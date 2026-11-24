import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
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

    const arshadId = db.prepare("SELECT id FROM users WHERE email = 'arshad@example.com'").get().id;
    const reply = await fetch(`${base}/api/bot/chat/${chat.thread_id}/reply`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: arshadId, request_id: received[0].body.request_id, text: 'Nothing is due today.' }),
    });
    assert.equal(reply.status, 200);
    const polled = await fetch(`${base}/api/grok`, { headers: { cookie: admin.header(), accept: 'application/json' } });
    const after = await polled.json();
    assert.equal(after.pending, false);
    assert.equal(after.messages.at(-1).body, 'Nothing is due today.');

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

    const comment = await fetch(`${base}/api/bot/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-bot-token', 'content-type': 'application/json' },
      body: JSON.stringify({ acting_user_id: lindiId, body: 'Looking now.' }),
    });
    assert.equal(comment.status, 201);
    const shown = await page(base, lindi, `/tasks/${taskId}`);
    assert.match(shown.text, /Looking now\./);
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
