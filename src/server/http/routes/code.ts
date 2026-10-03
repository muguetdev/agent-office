import type { Route } from '../router.js';
import { MAX_CODE_BYTES } from '../../code.js';
import { str } from '../../office/input.js';
import { floorParam } from './files.js';
import { readBytes, sameOrigin, send } from '../util.js';

// The code editor beside a worker's terminal (see code.ts): its files, one file to read, its version
// now (to see whether it changed under you), and saving one.
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
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
