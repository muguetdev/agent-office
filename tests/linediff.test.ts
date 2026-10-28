// The line diff the Code tab's live view and review run on (shared/linediff.ts): hunks, the smallest
// edits from one text to another, and accepting or rejecting one hunk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptHunk, applyEdits, countHunks, diffTexts, firstChangedLine, minimalEdits, rejectHunk } from '../src/shared/linediff.js';

test('hunks: what changed, what was added, what was taken away', () => {
  assert.deepEqual(diffTexts('a\nb\nc\n', 'a\nb\nc\n'), []);
  assert.deepEqual(diffTexts('a\nb\nc\n', 'a\nB\nc\n'), [{ aStart: 1, aLen: 1, bStart: 1, bLen: 1 }]);
  assert.deepEqual(diffTexts('a\nc\n', 'a\nb\nc\n'), [{ aStart: 1, aLen: 0, bStart: 1, bLen: 1 }]);
  assert.deepEqual(diffTexts('a\nb\nc\n', 'a\nc\n'), [{ aStart: 1, aLen: 1, bStart: 1, bLen: 0 }]);
  // Two separate changes are two hunks.
  const two = diffTexts('1\n2\n3\n4\n5\n6\n', '1\nX\n3\n4\n5\nY\n');
  assert.deepEqual(two, [
    { aStart: 1, aLen: 1, bStart: 1, bLen: 1 },
    { aStart: 5, aLen: 1, bStart: 5, bLen: 1 },
  ]);
  assert.deepEqual(countHunks(two), { added: 2, removed: 2 });
  assert.equal(firstChangedLine(two), 1);
});

test('the smallest edits turn the old text into the new, touching only the lines that changed', () => {
  const old = 'line 1\nline 2\nline 3\n';
  const edits = minimalEdits(old, 'line 1\nline two\nline 3\n');
  assert.deepEqual(edits, [{ start: 7, end: 14, text: 'line two\n' }]);
  // Added at the very end, without a newline at the end, and everything taken away.
  for (const [a, b] of [
    ['x', 'x\ny'],
    ['x\ny', 'x'],
    ['a\nb', ''],
    ['', 'new\nfile\n'],
    ['keep\n', 'top\nkeep\nbottom\n'],
  ])
    assert.equal(applyEdits(a, minimalEdits(a, b)), b, JSON.stringify([a, b]));
});

test('random texts: the edits always get there, and accepting or rejecting every hunk ends at one side', () => {
  let seed = 7;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const text = () => Array.from({ length: rnd(14) }, () => 'abcdef'[rnd(6)]).join('\n');
  for (let i = 0; i < 2000; i++) {
    const a = text();
    const b = text();
    const hunks = diffTexts(a, b);
    assert.equal(applyEdits(a, minimalEdits(a, b, hunks)), b);
    let base = a;
    for (const h of [...hunks].reverse()) base = acceptHunk(base, b, h);
    assert.equal(base, b);
    let cur = b;
    for (const h of [...hunks].reverse()) cur = rejectHunk(a, cur, h);
    assert.equal(cur, a);
  }
});

test('a big, wholly different file is one hunk rather than a slow diff', () => {
  const a = Array.from({ length: 6000 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 6000 }, (_, i) => `b${i}`).join('\n');
  const t = Date.now();
  const hunks = diffTexts(a, b);
  assert.ok(Date.now() - t < 2000);
  assert.deepEqual(hunks, [{ aStart: 0, aLen: 6000, bStart: 0, bLen: 6000 }]);
  assert.equal(applyEdits(a, minimalEdits(a, b, hunks)), b);
});
