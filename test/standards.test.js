import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const banned = /\b(plc|modbus|61131|61850|scada|comms|opc|network|protocol)\b/i;

const covered = [
  'SANS 10142-1', 'SANS 10142-2', 'SANS 10313', 'SANS 10199', 'SANS 10292', 'SANS 1507', 'SANS 60947',
  'NRS 097-2-1', 'NRS 097-2-2', 'NRS 097-2-3', 'NRS 048', 'NRS 057',
  'IEC 61439', 'IEC 62446-1', 'IEC 62548', 'IEC 61215', 'IEC 61730', 'IEC 62109', 'IEC 62116',
  'IEC 62619', 'IEC 62933', 'IEC 62485', 'IEC 60364-4-41', 'IEC 60364-7-712', 'IEC 62305', 'IEC 61000',
  'IEC 60034', 'IEC 60076', 'IEC 62271', 'IEC 60909', 'IEC 60255', 'IEC 60947-6-1',
  'OHS Act', 'EIR', 'EMR', 'SSEG',
];

test('standards stay on electrical power and never mention controls or communications', () => {
  const rows = JSON.parse(readFileSync(new URL('../src/data/standards.json', import.meta.url), 'utf8'));
  assert.ok(rows.length >= 145 && rows.length <= 170, `expected about 150 standards, got ${rows.length}`);
  const ids = new Set();
  const whys = new Set();
  const codes = new Set();
  const sans10142 = rows.filter((row) => row.code === 'SANS 10142-1');
  assert.ok(sans10142.length >= 15 && sans10142.length <= 20);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const text = [row.category, row.title, row.code, row.why, row.id].join(' ');
    assert.equal(banned.test(text), false, `${row.code} mentions a controls or communications topic`);
    assert.equal(ids.has(row.id), false, `duplicate id ${row.id}`);
    assert.equal(whys.has(row.why), false, `duplicate sentence: ${row.why}`);
    ids.add(row.id);
    whys.add(row.why);
    codes.add(row.code);
    if (index > 0) assert.notEqual(row.category, rows[index - 1].category, `${row.title} repeats ${row.category}`);
  }
  for (const code of covered) assert.equal(codes.has(code), true, `missing ${code}`);
});
