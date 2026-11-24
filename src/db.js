import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { colorForUser, colorsToStore, nextColor, normalizeColor } from './colors.js';
import { hashPassword } from './passwords.js';
import { dateInJohannesburg, entrySeconds, shiftDate, startOfMonthIso, startOfWeekIso, todayDate } from './time.js';

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
      reviewer_id INTEGER REFERENCES users(id),
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

    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (task_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS task_status_history (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      changed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_status_history_task ON task_status_history(task_id, changed_at);
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

    CREATE TABLE IF NOT EXISTS task_mentions (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (task_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS mention_notices (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      read_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mention_notices_user ON mention_notices(user_id, read_at);

    CREATE TABLE IF NOT EXISTS grok_threads (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grok_threads_user ON grok_threads(user_id, updated_at);

    CREATE TABLE IF NOT EXISTS grok_messages (
      id INTEGER PRIMARY KEY,
      thread_id INTEGER NOT NULL REFERENCES grok_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'grok')),
      body TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      status TEXT NOT NULL DEFAULT 'complete',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grok_messages_thread ON grok_messages(thread_id, id);

    CREATE TABLE IF NOT EXISTS grok_requests (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grok_requests_user ON grok_requests(user_id, created_at);

    CREATE TABLE IF NOT EXISTS grok_files (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      thread_id INTEGER REFERENCES grok_threads(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      message_id INTEGER,
      comment_id INTEGER,
      kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_grok_files_thread ON grok_files(thread_id);
    CREATE INDEX IF NOT EXISTS idx_grok_files_task ON grok_files(task_id);
    CREATE INDEX IF NOT EXISTS idx_grok_files_expires ON grok_files(expires_at);

    CREATE TABLE IF NOT EXISTS grok_live (
      id INTEGER PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      thread_id INTEGER,
      task_id INTEGER,
      text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kudos (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      target_type TEXT NOT NULL CHECK (target_type IN ('comment', 'task')),
      target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, target_type, target_id)
    );
  `);
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all();
  if (!taskColumns.some((column) => column.name === 'project_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id)');
  }
  const columns = db.prepare('PRAGMA table_info(tasks)').all();
  if (!columns.some((column) => column.name === 'deleted_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN deleted_at TEXT');
  }
  if (!columns.some((column) => column.name === 'reviewer_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN reviewer_id INTEGER REFERENCES users(id)');
  }
  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some((column) => column.name === 'is_bot')) {
    db.exec('ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0');
  }
  const colorColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!colorColumns.some((column) => column.name === 'color')) {
    db.exec('ALTER TABLE users ADD COLUMN color TEXT');
  }
  relaxGrokThreads(db);
  backfillTaskAssignees(db);
  backfillStatusHistory(db);
  backfillUserColors(db);
}

function backfillUserColors(db) {
  const rows = db.prepare('SELECT id, color FROM users ORDER BY id').all();
  const update = db.prepare('UPDATE users SET color = ? WHERE id = ?');
  for (const row of colorsToStore(rows)) update.run(row.color, row.id);
}

function paintUser(row) {
  if (!row) return row;
  row.color = colorForUser(row.id, row.color);
  return row;
}

function recordStatus(db, taskId, status, changedAt) {
  db.prepare('INSERT INTO task_status_history (task_id, status, changed_at) VALUES (?, ?, ?)').run(taskId, status, changedAt);
}

function backfillStatusHistory(db) {
  db.exec(`
    INSERT INTO task_status_history (task_id, status, changed_at)
    SELECT t.id, t.status, t.created_at FROM tasks t
    WHERE NOT EXISTS (SELECT 1 FROM task_status_history h WHERE h.task_id = t.id)
  `);
}

function backfillTaskAssignees(db) {
  db.exec(`
    INSERT OR IGNORE INTO task_assignees (task_id, user_id)
    SELECT t.id, t.assignee_id FROM tasks t
    WHERE t.assignee_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = t.assignee_id)
  `);
}

function relaxGrokThreads(db) {
  const columns = db.prepare('PRAGMA table_info(grok_threads)').all();
  if (!columns.length) return;
  const hasTitle = columns.some((column) => column.name === 'title');
  const unique = db.prepare('PRAGMA index_list(grok_threads)').all()
    .some((index) => index.unique && index.origin === 'u');
  if (hasTitle && !unique) return;
  const titleSql = hasTitle ? "COALESCE(title, '')" : "''";
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    CREATE TABLE grok_threads_next (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO grok_threads_next (id, user_id, title, created_at, updated_at)
      SELECT id, user_id, ${titleSql}, created_at, updated_at FROM grok_threads;
    DROP TABLE grok_threads;
    ALTER TABLE grok_threads_next RENAME TO grok_threads;
    CREATE INDEX IF NOT EXISTS idx_grok_threads_user ON grok_threads(user_id, updated_at);
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

export function userCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_bot = 0').get().n;
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
    const used = db.prepare('SELECT color FROM users').all().map((row) => row.color);
    const info = db.prepare(`
      INSERT INTO users (email, name, password_hash, role, active, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `).run(email, name, hashPassword(password), role, nextColor(used), now, now);
    return { id: Number(info.lastInsertRowid) };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return { error: 'email' };
    throw error;
  }
}

export function updateUser(db, id, { email, name, role, active, password, color }) {
  const now = new Date().toISOString();
  try {
    db.prepare(`
      UPDATE users
      SET email = ?, name = ?, role = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(email, name, role, active ? 1 : 0, now, id);
    const stored = normalizeColor(color);
    if (stored) db.prepare('UPDATE users SET color = ? WHERE id = ?').run(stored, id);
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
  return paintUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null);
}

export function getUserByEmail(db, email) {
  return paintUser(db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null);
}

export function listUsers(db, actor) {
  if (actor.role === 'admin') {
    return db.prepare(`
      SELECT id, email, name, role, active, color, created_at
      FROM users
      WHERE role = 'user' AND is_bot = 0
      ORDER BY active DESC, name COLLATE NOCASE
    `).all().map(paintUser);
  }
  return db.prepare(`
    SELECT id, email, name, role, active, color, created_at
    FROM users
    WHERE is_bot = 0
    ORDER BY active DESC, CASE role WHEN 'superuser' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name COLLATE NOCASE
  `).all().map(paintUser);
}

export function listActiveUsers(db) {
  return db.prepare(`
    SELECT id, email, name, role, active, color
    FROM users
    WHERE active = 1 AND is_bot = 0
    ORDER BY name COLLATE NOCASE
  `).all().map(paintUser);
}

export function countOtherActiveSuperusers(db, userId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM users
    WHERE role = 'superuser' AND active = 1 AND id != ?
  `).get(userId).n;
}

export function getSessionUser(db, sessionId) {
  if (!sessionId) return null;
  return paintUser(db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ? AND u.active = 1
  `).get(sessionId, Date.now()) || null);
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
  const where = ['t.deleted_at IS NULL'];
  const params = [];
  if (filters.status) {
    where.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.assigneeId === 'none') {
    where.push('NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)');
  } else if (filters.assigneeId) {
    where.push('EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)');
    params.push(filters.assigneeId);
  }
  if (filters.overdue) {
    where.push("t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date != '' AND t.due_date < ?");
    params.push(filters.today);
  }
  if (filters.nodue) where.push("(t.due_date IS NULL OR t.due_date = '')");
  if (filters.projectId) {
    where.push('t.project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.due) {
    where.push('t.due_date = ?');
    params.push(filters.due);
  }
  if (filters.dueFrom) {
    where.push("t.due_date IS NOT NULL AND t.due_date != '' AND t.due_date >= ?");
    params.push(filters.dueFrom);
  }
  if (filters.dueTo) {
    where.push("t.due_date IS NOT NULL AND t.due_date != '' AND t.due_date <= ?");
    params.push(filters.dueTo);
  }
  if (filters.mentionUserId) {
    where.push(`(
      EXISTS (
        SELECT 1 FROM comments cm
        JOIN comment_mentions mn ON mn.comment_id = cm.id
        WHERE cm.task_id = t.id AND mn.user_id = ?
      )
      OR EXISTS (
        SELECT 1 FROM task_mentions tm
        WHERE tm.task_id = t.id AND tm.user_id = ?
      )
    )`);
    params.push(filters.mentionUserId, filters.mentionUserId);
  }
  if (filters.search) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR IFNULL(t.description, '') LIKE ? ESCAPE '\\' OR IFNULL(p.name, '') LIKE ? ESCAPE '\\')");
    const term = likeTerm(filters.search);
    params.push(term, term, term);
  }
  const sql = `
    SELECT t.*,
      a.name AS assignee_name,
      a.color AS assignee_color,
      c.name AS creator_name,
      c.color AS creator_color,
      r.name AS reviewer_name,
      r.color AS reviewer_color,
      p.name AS project_name,
      (SELECT COUNT(*) FROM comments cm WHERE cm.task_id = t.id) AS comment_count
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users c ON c.id = t.created_by
    LEFT JOIN users r ON r.id = t.reviewer_id
    LEFT JOIN projects p ON p.id = t.project_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE t.status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,
      CASE WHEN t.due_date IS NULL OR t.due_date = '' THEN 1 ELSE 0 END,
      t.due_date ASC,
      t.updated_at DESC
  `;
  return attachAssignees(db, db.prepare(sql).all(...params));
}

export function boardCounts(db, today) {
  const open = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status != 'done' AND deleted_at IS NULL").get().n;
  const overdue = db.prepare(`
    SELECT COUNT(*) AS n FROM tasks
    WHERE status != 'done' AND deleted_at IS NULL AND due_date IS NOT NULL AND due_date != '' AND due_date < ?
  `).get(today).n;
  return { open, overdue };
}

export function getTask(db, id) {
  const task = db.prepare(`
    SELECT t.*,
      a.name AS assignee_name,
      a.color AS assignee_color,
      c.name AS creator_name,
      c.color AS creator_color,
      r.name AS reviewer_name,
      r.color AS reviewer_color,
      p.name AS project_name,
      (SELECT COUNT(*) FROM comments cm WHERE cm.task_id = t.id) AS comment_count
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users c ON c.id = t.created_by
    LEFT JOIN users r ON r.id = t.reviewer_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.id = ? AND t.deleted_at IS NULL
  `).get(id);
  return task ? attachAssignees(db, [task])[0] : null;
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
  const id = Number(info.lastInsertRowid);
  const ids = fields.assigneeIds ?? (fields.assigneeId ? [fields.assigneeId] : []);
  setTaskAssignees(db, id, ids);
  recordStatus(db, id, fields.status, now);
  return id;
}

export function setTaskAssignees(db, taskId, userIds) {
  const ids = [];
  for (const value of userIds || []) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
    const insert = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)');
    for (const id of ids) insert.run(taskId, id);
    db.prepare('UPDATE tasks SET assignee_id = ? WHERE id = ?').run(ids[0] || null, taskId);
  });
  tx();
  return ids;
}

function attachAssignees(db, rows) {
  if (!rows.length) return rows;
  const marks = rows.map(() => '?').join(',');
  const links = db.prepare(`
    SELECT ta.task_id, u.id, u.name, u.color
    FROM task_assignees ta
    JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id IN (${marks})
    ORDER BY u.name COLLATE NOCASE
  `).all(...rows.map((row) => row.id));
  const byTask = new Map();
  for (const link of links) {
    if (!byTask.has(link.task_id)) byTask.set(link.task_id, []);
    byTask.get(link.task_id).push(paintUser({ id: link.id, name: link.name, color: link.color }));
  }
  return rows.map((row) => {
    const people = byTask.get(row.id) || [];
    const names = people.map((person) => person.name).join(', ');
    if (row.created_by) row.creator_color = colorForUser(row.created_by, row.creator_color);
    if (row.reviewer_id) row.reviewer_color = colorForUser(row.reviewer_id, row.reviewer_color);
    if (row.assignee_id) row.assignee_color = colorForUser(row.assignee_id, row.assignee_color);
    return {
      ...row,
      assignees: people,
      assignee_ids: people.map((person) => person.id),
      assignee_name: names || row.assignee_name || '',
    };
  });
}

export function updateTask(db, id, fields) {
  const current = getTask(db, id);
  if (!current) return null;
  const now = new Date().toISOString();
  let completedAt = current.completed_at;
  if (fields.status === 'done' && current.status !== 'done') completedAt = now;
  if (fields.status !== 'done') completedAt = null;
  let reviewerId = current.reviewer_id || null;
  if (fields.status !== 'review') reviewerId = null;
  else if (fields.reviewerId !== undefined) reviewerId = fields.reviewerId || null;
  db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, assignee_id = ?, status = ?, priority = ?, due_date = ?,
        project_id = ?, reviewer_id = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    fields.title,
    fields.description,
    fields.assigneeId,
    fields.status,
    fields.priority,
    fields.dueDate,
    fields.projectId || null,
    reviewerId,
    completedAt,
    now,
    id,
  );
  if (Array.isArray(fields.assigneeIds)) setTaskAssignees(db, id, fields.assigneeIds);
  if (fields.status !== current.status) recordStatus(db, id, fields.status, now);
  return getTask(db, id);
}

export function deleteTask(db, id) {
  const now = new Date().toISOString();
  db.prepare('UPDATE time_entries SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL').run(now, id);
  db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, now, id);
}

export function listRemovedTasks(db) {
  return db.prepare(`
    SELECT t.id, t.title, t.status, t.deleted_at, c.name AS creator_name
    FROM tasks t
    LEFT JOIN users c ON c.id = t.created_by
    WHERE t.deleted_at IS NOT NULL
    ORDER BY t.deleted_at DESC
  `).all();
}

export function restoreTask(db, id) {
  const now = new Date().toISOString();
  const info = db.prepare('UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL').run(now, id);
  return info.changes > 0;
}

export function listComments(db, taskId) {
  return db.prepare(`
    SELECT c.*, u.name AS author_name, u.color AS author_color
    FROM comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.task_id = ?
    ORDER BY c.created_at ASC, c.id ASC
  `).all(taskId).map((row) => {
    row.author_color = colorForUser(row.author_id, row.author_color);
    return row;
  });
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

export function boardSnapshot(db) {
  const totals = timeTotals(db);
  return {
    users: db.prepare(`
      SELECT id, name FROM users
      WHERE active = 1 AND is_bot = 0
      ORDER BY name COLLATE NOCASE
    `).all(),
    projects: db.prepare('SELECT id, name FROM projects ORDER BY name COLLATE NOCASE').all(),
    tasks: attachAssignees(db, db.prepare(`
      SELECT id, title, status, assignee_id, due_date AS due, priority
      FROM tasks
      WHERE deleted_at IS NULL AND status != 'done'
      ORDER BY updated_at DESC
      LIMIT 100
    `).all()).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      assignee_id: task.assignee_ids[0] || null,
      assignee_ids: task.assignee_ids,
      due: task.due,
      priority: task.priority,
      time_seconds: totals.get(task.id) || 0,
    })),
  };
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
  const where = ['t.deleted_at IS NULL'];
  if (filters.projectId) {
    where.push('t.project_id = ?');
    params.push(filters.projectId);
  }
  if (filters.personId === 'none') where.push('NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id)');
  else if (filters.personId) {
    where.push('EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)');
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
    LEFT JOIN task_assignees ta ON ta.user_id = u.id
    LEFT JOIN tasks t ON t.id = ta.task_id AND t.deleted_at IS NULL AND (? IS NULL OR t.project_id = ?)
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
      WHERE deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = tasks.id) ${projectSql}
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
    SELECT te.*, u.name AS user_name, u.color AS color, t.title AS task_title
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    JOIN tasks t ON t.id = te.task_id
    WHERE te.ended_at IS NULL
    ORDER BY te.started_at ASC
  `).all().map((row) => {
    row.color = colorForUser(row.user_id, row.color);
    return row;
  });
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
    SELECT te.*, u.name AS user_name, u.color AS color
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    WHERE te.task_id = ?
    ORDER BY te.started_at DESC, te.id DESC
  `).all(taskId).map((row) => {
    row.color = colorForUser(row.user_id, row.color);
    return row;
  });
}

export function timeTotals(db, now = Date.now()) {
  const totals = new Map();
  for (const row of db.prepare('SELECT task_id, started_at, ended_at FROM time_entries').all()) {
    totals.set(row.task_id, (totals.get(row.task_id) || 0) + entrySeconds(row.started_at, row.ended_at, now));
  }
  return totals;
}

export function timeReport(db, filters, now = Date.now()) {
  const where = ['t.deleted_at IS NULL'];
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

  const doneWhere = ["t.status = 'done'", 't.deleted_at IS NULL'];
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

export function activeUserIds(db, ids) {
  const found = [];
  const lookup = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1');
  for (const id of ids) {
    const row = lookup.get(id);
    if (row) found.push(row.id);
  }
  return found;
}

export function setTaskMentions(db, taskId, userIds) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM task_mentions WHERE task_id = ?').run(taskId);
    const insert = db.prepare('INSERT OR IGNORE INTO task_mentions (task_id, user_id) VALUES (?, ?)');
    for (const userId of userIds) insert.run(taskId, userId);
  });
  tx();
}

export function mentionReviewer(db, { taskId, authorId, reviewer, note }) {
  const text = String(note || '').trim().slice(0, 280);
  const body = text ? `@[${reviewer.name}](${reviewer.id}) ${text}` : `@[${reviewer.name}](${reviewer.id})`;
  const commentId = addComment(db, { taskId, authorId, body });
  setCommentMentions(db, commentId, [reviewer.id]);
  notifyMentions(db, { taskId, userIds: [reviewer.id], actorId: authorId });
  return commentId;
}

export function notifyMentions(db, { taskId, userIds, actorId }) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM mention_notices WHERE user_id = ? AND task_id = ? AND read_at IS NULL');
  const insert = db.prepare('INSERT INTO mention_notices (user_id, task_id, created_at) VALUES (?, ?, ?)');
  for (const userId of userIds) {
    if (!userId || userId === actorId) continue;
    if (existing.get(userId, taskId)) continue;
    insert.run(userId, taskId, now);
  }
}

export function unreadMentionCount(db, userId) {
  return db.prepare('SELECT COUNT(DISTINCT task_id) AS n FROM mention_notices WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

export function markMentionsRead(db, userId, taskId) {
  db.prepare('UPDATE mention_notices SET read_at = ? WHERE user_id = ? AND task_id = ? AND read_at IS NULL').run(
    new Date().toISOString(),
    userId,
    taskId,
  );
}

export function stopTimersOnTask(db, taskId) {
  const now = new Date().toISOString();
  const running = db.prepare('SELECT * FROM time_entries WHERE task_id = ? AND ended_at IS NULL').all(taskId);
  if (running.length) {
    db.prepare('UPDATE time_entries SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL').run(now, taskId);
  }
  return running;
}

export function kudosSummary(db, userId, targetType, ids) {
  const counts = new Map();
  const mine = new Set();
  if (!ids.length) return { counts, mine };
  const marks = ids.map(() => '?').join(',');
  for (const row of db.prepare(`SELECT target_id, COUNT(*) AS n FROM kudos WHERE target_type = ? AND target_id IN (${marks}) GROUP BY target_id`).all(targetType, ...ids)) {
    counts.set(row.target_id, row.n);
  }
  for (const row of db.prepare(`SELECT target_id FROM kudos WHERE user_id = ? AND target_type = ? AND target_id IN (${marks})`).all(userId, targetType, ...ids)) {
    mine.add(row.target_id);
  }
  return { counts, mine };
}

export function toggleKudo(db, { userId, targetType, targetId }) {
  const existing = db.prepare('SELECT id FROM kudos WHERE user_id = ? AND target_type = ? AND target_id = ?').get(userId, targetType, targetId);
  if (existing) {
    db.prepare('DELETE FROM kudos WHERE id = ?').run(existing.id);
    return false;
  }
  db.prepare('INSERT INTO kudos (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    targetType,
    targetId,
    new Date().toISOString(),
  );
  return true;
}

export function myDay(db, userId, today) {
  const open = db.prepare(`
    SELECT COUNT(*) AS n FROM tasks t
    WHERE t.status != 'done' AND t.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)
  `).get(userId).n;
  const dueToday = db.prepare(`
    SELECT COUNT(*) AS n FROM tasks t
    WHERE t.status != 'done' AND t.deleted_at IS NULL AND t.due_date = ?
      AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?)
  `).get(today, userId).n;
  const timer = db.prepare(`
    SELECT te.task_id, te.started_at, t.title
    FROM time_entries te
    JOIN tasks t ON t.id = te.task_id
    WHERE te.user_id = ? AND te.ended_at IS NULL AND t.deleted_at IS NULL
  `).get(userId) || null;
  return { open, dueToday, timer };
}

function hoursFrom(entries, sinceIso, now) {
  let seconds = 0;
  const since = Date.parse(sinceIso);
  for (const entry of entries) {
    if (Date.parse(entry.started_at) < since) continue;
    seconds += entrySeconds(entry.started_at, entry.ended_at, now);
  }
  return Math.round((seconds / 3600) * 10) / 10;
}

export function teamBoard(db, now = Date.now()) {
  const moment = new Date(now);
  const today = todayDate(moment);
  const weekIso = startOfWeekIso(moment);
  const monthIso = startOfMonthIso(moment);
  const people = db.prepare("SELECT id, name, role, color FROM users WHERE active = 1 AND is_bot = 0 ORDER BY name COLLATE NOCASE").all();
  const done = db.prepare("SELECT id, created_by, assignee_id, due_date, completed_at, status FROM tasks WHERE status = 'done' AND completed_at IS NOT NULL AND deleted_at IS NULL").all();
  const openTasks = db.prepare("SELECT id, title, due_date, status FROM tasks WHERE status != 'done' AND deleted_at IS NULL").all();
  const members = new Map();
  for (const link of db.prepare('SELECT task_id, user_id FROM task_assignees').all()) {
    if (!members.has(link.task_id)) members.set(link.task_id, []);
    members.get(link.task_id).push(link.user_id);
  }
  const entries = db.prepare(`
    SELECT te.user_id, te.started_at, te.ended_at
    FROM time_entries te
    JOIN tasks t ON t.id = te.task_id
    WHERE t.deleted_at IS NULL
  `).all();
  const rows = people.map((person) => {
    const mine = done.filter((task) => {
      const ids = members.get(task.id) || [];
      if (!ids.length) return task.created_by === person.id;
      return ids.includes(person.id);
    });
    const completedDates = new Set();
    let weekCount = 0;
    let monthCount = 0;
    let onTime = 0;
    let withDue = 0;
    for (const task of mine) {
      const day = dateInJohannesburg(task.completed_at);
      if (day) completedDates.add(day);
      if (task.completed_at >= weekIso) weekCount += 1;
      if (task.completed_at >= monthIso) monthCount += 1;
      if (task.due_date) {
        withDue += 1;
        if (day && day <= task.due_date) onTime += 1;
      }
    }
    let streak = 0;
    let cursor = completedDates.has(today) ? today : shiftDate(today, -1);
    if (completedDates.has(cursor)) {
      while (completedDates.has(cursor)) {
        streak += 1;
        cursor = shiftDate(cursor, -1);
      }
    }
    const userEntries = entries.filter((entry) => entry.user_id === person.id);
    const mineOpen = openTasks.filter((task) => (members.get(task.id) || []).includes(person.id));
    const upcoming = mineOpen
      .filter((task) => task.due_date)
      .sort((a, b) => {
        const lateA = a.due_date < today ? 0 : 1;
        const lateB = b.due_date < today ? 0 : 1;
        return lateA - lateB || a.due_date.localeCompare(b.due_date) || a.id - b.id;
      })
      .slice(0, 3)
      .map((task) => ({
        id: task.id,
        title: task.title,
        due: task.due_date,
        late: task.due_date < today,
      }));
    return {
      id: person.id,
      name: person.name,
      role: person.role,
      color: colorForUser(person.id, person.color),
      open: mineOpen.length,
      overdue: mineOpen.filter((task) => task.due_date && task.due_date < today).length,
      weekCount,
      monthCount,
      weekHours: hoursFrom(userEntries, weekIso, now),
      monthHours: hoursFrom(userEntries, monthIso, now),
      onTimePercent: withDue ? Math.round((onTime / withDue) * 100) : null,
      streak,
      upcoming,
      more: Math.max(0, mineOpen.length - upcoming.length),
    };
  });
  const maxOpen = rows.reduce((max, row) => Math.max(max, row.open), 0);
  return rows
    .map((row) => ({ ...row, load: maxOpen ? Math.round((row.open / maxOpen) * 100) : 0 }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

const GROK_EMAIL = 'grok@taskboard.local';

export function ensureGrokUser(db) {
  const existing = getUserByEmail(db, GROK_EMAIL);
  if (existing) {
    db.prepare("UPDATE users SET name = 'Grok', role = 'user', active = 0, is_bot = 1, color = ? WHERE id = ?")
      .run(colorForUser(existing.id, existing.color), existing.id);
    return getUser(db, existing.id);
  }
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO users (email, name, password_hash, role, active, is_bot, color, created_at, updated_at)
    VALUES (?, 'Grok', ?, 'user', 0, 1, ?, ?, ?)
  `).run(GROK_EMAIL, hashPassword(`${now}-${Math.random()}`), '#1d4ed8', now, now);
  const id = Number(info.lastInsertRowid);
  db.prepare('UPDATE users SET color = ? WHERE id = ?').run(colorForUser(id, null), id);
  return getUser(db, id);
}

export function listGrokThreads(db, userId) {
  return db.prepare('SELECT * FROM grok_threads WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(userId);
}

export function createGrokThread(db, userId) {
  const now = new Date().toISOString();
  const info = db.prepare('INSERT INTO grok_threads (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(userId, '', now, now);
  return getGrokThread(db, Number(info.lastInsertRowid));
}

export function latestGrokThread(db, userId) {
  return db.prepare('SELECT * FROM grok_threads WHERE user_id = ? ORDER BY updated_at DESC, id DESC').get(userId) || null;
}

export function renameGrokThread(db, threadId, userId, title) {
  const thread = getGrokThread(db, threadId);
  if (!thread || thread.user_id !== userId) return null;
  const clean = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!clean) return thread;
  const now = new Date().toISOString();
  db.prepare('UPDATE grok_threads SET title = ?, updated_at = ? WHERE id = ?').run(clean, now, threadId);
  return getGrokThread(db, threadId);
}

export function nameGrokThreadFromMessage(db, threadId, text) {
  const title = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  if (!title) return;
  db.prepare("UPDATE grok_threads SET title = ? WHERE id = ? AND title = ''").run(title, threadId);
}

export function deleteGrokThread(db, threadId, userId) {
  const thread = getGrokThread(db, threadId);
  if (!thread || thread.user_id !== userId) return null;
  const files = db.prepare('SELECT stored_name FROM grok_files WHERE thread_id = ?').all(threadId);
  db.prepare('DELETE FROM grok_files WHERE thread_id = ?').run(threadId);
  db.prepare('DELETE FROM grok_threads WHERE id = ?').run(threadId);
  return files;
}

export function listGrokMessages(db, threadId) {
  return db.prepare(`
    SELECT id, role, body, request_id, status, created_at
    FROM grok_messages
    WHERE thread_id = ?
    ORDER BY id ASC
  `).all(threadId);
}

export function addGrokMessage(db, { threadId, role, body, requestId, status }) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO grok_messages (thread_id, role, body, request_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(threadId, role, body || '', requestId || null, status || 'complete', now);
  db.prepare('UPDATE grok_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
  return Number(info.lastInsertRowid);
}

export function completeGrokReply(db, threadId, { requestId, text }) {
  const now = new Date().toISOString();
  const pending = requestId
    ? db.prepare("SELECT id FROM grok_messages WHERE thread_id = ? AND request_id = ? AND role = 'grok' AND status = 'pending'").get(threadId, requestId)
    : db.prepare("SELECT id FROM grok_messages WHERE thread_id = ? AND role = 'grok' AND status = 'pending' ORDER BY id DESC").get(threadId);
  let messageId;
  if (pending) {
    db.prepare("UPDATE grok_messages SET body = ?, status = 'complete' WHERE id = ?").run(text, pending.id);
    messageId = pending.id;
  } else {
    messageId = addGrokMessage(db, { threadId, role: 'grok', body: text, requestId, status: 'complete' });
  }
  db.prepare("UPDATE grok_files SET message_id = ? WHERE thread_id = ? AND kind = 'out' AND message_id IS NULL").run(messageId, threadId);
  if (requestId) db.prepare('DELETE FROM grok_live WHERE request_id = ?').run(requestId);
  db.prepare('UPDATE grok_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
  return messageId;
}

export function getGrokThread(db, threadId) {
  return db.prepare('SELECT * FROM grok_threads WHERE id = ?').get(threadId) || null;
}

export function countGrokRequests(db, userId, sinceMs) {
  return db.prepare('SELECT COUNT(*) AS n FROM grok_requests WHERE user_id = ? AND created_at > ?').get(userId, sinceMs).n;
}

export function recordGrokRequest(db, userId) {
  db.prepare('INSERT INTO grok_requests (user_id, created_at) VALUES (?, ?)').run(userId, Date.now());
  db.prepare('DELETE FROM grok_requests WHERE created_at < ?').run(Date.now() - 48 * 60 * 60 * 1000);
}

export function addGrokFile(db, fields) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO grok_files (
      owner_user_id, thread_id, task_id, message_id, comment_id, kind, filename, stored_name, size, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.ownerUserId,
    fields.threadId || null,
    fields.taskId || null,
    fields.messageId || null,
    fields.commentId || null,
    fields.kind,
    fields.filename,
    fields.storedName,
    fields.size,
    now,
    fields.expiresAt,
  );
  return getGrokFile(db, Number(info.lastInsertRowid));
}

export function getGrokFile(db, id) {
  return db.prepare('SELECT * FROM grok_files WHERE id = ?').get(id) || null;
}

export function listGrokFiles(db, { threadId = null, taskId = null } = {}) {
  if (threadId) return db.prepare('SELECT * FROM grok_files WHERE thread_id = ? ORDER BY id').all(threadId);
  if (taskId) return db.prepare('SELECT * FROM grok_files WHERE task_id = ? ORDER BY id').all(taskId);
  return [];
}

export function latestGrokMessageId(db, threadId, requestId) {
  if (requestId) {
    const match = db.prepare("SELECT id FROM grok_messages WHERE thread_id = ? AND request_id = ? AND role = 'grok' ORDER BY id DESC").get(threadId, requestId);
    if (match) return match.id;
  }
  return db.prepare("SELECT id FROM grok_messages WHERE thread_id = ? AND role = 'grok' ORDER BY id DESC").get(threadId)?.id || null;
}

export function latestGrokCommentId(db, taskId, grokUserId) {
  return db.prepare('SELECT id FROM comments WHERE task_id = ? AND author_id = ? ORDER BY id DESC').get(taskId, grokUserId)?.id || null;
}

export function bindLooseGrokCommentFiles(db, taskId, commentId) {
  db.prepare("UPDATE grok_files SET comment_id = ? WHERE task_id = ? AND kind = 'out' AND comment_id IS NULL").run(commentId, taskId);
}

export function listExpiredGrokFiles(db, nowIso) {
  return db.prepare('SELECT id, stored_name FROM grok_files WHERE expires_at <= ?').all(nowIso);
}

export function deleteGrokFileRow(db, id) {
  db.prepare('DELETE FROM grok_files WHERE id = ?').run(id);
}

export function setGrokLive(db, { requestId, userId, threadId = null, taskId = null, text }) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!requestId) return null;
  if (!clean) {
    db.prepare('DELETE FROM grok_live WHERE request_id = ?').run(requestId);
    return null;
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO grok_live (request_id, user_id, thread_id, task_id, text, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id) DO UPDATE SET
      text = excluded.text,
      updated_at = excluded.updated_at,
      user_id = excluded.user_id,
      thread_id = excluded.thread_id,
      task_id = excluded.task_id
  `).run(requestId, userId, threadId, taskId, clean, now);
  return { request_id: requestId, text: clean };
}

export function clearGrokLiveForTask(db, taskId) {
  db.prepare('DELETE FROM grok_live WHERE task_id = ?').run(taskId);
}

export function listGrokWaiting(db, userId) {
  return db.prepare(`
    SELECT m.id, m.thread_id, m.request_id, m.created_at, COALESCE(l.text, '') AS live
    FROM grok_messages m
    JOIN grok_threads t ON t.id = m.thread_id
    LEFT JOIN grok_live l ON l.request_id = m.request_id
    WHERE t.user_id = ? AND m.role = 'grok' AND m.status = 'pending'
    ORDER BY m.id
  `).all(userId);
}

export function taskGrokLive(db, taskId) {
  return db.prepare('SELECT text FROM grok_live WHERE task_id = ? ORDER BY updated_at DESC LIMIT 1').get(taskId)?.text || '';
}

export function unansweredGrokMention(db, taskId, grokUserId) {
  const mention = db.prepare(`
    SELECT c.id, c.created_at, c.author_id
    FROM comments c
    JOIN comment_mentions m ON m.comment_id = c.id AND m.user_id = ?
    WHERE c.task_id = ?
    ORDER BY c.id DESC
    LIMIT 1
  `).get(grokUserId, taskId);
  if (!mention || mention.author_id === grokUserId) return null;
  const later = db.prepare('SELECT id FROM comments WHERE task_id = ? AND author_id = ? AND id > ? LIMIT 1').get(taskId, grokUserId, mention.id);
  if (later) return null;
  return mention;
}
