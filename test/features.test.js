import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { PALETTE } from '../src/colors.js';
import { openDatabase } from '../src/db.js';
import { hashPassword } from '../src/passwords.js';
import { createApp } from '../src/server.js';
import { todayDate } from '../src/time.js';

function shiftDate(ymd, days) {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function jar() {
  const cookies = new Map();
  return {
    store(res) {
      for (const line of res.headers.getSetCookie?.() || []) {
        const pair = line.split(';')[0];
        const index = pair.indexOf('=');
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    },
    header() {
      return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    },
  };
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function page(base, cookies, urlPath) {
  const res = await fetch(base + urlPath, { redirect: 'manual', headers: { cookie: cookies.header() } });
  cookies.store(res);
  const text = await res.text();
  return { res, text, csrf: text.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1] || '' };
}

async function post(base, cookies, urlPath, fields) {
  const res = await fetch(base + urlPath, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: cookies.header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  cookies.store(res);
  return res;
}

async function login(base, email, password) {
  const cookies = jar();
  const form = await page(base, cookies, '/login');
  const res = await post(base, cookies, '/login', { email, password, _csrf: form.csrf, next: '/' });
  return { cookies, res };
}

test('projects, activity, mentions, csv, management, attachments', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-features-'));
  const app = createApp({
    port: 8082,
    sessionSecret: 'test-session-secret-value',
    dbPath: path.join(dir, 'board.sqlite'),
    dataDir: dir,
    adminEmail: 'arshad@example.com',
    adminPassword: 'super-password',
    adminName: 'Arshad',
    loginMax: 8,
    loginWindowMs: 15 * 60 * 1000,
  });
  const db = app.locals.db;
  const { server, base } = await listen(app);
  try {
    const admin = await login(base, 'arshad@example.com', 'super-password');
    const users = await page(base, admin.cookies, '/users');
    await post(base, admin.cookies, '/users', {
      _csrf: users.csrf,
      name: 'Lindi Nkosi',
      email: 'lindi@example.com',
      password: 'lindi-password',
      role: 'user',
    });
    const lindiRow = db.prepare('SELECT id FROM users WHERE email = ?').get('lindi@example.com');
    const listed = await page(base, admin.cookies, '/users');
    const people = db.prepare("SELECT id, color FROM users WHERE is_bot = 0").all();
    for (const person of people) {
      assert.match(listed.text, /swatch c-/);
      assert.match(listed.text, new RegExp(`form="user-${person.id}" type="radio" name="color" value="${person.color}" checked`));
    }
    assert.doesNotMatch(listed.text, / style=/);
    assert.match(listed.text, /class="swatch c-\d+" title="Lindi Nkosi"/);
    assert.match(listed.text, /title="Red"/);
    assert.match(listed.text, /title="Yellow"/);
    assert.doesNotMatch(listed.text, /class="swatch c-\d+" title="[^"]*" aria-hidden/);
    const form = await page(base, admin.cookies, '/tasks/new');
    const created = await post(base, admin.cookies, '/tasks', {
      _csrf: form.csrf,
      title: 'Tubecon logger',
      description: 'Fit the meter',
      status: 'todo',
      priority: 'urgent',
      due_date: shiftDate(todayDate(), -2),
      assignee_id: String(lindiRow.id),
      project_id: '',
      new_project: 'Tubecon',
    });
    assert.equal(created.status, 302);
    const taskId = Number(created.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    assert.equal(db.prepare('SELECT name FROM projects').get().name, 'Tubecon');

    const moved = await post(base, admin.cookies, `/tasks/${taskId}`, {
      _csrf: form.csrf,
      title: 'Tubecon logger',
      description: 'Fit the meter',
      status: 'review',
      priority: 'urgent',
      due_date: shiftDate(todayDate(), -2),
      assignee_id: String(lindiRow.id),
      project_id: String(db.prepare('SELECT id FROM projects').get().id),
      new_project: '',
    });
    assert.equal(moved.status, 302);
    const detail = await page(base, admin.cookies, `/tasks/${taskId}`);
    assert.match(detail.text, /Status: To Do → Review/);
    assert.match(detail.text, /Created the task/);

    await post(base, admin.cookies, `/tasks/${taskId}/comments`, {
      _csrf: form.csrf,
      body: 'Please check this @Lindi Nkosi',
    });
    const mentioned = await page(base, admin.cookies, `/tasks/${taskId}`);
    assert.match(mentioned.text, /class="mention"[^>]*>[\s\S]*?@Lindi Nkosi</);

    const lindi = await login(base, 'lindi@example.com', 'lindi-password');
    const mentions = await page(base, lindi.cookies, '/?mentions=1');
    assert.equal(mentions.res.status, 200);
    assert.match(mentions.text, /Tubecon logger/);
    const notMentioned = await page(base, admin.cookies, '/?mentions=1');
    assert.doesNotMatch(notMentioned.text, /Tubecon logger/);

    const projectId = db.prepare('SELECT id FROM projects').get().id;
    const filtered = await page(base, admin.cookies, `/?project=${projectId}`);
    assert.match(filtered.text, /Tubecon logger/);

    const csv = await fetch(`${base}/export.csv?project=${projectId}`, { headers: { cookie: admin.cookies.header() } });
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const csvText = await csv.text();
    assert.match(csvText, /Tubecon logger/);
    assert.match(csvText, /yes/);
    assert.match(csvText.split('\n')[0], /(^|,)time(,|$)/i);
    assert.match(filtered.text, /<th>Time<\/th>/);
    assert.match(filtered.text, /class="who"[\s\S]*swatch c-/);
    assert.match(filtered.text, /<th>Assignee<\/th>[\s\S]*swatch c-/);
    assert.doesNotMatch(filtered.text, / style=/);
    const calendar = await page(base, admin.cookies, `/calendar?month=${shiftDate(todayDate(), -2).slice(0, 7)}`);
    assert.match(calendar.text, /swatch c-/);
    assert.doesNotMatch(calendar.text, / style=/);
    assert.doesNotMatch(filtered.text, /info-btn/);
    assert.doesNotMatch(mentions.text, /info-btn/);
    assert.match(detail.text, /<h2>Time<\/h2>/);

    const manageDenied = await page(base, lindi.cookies, '/manage');
    assert.equal(manageDenied.res.status, 403);
    const manage = await page(base, admin.cookies, '/manage');
    assert.equal(manage.res.status, 200);
    assert.match(manage.text, /Lindi Nkosi/);
    assert.match(manage.text, /Tubecon logger/);
    assert.match(manage.text, /Needs attention/);
    assert.match(manage.text, /Tips/);
    assert.match(manage.text, /Created vs done/);
    assert.match(manage.text, /Avg days to finish/);
    assert.match(manage.text, /If created stays above done/);
    assert.doesNotMatch(manage.text, /info-btn/);
    assert.match(manage.text, /Not enough data yet/);
    assert.doesNotMatch(manageDenied.text, /href="\/manage"/);
    const again = await page(base, admin.cookies, '/users');
    await post(base, admin.cookies, '/users', { _csrf: again.csrf, name: 'Thabo Admin', email: 'thabo-admin@example.com', password: 'thabo-password', role: 'admin' });
    const thaboAdmin = await login(base, 'thabo-admin@example.com', 'thabo-password');
    assert.equal((await page(base, thaboAdmin.cookies, '/manage')).res.status, 200);
    assert.equal((await page(base, admin.cookies, '/manage')).res.status, 200);
    assert.doesNotMatch((await page(base, lindi.cookies, '/')).text, /href="\/manage"/);

    const uploadForm = new FormData();
    uploadForm.set('_csrf', form.csrf);
    uploadForm.set('file', new File(['meter photo'], 'meter.txt', { type: 'text/plain' }));
    const uploaded = await fetch(`${base}/tasks/${taskId}/attachments`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: admin.cookies.header() },
      body: uploadForm,
    });
    assert.equal(uploaded.status, 302);
    const file = db.prepare('SELECT id FROM attachments').get();
    assert.ok(file);
    const hidden = await fetch(`${base}/attachments/${file.id}`, { redirect: 'manual' });
    assert.equal(hidden.status, 302);
    const shown = await fetch(`${base}/attachments/${file.id}`, {
      headers: { cookie: admin.cookies.header() },
    });
    assert.equal(shown.status, 200);
    assert.equal(await shown.text(), 'meter photo');
    const withFile = await page(base, admin.cookies, `/tasks/${taskId}`);
    assert.match(withFile.text, /meter\.txt/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('an old database without colours still shows dots', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-old-color-'));
  const file = path.join(dir, 'old.sqlite');
  const now = new Date().toISOString();
  const due = todayDate();
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_id INTEGER,
      status TEXT NOT NULL,
      priority TEXT,
      due_date TEXT,
      created_by INTEGER NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  raw.prepare(`
    INSERT INTO users (email, name, password_hash, role, active, created_at, updated_at)
    VALUES ('lindi@example.com', 'Lindi Nkosi', ?, 'superuser', 1, ?, ?)
  `).run(hashPassword('old-password'), now, now);
  raw.prepare(`
    INSERT INTO tasks (title, description, assignee_id, status, priority, due_date, created_by, created_at, updated_at)
    VALUES ('Roof check', '', 1, 'todo', '', ?, 1, ?, ?)
  `).run(due, now, now);
  raw.close();

  const app = createApp({
    port: 8082,
    sessionSecret: 'test-session-secret-value',
    dbPath: file,
    dataDir: dir,
    adminEmail: 'arshad@example.com',
    adminPassword: 'super-password',
    adminName: 'Arshad',
    loginMax: 8,
    loginWindowMs: 15 * 60 * 1000,
  });
  const db = app.locals.db;
  const { server, base } = await listen(app);
  try {
    const stored = db.prepare("SELECT id, color FROM users WHERE email = 'lindi@example.com'").get();
    assert.equal(stored.color, PALETTE[0]);
    const session = await login(base, 'lindi@example.com', 'old-password');
    assert.equal(session.res.status, 302);
    const home = await page(base, session.cookies, '/');
    assert.match(home.text, /class="who"[\s\S]*class="swatch c-[\s\S]*who-name">Lindi Nkosi/);
    assert.match(home.text, /<th>Assignee<\/th>[\s\S]*class="swatch c-[\s\S]*Lindi Nkosi/);
    const calendar = await page(base, session.cookies, '/calendar');
    assert.match(calendar.text, /class="chip[^"]*"[\s\S]*class="swatch c-[\s\S]*Roof check/);

    db.prepare("UPDATE users SET color = 'BLUE' WHERE email = 'lindi@example.com'").run();
    const again = await page(base, session.cookies, '/');
    assert.match(again.text, /class="who"[\s\S]*class="swatch c-[\s\S]*who-name">Lindi Nkosi/);
    assert.match(again.text, /class="swatch c-[\s\S]*Lindi Nkosi/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  const reopened = openDatabase(file);
  try {
    const fixed = reopened.prepare("SELECT id, color FROM users WHERE email = 'lindi@example.com'").get();
    assert.equal(fixed.color, PALETTE[0]);
    assert.equal(fixed.color, fixed.color.toLowerCase());
  } finally {
    reopened.close();
  }
});
