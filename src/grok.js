import crypto from 'node:crypto';
import express from 'express';
import {
  activeUserIds,
  addActivity,
  addComment,
  completeGrokReply,
  countGrokRequests,
  createTask,
  findOrCreateProject,
  getGrokThread,
  getProject,
  getTask,
  getUser,
  listActiveUsers,
  listComments,
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

function taskJson(task, comments) {
  const payload = {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    assignee_id: task.assignee_id,
    assignee: task.assignee_name || null,
    project_id: task.project_id,
    project: task.project_name || null,
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

export function mountBot(app, { db, config, grokUser }) {
  const router = express.Router();
  router.use(express.json({ limit: '200kb' }));
  router.use((req, res, next) => {
    if (!config.botApiToken) return json(res, 503, { error: 'Bot API is disabled' });
    const header = String(req.get('authorization') || '');
    const match = /^Bearer\s+(\S+)\s*$/.exec(header);
    if (!match || !safeEqual(match[1], config.botApiToken)) return json(res, 401, { error: 'Unauthorized' });
    next();
  });

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
    let assigneeId = null;
    if (req.body.assignee_id) {
      const person = listActiveUsers(db).find((user) => user.id === Number(req.body.assignee_id));
      if (!person) return json(res, 400, { error: 'Unknown assignee' });
      assigneeId = person.id;
    }
    const id = createTask(db, {
      title,
      description: String(req.body.description || ''),
      assigneeId,
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
    if (req.body.assignee_id !== undefined) {
      if (!req.body.assignee_id) assigneeId = null;
      else {
        const person = listActiveUsers(db).find((user) => user.id === Number(req.body.assignee_id));
        if (!person) return json(res, 400, { error: 'Unknown assignee' });
        assigneeId = person.id;
      }
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
    const updated = updateTask(db, task.id, {
      title,
      description: req.body.description === undefined ? task.description : String(req.body.description),
      assigneeId,
      status,
      priority,
      dueDate: due || null,
      projectId,
    });
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
    const ids = activeUserIds(db, mentionedUserIds(body, listActiveUsers(db)));
    setCommentMentions(db, commentId, ids.filter((id) => id !== grok.id));
    addActivity(db, { taskId: task.id, actorId: grok.id, action: 'comment', detail: behalf(actor, 'Added a comment') });
    json(res, 201, { comment: { id: commentId, author: 'Grok', body } });
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

