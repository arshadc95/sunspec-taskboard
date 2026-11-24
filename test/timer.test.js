import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';

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

test('migrates time entries onto an existing database', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-migrate-'));
  const file = path.join(dir, 'old.sqlite');
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
  raw.close();
  const db = openDatabase(file);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'time_entries'").get());
  db.close();
});

test('task timers', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-timer-'));
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
    const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
    assert.match(styles, /\.title-link:hover\s*\{[^}]*text-decoration:\s*underline/);
    assert.match(styles, /tr\.task-row\s*\{[^}]*cursor:\s*pointer/);

    const admin = await login(base, 'arshad@example.com', 'super-password');
    const users = await page(base, admin.cookies, '/users');
    await post(base, admin.cookies, '/users', {
      _csrf: users.csrf,
      name: 'Lindi Nkosi',
      email: 'lindi@example.com',
      password: 'lindi-password',
      role: 'user',
    });
    const lindiId = db.prepare("SELECT id FROM users WHERE email = 'lindi@example.com'").get().id;
    const lindi = await login(base, 'lindi@example.com', 'lindi-password');
    const form = await page(base, lindi.cookies, '/tasks/new');
    const first = await post(base, lindi.cookies, '/tasks', {
      _csrf: form.csrf,
      title: 'Tubecon Off-Grid Test',
      description: 'Run the test',
      status: 'todo',
      priority: '',
      due_date: '',
      assignee_id: String(lindiId),
      project_id: '',
      new_project: 'Tubecon',
    });
    const firstId = Number(first.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const second = await post(base, lindi.cookies, '/tasks', {
      _csrf: form.csrf,
      title: 'Write the report',
      description: '',
      status: 'todo',
      priority: '',
      due_date: '',
      assignee_id: String(lindiId),
      project_id: '',
      new_project: '',
    });
    const secondId = Number(second.headers.get('location').match(/\/tasks\/(\d+)/)[1]);

    const boardBefore = await page(base, lindi.cookies, '/');
    assert.match(boardBefore.text, /class="title-link"/);
    assert.match(boardBefore.text, new RegExp(`data-href="/tasks/${firstId}"`));

    const started = await post(base, lindi.cookies, `/tasks/${firstId}/timer/start`, { _csrf: form.csrf });
    assert.equal(started.status, 302);
    assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(firstId).status, 'in_progress');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE user_id = (SELECT id FROM users WHERE email = ?) AND ended_at IS NULL').get('lindi@example.com').n, 1);
    const detail = await page(base, lindi.cookies, `/tasks/${firstId}`);
    assert.doesNotMatch(detail.text, /timer-elapsed/);
    assert.doesNotMatch(detail.text, /timer\/stop/);
    const runningBoard = await page(base, lindi.cookies, '/');
    assert.doesNotMatch(runningBoard.text, /timer\/start/);

    const switched = await post(base, lindi.cookies, `/tasks/${secondId}/timer/start`, { _csrf: form.csrf });
    assert.equal(switched.status, 302);
    const firstEntry = db.prepare('SELECT ended_at FROM time_entries WHERE task_id = ?').get(firstId);
    assert.ok(firstEntry.ended_at);
    assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(secondId).status, 'in_progress');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL AND user_id = (SELECT id FROM users WHERE email = 'lindi@example.com')").get().n, 1);

    const also = await post(base, admin.cookies, `/tasks/${secondId}/timer/start`, { _csrf: users.csrf });
    assert.equal(also.status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE task_id = ? AND ended_at IS NULL').get(secondId).n, 1);

    const stopped = await post(base, lindi.cookies, `/tasks/${secondId}/timer/stop`, { _csrf: form.csrf });
    assert.equal(stopped.status, 302);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL AND user_id = (SELECT id FROM users WHERE email = 'lindi@example.com')").get().n, 0);

    const done = await post(base, admin.cookies, '/tasks', {
      _csrf: users.csrf,
      title: 'Finished install',
      description: '',
      status: 'done',
      priority: '',
      due_date: '',
      assignee_id: '',
      project_id: String(db.prepare("SELECT id FROM projects WHERE name = 'Tubecon'").get().id),
      new_project: '',
    });
    const doneId = Number(done.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const startedAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO time_entries (task_id, user_id, started_at, ended_at) VALUES (?, ?, ?, ?)').run(
      doneId,
      lindiId,
      startedAt,
      new Date().toISOString(),
    );
    const manage = await page(base, admin.cookies, '/manage');
    assert.equal(manage.res.status, 200);
    assert.match(manage.text, /People/);
    assert.doesNotMatch(manage.text, /Time spent/);
    assert.match(manage.text, /Finished install/);
    assert.match(manage.text, /Lindi Nkosi/);
    assert.match(manage.text, /Tubecon/);
    const filtered = await page(base, admin.cookies, '/manage?project=' + db.prepare("SELECT id FROM projects WHERE name = 'Tubecon'").get().id);
    assert.match(filtered.text, /Tubecon/);
    assert.doesNotMatch(filtered.text, /Time spent/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
