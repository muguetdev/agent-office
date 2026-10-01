import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeFiles } from '../src/server/code.js';

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), 'code-'));
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'src/app.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
  writeFileSync(path.join(dir, '.gitignore'), 'secret.env\n');
  writeFileSync(path.join(dir, 'secret.env'), 'TOKEN=x\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const outside = mkdtempSync(path.join(tmpdir(), 'outside-'));
  writeFileSync(path.join(outside, 'other.txt'), 'not yours\n');
  return { dir, outside, code: new CodeFiles((id) => (id === 'w1' ? dir : undefined)) };
}

test("a worker's files: its project's, not git's own nor what's ignored", async () => {
  const { code } = project();
  const t = await code.tree('w1');
  assert.ok(!('error' in t));
  assert.deepEqual(t.files, ['.gitignore', 'logo.png', 'src/app.ts']);
  assert.equal('error' in (await code.tree('nobody')), true);
});

test('only text inside the folder opens: no way out of it, no .git, no binaries', async () => {
  const { code, outside } = project();
  const r = await code.read('w1', 'src/app.ts');
  assert.ok(!('error' in r));
  assert.equal(r.text, 'export const a = 1;\n');
  for (const bad of ['../x', path.relative('/', path.join(outside, 'other.txt')), path.join(outside, 'other.txt'), '.git/config', 'src/../../etc/passwd'])
    assert.equal(((await code.read('w1', bad)) as { status?: number }).status, 404, bad);
  assert.equal(((await code.read('w1', 'logo.png')) as { status?: number }).status, 415);
});

test('a save goes through only on the version it was made from', async () => {
  const { code, dir } = project();
  const r = await code.read('w1', 'src/app.ts');
  assert.ok(!('error' in r));
  const saved = await code.write('w1', 'src/app.ts', 'export const a = 2;\n', r.version);
  assert.ok(!('error' in saved));
  assert.equal(readFileSync(path.join(dir, 'src/app.ts'), 'utf8'), 'export const a = 2;\n');
  // Changed on disk since (the worker edited it): the old version no longer saves over it.
  writeFileSync(path.join(dir, 'src/app.ts'), 'export const a = 3; // the worker\n');
  utimesSync(path.join(dir, 'src/app.ts'), new Date(), new Date(Date.now() + 5000));
  const late = await code.write('w1', 'src/app.ts', 'export const a = 4;\n', saved.version);
  assert.equal((late as { status?: number }).status, 409);
  assert.equal(readFileSync(path.join(dir, 'src/app.ts'), 'utf8'), 'export const a = 3; // the worker\n');
});
