import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptGrokFiles, applyGrokClick, grokFileView, grokQueuedLabel, grokShouldQueue, toggleGrokLayout, GROK_PDF_MAX_BYTES } from '../public/grok-panel.js';

test('the grok bubble opens once and stays open through that same click', () => {
  let open = false;
  open = applyGrokClick(open, 'bubble', true);
  assert.equal(open, true);
  open = applyGrokClick(open, 'outside', true);
  assert.equal(open, true);
});

test('dropped files follow the PDF picker limits', () => {
  const pdf = { name: 'sheet.pdf', type: 'application/pdf', size: 1200 };
  const other = { name: 'photo.png', type: 'image/png', size: 1200 };
  const huge = { name: 'big.pdf', type: 'application/pdf', size: GROK_PDF_MAX_BYTES + 1 };
  const rejected = acceptGrokFiles([], [other]);
  assert.deepEqual(rejected.files, []);
  assert.equal(rejected.error, 'Only PDF files can be attached.');
  const tooBig = acceptGrokFiles([], [huge]);
  assert.deepEqual(tooBig.files, []);
  assert.equal(tooBig.error, 'Each PDF must be 15 MB or smaller.');
  const mixed = acceptGrokFiles([], [pdf, other]);
  assert.equal(mixed.files.length, 1);
  assert.equal(mixed.files[0], pdf);
  assert.equal(mixed.error, 'Only PDF files can be attached.');
  const many = acceptGrokFiles([pdf, pdf, pdf, pdf], [pdf, pdf]);
  assert.equal(many.files.length, 5);
  assert.equal(many.error, 'Only five PDFs at a time.');
});

test('a second Grok message waits until the reply is finished', () => {
  assert.equal(grokShouldQueue({ sending: false, pending: false, queued: 0 }), false);
  assert.equal(grokShouldQueue({ sending: true, pending: false, queued: 0 }), true);
  assert.equal(grokShouldQueue({ sending: false, pending: true, queued: 0 }), true);
  assert.equal(grokShouldQueue({ sending: false, pending: false, queued: 1 }), true);
  assert.equal(grokQueuedLabel({ text: 'Check the drawing', files: [{ name: 'sheet.pdf' }] }), 'Check the drawing · sheet.pdf · queued');
  assert.equal(grokQueuedLabel({ text: '', files: [{ name: 'sheet.pdf' }] }), 'sheet.pdf · queued');
});

test('a file card keeps a name, size, and open link when the filename is blank', () => {
  const blank = grokFileView({ id: 4, filename: '', size: 2048, expires_label: 'expires in 24h' });
  assert.equal(blank.name, 'file.pdf');
  assert.equal(blank.sizeLabel, '2 KB');
  assert.equal(blank.expiry, 'expires in 24h');
  assert.equal(blank.openUrl, '/files/4?inline=1');
  assert.equal(blank.downloadUrl, '/files/4');
  const named = grokFileView({ id: 9, filename: 'answer.pdf', size: 2 * 1024 * 1024, expired: true });
  assert.equal(named.name, 'answer.pdf');
  assert.equal(named.sizeLabel, '2.0 MB');
  assert.equal(named.expiry, 'expired');
  assert.equal(toggleGrokLayout('panel'), 'full');
  assert.equal(toggleGrokLayout('full'), 'panel');
});

test('the grok bubble, the close button, and a real outside click close the panel', () => {
  assert.equal(applyGrokClick(true, 'bubble', true), false);
  assert.equal(applyGrokClick(true, 'close', true), false);
  assert.equal(applyGrokClick(true, 'outside', false), false);
  assert.equal(applyGrokClick(false, 'outside', false), false);
});
