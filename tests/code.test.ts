import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CodeFiles } from '../src/server/code.js';
import { UPLOAD_MAX_BYTES, copyName } from '../src/shared/uploads.js';

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

const status = (r: object) => (r as { status?: number }).status;

test('an upload puts the bytes exactly where it says, making the folders on the way, and shows in the tree', async () => {
  const { code, dir } = project();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0x00, 0x80, 0x0a, 0x0d]);
  const r = await code.upload('w1', 'assets/img/new logo.png', bytes, false);
  assert.ok(!('error' in r), JSON.stringify(r));
  assert.equal(r.path, 'assets/img/new logo.png');
  assert.deepEqual(readFileSync(path.join(dir, 'assets/img/new logo.png')), bytes);
  const t = await code.tree('w1');
  assert.ok(!('error' in t) && t.files.includes('assets/img/new logo.png'));
  assert.equal(status(await code.upload('nobody', 'a.txt', bytes, false)), 404);
});

test("an upload never overwrites a file that's there unless told to", async () => {
  const { code, dir } = project();
  const r = await code.upload('w1', 'src/app.ts', Buffer.from('mine\n'), false);
  assert.equal(status(r), 409);
  assert.equal((r as { exists?: boolean }).exists, true);
  assert.equal(readFileSync(path.join(dir, 'src/app.ts'), 'utf8'), 'export const a = 1;\n');
  assert.ok(!('error' in (await code.upload('w1', 'src/app.ts', Buffer.from('mine\n'), true))));
  assert.equal(readFileSync(path.join(dir, 'src/app.ts'), 'utf8'), 'mine\n');
  // A folder by that name is never replaced, and a file can't stand in for a folder on the way.
  assert.equal(status(await code.upload('w1', 'src', Buffer.from('x'), true)), 409);
  assert.equal(status(await code.upload('w1', 'logo.png/x.txt', Buffer.from('x'), true)), 409);
});

test('an upload stays inside the folder: no .., no absolute paths, no .git or .agent-office, no links out', async () => {
  const { code, dir, outside } = project();
  for (const bad of ['../x.txt', 'src/../../x.txt', '/tmp/x.txt', path.join(outside, 'x.txt'), 'C:/x.txt', '', 'a//b.txt', './a.txt', '.git/hooks/pre-commit', 'sub/.GIT/config', '.agent-office/drops/x', 'a\0b'])
    assert.equal(status(await code.upload('w1', bad, Buffer.from('x'), true)), 403, bad);
  symlinkSync(outside, path.join(dir, 'out'));
  assert.equal(status(await code.upload('w1', 'out/x.txt', Buffer.from('x'), true)), 403);
  assert.equal(status(await code.upload('w1', 'out/deeper/x.txt', Buffer.from('x'), true)), 403);
  assert.equal(existsSync(path.join(outside, 'x.txt')), false);
  assert.equal(existsSync(path.join(outside, 'deeper')), false);
  // A link at the file's own name is replaced by the file, never written through.
  symlinkSync(path.join(outside, 'other.txt'), path.join(dir, 'link.txt'));
  assert.equal(status(await code.upload('w1', 'link.txt', Buffer.from('x'), false)), 409);
  assert.ok(!('error' in (await code.upload('w1', 'link.txt', Buffer.from('replaced\n'), true))));
  assert.equal(readFileSync(path.join(outside, 'other.txt'), 'utf8'), 'not yours\n');
  assert.equal(readFileSync(path.join(dir, 'link.txt'), 'utf8'), 'replaced\n');
});

test('an upload over the size cap is refused', async () => {
  const { code, dir } = project();
  assert.equal(status(await code.upload('w1', 'big.bin', Buffer.alloc(UPLOAD_MAX_BYTES + 1), false)), 413);
  assert.equal(existsSync(path.join(dir, 'big.bin')), false);
});

test("a copy's name, as VS Code gives it", () => {
  assert.equal(copyName('logo.png', 1), 'logo copy.png');
  assert.equal(copyName('logo.png', 2), 'logo copy 2.png');
  assert.equal(copyName('Makefile', 1), 'Makefile copy');
  assert.equal(copyName('.env', 3), '.env copy 3');
  assert.equal(copyName('a.tar.gz', 1), 'a.tar copy.gz');
});

/** POSTs `body` to the upload route, as the office's page (or another site, with `origin`). */
async function postUpload(query: string, body: Buffer, headers: Record<string, string> = {}) {
  const { codeRoutes } = await import('../src/server/http/routes/code.js');
  const { code, dir } = project();
  const floor = { id: 'f1', workers: new Map([['w1', {}]]), code };
  const ctx = { cfg: { trustProxy: false }, floors: new Map([['f1', floor]]) } as never;
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    void codeRoutes.code.handle(ctx, { req, res, url, path: url.pathname, session: {} as never });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `/api/code/upload?floor=f1&worker=w1&${query}`, headers: { origin: `http://localhost:${port}`, host: `localhost:${port}`, ...headers } }, (res) => {
        res.resume().on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', (err) => ((err as NodeJS.ErrnoException).code === 'ECONNRESET' || (err as NodeJS.ErrnoException).code === 'EPIPE' ? resolve(-1) : reject(err)));
      req.end(body);
    });
    return { status, dir };
  } finally {
    server.close();
  }
}

test('the upload route: only from the office’s own page, its size asked for up front, the bytes as they are', async () => {
  const bytes = Buffer.from([0, 1, 2, 0xff, 0xfe, 0x0d, 0x0a]);
  const ok = await postUpload('path=new%2Fdeep%2Fa.bin', bytes);
  assert.equal(ok.status, 200);
  assert.deepEqual(readFileSync(path.join(ok.dir, 'new/deep/a.bin')), bytes);
  const foreign = await postUpload('path=b.bin', bytes, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal(existsSync(path.join(foreign.dir, 'b.bin')), false);
  const big = await postUpload('path=c.bin', Buffer.from('x'), { 'content-length': String(UPLOAD_MAX_BYTES + 1) });
  assert.ok(big.status === 413 || big.status === -1, String(big.status));
  assert.equal(existsSync(path.join(big.dir, 'c.bin')), false);
  assert.equal((await postUpload('path=src%2Fapp.ts', bytes)).status, 409);
  assert.equal((await postUpload('path=..%2Fx.bin', bytes)).status, 403);
});

/** GETs a file's bytes from the raw route, with `headers` (a Range, say). */
async function getRaw(query: string, headers: Record<string, string> = {}, setup?: (dir: string) => void) {
  const { codeRoutes } = await import('../src/server/http/routes/code.js');
  const { code, dir } = project();
  setup?.(dir);
  const floor = { id: 'f1', workers: new Map([['w1', {}]]), code };
  const ctx = { cfg: { trustProxy: false }, floors: new Map([['f1', floor]]) } as never;
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    void codeRoutes.code.handle(ctx, { req, res, url, path: url.pathname, session: {} as never });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/code/raw?floor=f1&worker=w1&${query}`, { headers });
    return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) };
  } finally {
    server.close();
  }
}

test('the raw route: a picture as itself, sandboxed; a range of a video; anything else a download; never outside the folder', async () => {
  const png = await getRaw('path=logo.png');
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.match(png.headers.get('content-disposition') ?? '', /^inline/);
  assert.match(png.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.equal(png.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(png.body, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));

  const video = await getRaw('path=clip.mp4', { range: 'bytes=2-5' }, (dir) => writeFileSync(path.join(dir, 'clip.mp4'), Buffer.from('0123456789')));
  assert.equal(video.status, 206);
  assert.equal(video.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(video.body.toString(), '2345');
  assert.equal((await getRaw('path=clip.mp4', { range: 'bytes=50-' }, (dir) => writeFileSync(path.join(dir, 'clip.mp4'), 'x'))).status, 416);

  // A page would run as the office's own: it only ever downloads.
  const page = await getRaw('path=evil.html', {}, (dir) => writeFileSync(path.join(dir, 'evil.html'), '<script>alert(1)</script>'));
  assert.equal(page.headers.get('content-type'), 'application/octet-stream');
  assert.match(page.headers.get('content-disposition') ?? '', /^attachment/);
  const svg = await getRaw('path=a.svg', {}, (dir) => writeFileSync(path.join(dir, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
  assert.match(svg.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.match((await getRaw('path=logo.png&download=1')).headers.get('content-disposition') ?? '', /^attachment/);

  for (const bad of ['..%2Fx', '.git%2Fconfig', '%2Fetc%2Fpasswd']) assert.equal((await getRaw(`path=${bad}`)).status, 404, bad);
});
