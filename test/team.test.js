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
  assert.match(html, /No hours/);
  assert.match(html, /None yet/);
  assert.match(html, /No streak/);
  assert.match(html, /Admin/);
  assert.doesNotMatch(html, /info-btn/);
  assert.doesNotMatch(html, /—/);
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
  assert.equal(adaRow.load, 100);
  assert.match(html, /swatch c-/);
  assert.match(html, /Open<\/span><strong>5<\/strong>/);
  assert.match(html, /class="hot"[\s\S]*?<span>Overdue<\/span><strong>1<\/strong>/);
  assert.match(html, /Done this month<\/span><strong>1<\/strong>/);
  assert.match(html, /class="w-100"/);
  assert.doesNotMatch(html, / style=/);
  assert.match(html, /href="\/tasks\/\d+">Overdue meter</);
  assert.match(html, /class="late"/);
  assert.match(html, /Soon visit/);
  assert.match(html, /Later cable/);
  assert.doesNotMatch(html, /Fourth job/);
  assert.doesNotMatch(html, /No open tasks/);
  assert.doesNotMatch(html, /info-btn/);
});
