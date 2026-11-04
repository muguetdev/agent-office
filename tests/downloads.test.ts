// Downloading from the code editor: a folder as a real .zip (server/zip.ts), only the project's
// files and within a limit (CodeFiles.folder), and a path on a floor's server quoted so the remote
// shell reads it as one path, never as more (http/routes/serverfile.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZipWriter } from '../src/server/zip.ts';
import { CodeFiles } from '../src/server/code.ts';
import { remotePath } from '../src/server/http/routes/serverfile.ts';

let python = true;
try {
  execFileSync('python3', ['-c', 'import zipfile'], { stdio: 'ignore' });
} catch {
  python = false;
}

test('a zip that zip tools open, files deflated or stored, names in UTF-8', { skip: !python && 'no python3 here' }, (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-zip-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const chunks: Buffer[] = [];
  const zip = new ZipWriter((c) => chunks.push(c));
  zip.add('src/app.ts', Buffer.from('export const a = 1;\n'.repeat(200)), new Date('2026-11-03T12:00:00Z'));
  zip.add('ação/olá.txt', Buffer.from('oi'));
  zip.add('random.bin', Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)));
  zip.add('empty', Buffer.alloc(0));
  zip.finish();
  const file = path.join(dir, 'out.zip');
  writeFileSync(file, Buffer.concat(chunks));
  const out = execFileSync('python3', ['-c', `import zipfile,sys,json
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps({i.filename: len(z.read(i)) for i in z.infolist()}))`, file], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { 'src/app.ts': 4000, 'ação/olá.txt': 2, 'random.bin': 4096, empty: 0 });
});

test("a folder's files: the project's own, under it, and never past the limit", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-folder-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'a.ts'), 'a');
  writeFileSync(path.join(dir, 'src', 'lib', 'b.ts'), 'bb');
  writeFileSync(path.join(dir, 'README.md'), 'r');
  writeFileSync(path.join(dir, '.gitignore'), 'secret.env\n');
  writeFileSync(path.join(dir, 'secret.env'), 'TOKEN=x');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const code = new CodeFiles((id) => (id === 'w1' ? dir : undefined));
  const src = await code.folder('w1', 'src/', 1000);
  assert.ok(!('error' in src));
  assert.deepEqual(src.files.map((f) => f.rel), ['a.ts', 'lib/b.ts']);
  const all = await code.folder('w1', '', 1000);
  assert.ok(!('error' in all));
  assert.ok(!all.files.some((f) => f.rel === 'secret.env'), "what git ignores doesn't go");
  assert.equal(((await code.folder('w1', '', 2)) as { status: number }).status, 413);
  assert.equal(((await code.folder('w1', 'nope/', 1000)) as { status: number }).status, 404);
});

test("a path on the server is one quoted path, absolute or under its home, and nothing else", () => {
  assert.equal(remotePath('/var/log/app.log'), "'/var/log/app.log'");
  assert.equal(remotePath("/tmp/it's here"), "'/tmp/it'\\''s here'");
  assert.equal(remotePath('~/app/.env'), `"$HOME"/'app/.env'`);
  assert.equal(remotePath('~'), '"$HOME"');
  assert.equal(remotePath('/x; rm -rf /'), "'/x; rm -rf /'");
  for (const bad of ['', 'relative/path', '/a\nb', '~other/x']) assert.equal(remotePath(bad), undefined, bad);
});
