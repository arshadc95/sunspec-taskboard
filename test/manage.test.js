import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backlogChart, stackedArea, throughputChart } from '../src/charts.js';
import { COLOR_NAMES, colorForUser, colorsToStore, nextColor, normalizeColor, PALETTE } from '../src/colors.js';
import { createTask, createUser, openDatabase } from '../src/db.js';
import { buildManage, clampMonth, monthSpan, taskStatusAt } from '../src/manage.js';

test('a past calendar month runs from the 1st to the next 1st in Johannesburg', () => {
  const span = monthSpan('2026-10', new Date('2026-11-24T12:00:00+02:00'));
  assert.equal(span.start, Date.parse('2026-10-01T00:00:00+02:00'));
  assert.equal(span.end, Date.parse('2026-11-01T00:00:00+02:00'));
  assert.equal(span.label, 'Oct 2026');
  assert.equal(span.prev, '2026-09');
  assert.equal(span.current, false);
});

test('this month stops at now', () => {
  const now = new Date('2026-11-24T12:00:00+02:00');
  const span = monthSpan('2026-11', now);
  assert.equal(span.start, Date.parse('2026-11-01T00:00:00+02:00'));
  assert.equal(span.end, now.getTime() + 1);
  assert.equal(span.current, true);
  assert.equal(span.label, 'Nov 2026');
});

test('colours are stored as lowercase hex and a bad value falls back by user id', () => {
  assert.equal(normalizeColor('#E53935'), '#e53935');
  assert.equal(normalizeColor('E53935'), '#e53935');
  assert.equal(normalizeColor(' BLUE '), null);
  assert.equal(normalizeColor('#1d4ed8'), null);
  assert.equal(colorForUser(3, 'BLUE'), PALETTE[3 % PALETTE.length]);
  assert.equal(colorForUser(3, '#E53935'), '#e53935');
  assert.equal(PALETTE.length, 12);
  assert.equal(COLOR_NAMES.length, PALETTE.length);
  assert.equal(new Set(PALETTE).size, PALETTE.length);
  assert.equal(PALETTE.includes('#f97316'), false);
});

test('users outside the new palette take distinct colours in id order', () => {
  const updates = colorsToStore([
    { id: 4, color: '#E53935' },
    { id: 1, color: '#1d4ed8' },
    { id: 2, color: null },
    { id: 3, color: 'BLUE' },
  ]);
  assert.deepEqual(updates, [
    { id: 1, color: PALETTE[1] },
    { id: 2, color: PALETTE[2] },
    { id: 3, color: PALETTE[3] },
    { id: 4, color: '#e53935' },
  ]);
  const fresh = colorsToStore([
    { id: 8, color: null },
    { id: 2, color: '' },
  ]);
  assert.deepEqual(fresh, [
    { id: 2, color: PALETTE[0] },
    { id: 8, color: PALETTE[1] },
  ]);
});

test('a new user gets the least used colour from the palette', () => {
  assert.equal(nextColor([]), PALETTE[0]);
  assert.equal(nextColor(PALETTE), PALETTE[0]);
  assert.equal(nextColor([PALETTE[0]]), PALETTE[1]);
  assert.equal(PALETTE.includes('#f97316'), false);
});

test('a task stays open from the day it was created until it is done', () => {
  const task = { created_at: '2026-11-02T08:00:00+02:00', completed_at: '2026-11-10T09:00:00+02:00', status: 'done' };
  const history = [{ status: 'in_progress', changed_at: '2026-11-24T09:00:00+02:00' }];
  assert.equal(taskStatusAt(task, history, Date.parse('2026-11-01T23:59:59+02:00')), null);
  assert.equal(taskStatusAt(task, history, Date.parse('2026-11-05T23:59:59+02:00')), 'todo');
  assert.equal(taskStatusAt(task, history, Date.parse('2026-11-10T12:00:00+02:00')), 'done');
  const stillOpen = { created_at: '2026-11-02T08:00:00+02:00', completed_at: null, status: 'in_progress' };
  assert.equal(taskStatusAt(stillOpen, history, Date.parse('2026-11-20T23:59:59+02:00')), 'todo');
  assert.equal(taskStatusAt(stillOpen, history, Date.parse('2026-11-24T23:59:59+02:00')), 'in_progress');
});

test('status, open, and created charts cover the month up to today without a last-day spike', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-charts-'));
  const db = openDatabase(path.join(dir, 'board.sqlite'));
  const user = createUser(db, { email: 'ada@example.com', name: 'Ada Lovelace', password: 'password1', role: 'admin' });
  const early = createTask(db, {
    title: 'Early todo',
    description: '',
    assigneeId: user.id,
    status: 'todo',
    priority: null,
    dueDate: '2026-11-20',
    projectId: null,
    createdBy: user.id,
  });
  const moved = createTask(db, {
    title: 'Moved later',
    description: '',
    assigneeId: user.id,
    status: 'in_progress',
    priority: null,
    dueDate: '2026-11-20',
    projectId: null,
    createdBy: user.id,
  });
  db.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run('2026-11-02T08:00:00.000Z', early);
  db.prepare('UPDATE tasks SET created_at = ?, status = ? WHERE id = ?').run('2026-11-02T08:00:00.000Z', 'in_progress', moved);
  db.prepare('DELETE FROM task_status_history').run();
  db.prepare('INSERT INTO task_status_history (task_id, status, changed_at) VALUES (?, ?, ?)').run(moved, 'in_progress', '2026-11-24T09:00:00+02:00');
  const now = new Date('2026-11-24T15:00:00+02:00');
  const board = buildManage(db, { now, month: '2026-11' });
  db.close();
  assert.equal(board.cfd.days[0], '11-01');
  assert.equal(board.cfd.days.at(-1), '11-24');
  assert.equal(board.cfd.days.includes('11-30'), false);
  const onSecond = board.cfd.days.indexOf('11-02');
  const onTwenty = board.cfd.days.indexOf('11-20');
  const onToday = board.cfd.days.indexOf('11-24');
  assert.equal(board.cfd.todo[onSecond], 2);
  assert.equal(board.cfd.in_progress[onSecond], 0);
  assert.equal(board.cfd.todo[onTwenty], 2);
  assert.equal(board.cfd.todo[onToday], 1);
  assert.equal(board.cfd.in_progress[onToday], 1);
  assert.equal(board.backlog[onSecond].open, 2);
  assert.equal(board.backlog[onToday].open, 2);
  assert.equal(board.throughput.find((row) => row.label === '11-02').created, 2);
  assert.equal(board.throughput.find((row) => row.label === '11-24').created, 0);
});

test('one day of status data is a stacked bar, and a full month uses daily bars', () => {
  const days = Array.from({ length: 24 }, (_, index) => `11-${String(index + 1).padStart(2, '0')}`);
  const zeros = days.map(() => 0);
  const spike = stackedArea({
    days,
    todo: zeros.map((value, index) => (index === 23 ? 6 : value)),
    in_progress: zeros.map((value, index) => (index === 23 ? 2 : value)),
    review: zeros,
    done: zeros,
  });
  assert.match(spike, /status-today/);
  assert.match(spike, /#374151/);
  assert.match(spike, /#f97316/);
  assert.match(spike, /<title>11-24: To do 6<\/title>/);
  assert.match(spike, /<title>11-24: In progress 2<\/title>/);
  assert.doesNotMatch(spike, /Review/);
  assert.doesNotMatch(spike, /<polygon/);

  const bars = stackedArea({
    days: ['11-01', '11-02', '11-03'],
    todo: [6, 6, 4],
    in_progress: [2, 2, 2],
    review: [0, 0, 0],
    done: [0, 0, 0],
  });
  assert.match(bars, /status-bars/);
  assert.match(bars, /#374151/);
  assert.match(bars, /#f97316/);
  assert.match(bars, /<title>11-01: To do 6<\/title>/);
  assert.match(bars, />4</);
  assert.match(bars, />8</);
  assert.doesNotMatch(bars, /Review/);

  const open = backlogChart(days.map((label, index) => ({ label, open: index === 23 ? 8 : 0 })));
  assert.match(open, /open-today/);
  assert.match(open, /<title>11-24: Open 8<\/title>/);
  const steady = backlogChart([
    { label: '11-01', open: 8 },
    { label: '11-02', open: 8 },
  ]);
  assert.match(steady, /<title>11-01: Open 8<\/title>/);
  assert.doesNotMatch(steady, /open-today/);

  const created = throughputChart(days.map((label, index) => ({ label, created: index === 1 ? 6 : 0, completed: 0 })));
  assert.match(created, /<title>11-02: Created 6<\/title>/);
  assert.doesNotMatch(created, /11-24/);
});

test('the month stepper stays between the first task and the current month', () => {
  const open = clampMonth(null, '2026-08-15', '2026-11-24');
  assert.equal(open.ym, '2026-11');
  assert.equal(open.title, 'November 2026');
  assert.equal(open.canNext, false);
  assert.equal(open.canPrev, true);
  assert.equal(open.prev, '2026-10');

  const middle = clampMonth('2026-10', '2026-08-15', '2026-11-24');
  assert.equal(middle.ym, '2026-10');
  assert.equal(middle.canPrev, true);
  assert.equal(middle.canNext, true);
  assert.equal(middle.next, '2026-11');

  const floor = clampMonth('2020-01', '2026-08-15', '2026-11-24');
  assert.equal(floor.ym, '2026-08');
  assert.equal(floor.canPrev, false);
  assert.equal(floor.canNext, true);

  const future = clampMonth('2027-03', '2026-08-15', '2026-11-24');
  assert.equal(future.ym, '2026-11');
  assert.equal(future.canNext, false);
});
