import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backdropCloses } from '../public/dialog-close.js';
import { capRunningTimers, createTask, createUser, deleteTask, openDatabase, teamBoard, unreadMentionCount } from '../src/db.js';
import { buildManage } from '../src/manage.js';
import { publish } from '../src/events.js';
import { createApp } from '../src/server.js';
import { parseDuration, timerStopAt } from '../src/time.js';

test('clicking a dropdown item never closes the modal', () => {
  const dialog = { id: 'task-drawer' };
  const choice = { id: 'combo-choice' };
  assert.equal(backdropCloses(choice, dialog, dialog), false);
  assert.equal(backdropCloses(dialog, choice, dialog), false);
  assert.equal(backdropCloses(dialog, dialog, dialog), true);
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /menu\.addEventListener\('mousedown', \(event\) => event\.stopPropagation\(\)\)/);
  assert.match(source, /menu\.addEventListener\('click', \(event\) => event\.stopPropagation\(\)\)/);
  assert.match(source, /backdropCloses\(down, event\.target, dialog\)/);
  assert.match(source, /function bindShell\(/);
  assert.match(source, /function bindContent\(/);
  assert.match(source, /pagehide/);
  assert.doesNotMatch(source, /function bindPage\(/);
});

test('duration text accepts hours and minutes', () => {
  assert.equal(parseDuration('1h 30m'), 5400);
  assert.equal(parseDuration('1.5h'), 5400);
  assert.equal(parseDuration('45m'), 2700);
  assert.equal(parseDuration(''), null);
});

test('an overnight timer stops at the earlier of 18:00 SAST and four hours', () => {
  const started = '2026-11-25T14:00:00.000Z';
  assert.equal(timerStopAt(started), '2026-11-25T16:00:00.000Z');
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-cap-'));
  const db = openDatabase(path.join(dir, 'board.sqlite'));
  const user = createUser(db, { email: 'sam@example.com', name: 'Sam Cole', password: 'password1', role: 'user' });
  const taskId = createTask(db, {
    title: 'Night log',
    description: '',
    assigneeId: user.id,
    assigneeIds: [user.id],
    status: 'in_progress',
    priority: null,
    dueDate: null,
    projectId: null,
    createdBy: user.id,
  });
  db.prepare('INSERT INTO time_entries (task_id, user_id, started_at, ended_at) VALUES (?, ?, ?, NULL)').run(taskId, user.id, started);
  const fresh = '2026-11-26T06:00:00.000Z';
  db.prepare('INSERT INTO time_entries (task_id, user_id, started_at, ended_at) VALUES (?, ?, ?, NULL)').run(taskId, user.id, fresh);
  capRunningTimers(db, new Date('2026-11-26T07:00:00.000Z'));
  const rows = db.prepare('SELECT started_at, ended_at, auto_stopped FROM time_entries ORDER BY id').all();
  assert.equal(rows[0].ended_at, '2026-11-25T16:00:00.000Z');
  assert.equal(rows[0].auto_stopped, 1);
  assert.equal(rows[1].ended_at, null);
  assert.equal(rows[1].auto_stopped, 0);
  db.close();
});

test('old time entries gain the auto-stop columns', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-time-migrate-'));
  const file = path.join(dir, 'old.sqlite');
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE time_entries (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
  `);
  raw.close();
  const db = openDatabase(file);
  const names = db.prepare('PRAGMA table_info(time_entries)').all().map((column) => column.name);
  assert.ok(names.includes('auto_stopped'));
  assert.ok(names.includes('note'));
  assert.ok(names.includes('updated_at'));
  db.close();
});

test('old tasks gain a waiting_on column', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-wait-migrate-'));
  const file = path.join(dir, 'old.sqlite');
  const raw = new Database(file);
  raw.exec(`
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
  const names = db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name);
  assert.ok(names.includes('waiting_on'));
  db.close();
});

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

test('people can amend their own time and a superuser can amend anyone', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-amend-'));
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
      name: 'Sam Cole',
      email: 'sam@example.com',
      password: 'password1',
      role: 'user',
    });
    await post(base, admin.cookies, '/users', {
      _csrf: users.csrf,
      name: 'Alex Kim',
      email: 'alex@example.com',
      password: 'password1',
      role: 'user',
    });
    const sam = await login(base, 'sam@example.com', 'password1');
    const alex = await login(base, 'alex@example.com', 'password1');
    const samId = db.prepare("SELECT id FROM users WHERE email = 'sam@example.com'").get().id;
    const form = await page(base, sam.cookies, '/tasks/new');
    const created = await post(base, sam.cookies, '/tasks', {
      _csrf: form.csrf,
      title: 'Fit the meter',
      description: '',
      status: 'todo',
      priority: '',
      due_date: '',
      assignee_id: String(samId),
      project_id: '',
      new_project: '',
    });
    const taskId = Number(created.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const detail = await page(base, sam.cookies, `/tasks/${taskId}`);
    assert.match(detail.text, /Log time/);
    assert.doesNotMatch(detail.text, /name="hours"/);
    assert.doesNotMatch(detail.text, /name="minutes"/);
    assert.match(detail.text, /rows="3"/);
    assert.ok(detail.text.indexOf('>Comments') < detail.text.indexOf('Files and activity'));
    assert.match(detail.text, /class="task-col"/);
    const logged = await post(base, sam.cookies, `/tasks/${taskId}/time`, {
      _csrf: detail.csrf,
      duration: '20h 48m',
      date: '2026-11-26',
      note: 'left running',
    });
    assert.equal(logged.status, 302);
    const entry = db.prepare('SELECT id, user_id, auto_stopped FROM time_entries WHERE task_id = ?').get(taskId);
    assert.equal(entry.user_id, samId);
    const edited = await post(base, sam.cookies, `/tasks/${taskId}/time/${entry.id}`, {
      _csrf: detail.csrf,
      duration: '2h',
      date: '2026-11-26',
      note: 'fixed',
    });
    assert.equal(edited.status, 302);
    const after = db.prepare('SELECT started_at, ended_at, note, auto_stopped FROM time_entries WHERE id = ?').get(entry.id);
    assert.equal(after.note, 'fixed');
    assert.equal(after.auto_stopped, 0);
    assert.equal(Date.parse(after.ended_at) - Date.parse(after.started_at), 2 * 3600 * 1000);
    const activity = db.prepare('SELECT detail FROM activity WHERE task_id = ? ORDER BY id DESC').get(taskId).detail;
    assert.match(activity, /Amended time from 20h 48m to 2h 00m/);

    const blocked = await post(base, alex.cookies, `/tasks/${taskId}/time/${entry.id}`, {
      _csrf: (await page(base, alex.cookies, `/tasks/${taskId}`)).csrf,
      duration: '1h',
      date: '2026-11-26',
      note: 'nope',
    });
    assert.equal(blocked.status, 403);
    assert.equal(db.prepare('SELECT note FROM time_entries WHERE id = ?').get(entry.id).note, 'fixed');

    const adminPage = await page(base, admin.cookies, `/tasks/${taskId}`);
    const fixed = await post(base, admin.cookies, `/tasks/${taskId}/time/${entry.id}`, {
      _csrf: adminPage.csrf,
      duration: '1h 15m',
      date: '2026-11-26',
      note: 'super',
    });
    assert.equal(fixed.status, 302);
    const finalNote = db.prepare('SELECT note, ended_at, started_at FROM time_entries WHERE id = ?').get(entry.id);
    assert.equal(finalNote.note, 'super');
    assert.equal(Date.parse(finalNote.ended_at) - Date.parse(finalNote.started_at), 75 * 60 * 1000);
    const again = db.prepare('SELECT detail FROM activity WHERE task_id = ? ORDER BY id DESC').get(taskId).detail;
    assert.match(again, /Amended time from 2h 00m to 1h 15m/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('the event stream reaches the signed-in user and closes on shutdown', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-sse-'));
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
  const { server, base } = await listen(app);
  const db = app.locals.db;
  const admin = await login(base, 'arshad@example.com', 'super-password');
  const res = await fetch(`${base}/events`, { headers: { cookie: admin.cookies.header() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(res.headers.get('x-accel-buffering'), 'no');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const first = await reader.read();
  text += decoder.decode(first.value || new Uint8Array());
  assert.match(text, /connected/);
  publish({ type: 'board:changed', data: { actor: 'Grok', summary: 'Grok added: Fan', taskId: 4 } });
  const deadline = Date.now() + 2000;
  while (!text.includes('Grok added: Fan') && Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value || new Uint8Array());
  }
  assert.match(text, /event: board:changed/);
  assert.match(text, /Grok added: Fan/);
  const anonymous = await fetch(`${base}/events`, { redirect: 'manual' });
  assert.equal(anonymous.status, 401);
  await new Promise((resolve) => server.close(resolve));
  const closed = await reader.read();
  assert.equal(closed.done, true);
  db.close();
});

test('mentions ignore deleted tasks and only open Done when one is unread', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-mentions-'));
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
      name: 'Sam Cole',
      email: 'sam@example.com',
      password: 'password1',
      role: 'user',
    });
    const samId = db.prepare("SELECT id FROM users WHERE email = 'sam@example.com'").get().id;
    const form = await page(base, admin.cookies, '/tasks/new');
    const created = await post(base, admin.cookies, '/tasks', {
      _csrf: form.csrf,
      title: 'Site visit',
      description: `Ask @[Sam Cole](${samId}) to bring the meter`,
      status: 'todo',
      priority: '',
      due_date: '',
      assignee_id: String(samId),
      project_id: '',
      new_project: '',
    });
    const taskId = Number(created.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const done = await post(base, admin.cookies, `/tasks/${taskId}/complete`, { _csrf: form.csrf, back: '/' });
    assert.equal(done.status, 302);
    const sam = await login(base, 'sam@example.com', 'password1');
    const open = await page(base, sam.cookies, '/?mentions=1');
    assert.match(open.text, /Mark all read/);
    assert.match(open.text, /nav-badge/);
    assert.match(open.text, /aria-expanded="true"/);
    assert.doesNotMatch(open.text, /class="done-rows" hidden/);
    assert.match(open.text, /class="unread-mark"/);
    assert.match(open.text, /class="mention-snip"/);
    assert.match(open.text, /bring the meter/);
    const cleared = await post(base, sam.cookies, '/mentions/read', { _csrf: open.csrf });
    assert.equal(cleared.status, 302);
    const after = await page(base, sam.cookies, '/?mentions=1');
    assert.equal(unreadMentionCount(db, samId), 0);
    assert.doesNotMatch(after.text, /nav-badge/);
    assert.match(after.text, /Site visit/);
    assert.match(after.text, /class="done-rows" hidden/);
    const ghostId = createTask(db, {
      title: 'Gone',
      description: '',
      assigneeId: samId,
      assigneeIds: [samId],
      status: 'todo',
      priority: null,
      dueDate: null,
      projectId: null,
      createdBy: samId,
    });
    db.prepare('INSERT INTO mention_notices (user_id, task_id, created_at) VALUES (?, ?, ?)').run(samId, ghostId, new Date().toISOString());
    assert.equal(unreadMentionCount(db, samId), 1);
    deleteTask(db, ghostId);
    assert.equal(unreadMentionCount(db, samId), 0);
    db.prepare('INSERT INTO mention_notices (user_id, task_id, created_at) VALUES (?, ?, ?)').run(samId, ghostId, new Date().toISOString());
    assert.equal(unreadMentionCount(db, samId), 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('priority sort matches the list and the csv, and time notes keep start and end', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-sort-'));
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
    const home = await page(base, admin.cookies, '/');
    assert.match(home.text, /class="dayline-date"/);
    assert.match(home.text, /Fri, 27 Nov 2026|Sat, 28 Nov 2026|Thu, 26 Nov 2026/);
    assert.match(home.text, /name="sort"/);
    const form = await page(base, admin.cookies, '/tasks/new');
    const add = async (title, priority) => {
      const res = await post(base, admin.cookies, '/tasks', {
        _csrf: form.csrf,
        title,
        description: '',
        status: 'todo',
        priority,
        due_date: '',
        assignee_id: '',
        project_id: '',
        new_project: '',
      });
      return Number(res.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    };
    await add('Low cable', 'low');
    const urgentId = await add('Urgent inverter', 'urgent');
    await add('Med visit', 'med');
    const order = (text) => ['Urgent inverter', 'Med visit', 'Low cable'].map((title) => text.indexOf(title));
    const desc = await page(base, admin.cookies, '/?sort=priority_desc');
    const descAt = order(desc.text);
    assert.ok(descAt[0] < descAt[1] && descAt[1] < descAt[2]);
    assert.match(desc.text, /class="sort-link"/);
    assert.match(desc.text, /Priority ▼/);
    const asc = await page(base, admin.cookies, '/?sort=priority_asc');
    const ascAt = ['Low cable', 'Med visit', 'Urgent inverter'].map((title) => asc.text.indexOf(title));
    assert.ok(ascAt[0] < ascAt[1] && ascAt[1] < ascAt[2]);
    assert.match(asc.text, /Priority ▲/);
    const csvDesc = await fetch(`${base}/export.csv?sort=priority_desc`, { headers: { cookie: admin.cookies.header() } });
    const csvText = await csvDesc.text();
    const csvAt = order(csvText);
    assert.ok(csvAt[0] < csvAt[1] && csvAt[1] < csvAt[2]);
    assert.match(csvText.split('\n')[0], /Time Entries/);
    assert.match(csvText.split('\n')[0], /Completion Note/);
    const detail = await page(base, admin.cookies, `/tasks/${urgentId}`);
    const logged = await post(base, admin.cookies, `/tasks/${urgentId}/time`, {
      _csrf: detail.csrf,
      date: '2026-11-26',
      start: '08:30',
      end: '10:00',
      note: 'Replaced the breaker',
    });
    assert.equal(logged.status, 302);
    const shown = await page(base, admin.cookies, `/tasks/${urgentId}`);
    assert.match(shown.text, /26 Nov 2026, 08:30 – 10:00 \(1h 30m\)/);
    assert.match(shown.text, /Replaced the breaker/);
    const done = await post(base, admin.cookies, `/tasks/${urgentId}/complete`, {
      _csrf: detail.csrf,
      back: `/tasks/${urgentId}`,
      completion_note: 'Meter commissioned',
    });
    assert.equal(done.status, 302);
    const closed = await page(base, admin.cookies, `/tasks/${urgentId}`);
    assert.match(closed.text, /Meter commissioned/);
    const csvNote = await (await fetch(`${base}/export.csv?sort=priority_desc`, { headers: { cookie: admin.cookies.header() } })).text();
    assert.match(csvNote, /2026-11-26 08:30–10:00 \(1h 30m\): Replaced the breaker/);
    assert.match(csvNote, /Meter commissioned/);
    const blank = await post(base, admin.cookies, `/tasks/${urgentId}/complete`, {
      _csrf: detail.csrf,
      back: '/',
    });
    assert.equal(blank.status, 302);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('the board logs time from a dialog, complete can log time, and overdue dates can be pushed', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-log-'));
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
    const form = await page(base, admin.cookies, '/tasks/new');
    const adminId = db.prepare("SELECT id FROM users WHERE email = 'arshad@example.com'").get().id;
    const created = await post(base, admin.cookies, '/tasks', {
      _csrf: form.csrf,
      title: 'Late meter',
      description: '',
      status: 'todo',
      priority: '',
      due_date: '2026-11-20',
      assignee_id: String(adminId),
      project_id: '',
      new_project: '',
    });
    const taskId = Number(created.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const board = await page(base, admin.cookies, '/');
    assert.match(board.text, /\+ Log/);
    assert.match(board.text, /id="log-time-dialog"/);
    assert.match(board.text, /id="complete-dialog"/);
    assert.match(board.text, /id="reschedule-dialog"/);
    assert.match(board.text, /data-fill-duration="15m"/);
    assert.match(board.text, />Push</);
    assert.doesNotMatch(board.text, /timer\/start/);
    const detail = await page(base, admin.cookies, `/tasks/${taskId}`);
    assert.match(detail.text, /Start stopwatch/);
    assert.match(detail.text, /data-fill-duration="4h"/);
    const pushed = await post(base, admin.cookies, `/tasks/${taskId}/reschedule`, {
      _csrf: detail.csrf,
      due_date: '2026-11-30',
      reason: 'Waiting on supplier',
      back: `/tasks/${taskId}`,
    });
    assert.equal(pushed.status, 302);
    assert.equal(db.prepare('SELECT due_date FROM tasks WHERE id = ?').get(taskId).due_date, '2026-11-30');
    const activity = db.prepare('SELECT detail FROM activity WHERE task_id = ? ORDER BY id DESC').get(taskId).detail;
    assert.match(activity, /Rescheduled due date from 20 Nov 2026 to 30 Nov 2026: Waiting on supplier/);
    const finished = await post(base, admin.cookies, `/tasks/${taskId}/complete`, {
      _csrf: detail.csrf,
      duration: '30m',
      date: '2026-11-27',
      completion_note: 'Meter commissioned',
      back: `/tasks/${taskId}`,
    });
    assert.equal(finished.status, 302);
    assert.equal(db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId).status, 'done');
    assert.equal(db.prepare('SELECT completion_note FROM tasks WHERE id = ?').get(taskId).completion_note, 'Meter commissioned');
    const entry = db.prepare('SELECT started_at, ended_at, note FROM time_entries WHERE task_id = ?').get(taskId);
    assert.equal(Date.parse(entry.ended_at) - Date.parse(entry.started_at), 30 * 60 * 1000);
    assert.equal(entry.note, 'Meter commissioned');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('a task waiting on someone else is left out of overdue counts and on-time penalties', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-wait-'));
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
    const adminId = db.prepare("SELECT id FROM users WHERE email = 'arshad@example.com'").get().id;
    const form = await page(base, admin.cookies, '/tasks/new');
    const created = await post(base, admin.cookies, '/tasks', {
      _csrf: form.csrf,
      title: 'Held meter',
      description: '',
      status: 'todo',
      priority: '',
      due_date: '2026-11-20',
      assignee_id: String(adminId),
      project_id: '',
      new_project: '',
    });
    const taskId = Number(created.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const late = await page(base, admin.cookies, '/');
    assert.match(late.text, /1 overdue/);
    assert.match(late.text, /task-row overdue/);
    assert.match(late.text, /Waiting on external \(not our delay\)/);
    assert.match(late.text, /id="reschedule-dialog"/);
    const filtered = await page(base, admin.cookies, '/?overdue=1');
    assert.match(filtered.text, /Held meter/);
    assert.equal(teamBoard(db).find((row) => row.id === adminId).overdue, 1);
    assert.equal(buildManage(db).kpis.overdue, 1);

    const detail = await page(base, admin.cookies, `/tasks/${taskId}`);
    assert.match(detail.text, /Waiting on external \(not our delay\)/);
    const held = await post(base, admin.cookies, `/tasks/${taskId}/reschedule`, {
      _csrf: detail.csrf,
      due_date: '2026-11-21',
      reason: 'Site priority shift',
      waiting_present: '1',
      waiting_external: '1',
      waiting_on: 'Waiting on supplier',
      back: `/tasks/${taskId}`,
    });
    assert.equal(held.status, 302);
    assert.equal(db.prepare('SELECT due_date, waiting_on FROM tasks WHERE id = ?').get(taskId).waiting_on, 'Waiting on supplier');
    assert.equal(db.prepare('SELECT due_date FROM tasks WHERE id = ?').get(taskId).due_date, '2026-11-21');
    const notes = db.prepare('SELECT detail FROM activity WHERE task_id = ? ORDER BY id').all(taskId).map((row) => row.detail);
    assert.ok(notes.some((line) => /Rescheduled due date from 20 Nov 2026 to 21 Nov 2026: Site priority shift/.test(line)));
    assert.ok(notes.some((line) => line === 'Waiting on external: Waiting on supplier'));

    const calm = await page(base, admin.cookies, '/');
    assert.match(calm.text, /0 overdue/);
    assert.match(calm.text, /Waiting: Waiting on supplier/);
    assert.doesNotMatch(calm.text, /task-row overdue/);
    assert.match(calm.text, /task-row waiting/);
    const hidden = await page(base, admin.cookies, '/?overdue=1');
    assert.doesNotMatch(hidden.text, /Held meter/);
    assert.equal(teamBoard(db).find((row) => row.id === adminId).overdue, 0);
    assert.equal(buildManage(db).kpis.overdue, 0);
    assert.equal(buildManage(db).people.find((row) => row.id === adminId).overdue, 0);
    const csv = await (await fetch(`${base}/export.csv`, { headers: { cookie: admin.cookies.header() } })).text();
    assert.match(csv.split('\n')[0], /Waiting On/);
    assert.match(csv, /Waiting on supplier/);

    const cleared = await post(base, admin.cookies, `/tasks/${taskId}/waiting`, {
      _csrf: detail.csrf,
      clear: '1',
      back: '/',
    });
    assert.equal(cleared.status, 302);
    assert.equal(db.prepare('SELECT waiting_on FROM tasks WHERE id = ?').get(taskId).waiting_on, null);
    assert.match((await page(base, admin.cookies, '/')).text, /1 overdue/);
    assert.ok(db.prepare('SELECT detail FROM activity WHERE task_id = ? ORDER BY id DESC').get(taskId).detail.includes('Cleared the external wait'));

    await post(base, admin.cookies, `/tasks/${taskId}/waiting`, {
      _csrf: detail.csrf,
      waiting_present: '1',
      waiting_external: '1',
      waiting_on: 'Waiting on supplier',
      back: '/',
    });
    assert.equal(teamBoard(db).find((row) => row.id === adminId).overdue, 0);
    const doneLate = await post(base, admin.cookies, `/tasks/${taskId}/complete`, {
      _csrf: detail.csrf,
      back: '/',
    });
    assert.equal(doneLate.status, 302);
    const onTimeForm = await page(base, admin.cookies, '/tasks/new');
    const onTime = await post(base, admin.cookies, '/tasks', {
      _csrf: onTimeForm.csrf,
      title: 'Same day fix',
      description: '',
      status: 'todo',
      priority: '',
      due_date: '2026-11-27',
      assignee_id: String(adminId),
      project_id: '',
      new_project: '',
    });
    const onTimeId = Number(onTime.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const onTimePage = await page(base, admin.cookies, `/tasks/${onTimeId}`);
    await post(base, admin.cookies, `/tasks/${onTimeId}/complete`, {
      _csrf: onTimePage.csrf,
      back: '/',
    });
    assert.equal(teamBoard(db).find((row) => row.id === adminId).onTimePercent, 100);
    assert.equal(buildManage(db).people.find((row) => row.id === adminId).onTimePct, 100);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
