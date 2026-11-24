import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword } from './passwords.js';

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
  `);
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
  if (filters.search) {
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')");
    const term = likeTerm(filters.search);
    params.push(term, term);
  }
  const sql = `
    SELECT t.*,
      a.name AS assignee_name,
      c.name AS creator_name,
      (SELECT COUNT(*) FROM comments cm WHERE cm.task_id = t.id) AS comment_count
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users c ON c.id = t.created_by
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
      (SELECT COUNT(*) FROM comments cm WHERE cm.task_id = t.id) AS comment_count
    FROM tasks t
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN users c ON c.id = t.created_by
    WHERE t.id = ?
  `).get(id) || null;
}

export function createTask(db, fields) {
  const now = new Date().toISOString();
  const completedAt = fields.status === 'done' ? now : null;
  const info = db.prepare(`
    INSERT INTO tasks (
      title, description, assignee_id, status, priority, due_date, created_by,
      completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.title,
    fields.description,
    fields.assigneeId,
    fields.status,
    fields.priority,
    fields.dueDate,
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
        completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    fields.title,
    fields.description,
    fields.assigneeId,
    fields.status,
    fields.priority,
    fields.dueDate,
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
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), comment.task_id);
  return comment;
}
