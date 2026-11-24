import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { coachTips, managerTip } from '../src/coach.js';
import { stackedArea } from '../src/charts.js';
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

test('the workload tip only appears when the load is lopsided', () => {
  function balance(facts) {
    return coachTips(facts).find((item) => item.id === 'balance') || null;
  }
  const crowded = {
    open: 6,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 5, overdue: 0, inProgress: 1 },
      { id: 2, name: 'Lindi Nkosi', open: 1, overdue: 0, inProgress: 0 },
    ],
  };
  const other = balance({ ...crowded, viewerId: 2 });
  assert.equal(other.text, 'Most of the open work is with Arshad.');
  assert.doesNotMatch(other.text, /Chengadu|Worth seeing/);
  const self = balance({ ...crowded, viewerId: 1 });
  assert.equal(self.text, "You're holding most of the open work. Worth handing some off.");
  assert.equal(balance({
    open: 5,
    viewerId: 2,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 5, overdue: 0, inProgress: 1 },
      { id: 2, name: 'Lindi Nkosi', open: 0, overdue: 0, inProgress: 0 },
    ],
  }), null);
  assert.equal(balance({
    open: 8,
    viewerId: 2,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 4, overdue: 0, inProgress: 1 },
      { id: 2, name: 'Lindi Nkosi', open: 4, overdue: 0, inProgress: 0 },
    ],
  }), null);
  assert.equal(balance({
    open: 4,
    viewerId: 2,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 3, overdue: 0, inProgress: 1 },
      { id: 2, name: 'Lindi Nkosi', open: 1, overdue: 0, inProgress: 0 },
    ],
  }), null);
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

test('an empty review band stays off the chart and out of the daily tip', () => {
  const svg = stackedArea({
    days: ['11-01', '11-02'],
    todo: [2, 1],
    in_progress: [0, 1],
    review: [0, 0],
    done: [0, 1],
  });
  assert.doesNotMatch(svg, /Review/);
  assert.match(svg, /To do/);
  assert.match(svg, /In progress/);
  assert.match(svg, /Done/);
  const shown = stackedArea({
    days: ['11-01'],
    todo: [0],
    in_progress: [0],
    review: [2],
    done: [0],
  });
  assert.match(shown, /Review/);
  for (let day = 1; day <= 40; day += 1) {
    const when = new Date(Date.UTC(2026, 0, day));
    assert.doesNotMatch(managerTip(when), /review/i);
  }
  assert.match(managerTip(new Date(Date.UTC(2026, 0, 4)), { review: true }), /review/i);
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
