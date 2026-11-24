import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  activeUserIds,
  addActivity,
  addComment,
  addGrokFile,
  bindLooseGrokCommentFiles,
  clearGrokLiveForTask,
  completeGrokReply,
  countGrokRequests,
  createTask,
  findOrCreateProject,
  getGrokFile,
  getGrokThread,
  getProject,
  setGrokLive,
  getTask,
  getUser,
  latestGrokCommentId,
  latestGrokMessageId,
  listActiveUsers,
  listComments,
  mentionReviewer,
  listProjects,
  listTasks,
  recordGrokRequest,
  setCommentMentions,
  stopTimersOnTask,
  updateTask,
} from './db.js';
import { mentionedUserIds } from './mentions.js';
import { canCompleteTask, canEditTask } from './permissions.js';
import { isValidDate } from './time.js';
import { labelOf, PRIORITIES, STATUSES } from './constants.js';

export function grokConnected(config) {
  return Boolean(config.grokWebhookUrl);
}

export function rateLimitMessage(db, config, userId) {
  const hour = countGrokRequests(db, userId, Date.now() - 60 * 60 * 1000);
  if (hour >= (config.grokHourlyLimit || 20)) {
    return 'Grok is catching up. You can send 20 messages an hour.';
  }
  const day = countGrokRequests(db, userId, Date.now() - 24 * 60 * 60 * 1000);
  const daily = Number.isFinite(config.grokDailyLimit) ? config.grokDailyLimit : 100;
  if (day >= daily) {
    return `Grok's daily limit is ${daily} messages. Try again tomorrow.`;
  }
  return '';
}

export function postGrokWebhook(config, payload) {
  if (!config.grokWebhookUrl) return false;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (config.grokWebhookSecretHeader && config.grokWebhookSecret) {
    headers[config.grokWebhookSecretHeader] = config.grokWebhookSecret;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  fetch(config.grokWebhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).catch(() => {}).finally(() => clearTimeout(timer));
  return true;
}

const PDF_MAX = 15 * 1024 * 1024;

export function isPdf(buffer) {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-');
}

export function pdfFilename(name) {
  const base = path.basename(String(name || 'file.pdf')).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return base.toLowerCase().endsWith('.pdf') ? base : `${base || 'file'}.pdf`;
}

export function fileExpiry(row, now = Date.now()) {
  const exp = Date.parse(row.expires_at);
  const expired = !Number.isFinite(exp) || exp <= now;
  const hours = expired ? 0 : Math.max(1, Math.ceil((exp - now) / 3600000));
  return {
    id: row.id,
    filename: row.filename,
    size: row.size,
    kind: row.kind,
    expires_at: row.expires_at,
    expired,
    expires_label: expired ? 'expired' : `expires in ${hours}h`,
  };
}

export function webhookFiles(rows) {
  return rows.map((row) => ({ id: row.id, filename: row.filename, size: row.size, kind: row.kind }));
}

export function grokFileExpiry(config) {
  const hours = Number(config.grokFileTtlHours);
  return new Date(Date.now() + (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600 * 1000).toISOString();
}

export function recentContext(rows) {
  return rows.slice(-10).map((row) => ({
    role: row.role || row.author_name || 'user',
    text: row.body,
    at: row.created_at,
  }));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function json(res, status, body) {
  res.status(status).type('json').send(body);
}

function actingUser(db, req, res) {
  const id = Number(req.body?.acting_user_id);
  if (!Number.isInteger(id)) {
    json(res, 400, { error: 'acting_user_id is required' });
    return null;
  }
  const user = getUser(db, id);
  if (!user || !user.active || user.is_bot) {
    json(res, 403, { error: 'acting_user_id must be an active person' });
    return null;
  }
  return user;
}

function readAssigneeIds(body, users) {
  const hasList = body.assignee_ids !== undefined;
  const hasOne = body.assignee_id !== undefined;
  if (!hasList && !hasOne) return { ids: [] };
  const raw = hasList
    ? (Array.isArray(body.assignee_ids) ? body.assignee_ids : String(body.assignee_ids).split(','))
    : (body.assignee_id ? [body.assignee_id] : []);
  const ids = [];
  for (const value of raw) {
    if (value === '' || value === null) continue;
    const id = Number(value);
    if (!users.some((user) => user.id === id)) return { error: 'Unknown assignee' };
    if (!ids.includes(id)) ids.push(id);
  }
  return { ids };
}

function taskJson(task, comments) {
  const payload = {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    assignee_id: (task.assignee_ids && task.assignee_ids[0]) || task.assignee_id || null,
    assignee_ids: task.assignee_ids || [],
    assignees: (task.assignees || []).map((person) => ({ id: person.id, name: person.name })),
    assignee: task.assignee_name || null,
    project_id: task.project_id,
    project: task.project_name || null,
    reviewer_id: task.reviewer_id || null,
    reviewer: task.reviewer_name || null,
    created_by: task.created_by,
    comment_count: task.comment_count,
  };
  if (comments) {
    payload.comments = comments.map((comment) => ({
      id: comment.id,
      author_id: comment.author_id,
      author: comment.author_name,
      body: comment.body,
      created_at: comment.created_at,
    }));
  }
  return payload;
}

function behalf(user, detail) {
  return `Grok (on behalf of ${user.name}): ${detail}`;
}

export function mountBot(app, { db, config, grokUser, grokDir }) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, grokDir),
      filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}.pdf`),
    }),
    limits: { fileSize: PDF_MAX, files: 1 },
  });
  const router = express.Router();
  router.use((req, res, next) => {
    if (!config.botApiToken) return json(res, 503, { error: 'Bot API is disabled' });
    const header = String(req.get('authorization') || '');
    const match = /^Bearer\s+(\S+)\s*$/.exec(header);
    if (!match || !safeEqual(match[1], config.botApiToken)) return json(res, 401, { error: 'Unauthorized' });
    next();
  });
  router.use(express.json({ limit: '24mb' }));

  function sendStored(res, row) {
    if (Date.parse(row.expires_at) <= Date.now()) return json(res, 410, { error: 'File expired' });
    const root = path.resolve(grokDir);
    const full = path.resolve(root, row.stored_name);
    if (!full.startsWith(`${root}${path.sep}`) || !fs.existsSync(full)) return json(res, 404, { error: 'File not found' });
    const filename = row.filename.replace(/["\r\n]/g, '');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.\- ]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.sendFile(full);
  }

  function takePdf(req, res, next) {
    const type = String(req.get('content-type') || '');
    if (type.includes('multipart/form-data')) {
      upload.single('file')(req, res, (error) => {
        if (error) {
          return json(res, 400, { error: error.code === 'LIMIT_FILE_SIZE' ? 'Each PDF must be 15 MB or smaller.' : 'Could not read that file.' });
        }
        if (!req.file) return json(res, 400, { error: 'file is required' });
        const header = Buffer.alloc(5);
        const fd = fs.openSync(req.file.path, 'r');
        try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
        if (!isPdf(header)) {
          fs.rmSync(req.file.path, { force: true });
          return json(res, 400, { error: 'Only PDF files can be attached.' });
        }
        next({ stored: path.basename(req.file.filename), filename: pdfFilename(req.file.originalname), size: req.file.size });
      });
      return;
    }
    const raw = String(req.body?.data || req.body?.content_base64 || '');
    if (!raw) return json(res, 400, { error: 'file is required' });
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length > PDF_MAX) return json(res, 400, { error: 'Each PDF must be 15 MB or smaller.' });
    if (!isPdf(buffer)) return json(res, 400, { error: 'Only PDF files can be attached.' });
    const stored = `${crypto.randomBytes(16).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(grokDir, stored), buffer);
    next({ stored, filename: pdfFilename(req.body.filename), size: buffer.length });
  }

  router.get('/tasks', (req, res) => {
    const assignee = /^\d+$/.test(String(req.query.assignee || '')) ? Number(req.query.assignee) : (req.query.assignee === 'none' ? 'none' : null);
    const tasks = listTasks(db, {
      status: STATUSES.some(([value]) => value === req.query.status) ? req.query.status : '',
      assigneeId: assignee,
      projectId: /^\d+$/.test(String(req.query.project || '')) ? Number(req.query.project) : null,
      dueFrom: isValidDate(String(req.query.due_from || '')) ? String(req.query.due_from) : '',
      dueTo: isValidDate(String(req.query.due_to || '')) ? String(req.query.due_to) : '',
      search: String(req.query.q || '').trim().slice(0, 100),
      today: '1970-01-01',
    });
    json(res, 200, { tasks: tasks.map((task) => taskJson(task)) });
  });

  router.get('/tasks/:id', (req, res) => {
    const task = getTask(db, Number(req.params.id));
    if (!task) return json(res, 404, { error: 'Task not found' });
    json(res, 200, { task: taskJson(task, listComments(db, task.id)) });
  });

  router.get('/users', (req, res) => {
    json(res, 200, {
      users: listActiveUsers(db).map((user) => ({ id: user.id, name: user.name, role: user.role })),
    });
  });

  router.get('/projects', (req, res) => {
    json(res, 200, { projects: listProjects(db) });
  });

  router.post('/tasks', (req, res) => {
    const actor = actingUser(db, req, res);
    if (!actor) return;
    const title = String(req.body.title || '').trim();
    if (!title) return json(res, 400, { error: 'title is required' });
    const status = STATUSES.some(([value]) => value === req.body.status) ? req.body.status : 'todo';
    const priority = PRIORITIES.some(([value]) => value === req.body.priority) ? req.body.priority : null;
    const due = String(req.body.due_date || req.body.due || '').trim();
    if (due && !isValidDate(due)) return json(res, 400, { error: 'due must be YYYY-MM-DD' });
    let projectId = null;
    if (req.body.project_id) {
      const project = getProject(db, Number(req.body.project_id));
      if (!project) return json(res, 400, { error: 'Unknown project' });
      projectId = project.id;
    } else if (String(req.body.project || '').trim()) {
      projectId = findOrCreateProject(db, String(req.body.project).trim());
    }
    const chosen = readAssigneeIds(req.body, listActiveUsers(db));
    if (chosen.error) return json(res, 400, { error: chosen.error });
    const id = createTask(db, {
      title,
      description: String(req.body.description || ''),
      assigneeId: chosen.ids[0] || null,
      assigneeIds: chosen.ids,
      status,
      priority,
      dueDate: due || null,
      projectId,
      createdBy: actor.id,
    });
    const grok = grokUser();
    addActivity(db, { taskId: id, actorId: grok.id, action: 'created', detail: behalf(actor, 'Created the task') });
    json(res, 201, { task: taskJson(getTask(db, id)) });
  });

  router.patch('/tasks/:id', (req, res) => {
    const actor = actingUser(db, req, res);
    if (!actor) return;
    const task = getTask(db, Number(req.params.id));
    if (!task) return json(res, 404, { error: 'Task not found' });
    if (!canEditTask(actor, task)) return json(res, 403, { error: 'That person cannot edit this task' });
    const status = req.body.status === undefined ? task.status : req.body.status;
    if (!STATUSES.some(([value]) => value === status)) return json(res, 400, { error: 'Invalid status' });
    const priority = req.body.priority === undefined ? task.priority : (req.body.priority || null);
    if (priority && !PRIORITIES.some(([value]) => value === priority)) return json(res, 400, { error: 'Invalid priority' });
    const due = req.body.due_date === undefined && req.body.due === undefined
      ? (task.due_date || '')
      : String(req.body.due_date ?? req.body.due ?? '').trim();
    if (due && !isValidDate(due)) return json(res, 400, { error: 'due must be YYYY-MM-DD' });
    let assigneeId = task.assignee_id;
    let assigneeIds;
    if (req.body.assignee_ids !== undefined || req.body.assignee_id !== undefined) {
      const chosen = readAssigneeIds(req.body, listActiveUsers(db));
      if (chosen.error) return json(res, 400, { error: chosen.error });
      assigneeIds = chosen.ids;
      assigneeId = chosen.ids[0] || null;
    }
    let projectId = task.project_id;
    if (req.body.project_id !== undefined || req.body.project !== undefined) {
      if (req.body.project_id) {
        const project = getProject(db, Number(req.body.project_id));
        if (!project) return json(res, 400, { error: 'Unknown project' });
        projectId = project.id;
      } else if (String(req.body.project || '').trim()) {
        projectId = findOrCreateProject(db, String(req.body.project).trim());
      } else projectId = null;
    }
    const title = req.body.title === undefined ? task.title : String(req.body.title).trim();
    if (!title) return json(res, 400, { error: 'title is required' });
    let reviewerId;
    if (req.body.reviewer_id !== undefined && status === 'review') {
      const reviewer = getUser(db, Number(req.body.reviewer_id));
      if (!reviewer || !reviewer.active || reviewer.is_bot) return json(res, 400, { error: 'Unknown reviewer' });
      reviewerId = reviewer.id;
    }
    const updated = updateTask(db, task.id, {
      title,
      description: req.body.description === undefined ? task.description : String(req.body.description),
      assigneeId,
      assigneeIds,
      status,
      reviewerId,
      priority,
      dueDate: due || null,
      projectId,
    });
    if (status === 'review' && reviewerId && reviewerId !== task.reviewer_id) {
      const reviewer = getUser(db, reviewerId);
      mentionReviewer(db, {
        taskId: task.id,
        authorId: actor.id,
        reviewer,
        note: String(req.body.note || ''),
      });
    }
    const changed = [
      task.status !== updated.status ? `status ${labelOf(STATUSES, updated.status)}` : '',
      task.title !== updated.title ? 'title' : '',
      (task.assignee_id || null) !== (updated.assignee_id || null) ? 'assignee' : '',
      (task.due_date || '') !== (updated.due_date || '') ? 'due' : '',
    ].filter(Boolean).join(', ') || 'details';
    addActivity(db, { taskId: task.id, actorId: grokUser().id, action: 'updated', detail: behalf(actor, `Updated ${changed}`) });
    json(res, 200, { task: taskJson(updated) });
  });

  router.post('/tasks/:id/comments', (req, res) => {
    const actor = actingUser(db, req, res);
    if (!actor) return;
    const task = getTask(db, Number(req.params.id));
    if (!task) return json(res, 404, { error: 'Task not found' });
    const body = String(req.body.body || req.body.text || '').trim();
    if (!body) return json(res, 400, { error: 'body is required' });
    const grok = grokUser();
    const commentId = addComment(db, { taskId: task.id, authorId: grok.id, body });
    bindLooseGrokCommentFiles(db, task.id, commentId);
    const ids = activeUserIds(db, mentionedUserIds(body, listActiveUsers(db)));
    setCommentMentions(db, commentId, ids.filter((id) => id !== grok.id));
    clearGrokLiveForTask(db, task.id);
    addActivity(db, { taskId: task.id, actorId: grok.id, action: 'comment', detail: behalf(actor, 'Added a comment') });
    json(res, 201, { comment: { id: commentId, author: 'Grok', body } });
  });

  router.post('/chat/:threadId/status', (req, res) => {
    const actor = actingUser(db, req, res);
    if (!actor) return;
    const thread = getGrokThread(db, Number(req.params.threadId));
    if (!thread) return json(res, 404, { error: 'Thread not found' });
    if (thread.user_id !== actor.id) return json(res, 403, { error: 'That person does not own this thread' });
    const requestId = String(req.body.request_id || '').trim();
    if (!requestId) return json(res, 400, { error: 'request_id is required' });
    if (req.body.text === undefined) return json(res, 400, { error: 'text is required' });
    const live = setGrokLive(db, { requestId, userId: actor.id, threadId: thread.id, text: req.body.text });
    json(res, 200, { ok: true, text: live?.text || '' });
  });

  router.post('/tasks/:id/status', (req, res) => {
    const actor = actingUser(db, req, res);
    if (!actor) return;
    const task = getTask(db, Number(req.params.id));
    if (!task) return json(res, 404, { error: 'Task not found' });
    const requestId = String(req.body.request_id || '').trim();
    if (!requestId) return json(res, 400, { error: 'request_id is required' });
    if (req.body.text === undefined) return json(res, 400, { error: 'text is required' });
    const live = setGrokLive(db, { requestId, userId: actor.id, taskId: task.id, text: req.body.text });
    json(res, 200, { ok: true, text: live?.text || '' });
  });

  router.post('/chat/:threadId/reply', (req, res) => {
    const actor = actingUser(db, req, res);
    if (!actor) return;
    const thread = getGrokThread(db, Number(req.params.threadId));
    if (!thread) return json(res, 404, { error: 'Thread not found' });
    if (thread.user_id !== actor.id) return json(res, 403, { error: 'That person does not own this thread' });
    const text = String(req.body.text || req.body.body || '').trim();
    if (!text) return json(res, 400, { error: 'text is required' });
    completeGrokReply(db, thread.id, { requestId: String(req.body.request_id || ''), text });
    json(res, 200, { ok: true, thread_id: thread.id });
  });

  router.get('/files/:id', (req, res) => {
    const row = getGrokFile(db, Number(req.params.id));
    if (!row) return json(res, 404, { error: 'File not found' });
    sendStored(res, row);
  });

  router.post('/chat/:threadId/files', (req, res) => {
    takePdf(req, res, (file) => {
      const actor = actingUser(db, req, res);
      if (!actor) return fs.rmSync(path.join(grokDir, file.stored), { force: true });
      const thread = getGrokThread(db, Number(req.params.threadId));
      if (!thread) {
        fs.rmSync(path.join(grokDir, file.stored), { force: true });
        return json(res, 404, { error: 'Thread not found' });
      }
      if (thread.user_id !== actor.id) {
        fs.rmSync(path.join(grokDir, file.stored), { force: true });
        return json(res, 403, { error: 'That person does not own this thread' });
      }
      const row = addGrokFile(db, {
        ownerUserId: actor.id,
        threadId: thread.id,
        messageId: latestGrokMessageId(db, thread.id, String(req.body.request_id || '')),
        kind: 'out',
        filename: file.filename,
        storedName: file.stored,
        size: file.size,
        expiresAt: grokFileExpiry(config),
      });
      json(res, 201, { file: { id: row.id, filename: row.filename, size: row.size, kind: row.kind } });
    });
  });

  router.post('/tasks/:id/files', (req, res) => {
    takePdf(req, res, (file) => {
      const actor = actingUser(db, req, res);
      if (!actor) return fs.rmSync(path.join(grokDir, file.stored), { force: true });
      const task = getTask(db, Number(req.params.id));
      if (!task) {
        fs.rmSync(path.join(grokDir, file.stored), { force: true });
        return json(res, 404, { error: 'Task not found' });
      }
      const grok = grokUser();
      const commentId = latestGrokCommentId(db, task.id, grok.id);
      const row = addGrokFile(db, {
        ownerUserId: actor.id,
        taskId: task.id,
        commentId,
        kind: 'out',
        filename: file.filename,
        storedName: file.stored,
        size: file.size,
        expiresAt: grokFileExpiry(config),
      });
      addActivity(db, { taskId: task.id, actorId: grok.id, action: 'attachment', detail: behalf(actor, `Attached ${row.filename}`) });
      json(res, 201, { file: { id: row.id, filename: row.filename, size: row.size, kind: row.kind, comment_id: commentId } });
    });
  });

  router.post('/complete/:id', (req, res) => {
    const actor = actingUser(db, req, res);
    if (!actor) return;
    const task = getTask(db, Number(req.params.id));
    if (!task) return json(res, 404, { error: 'Task not found' });
    if (!canCompleteTask(actor, task)) return json(res, 403, { error: 'That person cannot complete this task' });
    if (task.status !== 'done') {
      updateTask(db, task.id, {
        title: task.title,
        description: task.description,
        assigneeId: task.assignee_id,
        status: 'done',
        priority: task.priority,
        dueDate: task.due_date,
        projectId: task.project_id,
      });
      stopTimersOnTask(db, task.id);
      addActivity(db, { taskId: task.id, actorId: grokUser().id, action: 'status', detail: behalf(actor, 'Marked the task done') });
    }
    json(res, 200, { task: taskJson(getTask(db, task.id)) });
  });

  app.use('/api/bot', router);
}

