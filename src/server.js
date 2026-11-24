import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import multer from 'multer';
import { labelOf, PRIORITIES, STATUSES } from './constants.js';
import { assertConfig, loadEnv, readConfig } from './config.js';
import {
  addActivity,
  addAttachment,
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
  deleteAttachment,
  findOrCreateProject,
  getAttachment,
  getProject,
  listActivity,
  listAttachments,
  activeUserIds,
  kudosSummary,
  listProjects,
  listRunningTimers,
  listTimeEntries,
  getRunningTimer,
  markMentionsRead,
  myDay,
  managementReport,
  notifyMentions,
  setCommentMentions,
  setTaskMentions,
  startTimer,
  stopTimer,
  stopTimersOnTask,
  teamBoard,
  timeReport,
  timeTotals,
  toggleKudo,
  unreadMentionCount,
} from './db.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { mentionedUserIds } from './mentions.js';
import { canCompleteTask, canControlTimer, canDeleteComment, canDeleteTask, canEditTask, canEditUser, isStaff } from './permissions.js';
import { daysAgoIso, entrySeconds, formatDue, isValidDate, startOfWeekIso, todayDate } from './time.js';
import {
  renderBoard,
  renderCalendar,
  renderForbidden,
  renderLogin,
  renderManage,
  renderNotFound,
  renderTask,
  renderTeam,
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
  const uploadsDir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
        cb(null, crypto.randomBytes(16).toString('hex') + ext);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
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
    if (req.user) req.user.unreadMentions = unreadMentionCount(db, req.user.id);
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
    const tasks = withTime(db, listTasks(db, filters));
    const people = listActiveUsers(db);
    html(res, 200, renderBoard({
      user: req.user,
      csrf: ensureCsrf(req, res),
      msg: String(req.query.msg || ''),
      tasks,
      filters,
      users: people,
      projects: listProjects(db),
      counts: boardCounts(db, filters.today),
      today: filters.today,
      exportQuery: filterQuery(filters),
      day: myDay(db, req.user.id, filters.today),
      highlight: numericId(req.query.highlight),
      openForm: req.query.newtask === '1',
      toast: toastFrom(req),
    }));
  });

  app.get('/calendar', requireUser, (req, res) => {
    const filters = readFilters(req);
    const today = filters.today;
    const view = req.query.view === 'week' ? 'week' : 'month';
    const anchor = isValidDate(String(req.query.day || '')) ? String(req.query.day) : today;
    let year = Number(today.slice(0, 4));
    let month = Number(today.slice(5, 7));
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(String(req.query.month || ''));
    if (monthMatch) {
      year = Number(monthMatch[1]);
      month = Number(monthMatch[2]);
    }
    const tasks = listTasks(db, { ...filters, search: '', overdue: false, mentions: false, mentionUserId: null });
    html(res, 200, renderCalendar({
      user: req.user,
      csrf: ensureCsrf(req, res),
      msg: String(req.query.msg || ''),
      tasks,
      filters,
      users: listActiveUsers(db),
      projects: listProjects(db),
      today,
      view,
      year,
      month,
      anchor,
    }));
  });

  app.get('/team', requireUser, (req, res) => {
    html(res, 200, renderTeam({
      user: req.user,
      csrf: ensureCsrf(req, res),
      rows: teamBoard(db),
    }));
  });

  app.post('/kudos', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const targetType = req.body.target_type === 'task' ? 'task' : 'comment';
    const targetId = numericId(req.body.target_id);
    const back = safeNext(String(req.body.return || '/'));
    if (!targetId) return res.redirect(back);
    if (targetType === 'comment') {
      if (!getComment(db, targetId)) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    } else {
      const task = getTask(db, targetId);
      if (!task || task.status !== 'done') return res.redirect(`${back}${back.includes('?') ? '&' : '?'}msg=invalid`);
    }
    toggleKudo(db, { userId: req.user.id, targetType, targetId });
    res.redirect(back);
  });

  app.get('/export.csv', requireUser, (req, res) => {
    const filters = readFilters(req);
    const tasks = listTasks(db, filters);
    const header = ['id', 'title', 'description', 'project', 'assignee', 'status', 'priority', 'due', 'created by', 'comments', 'created', 'updated', 'overdue'];
    const lines = [header.join(',')];
    for (const task of tasks) {
      lines.push([
        task.id,
        task.title,
        task.description,
        task.project_name || '',
        task.assignee_name || '',
        labelOf(STATUSES, task.status),
        labelOf(PRIORITIES, task.priority),
        task.due_date || '',
        task.creator_name || '',
        task.comment_count,
        task.created_at,
        task.updated_at,
        isOverdueTask(task, filters.today) ? 'yes' : 'no',
      ].map(csvCell).join(','));
    }
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="tasks.csv"',
      'Cache-Control': 'no-store',
    });
    res.send(lines.join('\n'));
  });

  app.get('/manage', requireStaff, (req, res) => {
    const filters = manageFilters(req);
    html(res, 200, renderManage({
      user: req.user,
      csrf: ensureCsrf(req, res),
      msg: String(req.query.msg || ''),
      report: managementReport(db, filters),
      time: timeReport(db, filters),
      projects: listProjects(db),
      users: listActiveUsers(db),
      filters,
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
      projects: listProjects(db),
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
    const projectId = projectFromBody(db, req.body, null);
    if (projectId === false) return res.redirect('/tasks/new?msg=invalid');
    const quick = req.body.quick === '1';
    if (quick && !parsed.title) return res.redirect('/?msg=invalid');
    const id = createTask(db, { ...parsed, projectId, createdBy: req.user.id });
    rememberMentions(db, id, `${parsed.title}\n${parsed.description}`, req.user.id);
    addActivity(db, { taskId: id, actorId: req.user.id, action: 'created', detail: 'Created the task' });
    if (quick || req.body.from === 'board') {
      const again = req.body.again === '1';
      return res.redirect(again ? `/?newtask=1&highlight=${id}` : `/?highlight=${id}`);
    }
    res.redirect(`/tasks/${id}?msg=created`);
  });

  app.get('/tasks/:id', requireUser, (req, res) => {
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    markMentionsRead(db, req.user.id, task.id);
    req.user.unreadMentions = unreadMentionCount(db, req.user.id);
    const comments = listComments(db, task.id);
    const commentPerms = new Map(comments.map((comment) => [comment.id, canDeleteComment(req.user, comment)]));
    const commentKudos = kudosSummary(db, req.user.id, 'comment', comments.map((comment) => comment.id));
    const taskKudos = kudosSummary(db, req.user.id, 'task', [task.id]);
    html(res, 200, renderTask({
      user: req.user,
      csrf: ensureCsrf(req, res),
      msg: String(req.query.msg || ''),
      task,
      comments,
      users: assigneeChoices(db, task),
      projects: listProjects(db),
      activity: listActivity(db, task.id),
      attachments: listAttachments(db, task.id),
      timer: { ...timerView(db, task, req.user.id), canControl: canControlTimer(req.user, task) },
      canEdit: canEditTask(req.user, task),
      canDelete: canDeleteTask(req.user),
      canComplete: canCompleteTask(req.user, task),
      commentPerms,
      commentKudos,
      taskKudos,
      today: todayDate(),
      toast: toastFrom(req),
    }));
  });

  app.post('/tasks/:id', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canEditTask(req.user, task)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    const choices = assigneeChoices(db, task);
    const parsed = parseTask(req.body, choices);
    if (parsed.error) return res.redirect(`/tasks/${task.id}?msg=invalid`);
    const projectId = projectFromBody(db, req.body, task.project_id);
    if (projectId === false) return res.redirect(`/tasks/${task.id}?msg=invalid`);
    const updated = updateTask(db, task.id, { ...parsed, projectId });
    logTaskChanges(db, req.user, task, updated);
    rememberMentions(db, task.id, `${parsed.title}\n${parsed.description}`, req.user.id);
    res.redirect(`/tasks/${task.id}?msg=saved`);
  });

  app.post('/tasks/:id/timer/start', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canControlTimer(req.user, task)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    const result = startTimer(db, { userId: req.user.id, taskId: task.id });
    if (result.already) return res.redirect(timerReturn(req, task.id, 'running'));
    if (result.stopped) {
      addActivity(db, { taskId: result.stopped.task_id, actorId: req.user.id, action: 'timer', detail: 'Stopped the timer' });
    }
    if (task.status === 'todo') {
      const updated = updateTask(db, task.id, {
        title: task.title,
        description: task.description,
        assigneeId: task.assignee_id,
        status: 'in_progress',
        priority: task.priority,
        dueDate: task.due_date,
        projectId: task.project_id,
      });
      logTaskChanges(db, req.user, task, updated);
    }
    addActivity(db, { taskId: task.id, actorId: req.user.id, action: 'timer', detail: 'Started a timer' });
    res.redirect(timerReturn(req, task.id, 'started'));
  });

  app.post('/tasks/:id/timer/stop', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canControlTimer(req.user, task)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    const stopped = stopTimer(db, { userId: req.user.id, taskId: task.id });
    if (!stopped) return res.redirect(timerReturn(req, task.id, 'notimer'));
    addActivity(db, { taskId: task.id, actorId: req.user.id, action: 'timer', detail: 'Stopped the timer' });
    res.redirect(timerReturn(req, task.id, 'stopped'));
  });

  app.post('/tasks/:id/complete', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canCompleteTask(req.user, task)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    const previous = task.status;
    if (previous !== 'done') {
      const updated = updateTask(db, task.id, {
        title: task.title,
        description: task.description,
        assigneeId: task.assignee_id,
        status: 'done',
        priority: task.priority,
        dueDate: task.due_date,
        projectId: task.project_id,
      });
      logTaskChanges(db, req.user, task, updated);
      stopTimersOnTask(db, task.id);
      addActivity(db, { taskId: task.id, actorId: req.user.id, action: 'status', detail: 'Marked the task done' });
    }
    const back = safeNext(String(req.body.back || '/'));
    const join = back.includes('?') ? '&' : '?';
    res.redirect(`${back}${join}toast=done&undo=${task.id}&was=${encodeURIComponent(previous)}`);
  });

  app.post('/tasks/:id/reopen', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canCompleteTask(req.user, task)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    const was = ['todo', 'in_progress', 'review'].includes(req.body.status) ? req.body.status : 'in_progress';
    if (task.status === 'done') {
      const updated = updateTask(db, task.id, {
        title: task.title,
        description: task.description,
        assigneeId: task.assignee_id,
        status: was,
        priority: task.priority,
        dueDate: task.due_date,
        projectId: task.project_id,
      });
      logTaskChanges(db, req.user, task, updated);
      addActivity(db, { taskId: task.id, actorId: req.user.id, action: 'status', detail: 'Reopened the task' });
    }
    res.redirect(safeNext(String(req.body.back || `/?highlight=${task.id}`)));
  });

  app.post('/tasks/:id/delete', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const task = id ? getTask(db, id) : null;
    if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canDeleteTask(req.user)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    for (const file of listAttachments(db, task.id)) {
      fs.rmSync(path.join(uploadsDir, path.basename(file.stored_name)), { force: true });
    }
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
    const commentId = addComment(db, { taskId: task.id, authorId: req.user.id, body });
    const mentioned = activeUserIds(db, mentionedUserIds(body, listActiveUsers(db)));
    setCommentMentions(db, commentId, mentioned);
    notifyMentions(db, { taskId: task.id, userIds: mentioned, actorId: req.user.id });
    addActivity(db, { taskId: task.id, actorId: req.user.id, action: 'comment', detail: 'Added a comment' });
    res.redirect(`/tasks/${task.id}?msg=commented`);
  });

  app.post('/comments/:id/delete', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const comment = id ? getComment(db, id) : null;
    if (!comment) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    if (!canDeleteComment(req.user, comment)) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    deleteComment(db, comment.id);
    addActivity(db, { taskId: comment.task_id, actorId: req.user.id, action: 'comment', detail: 'Deleted a comment' });
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

  app.post('/tasks/:id/attachments', requireUser, (req, res, next) => {
    upload.single('file')(req, res, (error) => {
      if (error && error.code === 'LIMIT_FILE_SIZE') return res.redirect(`/tasks/${req.params.id}?msg=toobig`);
      if (error) return next(error);
      if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
      const id = numericId(req.params.id);
      const task = id ? getTask(db, id) : null;
      if (!task) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
      if (!req.file || !req.file.size) {
        if (req.file) fs.rmSync(req.file.path, { force: true });
        return res.redirect(`/tasks/${task.id}?msg=invalid`);
      }
      const original = path.basename(req.file.originalname || 'file').slice(0, 180) || 'file';
      addAttachment(db, {
        taskId: task.id,
        uploadedBy: req.user.id,
        storedName: req.file.filename,
        originalName: original,
        mime: req.file.mimetype || '',
        size: req.file.size,
      });
      addActivity(db, { taskId: task.id, actorId: req.user.id, action: 'attachment', detail: `Attached ${original}` });
      res.redirect(`/tasks/${task.id}?msg=saved`);
    });
  });

  app.get('/attachments/:id', requireUser, (req, res) => {
    const id = numericId(req.params.id);
    const file = id ? getAttachment(db, id) : null;
    if (!file || file.stored_name.includes('..') || file.stored_name.includes('/') || file.stored_name.includes('\\')) {
      return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    }
    const root = path.resolve(uploadsDir);
    const full = path.resolve(root, file.stored_name);
    if (!full.startsWith(`${root}${path.sep}`)) return res.status(400).end();
    const risky = /svg|html|xml|javascript/i.test(`${file.mime} ${file.original_name}`);
    const filename = file.original_name.replace(/["\r\n]/g, '');
    res.set({
      'Content-Type': risky ? 'application/octet-stream' : (file.mime || 'application/octet-stream'),
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.\- ]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.sendFile(full);
  });

  app.post('/attachments/:id/delete', requireUser, (req, res) => {
    if (!csrfOk(req)) return res.status(403).type('text').send('Form expired. Reload the page and try again.');
    const id = numericId(req.params.id);
    const file = id ? getAttachment(db, id) : null;
    if (!file) return html(res, 404, renderNotFound({ user: req.user, csrf: ensureCsrf(req, res) }));
    const allowed = req.user.role === 'superuser' || req.user.role === 'admin' || file.uploaded_by === req.user.id;
    if (!allowed) return html(res, 403, renderForbidden({ user: req.user, csrf: ensureCsrf(req, res) }));
    deleteAttachment(db, file.id);
    fs.rmSync(path.join(uploadsDir, file.stored_name), { force: true });
    addActivity(db, { taskId: file.task_id, actorId: req.user.id, action: 'attachment', detail: `Removed ${file.original_name}` });
    res.redirect(`/tasks/${file.task_id}?msg=deleted`);
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

function withTime(db, tasks) {
  const totals = timeTotals(db);
  const runningByTask = new Map();
  for (const row of listRunningTimers(db)) {
    if (!runningByTask.has(row.task_id)) runningByTask.set(row.task_id, []);
    runningByTask.get(row.task_id).push(row);
  }
  return tasks.map((task) => ({
    ...task,
    time_seconds: totals.get(task.id) || 0,
    running: runningByTask.get(task.id) || [],
  }));
}

function timerView(db, task, userId) {
  const entries = listTimeEntries(db, task.id);
  const perUser = new Map();
  let total = 0;
  for (const entry of entries) {
    const seconds = entrySeconds(entry.started_at, entry.ended_at);
    total += seconds;
    const current = perUser.get(entry.user_id) || { user_id: entry.user_id, user_name: entry.user_name, seconds: 0 };
    current.seconds += seconds;
    perUser.set(entry.user_id, current);
  }
  const running = getRunningTimer(db, userId);
  return {
    mine: running && running.task_id === task.id ? running : null,
    other: running && running.task_id !== task.id ? running : null,
    entries,
    summary: {
      total,
      perUser: [...perUser.values()].sort((a, b) => b.seconds - a.seconds),
    },
  };
}

function readFilters(req) {
  const status = STATUSES.some(([value]) => value === req.query.status) ? req.query.status : '';
  const mine = req.query.mine === '1';
  let assigneeId = null;
  if (mine) assigneeId = req.user.id;
  else if (req.query.assignee === 'none') assigneeId = 'none';
  else if (/^\d+$/.test(String(req.query.assignee || ''))) assigneeId = Number(req.query.assignee);
  const projectId = /^\d+$/.test(String(req.query.project || '')) ? Number(req.query.project) : null;
  const due = req.query.due === 'today' ? todayDate() : '';
  const mentions = req.query.mentions === '1';
  return {
    status,
    mine,
    assigneeId,
    projectId,
    mentions,
    due,
    mentionUserId: mentions ? req.user.id : null,
    overdue: req.query.overdue === '1',
    search: String(req.query.q || '').trim().slice(0, 100),
    today: todayDate(),
  };
}

function filterQuery(filters) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.mine) params.set('mine', '1');
  else if (filters.assigneeId === 'none') params.set('assignee', 'none');
  else if (filters.assigneeId) params.set('assignee', String(filters.assigneeId));
  if (filters.projectId) params.set('project', String(filters.projectId));
  if (filters.overdue) params.set('overdue', '1');
  if (filters.mentions) params.set('mentions', '1');
  if (filters.search) params.set('q', filters.search);
  return params.toString();
}

function manageFilters(req) {
  const projectId = /^\d+$/.test(String(req.query.project || '')) ? Number(req.query.project) : null;
  let personId = null;
  if (req.query.person === 'none') personId = 'none';
  else if (/^\d+$/.test(String(req.query.person || ''))) personId = Number(req.query.person);
  const now = new Date();
  return {
    projectId,
    personId,
    today: todayDate(now),
    weekStart: startOfWeekIso(now),
    since7: daysAgoIso(7, now),
    since30: daysAgoIso(30, now),
  };
}

function toastFrom(req) {
  if (req.query.toast !== 'done') return null;
  if (!/^\d+$/.test(String(req.query.undo || ''))) return null;
  const undo = Number(req.query.undo);
  const was = ['todo', 'in_progress', 'review', 'done'].includes(String(req.query.was)) ? String(req.query.was) : 'in_progress';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (['toast', 'undo', 'was'].includes(key) || typeof value !== 'string') continue;
    params.set(key, value);
  }
  const query = params.toString();
  return { undo, was, back: `${req.path}${query ? `?${query}` : ''}` };
}

function rememberMentions(db, taskId, text, actorId) {
  const ids = activeUserIds(db, mentionedUserIds(text, listActiveUsers(db)));
  setTaskMentions(db, taskId, ids);
  notifyMentions(db, { taskId, userIds: ids, actorId });
}

function timerReturn(req, taskId, msg) {
  if (req.body.return === 'board') {
    const back = safeNext(String(req.body.back || '/'));
    const join = back.includes('?') ? '&' : '?';
    return `${back}${join}msg=${msg}`;
  }
  return `/tasks/${taskId}?msg=${msg}`;
}

function projectFromBody(db, body, currentId) {
    const typed = String(body.project_name || body.new_project || '').trim();
  const rawEarly = String(body.project_id || '').trim();
  if (typed) {
    if (rawEarly && /^\d+$/.test(rawEarly)) {
      const selected = getProject(db, Number(rawEarly));
      if (selected && selected.name.toLowerCase() === typed.toLowerCase()) return selected.id;
    }
    if (typed.length > 80) return false;
    return findOrCreateProject(db, typed);
  }
  const raw = rawEarly;
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return false;
  const project = getProject(db, Number(raw));
  if (!project) return false;
  return project.id || currentId;
}

function personName(db, id) {
  if (!id) return 'Unassigned';
  return getUser(db, id)?.name || 'Unknown';
}

function logTaskChanges(db, actor, before, after) {
  const changes = [];
  if (before.status !== after.status) {
    changes.push(['status', `Status: ${labelOf(STATUSES, before.status)} → ${labelOf(STATUSES, after.status)}`]);
  }
  if ((before.assignee_id || null) !== (after.assignee_id || null)) {
    changes.push(['assignee', `Assignee: ${personName(db, before.assignee_id)} → ${personName(db, after.assignee_id)}`]);
  }
  if ((before.due_date || '') !== (after.due_date || '')) {
    changes.push(['due', `Due: ${formatDue(before.due_date)} → ${formatDue(after.due_date)}`]);
  }
  if ((before.priority || '') !== (after.priority || '')) {
    changes.push(['priority', `Priority: ${labelOf(PRIORITIES, before.priority) || '—'} → ${labelOf(PRIORITIES, after.priority) || '—'}`]);
  }
  if ((before.project_id || null) !== (after.project_id || null)) {
    changes.push(['project', `Project: ${before.project_name || '—'} → ${after.project_name || '—'}`]);
  }
  for (const [action, detail] of changes) {
    addActivity(db, { taskId: after.id, actorId: actor.id, action, detail });
  }
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function isOverdueTask(task, today) {
  return Boolean(task.due_date) && task.status !== 'done' && task.due_date < today;
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
