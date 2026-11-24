import assert from 'node:assert/strict';
import test from 'node:test';
import { monthSpan, previousMonths, yearSpan } from '../src/manage.js';

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

test('previous months go back to the first task and skip the current month', () => {
  assert.deepEqual(previousMonths('2026-08-15', '2026-11-24'), ['2026-10', '2026-09', '2026-08']);
  assert.deepEqual(previousMonths('2026-11-02', '2026-11-24'), []);
});

test('this year starts on 1 January and compares with last year', () => {
  const now = new Date('2026-11-24T12:00:00+02:00');
  const span = yearSpan(now);
  assert.equal(span.start, Date.parse('2026-01-01T00:00:00+02:00'));
  assert.equal(span.end, now.getTime() + 1);
  assert.equal(span.prevStart, Date.parse('2025-01-01T00:00:00+02:00'));
  assert.equal(span.prevEnd, Date.parse('2026-01-01T00:00:00+02:00'));
});
