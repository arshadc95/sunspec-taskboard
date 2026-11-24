import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { PRIORITIES, STATUSES } from './constants.js';
import { assertConfig, loadEnv, readConfig } from './config.js';
import {
  addComment,
  boardCounts,
  bootstrapSuperuser,
  clearLoginAttempts,
  createSession,
  createTask,
  createUser,
  deleteComment,
  deleteSession,
  deleteTask,
  getComment,
  getSessionUser,
  getTask,
  getUser,
  getUserByEmail,
  listActiveUsers,
  listComments,
  listTasks,
  listUsers,
  loginAttemptCount,
  openDatabase,
  recordLoginAttempt,
  updateTask,
  updateUser,
  userCount,
  countOtherActiveSuperusers,
} from './db.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { canDeleteComment, canDeleteTask, canEditTask, canEditUser, isStaff } from './permissions.js';
import { isValidDate, todayDate } from './time.js';
import {
  renderBoard,
  renderForbidden,
  renderLogin,
  renderNotFound,
  renderTask,
  renderUsers,
} from './view.js';

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
  };
}

function safeNext(value) {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('://')) return '/';
  return value;
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

function cookieOpts(req, maxAge) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure === true,
    path: '/',
    maxAge,
  };
}

function signSession(id, secret) {
  const mac = crypto.createHmac('sha256', secret).update(id).digest('hex');
  return `${id}.${mac}`;
}

function unsignSession(value, secret) {
  if (!value) return null;
  const index = value.lastIndexOf('.');
  if (index <= 0) return null;
  const id = value.slice(0, index);
  const mac = value.slice(index + 1);
  const expected = crypto.createHmac('sha256', secret).update(id).digest('hex');
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  return id;
}

function html(res, status, body) {
  res.status(status).set('Cache-Control', 'no-store').type('html').send(body);
}

function numericId(value) {
  if (!/^\d+$/.test(String(value ?? ''))) return null;
  return Number(value);
}

function assigneeChoices(db, task) {
  const users = listActiveUsers(db);
  if (task?.assignee_id && !users.some((user) => user.id === task.assignee_id)) {
    const extra = getUser(db, task.assignee_id);
    if (extra) users.push(extra);
  }
  return users;
}

function parseTask(body, users) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const status = String(body.status || '');
  const priorityRaw = String(body.priority || '');
  const due = String(body.due_date || '').trim();
  const assigneeRaw = String(body.assignee_id || '').trim();
  if (!title || title.length > 200) return { error: 'invalid' };
  if (description.length > 20000) return { error: 'invalid' };
  if (!STATUSES.some(([value]) => value === status)) return { error: 'invalid' };
  if (priorityRaw && !PRIORITIES.some(([value]) => value === priorityRaw)) return { error: 'invalid' };
  if (due && !isValidDate(due)) return { error: 'invalid' };
  let assigneeId = null;
  if (assigneeRaw) {
    const id = Number(assigneeRaw);
    if (!users.some((user) => user.id === id)) return { error: 'invalid' };
    assigneeId = id;
  }
  return {
    title,
    description,
    status,
    priority: priorityRaw || null,
    dueDate: due || null,
    assigneeId,
  };
}

function parseIdentity(body) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!name || name.length > 120) return { error: 'invalid' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'invalid' };
  return { name, email };
}

export function createApp(config) {
  assertConfig(config);
  const db = openDatabase(config.dbPath);
  if (userCount(db) === 0) {
    if (config.adminEmail && config.adminPassword) {
      if (config.adminPassword.length < 8) {
        console.warn('ADMIN_PASSWORD is shorter than 8 characters. Superuser was not created.');
      } else {
        const created = bootstrapSuperuser(db, {
          email: config.adminEmail,
          password: config.adminPassword,
          name: config.adminName,
        });
        if (created?.id) console.log(`Created superuser ${config.adminEmail}`);
      }
    } else {
      console.warn('No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, or run npm run create-superuser.');
    }
  }

  let dummyHash = '';
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals.db = db;
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'X-DNS-Prefetch-Control': 'off',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
    });
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.static(publicDir, { index: false, dotfiles: 'deny' }));

  function ensureCsrf(req, res) {
    const existing = readCookie(req, 'csrf');
    if (/^[a-f0-9]{64}$/.test(existing)) return existing;
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf', token, cookieOpts(req, 7 * 24 * 60 * 60 * 1000));
    return token;
  }

  function csrfOk(req) {
    const cookie = readCookie(req, 'csrf');
    const body = String(req.body?._csrf || '');
    if (!/^[a-f0-9]{64}$/.test(cookie) || cookie.length !== body.length) return false;
    return crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(body));
  }

  app.use((req, res, next) => {
    const sessionId = unsignSession(readCookie(req, 'sid'), config.sessionSecret);
    const row = sessionId ? getSessionUser(db, sessionId) : null;
    req.sessionId = row ? sessionId : null;
    req.user = row ? publicUser(row) : null;
    next();
  });

  app.get('/healthz', (req, res) => {
    res.type('text').send('ok');
  });

  app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    html(res, 200, renderLogin({
      msg: String(req.query.msg || ''),
      next: safeNext(String(req.query.next || '/')),
      csrf: ensureCsrf(req, res),
    }));
  });

  app.post('/login', (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const ip = req.ip || 'unknown';
    const since = Date.now() - config.loginWindowMs;
    if (loginAttemptCount(db, ip, since) >= config.loginMax) return res.redirect('/login?msg=ratelimit');
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = getUserByEmail(db, email);
    const passwordHash = user?.password_hash || (dummyHash ||= hashPassword('not-a-real-password'));
    const ok = verifyPassword(password, passwordHash);
    if (!user || !user.active || !ok) {
      recordLoginAttempt(db, ip);
      return res.redirect('/login?msg=badlogin');
    }
    clearLoginAttempts(db, ip);
    const sessionId = crypto.randomBytes(32).toString('hex');
    createSession(db, user.id, sessionId, Date.now() + SESSION_MS);
    res.cookie('sid', signSession(sessionId, config.sessionSecret), cookieOpts(req, SESSION_MS));
    res.redirect(safeNext(String(req.body.next || '/')));
  });

  app.post('/logout', (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    if (req.sessionId) deleteSession(db, req.sessionId);
    res.clearCookie('sid', cookieOpts(req, 0));
    res.redirect('/login');
  });

  function requireUser(req, res, next) {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(safeNext(req.originalUrl))}`);
    next();
  }

  function requireStaff(req, res, next) {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(safeNext(req.originalUrl))}`);
    if (!isStaff(req.user)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    next();
  }

  app.get('/', requireUser, (req, res) => {
    const filters = readFilters(req);
    const tasks = listTasks(db, filters);
    html(res, 200, renderBoard({
      user: req.user,
      csrf: ensureCsrf(req, res),
      msg: String(req.query.msg || ''),
      tasks,
      filters,
      users: listActiveUsers(db),
      counts: boardCounts(db, filters.today),
      today: filters.today,
    }));
  });

  app.get('/tasks/new', requireUser, (req, res) => {
    html(res, 200, renderTask({
      user: req.user,
      csrf: ensureCsrf(req, res),
      msg: String(req.query.msg || ''),
      task: null,
      comments: [],
      users: listActiveUsers(db),
      canEdit: true,
      canDelete: false,
      commentPerms: new Map(),
    }));
  });

  app.post('/tasks', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const users = listActiveUsers(db);
    const parsed = parseTask(req.body, users);
    if (parsed.error) return res.redirect('/tasks/new?msg=invalid');
    const id = createTask(db, { ...parsed, createdBy: req.user.id });
    res.redirect(`/tasks/${id}?msg=created`);
  });

  app.get('/tasks/:id', requireUser, (req, res) => {
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    const comments = listComments(db, task.id);
    const commentPerms = new Map(comments.map((comment) => [comment.id, canDeleteComment(req.user, comment)]));
    html(res, 200, renderTask({
      user: req.user,
      csrf: ensureCsrf(req, res),
      msg: String(req.query.msg || ''),
      task,
      comments,
      users: assigneeChoices(db, task),
      canEdit: canEditTask(req.user, task),
      canDelete: canDeleteTask(req.user),
      commentPerms,
    }));
  });

  app.post('/tasks/:id', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canEditTask(req.user, task)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    const parsed = parseTask(req.body, assigneeChoices(db, task));
    if (parsed.error) return res.redirect(`/tasks/${task.id}?msg=invalid`);
    updateTask(db, task.id, parsed);
    res.redirect(`/tasks/${task.id}?msg=saved`);
  });

  app.post('/tasks/:id/delete', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canDeleteTask(req.user)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    deleteTask(db, task.id);
    res.redirect('/?msg=deleted');
  });

  app.post('/tasks/:id/comments', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    const body = String(req.body.body || '').trim();
    if (!body || body.length > 8000) return res.redirect(`/tasks/${task.id}?msg=invalid`);
    addComment(db, { taskId: task.id, authorId: req.user.id, body });
    res.redirect(`/tasks/${task.id}?msg=commented`);
  });

  app.post('/comments/:id/delete', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const comment = id ? getComment(db, id) : null;
    if (!comment) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canDeleteComment(req.user, comment)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    deleteComment(db, comment.id);
    res.redirect(`/tasks/${comment.task_id}?msg=deleted`);
  });

  app.get('/users', requireStaff, (req, res) => {
    html(res, 200, renderUsers({
      user: req.user,
      csrf: ensureCsrf(req, res),
      msg: String(req.query.msg || ''),
      users: listUsers(db, req.user),
    }));
  });

  app.post('/users', requireStaff, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const identity = parseIdentity(req.body);
    if (identity.error) return res.redirect('/users?msg=invalid');
    const password = String(req.body.password || '');
    if (password.length < 8) return res.redirect('/users?msg=short');
    let role = 'user';
    if (req.user.role === 'superuser') {
      role = String(req.body.role || 'user');
      if (!['superuser', 'admin', 'user'].includes(role)) return res.redirect('/users?msg=invalid');
    }
    const created = createUser(db, { ...identity, password, role });
    if (created.error) return res.redirect('/users?msg=email');
    res.redirect('/users?msg=saved');
  });

  app.post('/users/:id', requireStaff, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const target = id ? getUser(db, id) : null;
    if (!target) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canEditUser(req.user, target)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    const identity = parseIdentity(req.body);
    if (identity.error) return res.redirect('/users?msg=invalid');
    const password = String(req.body.password || '');
    if (password && password.length < 8) return res.redirect('/users?msg=short');
    let role = target.role;
    if (req.user.role === 'superuser' && target.id !== req.user.id) {
      role = String(req.body.role || target.role);
      if (!['superuser', 'admin', 'user'].includes(role)) return res.redirect('/users?msg=invalid');
    }
    const active = target.id === req.user.id ? true : req.body.active === '1';
    if (target.role === 'superuser' && (role !== 'superuser' || !active)) {
      if (countOtherActiveSuperusers(db, target.id) < 1) return res.redirect('/users?msg=lastsuper');
    }
    const updated = updateUser(db, target.id, { ...identity, role, active, password: password || undefined });
    if (updated.error) return res.redirect('/users?msg=email');
    res.redirect('/users?msg=saved');
  });

  app.use((req, res) => {
    if (!req.user) return res.redirect('/login');
    html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
  });

  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).type('text').send('Something went wrong.');
  });

  return app;
}

function readFilters(req) {
  const status = STATUSES.some(([value]) => value === req.query.status) ? req.query.status : '';
  const mine = req.query.mine === '1';
  let assigneeId = null;
  if (mine) assigneeId = req.user.id;
  else if (req.query.assignee === 'none') assigneeId = 'none';
  else if (/^\d+$/.test(String(req.query.assignee || ''))) assigneeId = Number(req.query.assignee);
  return {
    status,
    mine,
    assigneeId,
    overdue: req.query.overdue === '1',
    search: String(req.query.q || '').trim().slice(0, 100),
    today: todayDate(),
  };
}

export function start() {
  loadEnv();
  const config = readConfig();
  const app = createApp(config);
  const server = app.listen(config.port, '127.0.0.1', () => {
    console.log(`Sunspec task board listening on http://127.0.0.1:${config.port}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    start();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
