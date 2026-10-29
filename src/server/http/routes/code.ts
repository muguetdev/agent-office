import { createReadStream } from 'node:fs';
import type http from 'node:http';
import type { Route } from '../router.js';
import { mediaKind, mediaType } from '../../../shared/media.js';
import { MAX_CODE_BYTES } from '../../code.js';
import { UPLOAD_MAX_BYTES } from '../../../shared/uploads.js';
import { str } from '../../office/input.js';
import { floorParam } from './files.js';
import { readBytes, sameOrigin, send } from '../util.js';

// The code editor beside a worker's terminal (see code.ts): its files, one file to read, its version
// now (to see whether it changed under you), saving one, uploading any file into the folder, and one
// file's bytes as they are (raw: shown as an image, a video… or downloaded).
export const codeRoutes = {
  code: {
    prefix: '/api/code/',
    auth: 'session',
    async handle(ctx, { req, res, url, path: p, session }) {
      const floor = floorParam(ctx, url, session);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const workerId = str(url.searchParams.get('worker'), 32);
      if (!workerId || !floor.workers.get(workerId)) return send(res, 404, { error: 'No such worker' });
      const file = str(url.searchParams.get('path'), 4096);
      const answer = (r: object) => ('error' in r ? send(res, (r as unknown as { status: number }).status, r) : send(res, 200, r));
      if (p === '/api/code/tree' && req.method === 'GET') return answer(await floor.code.tree(workerId));
      if (p === '/api/code/version' && req.method === 'GET') return answer(await floor.code.version(workerId, file));
      if (p === '/api/code/file' && req.method === 'GET') return answer(await floor.code.read(workerId, file));
      if (p === '/api/code/raw' && (req.method === 'GET' || req.method === 'HEAD')) {
        const r = await floor.code.raw(workerId, file);
        if ('error' in r) return send(res, r.status, r);
        return sendRaw(req, res, r, file, url.searchParams.get('download') === '1');
      }
      if (p === '/api/code/file' && req.method === 'PUT') {
        // Only the office's own page saves (another site can't, with a visitor's cookie).
        if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
        let body: Buffer;
        try {
          body = await readBytes(req, MAX_CODE_BYTES + 1);
        } catch {
          return send(res, 413, { error: 'Too big to save here' });
        }
        return answer(await floor.code.write(workerId, file, body.toString('utf8'), str(url.searchParams.get('base'), 64)));
      }
      if (p === '/api/code/upload' && req.method === 'POST') {
        // A file dragged in from the desktop or picked with ⬆️ Upload: its bytes as they are, text or not.
        if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
        const tooBig = { error: `Too big to upload (${UPLOAD_MAX_BYTES / 1024 / 1024} MB at most)` };
        if (Number(req.headers['content-length']) > UPLOAD_MAX_BYTES) return send(res, 413, tooBig);
        let body: Buffer;
        try {
          body = await readBytes(req, UPLOAD_MAX_BYTES);
        } catch (err) {
          return (err as Error).message === 'too large' ? send(res, 413, tooBig) : send(res, 400, { error: 'Bad request' });
        }
        return answer(await floor.code.upload(workerId, file, body, url.searchParams.get('replace') === '1'));
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;

/**
 * A file's bytes, a range of them when asked (a video seeking), as its own type when the editor shows
 * it (shared/media.ts) and else as a download. It never runs as a page of the office's: the content
 * security policy sandboxes it (an SVG's scripts, say), and nothing is sniffed into something else.
 */
function sendRaw(req: http.IncomingMessage, res: http.ServerResponse, f: { abs: string; size: number; version: string }, file: string, download: boolean) {
  const shown = !download && !!mediaKind(file);
  const name = encodeURIComponent(file.split('/').pop() ?? 'file');
  const headers: Record<string, string | number> = {
    'content-type': shown ? mediaType(file) : 'application/octet-stream',
    'content-disposition': `${shown ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-cache',
    etag: `"${f.version}"`,
    'x-content-type-options': 'nosniff',
    // A PDF needs the browser's own viewer, which a sandbox would block; anything else is sandboxed.
    'content-security-policy': mediaKind(file) === 'pdf' && shown ? "default-src 'none'; object-src 'self'; frame-ancestors 'self'" : "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; font-src 'self' data:; sandbox; frame-ancestors 'self'",
  };
  if (req.headers['if-none-match'] === headers.etag) return void res.writeHead(304, headers).end();
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  let start = 0;
  let end = f.size - 1;
  if (m && (m[1] || m[2])) {
    start = m[1] ? Number(m[1]) : Math.max(0, f.size - Number(m[2]));
    end = m[1] && m[2] ? Math.min(Number(m[2]), f.size - 1) : f.size - 1;
    if (start > end || start >= f.size) return void res.writeHead(416, { 'content-range': `bytes */${f.size}` }).end();
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${f.size}`, 'content-length': end - start + 1 });
  } else res.writeHead(200, { ...headers, 'content-length': f.size });
  if (req.method === 'HEAD' || f.size === 0) return void res.end();
  const stream = createReadStream(f.abs, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
