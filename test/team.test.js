import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTask, createUser, openDatabase, teamBoard } from '../src/db.js';
import { renderTeam } from '../src/view.js';
import { shiftDate, todayDate } from '../src/time.js';

function page(rows) {
  return renderTeam({
    user: { id: 1, name: 'Ada Lovelace', role: 'admin', color: '#1d4ed8' },
    csrf: 'a'.repeat(64),
    rows,
  });
}

test('an empty team card does not show a table of zeros', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-team-empty-'));
  const db = openDatabase(path.join(dir, 'board.sqlite'));
  createUser(db, { email: 'ada@example.com', name: 'Ada Lovelace', password: 'password1', role: 'admin' });
  const html = page(teamBoard(db));
  db.close();
  assert.match(html, /Ada Lovelace/);
  assert.match(html, /class="swatch c-/);
  assert.match(html, /No open tasks/);
  assert.match(html, /Logged this month/);
  assert.match(html, />0m</);
  assert.match(html, /On time —/);
  assert.match(html, /No streak/);
  assert.doesNotMatch(html, /None yet/);
  assert.match(html, /Admin/);
  assert.doesNotMatch(html, /info-btn/);
  assert.doesNotMatch(html, /<table/);
});

test('a team card lists the next three due tasks and the colour', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-team-full-'));
  const db = openDatabase(path.join(dir, 'board.sqlite'));
  const ada = createUser(db, { email: 'ada@example.com', name: 'Ada Lovelace', password: 'password1', role: 'admin' });
  const today = todayDate();
  const add = (title, due, status = 'todo') => createTask(db, {
    title,
    description: '',
    assigneeId: ada.id,
    assigneeIds: [ada.id],
    status,
    priority: null,
    dueDate: due,
    projectId: null,
    createdBy: ada.id,
  });
  const finished = add('Finished install', shiftDate(today, -1), 'done');
  add('Overdue meter', shiftDate(today, -1));
  add('Soon visit', shiftDate(today, 2));
  add('Later cable', shiftDate(today, 5));
  add('Fourth job', shiftDate(today, 12));
  add('Undated', null);
  const start = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO time_entries (task_id, user_id, started_at, ended_at) VALUES (?, ?, ?, ?)').run(
    finished,
    ada.id,
    start,
    new Date().toISOString(),
  );
  const rows = teamBoard(db);
  const html = page(rows);
  db.close();
  const adaRow = rows.find((row) => row.name === 'Ada Lovelace');
  assert.equal(adaRow.open, 5);
  assert.equal(adaRow.overdue, 1);
  assert.equal(adaRow.upcoming.length, 3);
  assert.equal(adaRow.more, 2);
  assert.equal(adaRow.load, 100);
  assert.match(html, /swatch c-/);
  assert.match(html, /M8 13a3 3 0 1 0 0-6/);
  assert.doesNotMatch(html, /width="12" height="12"/);
  assert.match(html, /<span>Open<\/span>/);
  assert.match(html, /<strong>5<\/strong>/);
  assert.match(html, /<span>Overdue<\/span>/);
  assert.match(html, /<strong class="hot">1<\/strong>/);
  assert.match(html, /title="Done this month">Done<\/span>/);
  assert.match(html, /<strong>1<\/strong>/);
  assert.match(html, /class="w-100"/);
  assert.doesNotMatch(html, / style=/);
  assert.match(html, /href="\/tasks\/\d+">Overdue meter</);
  assert.match(html, /class="late"/);
  assert.match(html, /Soon visit/);
  assert.match(html, /Later cable/);
  assert.doesNotMatch(html, /Fourth job/);
  assert.match(html, new RegExp(`href="/\\?assignee=${ada.id}">\\+2 more`));
  assert.doesNotMatch(html, /No open tasks/);
  assert.doesNotMatch(html, /info-btn/);
});

test('a card with many tasks shows three rows and a link for the rest', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'taskboard-team-many-'));
  const db = openDatabase(path.join(dir, 'board.sqlite'));
  const ada = createUser(db, { email: 'ada@example.com', name: 'Ada Lovelace', password: 'password1', role: 'admin' });
  const today = todayDate();
  for (let index = 0; index < 20; index += 1) {
    createTask(db, {
      title: `Job ${String(index).padStart(2, '0')}`,
      description: '',
      assigneeId: ada.id,
      assigneeIds: [ada.id],
      status: 'todo',
      priority: null,
      dueDate: shiftDate(today, index - 5),
      projectId: null,
      createdBy: ada.id,
    });
  }
  const rows = teamBoard(db);
  const html = page(rows);
  db.close();
  const adaRow = rows.find((row) => row.name === 'Ada Lovelace');
  assert.equal(adaRow.open, 20);
  assert.equal(adaRow.upcoming.length, 3);
  assert.deepEqual(adaRow.upcoming.map((task) => task.title), ['Job 00', 'Job 01', 'Job 02']);
  assert.equal(adaRow.upcoming.every((task, index) => index === 0 || task.due >= adaRow.upcoming[index - 1].due), true);
  assert.equal(adaRow.upcoming[0].late, true);
  assert.equal(adaRow.more, 17);
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.match(html, /Job 00/);
  assert.match(html, /Job 02/);
  assert.doesNotMatch(html, /Job 03/);
  assert.match(html, new RegExp(`href="/\\?assignee=${ada.id}">\\+17 more`));
});

test('a team card shows logged time, a live timer, and an auto-stop flag', () => {
  const html = page([{
    id: 4,
    name: 'Sam Cole',
    role: 'user',
    color: '#1d4ed8',
    open: 1,
    overdue: 0,
    monthCount: 0,
    monthSeconds: 5400,
    todaySeconds: 1800,
    onTimePercent: null,
    streak: 0,
    upcoming: [],
    more: 0,
    load: 10,
    running: { taskId: 9, title: 'String the array', startedAt: '2026-11-26T08:00:00.000Z' },
    flag: { taskId: 9, auto: true },
  }]);
  assert.match(html, /Logged this month/);
  assert.match(html, />1h 30m</);
  assert.match(html, /Today/);
  assert.match(html, />30m</);
  assert.match(html, /class="timer-badge"/);
  assert.match(html, /String the array/);
  assert.match(html, /class="time-flag"[^>]*>Auto-stopped/);
  assert.match(html, /href="\/tasks\/9"/);
  assert.doesNotMatch(html, / style=/);
});
