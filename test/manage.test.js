import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stackedArea } from '../src/charts.js';
import { colorForUser, nextColor, normalizeColor, PALETTE } from '../src/colors.js';
import { createTask, openDatabase, updateTask } from '../src/db.js';
import { clampMonth, monthSpan } from '../src/manage.js';

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
  assert.equal(normalizeColor('#1D4ED8'), '#1d4ed8');
  assert.equal(normalizeColor('1D4ED8'), '#1d4ed8');
  assert.equal(normalizeColor(' BLUE '), null);
  assert.equal(colorForUser(3, 'BLUE'), PALETTE[3 % PALETTE.length]);
  assert.equal(colorForUser(3, '#1D4ED8'), '#1d4ed8');
});

test('a new user gets the least used colour from the palette', () => {
  assert.equal(nextColor([]), PALETTE[0]);
  assert.equal(nextColor(PALETTE), PALETTE[0]);
  assert.equal(nextColor([PALETTE[0]]), PALETTE[1]);
  assert.equal(PALETTE.includes('#f97316'), false);
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
