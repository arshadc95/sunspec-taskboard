import assert from 'node:assert/strict';
import test from 'node:test';
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
