import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
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
  await post(base, cookies, '/login', { email, password, _csrf: form.csrf, next: '/' });
  return cookies;
}

function waitFor(list, count = 1) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (list.length >= count) {
        clearInterval(timer);
        resolve(list);
      } else if (Date.now() - started > 4000) {
        clearInterval(timer);
        reject(new Error('webhook did not arrive'));
      }
    }, 30);
  });
}

test('grok chat, mentions, and bot api', { timeout: 60000 }, async () => {
  const hits = [];
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      hits.push({ secret: req.headers['x-grok-secret'], body: JSON.parse(body) });
      res.end('ok');
    });
  });
  await new Promise((resolve) => hook.listen(0, '127.0.0.1', resolve));
  const hookBase = `http://127.0.0.1:${hook.address().port}/hook`;
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-grok-'));
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
    grokWebhookUrl: hookBase,
    grokWebhookSecretHeader: 'X-Grok-Secret',
    grokWebhookSecret: 'test-secret',
    botApiToken: 'test-bot-token',
    grokDailyLimit: 2,
    grokHourlyLimit: 20,
  });
  const db = app.locals.db;
  const { server, base } = await listen(app);
  const off = createApp({
    port: 8082,
    sessionSecret: 'test-session-secret-value',
    dbPath: path.join(dir, 'off.sqlite'),
    dataDir: dir,
    adminEmail: 'arshad@example.com',
    adminPassword: 'super-password',
    adminName: 'Arshad',
    loginMax: 8,
    loginWindowMs: 15 * 60 * 1000,
  });
  const offListen = await listen(off);
  try {
    const grok = db.prepare("SELECT * FROM users WHERE email = 'grok@taskboard.local'").get();
    assert.equal(grok.name, 'Grok');
    assert.equal(grok.role, 'user');
    assert.equal(grok.active, 0);
    assert.equal(grok.is_bot, 1);

    const admin = await login(base, 'arshad@example.com', 'super-password');
    const home = await page(base, admin, '/');
    assert.match(home.text, /class="grok-bubble"/);
    assert.match(home.text, /id="mention-extra"/);
    assert.match(home.text, /"name":"Grok"/);
    const people = home.text.match(/id="people-data">([^<]+)/)[1];
    assert.equal(people.includes('Grok'), false);

    const users = await page(base, admin, '/users');
    assert.equal(users.text.includes('grok@taskboard.local'), false);
    const guest = jar();
    const loginPage = await page(base, guest, '/login');
    const blocked = await post(base, guest, '/login', { email: 'grok@taskboard.local', password: 'super-password', _csrf: loginPage.csrf });
    assert.equal(blocked.headers.get('location'), '/login?msg=badlogin');

    const sent = await fetch(`${base}/api/grok`, {
      method: 'POST',
      headers: { cookie: admin.header(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: home.csrf, text: 'What is due today?' }),
    });
    const chat = await sent.json();
    assert.equal(sent.status, 200);
    assert.equal(chat.pending, true);
    assert.equal(chat.messages.at(-2).body, 'What is due today?');
    const received = await waitFor(hits);
    assert.equal(received[0].secret, 'test-secret');
    assert.equal(received[0].body.type, 'chat');
    assert.equal(received[0].body.thread_id, chat.thread_id);
    assert.equal(received[0].body.user.name, 'Arshad');
    assert.equal(received[0].body.text, 'What is due today?');
    assert.equal(received[0].body.recent_context.at(-1).text, 'What is due today?');
    assert.equal(received[0].body.board_snapshot.users.some((user) => user.name === 'Arshad' && user.id), true);
    assert.equal(received[0].body.board_snapshot.users.some((user) => user.name === 'Grok'), false);
    assert.ok(Array.isArray(received[0].body.board_snapshot.projects));
    assert.ok(Array.isArray(received[0].body.board_snapshot.tasks));

    const arshadId = db.prepare("SELECT id FROM users WHERE email = 'arshad@example.com'").get().id;
    const status = await fetch(`${base}/api/bot/chat/${chat.thread_id}/status`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: arshadId, request_id: received[0].body.request_id, text: 'Reading the board…' }),
    });
    assert.equal(status.status, 200);
    const live = await (await fetch(`${base}/api/grok?thread=${chat.thread_id}`, { headers: { cookie: admin.header(), accept: 'application/json' } })).json();
    assert.equal(live.messages.at(-1).live, 'Reading the board…');
    assert.equal(live.waiting.length, 1);
    const stranger = await fetch(`${base}/api/bot/chat/${chat.thread_id}/status`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: 99999, request_id: received[0].body.request_id, text: 'Nope' }),
    });
    assert.equal(stranger.status, 403);
    const reply = await fetch(`${base}/api/bot/chat/${chat.thread_id}/reply`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: arshadId, request_id: received[0].body.request_id, text: 'Nothing is due today.' }),
    });
    assert.equal(reply.status, 200);
    const polled = await fetch(`${base}/api/grok`, { headers: { cookie: admin.header(), accept: 'application/json' } });
    const after = await polled.json();
    assert.equal(after.pending, false);
    assert.equal(after.waiting.length, 0);
    assert.equal(after.messages.at(-1).body, 'Nothing is due today.');
    assert.equal(after.messages.at(-1).live, '');

    const unauth = await fetch(`${base}/api/bot/tasks`);
    assert.equal(unauth.status, 401);
    const disabled = await fetch(`${offListen.base}/api/bot/tasks`, { headers: { authorization: 'Bearer test-bot-token' } });
    assert.equal(disabled.status, 503);

    const userPage = await page(base, admin, '/users');
    await post(base, admin, '/users', {
      _csrf: userPage.csrf, name: 'Lindi Nkosi', email: 'lindi@example.com', password: 'lindi-password', role: 'user',
    });
    const lindi = await login(base, 'lindi@example.com', 'lindi-password');
    const lindiId = db.prepare("SELECT id FROM users WHERE email = 'lindi@example.com'").get().id;
    const form = await page(base, admin, '/tasks/new');
    const created = await post(base, admin, '/tasks', {
      _csrf: form.csrf, title: 'Replace the inverter fan', status: 'todo', priority: 'high',
    });
    const taskId = Number(created.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const taskPage = await page(base, lindi, `/tasks/${taskId}`);
    const mentioned = await post(base, lindi, `/tasks/${taskId}/comments`, {
      _csrf: taskPage.csrf,
      body: `@[Grok](${grok.id}) can you look?`,
    });
    assert.equal(mentioned.status, 302);
    await waitFor(hits, 2);
    assert.equal(hits[1].body.type, 'comment');
    assert.equal(hits[1].body.task.id, taskId);
    assert.equal(hits[1].body.task.title, 'Replace the inverter fan');
    assert.equal(hits[1].body.user.name, 'Lindi Nkosi');
    assert.equal(hits[1].body.thread_id, undefined);
    const snapTask = hits[1].body.board_snapshot.tasks.find((task) => task.id === taskId);
    assert.equal(snapTask.title, 'Replace the inverter fan');
    assert.equal(snapTask.status, 'todo');
    assert.equal(Object.hasOwn(snapTask, 'assignee_id'), true);
    assert.equal(Object.hasOwn(snapTask, 'due'), true);
    assert.equal(Object.hasOwn(snapTask, 'priority'), true);
    const taskStatus = await fetch(`${base}/api/bot/tasks/${taskId}/status`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: lindiId, request_id: hits[1].body.request_id, text: 'Creating task…' }),
    });
    assert.equal(taskStatus.status, 200);
    const waitingPage = await page(base, lindi, `/tasks/${taskId}`);
    assert.match(waitingPage.text, /Got it, working on it/);
    assert.match(waitingPage.text, /Creating task/);
    const taskLive = await (await fetch(`${base}/api/grok/tasks/${taskId}`, { headers: { cookie: lindi.header(), accept: 'application/json' } })).json();
    assert.equal(taskLive.waiting, true);
    assert.equal(taskLive.live, 'Creating task…');

    const comment = await fetch(`${base}/api/bot/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: lindiId, body: 'Looking now.' }),
    });
    assert.equal(comment.status, 201);
    const shown = await page(base, lindi, `/tasks/${taskId}`);
    assert.match(shown.text, /Looking now\./);
    assert.equal(shown.text.includes('data-grok-task'), false);
    const cleared = await (await fetch(`${base}/api/grok/tasks/${taskId}`, { headers: { cookie: lindi.header(), accept: 'application/json' } })).json();
    assert.equal(cleared.waiting, false);
    assert.equal(cleared.live, '');
    assert.match(shown.text, />Grok</);
    const activity = db.prepare('SELECT detail FROM activity WHERE task_id = ? ORDER BY id DESC').get(taskId);
    assert.match(activity.detail, /Grok \(on behalf of Lindi Nkosi\)/);

    const denied = await fetch(`${base}/api/bot/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: lindiId, title: 'Nope' }),
    });
    assert.equal(denied.status, 403);

    const edited = await fetch(`${base}/api/bot/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: arshadId, status: 'in_progress', assignee_id: lindiId }),
    });
    assert.equal(edited.status, 200);
    const done = await fetch(`${base}/api/bot/complete/${taskId}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: lindiId }),
    });
    assert.equal(done.status, 200);
    assert.equal((await done.json()).task.status, 'done');

    const listed = await fetch(`${base}/api/bot/users`, { headers: { authorization: 'Bearer test-bot-token' } });
    const names = (await listed.json()).users.map((user) => user.name);
    assert.equal(names.includes('Grok'), false);
    assert.equal(names.includes('Lindi Nkosi'), true);

    const again = await fetch(`${base}/api/grok`, {
      method: 'POST',
      headers: { cookie: lindi.header(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: taskPage.csrf, text: 'One more' }),
    });
    assert.equal(again.status, 200);
    const third = await fetch(`${base}/api/grok`, {
      method: 'POST',
      headers: { cookie: lindi.header(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: taskPage.csrf, text: 'And another' }),
    });
    const limited = await third.json();
    assert.equal(third.status, 429);
    assert.match(limited.error, /daily limit/i);

    const quietCookies = await login(offListen.base, 'arshad@example.com', 'super-password');
    const quiet = await page(offListen.base, quietCookies, '/');
    const disconnected = await fetch(`${offListen.base}/api/grok`, {
      method: 'POST',
      headers: { cookie: quietCookies.header(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: quiet.csrf, text: 'Hello' }),
    });
    assert.equal(disconnected.status, 503);
    assert.match((await disconnected.json()).error, /isn't connected/);
  } finally {
    server.close();
    offListen.server.close();
    hook.close();
  }
});

test('several grok chats and pdf files', { timeout: 60000 }, async () => {
  const hits = [];
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { hits.push({ body: JSON.parse(body || '{}') }); res.end('ok'); });
  });
  await new Promise((resolve) => hook.listen(0, '127.0.0.1', resolve));
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-grok-files-'));
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
    grokWebhookUrl: `http://127.0.0.1:${hook.address().port}/hook`,
    botApiToken: 'test-bot-token',
    grokDailyLimit: 100,
    grokHourlyLimit: 20,
    grokFileTtlHours: 24,
  });
  const db = app.locals.db;
  const { server, base } = await listen(app);
  try {
    const admin = await login(base, 'arshad@example.com', 'super-password');
    const home = await page(base, admin, '/');
    assert.match(home.text, /data-grok-new/);
    const first = await fetch(`${base}/api/grok`, {
      method: 'POST',
      headers: { cookie: admin.header(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: home.csrf, text: 'Alpha chat about the roof quote and the extra words' }),
    });
    const alpha = await first.json();
    assert.equal(alpha.title, 'Alpha chat about the roof quote and the');
    const created = await fetch(`${base}/api/grok/threads`, {
      method: 'POST',
      headers: { cookie: admin.header(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: home.csrf }),
    });
    const fresh = await created.json();
    assert.equal(fresh.title, '');
    assert.notEqual(fresh.thread_id, alpha.thread_id);
    const second = await fetch(`${base}/api/grok`, {
      method: 'POST',
      headers: { cookie: admin.header(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: home.csrf, thread_id: String(fresh.thread_id), text: 'Beta follow up' }),
    });
    const beta = await second.json();
    assert.equal(beta.threads[0].id, fresh.thread_id);
    const renamed = await fetch(`${base}/api/grok/threads/${alpha.thread_id}/rename`, {
      method: 'POST',
      headers: { cookie: admin.header(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: home.csrf, title: 'Roof quote' }),
    });
    assert.equal((await renamed.json()).threads.find((thread) => thread.id === alpha.thread_id).title, 'Roof quote');
    const removed = await fetch(`${base}/api/grok/threads/${fresh.thread_id}/delete`, {
      method: 'POST',
      headers: { cookie: admin.header(), 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ _csrf: home.csrf }),
    });
    const afterDelete = await removed.json();
    assert.equal(afterDelete.threads.some((thread) => thread.id === fresh.thread_id), false);

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const form = new FormData();
    form.set('_csrf', home.csrf);
    form.set('text', 'See the quote');
    form.set('thread_id', String(alpha.thread_id));
    form.append('files', new Blob([pdf], { type: 'application/pdf' }), 'quote.pdf');
    const sent = await fetch(`${base}/api/grok`, { method: 'POST', headers: { cookie: admin.header(), accept: 'application/json' }, body: form });
    const chat = await sent.json();
    assert.equal(sent.status, 200);
    assert.equal(chat.messages.find((message) => message.body === 'See the quote').files[0].filename, 'quote.pdf');
    assert.match(chat.messages.find((message) => message.body === 'See the quote').files[0].expires_label, /expires in \d+h/);
    let posted;
    const pdfWait = Date.now();
    while (Date.now() - pdfWait < 4000) {
      posted = hits.find((hit) => hit.body.text === 'See the quote');
      if (posted) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(posted.body.files[0].kind, 'in');
    assert.equal(posted.body.thread_id, alpha.thread_id);
    const fileId = posted.body.files[0].id;
    const download = await fetch(`${base}/files/${fileId}`, { headers: { cookie: admin.header() } });
    assert.equal(download.status, 200);
    assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 4).toString(), '%PDF');

    const users = await page(base, admin, '/users');
    await post(base, admin, '/users', {
      _csrf: users.csrf, name: 'Lindi Nkosi', email: 'lindi@example.com', password: 'lindi-password', role: 'user',
    });
    const lindi = await login(base, 'lindi@example.com', 'lindi-password');
    const denied = await fetch(`${base}/files/${fileId}`, { headers: { cookie: lindi.header() } });
    assert.equal(denied.status, 403);
    const fake = new FormData();
    fake.set('_csrf', home.csrf);
    fake.set('text', 'Not a pdf');
    fake.set('thread_id', String(alpha.thread_id));
    fake.append('files', new Blob(['hello']), 'notes.pdf');
    const rejected = await fetch(`${base}/api/grok`, { method: 'POST', headers: { cookie: admin.header(), accept: 'application/json' }, body: fake });
    assert.equal(rejected.status, 400);

    const arshadId = db.prepare("SELECT id FROM users WHERE email = 'arshad@example.com'").get().id;
    const replyPdf = Buffer.from('%PDF-1.4\nreply\n%%EOF\n').toString('base64');
    const uploaded = await fetch(`${base}/api/bot/chat/${alpha.thread_id}/files`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: arshadId, filename: 'answer.pdf', data: replyPdf, request_id: posted.body.request_id }),
    });
    assert.equal(uploaded.status, 201);
    const shown = await (await fetch(`${base}/api/grok?thread=${alpha.thread_id}`, { headers: { cookie: admin.header(), accept: 'application/json' } })).json();
    const attached = [...shown.messages, { files: shown.files }].some((message) => (message.files || []).some((file) => file.filename === 'answer.pdf'));
    assert.equal(attached, true);
    const botFile = await fetch(`${base}/api/bot/files/${fileId}`, { headers: { authorization: 'Bearer test-bot-token' } });
    assert.equal(botFile.status, 200);

    const taskForm = await page(base, admin, '/tasks/new');
    const task = await post(base, admin, '/tasks', { _csrf: taskForm.csrf, title: 'Fan', status: 'todo' });
    const taskId = Number(task.headers.get('location').match(/\/tasks\/(\d+)/)[1]);
    const taskPage = await page(base, lindi, `/tasks/${taskId}`);
    assert.equal(taskPage.text.includes('PDF for Grok'), false);
    assert.equal(taskPage.text.includes('name="files"'), false);
    const commented = await post(base, lindi, `/tasks/${taskId}/comments`, {
      _csrf: taskPage.csrf,
      body: `@[Grok](${db.prepare("SELECT id FROM users WHERE email = 'grok@taskboard.local'").get().id}) the drawing`,
    });
    assert.equal(commented.status, 302);
    let commentHit;
    const commentWait = Date.now();
    while (Date.now() - commentWait < 4000) {
      commentHit = hits.find((hit) => hit.body.type === 'comment');
      if (commentHit) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(commentHit.body.type, 'comment');
    assert.deepEqual(commentHit.body.files, []);

    db.prepare("UPDATE grok_files SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(fileId);
    const gone = await fetch(`${base}/files/${fileId}`, { headers: { cookie: admin.header() } });
    assert.equal(gone.status, 410);
    app.locals.purgeGrokFiles();
    assert.equal(db.prepare('SELECT id FROM grok_files WHERE id = ?').get(fileId), undefined);
  } finally {
    server.close();
    hook.close();
  }
});

test('a task can have several assignees', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-assignees-'));
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
    botApiToken: 'test-bot-token',
  });
  const db = app.locals.db;
  const { server, base } = await listen(app);
  try {
    const admin = await login(base, 'arshad@example.com', 'super-password');
    const users = await page(base, admin, '/users');
    await post(base, admin, '/users', { _csrf: users.csrf, name: 'Lindi Nkosi', email: 'lindi@example.com', password: 'lindi-password', role: 'user' });
    await post(base, admin, '/users', { _csrf: users.csrf, name: 'Thabang Madikgetla', email: 'thabang@example.com', password: 'thabang-password', role: 'user' });
    const lindi = db.prepare("SELECT id FROM users WHERE email = 'lindi@example.com'").get().id;
    const thabang = db.prepare("SELECT id FROM users WHERE email = 'thabang@example.com'").get().id;
    const arshad = db.prepare("SELECT id FROM users WHERE email = 'arshad@example.com'").get().id;
    const created = await fetch(`${base}/api/bot/tasks`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: arshad, title: 'Shared job', assignee_ids: [lindi, thabang] }),
    });
    const payload = await created.json();
    assert.equal(created.status, 201);
    assert.deepEqual(payload.task.assignee_ids.sort(), [lindi, thabang].sort());
    assert.equal(payload.task.assignees.length, 2);
    const taskId = payload.task.id;
    const board = await page(base, admin, '/');
    assert.match(board.text, /Shared job/);
    assert.match(board.text, /\+1/);
    const mine = await page(base, await login(base, 'thabang@example.com', 'thabang-password'), '/?mine=1');
    assert.match(mine.text, /Shared job/);
    const lindiCookies = await login(base, 'lindi@example.com', 'lindi-password');
    const done = await fetch(`${base}/api/bot/complete/${taskId}`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: lindi }),
    });
    assert.equal(done.status, 200);
    const single = await fetch(`${base}/api/bot/tasks`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: arshad, title: 'Solo job', assignee_id: thabang }),
    });
    const solo = await single.json();
    assert.equal(solo.task.assignee_ids[0], thabang);
    const filtered = await fetch(`${base}/api/bot/tasks?assignee=${thabang}`, {
      headers: { authorization: 'Bearer test-bot-token' },
    });
    const filteredTasks = (await filtered.json()).tasks.map((task) => task.title);
    assert.equal(filteredTasks.includes('Shared job'), true);
    assert.equal(filteredTasks.includes('Solo job'), true);
    const cleared = await fetch(`${base}/api/bot/tasks/${solo.task.id}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: arshad, assignee_ids: [] }),
    });
    assert.deepEqual((await cleared.json()).task.assignee_ids, []);
    const footer = board.text.slice(board.text.indexOf('form-footer'));
    assert.equal(footer.indexOf('Save &amp; add another') < footer.indexOf('>Save<'), true);
    assert.match(board.text, /name="assignee_ids"/);
    assert.match(board.text, /id="task-drawer"/);
    const css = await fetch(`${base}/styles.css`);
    const sheet = await css.text();
    assert.match(sheet, /#task-drawer\.drawer[\s\S]*width: min\(640px/);
    assert.match(sheet, /#task-drawer::backdrop \{ background: rgba\(0, 0, 0, 0\.5\)/);
    assert.match(sheet, /dialog\.drawer\[open\]\s*\{[^}]*display:\s*flex/);
    assert.match(sheet, /dialog\.drawer:not\(\[open\]\)\s*\{[^}]*display:\s*none/);
    assert.equal(/\.drawer\s*\{[^}]*display:\s*flex/.test(sheet), false);
    assert.match(sheet, /\.combo-menu\s*\{[^}]*\}/);
    assert.match(sheet, /max-height:\s*240px/);
    assert.equal(board.text.includes('<dialog id="task-drawer" class="drawer" open'), false);
    const now = new Date().toISOString();
    const legacy = db.prepare(`
      INSERT INTO tasks (title, description, assignee_id, status, created_by, created_at, updated_at)
      VALUES ('Legacy job', '', ?, 'todo', ?, ?, ?)
    `).run(lindi, arshad, now, now);
    const reopened = openDatabase(path.join(dir, 'board.sqlite'));
    const link = reopened.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').get(legacy.lastInsertRowid);
    assert.equal(link.user_id, lindi);
    reopened.close();
    assert.equal(lindiCookies.header().includes('sid'), true);
  } finally {
    server.close();
  }
});

test('old grok threads lose the one-chat unique constraint', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-grok-migrate-'));
  const file = path.join(dir, 'old.sqlite');
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE grok_threads (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO grok_threads (user_id, created_at, updated_at)
      VALUES (1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  raw.close();
  const db = openDatabase(file);
  const names = db.prepare('PRAGMA table_info(grok_threads)').all().map((column) => column.name);
  assert.equal(names.includes('title'), true);
  const now = '2026-01-02T00:00:00.000Z';
  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
    VALUES (1, 'a@example.com', 'A', 'x', 'user', 1, ?, ?)
  `).run(now, now);
  db.prepare('INSERT INTO grok_threads (user_id, title, created_at, updated_at) VALUES (1, ?, ?, ?)').run('', now, now);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM grok_threads').get().n, 2);
  db.close();
});
