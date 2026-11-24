import assert from 'node:assert/strict';
import test from 'node:test';
import { COLOR_NAMES, colorForUser, colorsToStore, nextColor, normalizeColor, PALETTE } from '../src/colors.js';
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
