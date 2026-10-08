import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outfitFromSeed, outfitOf, outfitParam, parseOutfit, sameLook, sanitizeLook, sanitizeOutfit } from '../src/shared/avatar.ts';

const outfit = { cut: 2, top: 1, bottom: 0, shoes: 1, glasses: 2, beard: 1, pants: 3, shoeColor: 0, inner: 2, frames: 1, badge: 1 };
const older = { cut: 2, top: 1, bottom: 0, shoes: 1, glasses: 2, beard: 1, pants: 3, shoeColor: 0 };

test('an outfit goes through the URL and back', () => {
  assert.deepEqual(parseOutfit(outfitParam(outfit)), outfit);
  assert.equal(parseOutfit('1,2,3'), undefined);
  assert.equal(parseOutfit(null), undefined);
});

test('an outfit saved before the later choices gets them at their first', () => {
  assert.deepEqual(sanitizeOutfit(older), { ...older, inner: 0, frames: 0, badge: 0 });
  assert.deepEqual(parseOutfit('2,1,0,1,2,1,3,0'), { ...older, inner: 0, frames: 0, badge: 0 });
  assert.equal(sanitizeOutfit({ ...outfit, badge: 2 }), undefined);
});

test('an outfit out of range or missing a piece is dropped', () => {
  assert.equal(sanitizeOutfit({ ...outfit, top: 9 }), undefined);
  assert.equal(sanitizeOutfit({ ...outfit, cut: 1.5 }), undefined);
  assert.equal(sanitizeOutfit({ cut: 0 }), undefined);
  assert.deepEqual(sanitizeOutfit({ ...outfit, extra: 1 }), outfit);
});

test('a look keeps its outfit, or the one it had, and compares by it', () => {
  const was = { skin: 0, hair: 0, style: 0, outfit };
  assert.deepEqual(sanitizeLook({ skin: 1, hair: 1, style: 1 }, was).outfit, outfit);
  assert.equal(sanitizeLook({ skin: 1, hair: 1, style: 1, outfit: { bad: 1 } }, was).outfit, undefined);
  assert.equal(sameLook(was, { ...was, outfit: { ...outfit, beard: 0 } }), false);
  assert.equal(sameLook(was, { ...was, outfit: { ...outfit } }), true);
});

test('without one, the outfit comes from the name, the same every time', () => {
  const look = { skin: 0, hair: 0, style: 6 };
  assert.deepEqual(outfitOf('Ada', look), outfitFromSeed('Ada', 6));
  assert.equal(outfitOf('Ada', look).cut, 3);
  assert.ok(sanitizeOutfit(outfitFromSeed('Grace', 0)));
});
