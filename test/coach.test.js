import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stackedArea } from '../src/charts.js';
import { coachTips } from '../src/coach.js';
import { createTask, createUser, openDatabase, updateTask } from '../src/db.js';
import { buildManage } from '../src/manage.js';
import { shiftDate, todayDate } from '../src/time.js';

function textOf(facts) {
  return coachTips(facts).map((item) => item.text).join('\n');
}

function one(facts, id) {
  const hits = coachTips(facts).filter((item) => item.id === id);
  assert.equal(hits.length, 1);
  return hits[0];
}

test('workload imbalance names who is heavy and who has space', () => {
  const facts = {
    open: 5,
    viewerId: 1,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 5, overdue: 0 },
      { id: 2, name: 'Duncan Moss', open: 0, overdue: 0 },
      { id: 3, name: 'Jaime Botha', open: 0, overdue: 0 },
    ],
  };
  const tip = one(facts, 'balance');
  assert.equal(tip.text, 'Arshad has 5 open, Duncan and Jaime have 0. Consider shifting some work to them.');
  assert.doesNotMatch(tip.text, /\byou\b|Chengadu|Moss|Botha/i);
  assert.equal(one({
    open: 5,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 5, overdue: 0 },
      { id: 2, name: 'Duncan Moss', open: 0, overdue: 0 },
    ],
  }, 'balance').text, 'Arshad has 5 open, Duncan has 0. Consider shifting some work to Duncan.');
  assert.equal(coachTips({
    open: 8,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 4, overdue: 0 },
      { id: 2, name: 'Lindi Nkosi', open: 4, overdue: 0 },
    ],
  }).some((item) => item.id === 'balance'), false);
  assert.equal(coachTips({
    open: 2,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 2, overdue: 0 },
      { id: 2, name: 'Duncan Moss', open: 0, overdue: 0 },
    ],
  }).some((item) => item.id === 'balance'), false);
});

test('unassigned tasks tell the manager to assign them', () => {
  assert.equal(one({ unassigned: 4, people: [] }, 'unassigned').text, '4 tasks have no owner. Assign them.');
  assert.equal(one({ unassigned: 1, people: [] }, 'unassigned').text, '1 task has no owner. Assign it.');
  assert.equal(coachTips({ unassigned: 0, people: [] }).some((item) => item.id === 'unassigned'), false);
});

test('overdue work is listed per person', () => {
  const tip = one({
    people: [
      { id: 1, name: 'Duncan Moss', open: 2, overdue: 1 },
      { id: 2, name: 'Arshad Chengadu', open: 4, overdue: 3 },
      { id: 3, name: 'Jaime Botha', open: 1, overdue: 0 },
    ],
  }, 'overdue');
  assert.equal(tip.text, 'Arshad has 3 overdue, Duncan has 1 overdue.');
  assert.equal(coachTips({
    people: [{ id: 1, name: 'Duncan Moss', open: 2, overdue: 0 }],
  }).some((item) => item.id === 'overdue'), false);
});

test('tasks due in the next 3 days that have not started are flagged', () => {
  assert.equal(
    one({ dueSoon: 2, people: [] }, 'due-soon').text,
    '2 tasks are due in the next 3 days and have not been started.',
  );
  assert.equal(coachTips({ dueSoon: 0, people: [] }).some((item) => item.id === 'due-soon'), false);
});

test('in-progress tasks with no update for a week are flagged', () => {
  assert.equal(
    one({ stale: 3, people: [] }, 'stale').text,
    '3 tasks have been in progress for more than 7 days with no update.',
  );
  assert.equal(coachTips({ stale: 0, people: [] }).some((item) => item.id === 'stale'), false);
});

test('tasks with no due date are flagged', () => {
  assert.equal(one({ noDue: 5, people: [] }, 'nodue').text, '5 tasks have no due date.');
  assert.equal(coachTips({ noDue: 0, people: [] }).some((item) => item.id === 'nodue'), false);
});

test('people with nothing open are offered work', () => {
  const tip = one({
    open: 2,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 2, overdue: 0 },
      { id: 2, name: 'Duncan Moss', open: 0, overdue: 0 },
      { id: 3, name: 'Jaime Botha', open: 0, overdue: 0 },
    ],
  }, 'idle');
  assert.equal(tip.text, 'Duncan and Jaime have nothing open, give them work.');
  assert.equal(coachTips({
    open: 0,
    people: [
      { id: 1, name: 'Duncan Moss', open: 0, overdue: 0 },
      { id: 2, name: 'Jaime Botha', open: 0, overdue: 0 },
    ],
  }).some((item) => item.id === 'idle'), false);
});

test('review waiting is mentioned only when review is in use', () => {
  assert.equal(
    one({ reviewUsed: true, reviewWaiting: 2, people: [] }, 'review').text,
    '2 tasks have been in review for more than 2 days.',
  );
  assert.equal(coachTips({ reviewUsed: false, reviewWaiting: 4, people: [] }).some((item) => item.id === 'review'), false);
  assert.equal(coachTips({ reviewUsed: true, reviewWaiting: 0, people: [] }).some((item) => item.id === 'review'), false);
});

test('a project with a pile of open tasks and no recent assignment is flagged', () => {
  const tip = one({
    projects: [
      { id: 4, name: 'Tubecon', open: 8, assignedRecently: false },
      { id: 5, name: 'Quiet site', open: 2, assignedRecently: false },
      { id: 6, name: 'Live site', open: 9, assignedRecently: true },
    ],
    people: [],
  }, 'project');
  assert.equal(tip.text, 'Tubecon has 8 open tasks and nobody has been assigned there this month.');
  assert.equal(coachTips({
    projects: [{ id: 6, name: 'Live site', open: 9, assignedRecently: true }],
    people: [],
  }).some((item) => item.id === 'project'), false);
});

test('tips stay a short list and the important ones come first', () => {
  const tips = coachTips({
    open: 9,
    unassigned: 2,
    dueSoon: 2,
    stale: 2,
    reviewUsed: true,
    reviewWaiting: 2,
    noDue: 4,
    people: [
      { id: 1, name: 'Arshad Chengadu', open: 5, overdue: 2 },
      { id: 2, name: 'Duncan Moss', open: 0, overdue: 0 },
      { id: 3, name: 'Jaime Botha', open: 0, overdue: 0 },
    ],
    projects: [{ id: 4, name: 'Tubecon', open: 8, assignedRecently: false }],
  });
  assert.ok(tips.length >= 3 && tips.length <= 6);
  assert.deepEqual(tips.map((item) => item.id), ['balance', 'unassigned', 'overdue', 'due-soon', 'stale', 'review']);
  assert.doesNotMatch(textOf({ people: [] }), /\byou\b|Notes from this period|PLC/i);
});

test('an empty month produces no tips', () => {
  assert.deepEqual(coachTips({ people: [{ id: 1, name: 'Arshad Chengadu', open: 0, overdue: 0 }], open: 0 }), []);
});

test('an empty review band stays off the chart', () => {
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

test('manage tips use the open work in the selected month', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-tips-'));
  const db = openDatabase(path.join(dir, 'board.sqlite'));
  const arshad = createUser(db, { email: 'arshad@example.com', name: 'Arshad Chengadu', password: 'password1', role: 'admin' });
  createUser(db, { email: 'duncan@example.com', name: 'Duncan Moss', password: 'password1', role: 'user' });
  createUser(db, { email: 'jaime@example.com', name: 'Jaime Botha', password: 'password1', role: 'user' });
  const today = todayDate();
  for (let index = 0; index < 5; index += 1) {
    createTask(db, {
      title: `Open ${index}`,
      description: '',
      assigneeId: arshad.id,
      assigneeIds: [arshad.id],
      status: 'todo',
      priority: null,
      dueDate: shiftDate(today, 10),
      projectId: null,
      createdBy: arshad.id,
    });
  }
  createTask(db, {
    title: 'Due soon',
    description: '',
    assigneeId: arshad.id,
    assigneeIds: [arshad.id],
    status: 'todo',
    priority: null,
    dueDate: shiftDate(today, 1),
    projectId: null,
    createdBy: arshad.id,
  });
  createTask(db, {
    title: 'Already started',
    description: '',
    assigneeId: arshad.id,
    assigneeIds: [arshad.id],
    status: 'in_progress',
    priority: null,
    dueDate: shiftDate(today, 1),
    projectId: null,
    createdBy: arshad.id,
  });
  createTask(db, {
    title: 'Due later',
    description: '',
    assigneeId: arshad.id,
    assigneeIds: [arshad.id],
    status: 'todo',
    priority: null,
    dueDate: shiftDate(today, 9),
    projectId: null,
    createdBy: arshad.id,
  });
  const board = buildManage(db, { now: new Date() });
  db.close();
  const balance = board.tips.find((item) => item.id === 'balance');
  assert.equal(balance.text, 'Arshad has 8 open, Duncan and Jaime have 0. Consider shifting some work to them.');
  const soon = board.tips.find((item) => item.id === 'due-soon');
  assert.equal(soon.text, '1 task is due in the next 3 days and has not been started.');
});
