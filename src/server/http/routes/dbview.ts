// The 🗄️ Database tab's reads (see dbview/): POST /api/dbview?floor=&worker=&source= with what to read.
// source=machine reads the worker's own machine, source=server its floor's server (a server's floor).
// The same checks as the 🖥️ Screen tab's desktop: signed in, not a guest (the router), on a floor the
// session may go to, a worker there; and only from the office's own page.
import type { Route } from '../router.js';
import { str } from '../../office/input.js';
import { floorParam } from './files.js';
import { readBody, sameOrigin, send } from '../util.js';
import { dbRequest, readDb, readServerDb } from '../../dbview/index.js';
import { MachineShell } from '../../machines/shell.js';
import { onServer } from '../../server-watch.js';
import { isDbSource } from '../../../shared/dbview.js';
import { L } from '../../i18n.js';

/** The most a server's answer may be: a page of wide rows. */
const SERVER_KEEP = 8 * 1024 * 1024;

export const dbviewRoutes = {
  read: {
    method: 'POST',
    path: '/api/dbview',
    auth: 'session',
    async handle(ctx, { req, res, url, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const floor = floorParam(ctx, url, session);
      const w = floor?.workers.get(str(url.searchParams.get('worker'), 32));
      if (!floor || !w) return send(res, 404, { error: L.machines.noDesktop });
      const source = url.searchParams.get('source') ?? 'machine';
      if (!isDbSource(source)) return send(res, 400, { error: 'Bad request' });
      if (source === 'machine' && (!w.machine || w.machineBusy === 'giving' || w.machineBusy === 'taking')) return send(res, 409, { error: L.dbview.noMachine });
      if (source === 'server' && !floor.def.ssh) return send(res, 409, { error: L.dbview.noServer });
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, 64 * 1024));
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const ask = dbRequest(body);
      if (typeof ask === 'string') return send(res, 400, { error: ask });
      try {
        if (source === 'server') return send(res, 200, await readServerDb((script, timeout) => onServer(ctx.cfg.dataDir, floor.id, script, timeout, SERVER_KEEP), ask));
        return send(res, 200, await readDb(new MachineShell(ctx.cfg.dataDir), w, ask));
      } catch (err) {
        return send(res, 502, { error: (source === 'server' ? L.dbview.serverSaid : L.dbview.hostSaid)((err as Error).message) });
      }
    },
  },
} satisfies Record<string, Route>;
