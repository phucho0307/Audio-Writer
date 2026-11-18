// VieNeu chapters go to the sidecar a paragraph or so at a time.
//
//   npx tsx --test test/vieneu-pieces.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { vieneuPieces } = require('../src/tts/vieneu-tts.driver');

const words = (s) => s.split(/\s+/).filter(Boolean);

test('short paragraphs are packed together, in order', () => {
  assert.deepEqual(vieneuPieces('Một.\nHai.\n\nBa.', 100), ['Một.\nHai.\nBa.']);
});

test('no piece is over the limit, and nothing is lost or reordered', () => {
  const para = Array.from({ length: 80 }, (_, i) => `Câu số ${i} kể chuyện nha hoàn.`).join(' ');
  const text = `${para}\n\nĐoạn giữa ngắn.\n\n${para}`;
  const out = vieneuPieces(text, 300);
  assert.ok(out.length > 4);
  for (const p of out) assert.ok(p.length <= 300, `${p.length}`);
  assert.deepEqual(words(out.join(' ')), words(text));
});

test('a run-on with no full stop is still cut', () => {
  const out = vieneuPieces('a'.repeat(1000), 300);
  assert.ok(out.every((p) => p.length <= 300));
  assert.equal(out.join(''), 'a'.repeat(1000));
});

test('blank text gives nothing to send', () => {
  assert.deepEqual(vieneuPieces('  \n\n \n'), []);
});
