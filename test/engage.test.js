import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/server.js';
import { todayDate } from '../src/time.js';

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
  await post(base, cookies, '/login', { email, password, _csrf: form.csrf, next: '/' });
  return cookies;
}

test('complete, kudos, mentions, calendar, team', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-engage-'));
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
    const users = await page(base, admin, '/users');
    await post(base, admin, '/users', {
      _csrf: users.csrf, name: 'Thabang Madikgetla', email: 'thabang@example.com', password: 'thabang-password', role: 'user',
    });
    const thabangId = db.prepare("SELECT id FROM users WHERE email = 'thabang@example.com'").get().id;
    const form = await page(base, admin, '/tasks/new');
    const created = await post(base, admin, '/tasks', {
      _csrf: form.csrf,
      title: 'Site visit',
      description: `Ask @[Thabang Madikgetla](${thabangId}) to bring the meter`,
      status: 'todo',
      priority: 'high',
      due_date: todayDate(),
      assignee_id: String(thabangId),
      project_id: '',
      new_project: '',
    });
    const taskId = Number(created.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const thabang = await login(base, 'thabang@example.com', 'thabang-password');
    const mentions = await page(base, thabang, '/?mentions=1');
    assert.match(mentions.text, /Site visit/);
    assert.match(mentions.text, /nav-badge/);
    const opened = await page(base, thabang, `/tasks/${taskId}`);
    assert.doesNotMatch(opened.text, /nav-badge/);
    assert.match(opened.text, /class="mention"/);
    assert.match(opened.text, /Thabang Madikgetla/);

    const board = await page(base, thabang, '/');
    assert.doesNotMatch(board.text, /row-remove/);
    assert.match(board.text, /data-live/);
    assert.match(board.text, /My day/);
    assert.doesNotMatch(board.text, />Apply</);
    assert.doesNotMatch(board.text, /timer\/start/);
    const stranger = await post(base, admin, `/tasks/${taskId}/timer/start`, { _csrf: users.csrf });
    assert.equal(stranger.status, 403);
    const started = await post(base, thabang, `/tasks/${taskId}/timer/start`, { _csrf: opened.csrf, return: 'board', back: '/' });
    assert.equal(started.status, 302);
    const completed = await post(base, thabang, `/tasks/${taskId}/complete`, { _csrf: opened.csrf, back: '/' });
    assert.equal(completed.status, 302);
    assert.match(completed.headers.get('location'), /toast=done/);
    assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId).status, 'done');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE task_id = ? AND ended_at IS NULL').get(taskId).n, 0);
    const undone = await post(base, thabang, `/tasks/${taskId}/reopen`, { _csrf: opened.csrf, status: 'todo', back: '/' });
    assert.equal(undone.status, 302);
    assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId).status, 'todo');

    await post(base, thabang, `/tasks/${taskId}/complete`, { _csrf: opened.csrf, back: `/tasks/${taskId}` });
    const kudo = await post(base, admin, '/kudos', {
      _csrf: users.csrf, target_type: 'task', target_id: String(taskId), return: `/tasks/${taskId}`,
    });
    assert.equal(kudo.status, 302);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM kudos').get().n, 1);
    const calendar = await page(base, admin, '/calendar');
    assert.equal(calendar.res.status, 200);
    assert.match(calendar.text, /Site visit/);
    const team = await page(base, admin, '/team');
    assert.match(team.text, /Thabang Madikgetla/);
    assert.match(team.text, /On time/);
    const denied = await post(base, thabang, `/tasks/${taskId}/delete`, { _csrf: opened.csrf });
    assert.equal(denied.status, 403);
    const removed = await post(base, admin, `/tasks/${taskId}/delete`, { _csrf: users.csrf, back: '/' });
    assert.equal(removed.status, 302);
    assert.equal(db.prepare('SELECT deleted_at IS NOT NULL AS gone FROM tasks WHERE id = ?').get(taskId).gone, 1);
    const hidden = await page(base, admin, '/');
    assert.doesNotMatch(hidden.text, />Site visit</);
    const calendarGone = await page(base, admin, '/calendar');
    assert.doesNotMatch(calendarGone.text, /Site visit/);
    const adminUsers = await page(base, admin, '/users');
    assert.match(adminUsers.text, /Removed/);
    assert.match(adminUsers.text, /Site visit/);
    const restored = await post(base, admin, `/tasks/${taskId}/restore`, { _csrf: users.csrf });
    assert.equal(restored.status, 302);
    const visible = await page(base, admin, '/');
    assert.match(visible.text, /Site visit/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
