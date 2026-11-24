import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const banned = /\b(plc|modbus|61131|61850|scada|comms|opc|network|protocol)\b/i;

test('standards stay on electrical power and never mention controls or communications', () => {
  const rows = JSON.parse(readFileSync(new URL('../src/data/standards.json', import.meta.url), 'utf8'));
  assert.ok(rows.length >= 20);
  for (const row of rows) {
    const text = [row.category, row.title, row.code, row.why, row.id].join(' ');
    assert.equal(banned.test(text), false, `${row.code} mentions a controls or communications topic`);
  }
});
