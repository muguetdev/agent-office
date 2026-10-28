import type { Route } from '../router.js';
import { MAX_CODE_BYTES } from '../../code.js';
import { str } from '../../office/input.js';
import { floorParam } from './files.js';
import { readBody, sameOrigin, send } from '../util.js';
import { codeLive, reviewOf } from '../../codelive/index.js';

// Reviewing a worker's edits in its Code tab (see codelive/review.ts): the files that differ from
// their baseline, one file's baseline, and accepting or rejecting changes. The same checks as the
// Code tab's own routes (code.ts): signed in, not a guest (the router), on a floor the session may
// go to, a worker there; and changes only from the office's own page.
export const codeReviewRoutes = {
  review: {
    prefix: '/api/code-review/',
    auth: 'session',
    async handle(ctx, { req, res, url, path: p, session }) {
      const floor = floorParam(ctx, url, session);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const workerId = str(url.searchParams.get('worker'), 32);
      if (!workerId || !floor.workers.get(workerId)) return send(res, 404, { error: 'No such worker' });
      const review = reviewOf(floor);
      const answer = (r: object) => ('error' in r ? send(res, (r as unknown as { status: number }).status, r) : send(res, 200, r));
      if (p === '/api/code-review/files' && req.method === 'GET') return answer(await review.files(workerId));
      if (p === '/api/code-review/baseline' && req.method === 'GET') return answer(await review.baseline(workerId, str(url.searchParams.get('path'), 4096)));
      if (req.method !== 'POST' || (p !== '/api/code-review/accept' && p !== '/api/code-review/reject')) return send(res, 404, { error: 'Not found' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: { path?: unknown; base?: unknown; sig?: unknown; text?: unknown; all?: unknown };
      try {
        body = JSON.parse(await readBody(req, MAX_CODE_BYTES * 2 + 8192)) ?? {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const file = str(body.path, 4096);
      const sig = str(body.sig, 64);
      let r: object;
      if (p === '/api/code-review/accept') {
        if (body.all === true) r = await review.acceptAll(workerId);
        else r = await review.accept(workerId, file, str(body.base, 64), { ...(typeof body.text === 'string' ? { text: body.text } : {}), ...(sig ? { sig } : {}) });
      } else r = await review.reject(workerId, file, sig);
      // Everyone else with its Code tab open sees the review move on.
      if (!('error' in r)) codeLive(ctx).toViewers(workerId, { t: 'code.reviewed', workerId });
      return answer(r);
    },
  },
} satisfies Record<string, Route>;
