import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
      const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      for (const line of lines) {
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

async function page(base, cookies, urlPath, headers = {}) {
  const res = await fetch(base + urlPath, {
    redirect: 'manual',
    headers: { cookie: cookies.header(), ...headers },
  });
  cookies.store(res);
  const text = await res.text();
  const csrf = text.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1] || '';
  return { res, text, csrf };
}

async function post(base, cookies, urlPath, fields, headers = {}) {
  const res = await fetch(base + urlPath, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: cookies.header(),
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(fields),
  });
  cookies.store(res);
  return res;
}

async function login(base, email, password, headers = {}) {
  const cookies = jar();
  const form = await page(base, cookies, '/login', headers);
  const res = await post(base, cookies, '/login', {
    email,
    password,
    _csrf: form.csrf,
    next: '/',
  }, headers);
  return { cookies, res, form };
}

test('login, roles, tasks, and comments', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-'));
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
    const health = await fetch(`${base}/healthz`);
    assert.equal(await health.text(), 'ok');

    const logo = await fetch(`${base}/sunspec-logo.png`);
    const bytes = Buffer.from(await logo.arrayBuffer());
    assert.equal(logo.status, 200);
    assert.equal(bytes.subarray(0, 4).toString('hex'), '89504e47');
    const css = await fetch(`${base}/styles.css`);
    assert.equal(css.status, 200);

    const loggedOut = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(loggedOut.status, 302);
    assert.match(loggedOut.headers.get('location'), /^\/login/);

    const bad = await login(base, 'arshad@example.com', 'wrong-password');
    assert.equal(bad.res.status, 302);
    assert.equal(bad.res.headers.get('location'), '/login?msg=badlogin');

    const https = await login(base, 'arshad@example.com', 'super-password', { 'x-forwarded-proto': 'https' });
    const secureCookie = https.res.headers.getSetCookie().find((line) => line.startsWith('sid='));
    assert.ok(secureCookie);
    assert.match(secureCookie, /\bSecure\b/);
    assert.match(secureCookie, /HttpOnly/i);
    assert.match(secureCookie, /SameSite=Strict/i);

    const session = await login(base, 'arshad@example.com', 'super-password');
    const plainCookie = session.res.headers.getSetCookie().find((line) => line.startsWith('sid='));
    assert.ok(plainCookie);
    assert.doesNotMatch(plainCookie, /\bSecure\b/);
    assert.equal(session.res.headers.get('location'), '/');

    const home = await page(base, session.cookies, '/');
    assert.equal(home.res.status, 200);
    assert.match(home.text, /class="who"[\s\S]*class="swatch c-[\s\S]*who-name">Arshad[\s\S]*role-superuser/);
    assert.match(home.text, /role-superuser/);
    assert.match(home.text, /src="\/sunspec-logo.png"/);

    const usersPage = await page(base, session.cookies, '/users');
    assert.match(usersPage.text, /role-superuser/);
    const createdUser = await post(base, session.cookies, '/users', {
      _csrf: usersPage.csrf,
      name: 'Lindi Nkosi',
      email: 'lindi@example.com',
      password: 'lindi-password',
      role: 'user',
    });
    assert.equal(createdUser.status, 302);
    const createdAdmin = await post(base, session.cookies, '/users', {
      _csrf: usersPage.csrf,
      name: 'Thabo Admin',
      email: 'thabo@example.com',
      password: 'thabo-password',
      role: 'admin',
    });
    assert.equal(createdAdmin.status, 302);
    const lindiRow = db.prepare('SELECT id, role FROM users WHERE email = ?').get('lindi@example.com');
    const thaboRow = db.prepare('SELECT id, role FROM users WHERE email = ?').get('thabo@example.com');
    const superRow = db.prepare('SELECT id FROM users WHERE email = ?').get('arshad@example.com');
    assert.equal(lindiRow.role, 'user');
    assert.equal(thaboRow.role, 'admin');

    const thabo = await login(base, 'thabo@example.com', 'thabo-password');
    const thaboUsers = await page(base, thabo.cookies, '/users');
    assert.equal(thaboUsers.res.status, 200);
    assert.doesNotMatch(thaboUsers.text, /arshad@example.com/);
    const tamper = await post(base, thabo.cookies, '/users', {
      _csrf: thaboUsers.csrf,
      name: 'Sneaky',
      email: 'sneaky@example.com',
      password: 'sneaky-password',
      role: 'superuser',
    });
    assert.equal(tamper.status, 302);
    assert.equal(db.prepare('SELECT role FROM users WHERE email = ?').get('sneaky@example.com').role, 'user');
    const editSuper = await post(base, thabo.cookies, `/users/${superRow.id}`, {
      _csrf: thaboUsers.csrf,
      name: 'Arshad',
      email: 'arshad@example.com',
      role: 'user',
    });
    assert.equal(editSuper.status, 403);

    const lindi = await login(base, 'lindi@example.com', 'lindi-password');
    const lindiUsers = await page(base, lindi.cookies, '/users');
    assert.equal(lindiUsers.res.status, 403);

    const ownForm = await page(base, lindi.cookies, '/tasks/new');
    const own = await post(base, lindi.cookies, '/tasks', {
      _csrf: ownForm.csrf,
      title: 'Lindi own task',
      description: 'Pull the logs',
      status: 'todo',
      priority: 'low',
      due_date: '',
      assignee_id: '',
    });
    assert.equal(own.status, 302);
    const ownId = Number(own.headers.get('location').match(/\/tasks\/(\d+)/)[1]);

    const yesterday = shiftDate(todayDate(), -1);
    const newForm = await page(base, session.cookies, '/tasks/new');
    const assigned = await post(base, session.cookies, '/tasks', {
      _csrf: newForm.csrf,
      title: 'Install logger',
      description: 'On site tomorrow was yesterday',
      status: 'todo',
      priority: 'high',
      due_date: yesterday,
      assignee_id: String(lindiRow.id),
    });
    assert.equal(assigned.status, 302);
    const assignedId = Number(assigned.headers.get('location').match(/\/tasks\/(\d+)/)[1]);

    const done = await post(base, session.cookies, '/tasks', {
      _csrf: newForm.csrf,
      title: 'Already finished',
      description: 'Closed out',
      status: 'done',
      priority: '',
      due_date: yesterday,
      assignee_id: String(thaboRow.id),
    });
    const doneId = Number(done.headers.get('location').match(/\/tasks\/(\d+)/)[1]);

    const lindiEdit = await page(base, lindi.cookies, `/tasks/${assignedId}`);
    const moved = await post(base, lindi.cookies, `/tasks/${assignedId}`, {
      _csrf: lindiEdit.csrf,
      title: 'Install logger',
      description: 'On site tomorrow was yesterday',
      status: 'in_progress',
      priority: 'high',
      due_date: yesterday,
      assignee_id: String(lindiRow.id),
    });
    assert.equal(moved.status, 302);
    assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(assignedId).status, 'in_progress');

    const forbiddenEdit = await post(base, lindi.cookies, `/tasks/${doneId}`, {
      _csrf: lindiEdit.csrf,
      title: 'Already finished',
      description: 'Hijack',
      status: 'todo',
      priority: '',
      due_date: '',
      assignee_id: String(lindiRow.id),
    });
    assert.equal(forbiddenEdit.status, 403);
    assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(doneId).status, 'done');

    const thaboEdit = await page(base, thabo.cookies, `/tasks/${ownId}`);
    const adminEdit = await post(base, thabo.cookies, `/tasks/${ownId}`, {
      _csrf: thaboEdit.csrf,
      title: 'Lindi own task',
      description: 'Pull the logs',
      status: 'review',
      priority: 'low',
      due_date: '',
      assignee_id: '',
    });
    assert.equal(adminEdit.status, 302);

    const comment = await post(base, lindi.cookies, `/tasks/${assignedId}/comments`, {
      _csrf: lindiEdit.csrf,
      body: 'Checked the breaker',
    });
    assert.equal(comment.status, 302);
    const detail = await page(base, lindi.cookies, `/tasks/${assignedId}`);
    assert.match(detail.text, /Checked the breaker/);
    assert.match(detail.text, /Lindi Nkosi/);

    const otherComment = await post(base, session.cookies, `/tasks/${assignedId}/comments`, {
      _csrf: newForm.csrf,
      body: 'Bring the spare CT',
    });
    assert.equal(otherComment.status, 302);
    const other = db.prepare("SELECT id FROM comments WHERE body = ?").get('Bring the spare CT');
    const cannotDelete = await post(base, lindi.cookies, `/comments/${other.id}/delete`, { _csrf: lindiEdit.csrf });
    assert.equal(cannotDelete.status, 403);
    const ownComment = db.prepare("SELECT id FROM comments WHERE body = ?").get('Checked the breaker');
    const deletedOwn = await post(base, lindi.cookies, `/comments/${ownComment.id}/delete`, { _csrf: detail.csrf });
    assert.equal(deletedOwn.status, 302);
    const superDelete = await post(base, session.cookies, `/comments/${other.id}/delete`, { _csrf: newForm.csrf });
    assert.equal(superDelete.status, 302);

    const cannotDeleteTask = await post(base, lindi.cookies, `/tasks/${assignedId}/delete`, { _csrf: lindiEdit.csrf });
    assert.equal(cannotDeleteTask.status, 403);

    const board = await page(base, session.cookies, '/');
    const rows = [...board.text.matchAll(/<tr class="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g)];
    const install = rows.find((row) => row[2].includes('Install logger'));
    const finished = rows.find((row) => row[2].includes('Already finished'));
    assert.ok(install);
    assert.match(install[1], /overdue/);
    assert.match(install[2], /In Progress/);
    assert.match(install[2], /High/);
    assert.ok(finished);
    assert.doesNotMatch(finished[1], /overdue/);

    const mine = await page(base, lindi.cookies, '/?mine=1');
    assert.match(mine.text, /Install logger/);
    assert.doesNotMatch(mine.text, /Already finished/);
    const overdue = await page(base, session.cookies, '/?overdue=1');
    assert.match(overdue.text, /Install logger/);
    assert.doesNotMatch(overdue.text, /Already finished/);
    const search = await page(base, session.cookies, '/?q=logger');
    assert.match(search.text, /Install logger/);
    assert.doesNotMatch(search.text, /Already finished/);

    const reset = await post(base, session.cookies, `/users/${lindiRow.id}`, {
      _csrf: usersPage.csrf,
      name: 'Lindi Nkosi',
      email: 'lindi@example.com',
      role: 'user',
      password: 'lindi-new-password',
      active: '1',
    });
    assert.equal(reset.status, 302);
    const relog = await login(base, 'lindi@example.com', 'lindi-new-password');
    assert.equal(relog.res.headers.get('location'), '/');

    const deactivated = await post(base, session.cookies, `/users/${lindiRow.id}`, {
      _csrf: usersPage.csrf,
      name: 'Lindi Nkosi',
      email: 'lindi@example.com',
      role: 'user',
    });
    assert.equal(deactivated.status, 302);
    assert.equal(db.prepare('SELECT active FROM users WHERE id = ?').get(lindiRow.id).active, 0);
    const blocked = await login(base, 'lindi@example.com', 'lindi-new-password');
    assert.equal(blocked.res.headers.get('location'), '/login?msg=badlogin');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('login rate limit', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-limit-'));
  const app = createApp({
    port: 8082,
    sessionSecret: 'test-session-secret-value',
    dbPath: path.join(dir, 'board.sqlite'),
    dataDir: dir,
    adminEmail: 'arshad@example.com',
    adminPassword: 'super-password',
    adminName: 'Arshad',
    loginMax: 2,
    loginWindowMs: 15 * 60 * 1000,
  });
  const { server, base } = await listen(app);
  try {
    assert.equal((await login(base, 'arshad@example.com', 'nope-1')).res.headers.get('location'), '/login?msg=badlogin');
    assert.equal((await login(base, 'arshad@example.com', 'nope-2')).res.headers.get('location'), '/login?msg=badlogin');
    assert.equal((await login(base, 'arshad@example.com', 'super-password')).res.headers.get('location'), '/login?msg=ratelimit');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.db.close();
  }
});
