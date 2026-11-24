import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword } from './passwords.js';
import { entrySeconds } from './time.js';

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('superuser', 'admin', 'user')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY,
      ip TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
      priority TEXT CHECK (priority IN ('low', 'med', 'high', 'urgent')),
      due_date TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip, created_at);

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comment_mentions (
      comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (comment_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      stored_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime TEXT,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      started_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_time_task ON time_entries(task_id);
    CREATE INDEX IF NOT EXISTS idx_time_user_open ON time_entries(user_id, ended_at);
  `);
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all();
  if (!taskColumns.some((column) => column.name === 'project_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id)');
  }
}

export function userCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function bootstrapSuperuser(db, { email, password, name }) {
  if (userCount(db) > 0) return null;
  if (!email || !password || password.length < 8) return null;
  return createUser(db, { email, name: name || 'Superuser', password, role: 'superuser' });
}

export function upsertSuperuser(db, { email, password, name }) {
  const existing = getUserByEmail(db, email);
  if (!existing) {
    createUser(db, { email, name: name || 'Superuser', password, role: 'superuser' });
    return { created: true };
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users
    SET name = ?, password_hash = ?, role = 'superuser', active = 1, updated_at = ?
    WHERE id = ?
  `).run(name || existing.name, hashPassword(password), now, existing.id);
  return { created: false };
}

export function createUser(db, { email, name, password, role }) {
  const now = new Date().toISOString();
  try {
    const info = db.prepare(`
      INSERT INTO users (email, name, password_hash, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(email, name, hashPassword(password), role, now, now);
    return { id: Number(info.lastInsertRowid) };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return { error: 'email' };
    throw error;
  }
}

export function updateUser(db, id, { email, name, role, active, password }) {
  const now = new Date().toISOString();
  try {
    db.prepare(`
      UPDATE users
      SET email = ?, name = ?, role = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(email, name, role, active ? 1 : 0, now, id);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return { error: 'email' };
    throw error;
  }
  if (password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  }
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return { ok: true };
}

export function getUser(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

export function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
}

export function listUsers(db, actor) {
  if (actor.role === 'admin') {
    return db.prepare(`
      SELECT id, email, name, role, active, created_at
      FROM users
      WHERE role = 'user'
      ORDER BY active DESC, name COLLATE NOCASE
    `).all();
  }
  return db.prepare(`
    SELECT id, email, name, role, active, created_at
    FROM users
    ORDER BY active DESC, CASE role WHEN 'superuser' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name COLLATE NOCASE
  `).all();
}

export function listActiveUsers(db) {
  return db.prepare(`
    SELECT id, email, name, role, active
    FROM users
    WHERE active = 1
    ORDER BY name COLLATE NOCASE
  `).all();
}

export function countOtherActiveSuperusers(db, userId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM users
    WHERE role = 'superuser' AND active = 1 AND id != ?
  `).get(userId).n;
}

export function getSessionUser(db, sessionId) {
  if (!sessionId) return null;
  return db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ? AND u.active = 1
  `).get(sessionId, Date.now()) || null;
}

export function createSession(db, userId, sessionId, expiresAt) {
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    sessionId,
    userId,
    expiresAt,
    Date.now(),
  );
}

export function deleteSession(db, sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function loginAttemptCount(db, ip, since) {
  return db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND created_at > ?').get(ip, since).n;
}

export function recordLoginAttempt(db, ip) {
  db.prepare('INSERT INTO login_attempts (ip, created_at) VALUES (?, ?)').run(ip, Date.now());
  db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(Date.now() - 24 * 60 * 60 * 1000);
}

export function clearLoginAttempts(db, ip) {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
}

function likeTerm(value) {
  return `%${String(value).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function listTasks(db, filters) {
  const where = [];
  const params = [];
  if (filters.status) {
    where.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.assigneeId === 'none') {
    where.push('t.assignee_id IS NULL');
  } else if (filters.assigneeId) {
    where.push('t.assignee_id = ?');
    params.push(filters.assigneeId);
  }
  if (filters.overdue) {
    where.push("t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date != '' AND t.due_date < ?");
    params.push(filters.today);
  }
  if (filters.projectId) {
    where.push('t.project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.mentionUserId) {
    where.push(`EXISTS (
      SELECT 1 FROM comments cm
      JOIN comment_mentions mn ON mn.comment_id = cm.id
      WHERE cm.task_id = t.id AND mn.user_id = ?
    )`);
    params.push(filters.mentionUserId);
  }
  if (filters.search) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR IFNULL(t.description, '') LIKE ? ESCAPE '\\' OR IFNULL(p.name, '') LIKE ? ESCAPE '\\')");
    const term = likeTerm(filters.search);
    params.push(term, term, term);
  }
  const sql = `
    SELECT t.*,
      a.name AS assignee_name,
      c.name AS creator_name,
      p.name AS project_name,
      (SELECT COUNT(*) FROM comments cm WHERE cm.task_id = t.id) AS comment_count
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users c ON c.id = t.created_by
    LEFT JOIN projects p ON p.id = t.project_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE t.status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,
      CASE WHEN t.due_date IS NULL OR t.due_date = '' THEN 1 ELSE 0 END,
      t.due_date ASC,
      t.updated_at DESC
  `;
  return db.prepare(sql).all(...params);
}

export function boardCounts(db, today) {
  const open = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status != 'done'").get().n;
  const overdue = db.prepare(`
    SELECT COUNT(*) AS n FROM tasks
    WHERE status != 'done' AND due_date IS NOT NULL AND due_date != '' AND due_date < ?
  `).get(today).n;
  return { open, overdue };
}

export function getTask(db, id) {
  return db.prepare(`
    SELECT t.*,
      a.name AS assignee_name,
      c.name AS creator_name,
      p.name AS project_name,
      (SELECT COUNT(*) FROM comments cm WHERE cm.task_id = t.id) AS comment_count
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users c ON c.id = t.created_by
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.id = ?
  `).get(id) || null;
}

export function createTask(db, fields) {
  const now = new Date().toISOString();
  const completedAt = fields.status === 'done' ? now : null;
  const info = db.prepare(`
    INSERT INTO tasks (
      title, description, assignee_id, status, priority, due_date, project_id, created_by,
      completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.title,
    fields.description,
    fields.assigneeId,
    fields.status,
    fields.priority,
    fields.dueDate,
    fields.projectId || null,
    fields.createdBy,
    completedAt,
    now,
    now,
  );
  return Number(info.lastInsertRowid);
}

export function updateTask(db, id, fields) {
  const current = getTask(db, id);
  if (!current) return null;
  const now = new Date().toISOString();
  let completedAt = current.completed_at;
  if (fields.status === 'done' && current.status !== 'done') completedAt = now;
  if (fields.status !== 'done') completedAt = null;
  db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, assignee_id = ?, status = ?, priority = ?, due_date = ?,
        project_id = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    fields.title,
    fields.description,
    fields.assigneeId,
    fields.status,
    fields.priority,
    fields.dueDate,
    fields.projectId || null,
    completedAt,
    now,
    id,
  );
  return getTask(db, id);
}

export function deleteTask(db, id) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM comments WHERE task_id = ?').run(id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  });
  tx();
}

export function listComments(db, taskId) {
  return db.prepare(`
    SELECT c.*, u.name AS author_name
    FROM comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.task_id = ?
    ORDER BY c.created_at ASC, c.id ASC
  `).all(taskId);
}

export function getComment(db, id) {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id) || null;
}

export function addComment(db, { taskId, authorId, body }) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?, ?, ?, ?)
  `).run(taskId, authorId, body, now);
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, taskId);
  return Number(info.lastInsertRowid);
}

export function deleteComment(db, id) {
  const comment = getComment(db, id);
  if (!comment) return null;
  db.prepare('DELETE FROM comment_mentions WHERE comment_id = ?').run(id);
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), comment.task_id);
  return comment;
}

export function listProjects(db) {
  return db.prepare('SELECT id, name FROM projects ORDER BY name COLLATE NOCASE').all();
}

export function getProject(db, id) {
  return db.prepare('SELECT id, name FROM projects WHERE id = ?').get(id) || null;
}

export function findOrCreateProject(db, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed.length > 80) return null;
  const existing = db.prepare('SELECT id FROM projects WHERE lower(name) = lower(?)').get(trimmed);
  if (existing) return existing.id;
  try {
    const info = db.prepare('INSERT INTO projects (name, created_at) VALUES (?, ?)').run(trimmed, new Date().toISOString());
    return Number(info.lastInsertRowid);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return db.prepare('SELECT id FROM projects WHERE lower(name) = lower(?)').get(trimmed)?.id || null;
    }
    throw error;
  }
}

export function addActivity(db, { taskId, actorId, action, detail }) {
  db.prepare(`
    INSERT INTO activity (task_id, actor_id, action, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(taskId, actorId, action, detail, new Date().toISOString());
}

export function listActivity(db, taskId) {
  return db.prepare(`
    SELECT a.*, u.name AS actor_name
    FROM activity a
    JOIN users u ON u.id = a.actor_id
    WHERE a.task_id = ?
    ORDER BY a.created_at DESC, a.id DESC
  `).all(taskId);
}

export function setCommentMentions(db, commentId, userIds) {
  const insert = db.prepare('INSERT OR IGNORE INTO comment_mentions (comment_id, user_id) VALUES (?, ?)');
  const tx = db.transaction((ids) => {
    for (const userId of ids) insert.run(commentId, userId);
  });
  tx(userIds);
}

export function listAttachments(db, taskId) {
  return db.prepare(`
    SELECT a.*, u.name AS uploader_name
    FROM attachments a
    JOIN users u ON u.id = a.uploaded_by
    WHERE a.task_id = ?
    ORDER BY a.created_at ASC, a.id ASC
  `).all(taskId);
}

export function getAttachment(db, id) {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) || null;
}

export function addAttachment(db, fields) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO attachments (task_id, uploaded_by, stored_name, original_name, mime, size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(fields.taskId, fields.uploadedBy, fields.storedName, fields.originalName, fields.mime || '', fields.size, now);
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, fields.taskId);
  return Number(info.lastInsertRowid);
}

export function deleteAttachment(db, id) {
  const row = getAttachment(db, id);
  if (!row) return null;
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  return row;
}

function taskScope(filters, params) {
  const where = ['1 = 1'];
  if (filters.projectId) {
    where.push('t.project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.personId === 'none') where.push('t.assignee_id IS NULL');
  else if (filters.personId) {
    where.push('t.assignee_id = ?');
    params.push(filters.personId);
  }
  return where.join(' AND ');
}

export function managementReport(db, filters) {
  const peopleParams = [filters.today, filters.weekStart, filters.projectId, filters.projectId];
  let personClause = '';
  if (filters.personId && filters.personId !== 'none') {
    personClause = 'AND u.id = ?';
    peopleParams.push(filters.personId);
  }
  const people = filters.personId === 'none' ? [] : db.prepare(`
    SELECT u.id, u.name,
      SUM(CASE WHEN t.id IS NOT NULL AND t.status != 'done' THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN t.id IS NOT NULL AND t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date != '' AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue_count,
      SUM(CASE WHEN t.completed_at IS NOT NULL AND t.completed_at >= ? THEN 1 ELSE 0 END) AS done_week
    FROM users u
    LEFT JOIN tasks t ON t.assignee_id = u.id AND (? IS NULL OR t.project_id = ?)
    WHERE u.active = 1 ${personClause}
    GROUP BY u.id
    ORDER BY open_count DESC, u.name COLLATE NOCASE
  `).all(...peopleParams);

  const overdueParams = [];
  const overdueWhere = taskScope(filters, overdueParams);
  overdueParams.unshift(filters.today);
  const overdue = db.prepare(`
    SELECT t.id, t.title, t.due_date, t.status, a.name AS assignee_name, p.name AS project_name
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date != '' AND t.due_date < ?
      AND ${overdueWhere}
    ORDER BY t.due_date ASC
    LIMIT 40
  `).all(...overdueParams);

  function doneSince(since) {
    const params = [];
    const where = taskScope(filters, params);
    return db.prepare(`
      SELECT t.id, t.title, t.completed_at, a.name AS assignee_name, p.name AS project_name
      FROM tasks t
      LEFT JOIN users a ON a.id = t.assignee_id
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status = 'done' AND t.completed_at IS NOT NULL AND t.completed_at >= ?
        AND ${where}
      ORDER BY t.completed_at DESC
      LIMIT 20
    `).all(since, ...params);
  }

  const totalParams = [];
  const totalWhere = taskScope(filters, totalParams);
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status != 'done' AND due_date IS NOT NULL AND due_date != '' AND due_date < ? THEN 1 ELSE 0 END) AS overdue_count,
      SUM(CASE WHEN completed_at IS NOT NULL AND completed_at >= ? THEN 1 ELSE 0 END) AS done_week,
      SUM(CASE WHEN completed_at IS NOT NULL AND completed_at >= ? THEN 1 ELSE 0 END) AS done_7,
      SUM(CASE WHEN completed_at IS NOT NULL AND completed_at >= ? THEN 1 ELSE 0 END) AS done_30
    FROM tasks t
    WHERE ${totalWhere}
  `).get(filters.today, filters.weekStart, filters.since7, filters.since30, ...totalParams);

  let unassigned = null;
  if (!filters.personId || filters.personId === 'none') {
    const params = [filters.today, filters.weekStart];
    let projectSql = '';
    if (filters.projectId) {
      projectSql = 'AND project_id = ?';
      params.push(filters.projectId);
    }
    unassigned = db.prepare(`
      SELECT
        SUM(CASE WHEN status != 'done' THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN status != 'done' AND due_date IS NOT NULL AND due_date != '' AND due_date < ? THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN completed_at IS NOT NULL AND completed_at >= ? THEN 1 ELSE 0 END) AS done_week
      FROM tasks
      WHERE assignee_id IS NULL ${projectSql}
    `).get(...params);
  }

  return {
    people,
    unassigned,
    overdue,
    done7: doneSince(filters.since7),
    done30: doneSince(filters.since30),
    totals: {
      open: totals.open_count || 0,
      overdue: totals.overdue_count || 0,
      doneWeek: totals.done_week || 0,
      done7: totals.done_7 || 0,
      done30: totals.done_30 || 0,
    },
  };
}

export function listRunningTimers(db) {
  return db.prepare(`
    SELECT te.*, u.name AS user_name, t.title AS task_title
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    JOIN tasks t ON t.id = te.task_id
    WHERE te.ended_at IS NULL
    ORDER BY te.started_at ASC
  `).all();
}

export function getRunningTimer(db, userId) {
  return db.prepare(`
    SELECT te.*, t.title AS task_title
    FROM time_entries te
    JOIN tasks t ON t.id = te.task_id
    WHERE te.user_id = ? AND te.ended_at IS NULL
  `).get(userId) || null;
}

export function startTimer(db, { userId, taskId }) {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const running = db.prepare(`
      SELECT * FROM time_entries WHERE user_id = ? AND ended_at IS NULL
    `).get(userId);
    if (running && running.task_id === taskId) return { already: true, entry: running, stopped: null };
    let stopped = null;
    if (running) {
      db.prepare('UPDATE time_entries SET ended_at = ? WHERE id = ?').run(now, running.id);
      stopped = { ...running, ended_at: now };
    }
    const info = db.prepare(`
      INSERT INTO time_entries (task_id, user_id, started_at, ended_at)
      VALUES (?, ?, ?, NULL)
    `).run(taskId, userId, now);
    return { already: false, stopped, id: Number(info.lastInsertRowid), startedAt: now };
  })();
}

export function stopTimer(db, { userId, taskId }) {
  const running = db.prepare(`
    SELECT * FROM time_entries WHERE user_id = ? AND task_id = ? AND ended_at IS NULL
  `).get(userId, taskId);
  if (!running) return null;
  const now = new Date().toISOString();
  db.prepare('UPDATE time_entries SET ended_at = ? WHERE id = ?').run(now, running.id);
  return { ...running, ended_at: now };
}

export function listTimeEntries(db, taskId) {
  return db.prepare(`
    SELECT te.*, u.name AS user_name
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    WHERE te.task_id = ?
    ORDER BY te.started_at DESC, te.id DESC
  `).all(taskId);
}

export function timeTotals(db, now = Date.now()) {
  const totals = new Map();
  for (const row of db.prepare('SELECT task_id, started_at, ended_at FROM time_entries').all()) {
    totals.set(row.task_id, (totals.get(row.task_id) || 0) + entrySeconds(row.started_at, row.ended_at, now));
  }
  return totals;
}

export function timeReport(db, filters, now = Date.now()) {
  const where = [];
  const params = [];
  if (filters.projectId) {
    where.push('t.project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.personId && filters.personId !== 'none') {
    where.push('te.user_id = ?');
    params.push(filters.personId);
  }
  if (filters.personId === 'none') where.push('0 = 1');
  const entries = db.prepare(`
    SELECT te.task_id, te.user_id, te.started_at, te.ended_at,
      t.title, t.status, t.project_id, u.name AS user_name, p.name AS project_name
    FROM time_entries te
    JOIN tasks t ON t.id = te.task_id
    JOIN users u ON u.id = te.user_id
    LEFT JOIN projects p ON p.id = t.project_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `).all(...params);

  const byTask = new Map();
  const byPerson = new Map();
  const byProject = new Map();
  for (const entry of entries) {
    const seconds = entrySeconds(entry.started_at, entry.ended_at, now);
    const task = byTask.get(entry.task_id) || { id: entry.task_id, title: entry.title, project_name: entry.project_name || 'No project', seconds: 0 };
    task.seconds += seconds;
    byTask.set(entry.task_id, task);
    const person = byPerson.get(entry.user_id) || { id: entry.user_id, name: entry.user_name, seconds: 0 };
    person.seconds += seconds;
    byPerson.set(entry.user_id, person);
    const projectKey = entry.project_id || 0;
    const project = byProject.get(projectKey) || { id: entry.project_id, name: entry.project_name || 'No project', seconds: 0 };
    project.seconds += seconds;
    byProject.set(projectKey, project);
  }

  const doneWhere = ["t.status = 'done'"];
  const doneParams = [];
  if (filters.projectId) {
    doneWhere.push('t.project_id = ?');
    doneParams.push(filters.projectId);
  }
  const doneIds = new Set(db.prepare(`SELECT id FROM tasks t WHERE ${doneWhere.join(' AND ')}`).all(...doneParams).map((row) => row.id));
  const secondsByDone = new Map();
  for (const entry of entries) {
    if (!doneIds.has(entry.task_id)) continue;
    secondsByDone.set(entry.task_id, (secondsByDone.get(entry.task_id) || 0) + entrySeconds(entry.started_at, entry.ended_at, now));
  }
  const timed = [...secondsByDone.values()];
  const sort = (rows) => rows.sort((a, b) => b.seconds - a.seconds || String(a.name || a.title).localeCompare(String(b.name || b.title)));
  return {
    byTask: sort([...byTask.values()]),
    byPerson: sort([...byPerson.values()]),
    byProject: sort([...byProject.values()]),
    averageSeconds: timed.length ? Math.round(timed.reduce((sum, value) => sum + value, 0) / timed.length) : 0,
    completedWithTime: timed.length,
    completedCount: doneIds.size,
  };
}
