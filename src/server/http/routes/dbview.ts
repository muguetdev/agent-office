// The 🗄️ Database tab's reads (see dbview/): POST /api/dbview?floor=&worker= with what to read. The
// same checks as the 🖥️ Screen tab's desktop: signed in, not a guest (the router), on a floor the
// session may go to, a worker there with a machine; and only from the office's own page.
import type { Route } from '../router.js';
import { str } from '../../office/input.js';
import { floorParam } from './files.js';
import { readBody, sameOrigin, send } from '../util.js';
import { dbRequest, readDb } from '../../dbview/index.js';
import { MachineShell } from '../../machines/shell.js';
import { L } from '../../i18n.js';

export const dbviewRoutes = {
  read: {
    method: 'POST',
    path: '/api/dbview',
    auth: 'session',
    async handle(ctx, { req, res, url, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const floor = floorParam(ctx, url, session);
      const w = floor?.workers.get(str(url.searchParams.get('worker'), 32));
      if (!w) return send(res, 404, { error: L.machines.noDesktop });
      if (!w.machine || w.machineBusy === 'giving' || w.machineBusy === 'taking') return send(res, 409, { error: L.dbview.noMachine });
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, 64 * 1024));
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const ask = dbRequest(body);
      if (typeof ask === 'string') return send(res, 400, { error: ask });
      try {
        return send(res, 200, await readDb(new MachineShell(ctx.cfg.dataDir), w, ask));
      } catch (err) {
        return send(res, 502, { error: L.dbview.hostSaid((err as Error).message) });
      }
    },
  },
} satisfies Record<string, Route>;
