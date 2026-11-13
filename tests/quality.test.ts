import test from 'node:test';
import assert from 'node:assert/strict';

// core/quality.ts reads the browser as it loads: a stand-in for the bits it reads.
const g = globalThis as Record<string, unknown>;
g.navigator ??= { userAgent: 'node' };
g.matchMedia ??= () => ({ matches: false });
g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const { qualityFor } = await import('../src/client/core/quality.js');

test('auto is light on a phone and high on a computer, and only auto eases its resolution', () => {
  assert.equal(qualityFor('auto', true).level, 'low');
  assert.equal(qualityFor('auto', false).level, 'high');
  assert.ok(qualityFor('auto', true).dynamic && qualityFor('auto', false).dynamic);
  assert.ok(!qualityFor('high', true).dynamic && !qualityFor('low', false).dynamic);
});

test('a choice is kept whatever the device', () => {
  assert.equal(qualityFor('high', true).level, 'high');
  assert.equal(qualityFor('low', false).level, 'low');
});

test('high draws as the office always has; light spends less on every count', () => {
  const high = qualityFor('high', false);
  const low = qualityFor('low', true);
  assert.equal(high.antialias, true);
  assert.equal(high.maxFps, Infinity);
  assert.equal(high.shadowSize(16384), 4096);
  assert.equal(high.shadowSize(4096), 2048);
  assert.equal(low.antialias, false);
  assert.ok(low.maxPixelRatio < qualityFor('high', true).maxPixelRatio);
  assert.ok(low.shadowSize(16384) < high.shadowSize(16384));
  assert.ok(low.maxFps <= 30 && low.idleFps < low.maxFps);
  assert.ok(low.shadowEvery > 1);
});
