import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { coachTips } from '../src/coach.js';
import { createTask, openDatabase, updateTask } from '../src/db.js';

test('coach stays constructive and waits for enough data', () => {
  const tips = coachTips({
    periodDays: 7,
    historyDays: 7,
    open: 8,
    people: [
      { id: 1, name: 'Sam', open: 5, overdue: 3, inProgress: 2 },
      { id: 2, name: 'Duncan', open: 1, overdue: 0, inProgress: 0 },
    ],
    reviewStuck: 3,
    staleProgress: [{ id: 12, title: 'Inverter fan', owner: 'Sam', days: 8 }],
    noDue: 4,
    unassigned: 0,
    unassignedNew: 0,
    donePeriod: 1,
    donePrevious: 6,
    overdueNow: 4,
    overdueStart: 1,
    onTimeWeek: 0,
    topFinisher: null,
  });
  const text = tips.map((item) => item.text).join('\n');
  assert.match(text, /Duncan/);
  assert.match(text, /Sam/);
  assert.match(text, /Review is getting a bit full/);
  assert.equal(tips.some((item) => item.id === 'throughput'), false);
  assert.equal(tips.some((item) => item.id === 'overdue-trend'), false);
  assert.doesNotMatch(text, /worst|rank|underperform|\bWIP\b|throughput/i);
});

test('coach can say something kind when the week went well', () => {
  const tips = coachTips({
    periodDays: 30,
    historyDays: 30,
    open: 2,
    people: [{ id: 1, name: 'Lindi', open: 1, overdue: 0, inProgress: 1, done: 4 }],
    reviewStuck: 0,
    staleProgress: [],
    noDue: 0,
    unassigned: 0,
    unassignedNew: 0,
    donePeriod: 6,
    donePrevious: 4,
    overdueNow: 0,
    overdueStart: 0,
    onTimeWeek: 5,
    topFinisher: { name: 'Lindi', done: 4 },
  });
  assert.match(tips.map((item) => item.text).join(' '), /Nice, 5 tasks closed on time/);
});

test('status changes are stored for the flow chart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-history-'));
  const db = openDatabase(path.join(dir, 'board.sqlite'));
  const now = new Date().toISOString();
  const userId = Number(db.prepare(`
    INSERT INTO users (email, name, password_hash, role, active, created_at, updated_at)
    VALUES ('ada@example.com', 'Ada', 'x', 'user', 1, ?, ?)
  `).run(now, now).lastInsertRowid);
  const taskId = createTask(db, {
    title: 'String check',
    description: '',
    assigneeId: userId,
    status: 'todo',
    priority: null,
    dueDate: null,
    projectId: null,
    createdBy: userId,
  });
  updateTask(db, taskId, {
    title: 'String check',
    description: '',
    assigneeId: userId,
    status: 'in_progress',
    priority: null,
    dueDate: null,
    projectId: null,
  });
  const rows = db.prepare('SELECT status FROM task_status_history WHERE task_id = ? ORDER BY id').all(taskId);
  assert.deepEqual(rows.map((row) => row.status), ['todo', 'in_progress']);
  db.close();
});
