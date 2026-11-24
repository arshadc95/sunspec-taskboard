import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGrokClick } from '../public/grok-panel.js';

test('the grok bubble opens once and stays open through that same click', () => {
  let open = false;
  open = applyGrokClick(open, 'bubble', true);
  assert.equal(open, true);
  open = applyGrokClick(open, 'outside', true);
  assert.equal(open, true);
});

test('the grok bubble, the close button, and a real outside click close the panel', () => {
  assert.equal(applyGrokClick(true, 'bubble', true), false);
  assert.equal(applyGrokClick(true, 'close', true), false);
  assert.equal(applyGrokClick(true, 'outside', false), false);
  assert.equal(applyGrokClick(false, 'outside', false), false);
});
