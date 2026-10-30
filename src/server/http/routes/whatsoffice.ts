// A worker's 💬 WhatsOffice tab (see whatsoffice/): its conversations (GET /api/whatsoffice?floor=&worker=)
// and one of them (GET /api/whatsoffice/thread?floor=&worker=&id=). Signed in, not a guest (the router),
// on a floor the session may go to, a worker there. Looking doesn't mark anything read.
import type { Route } from '../router.js';
import { str } from '../../office/input.js';
import { floorParam } from './files.js';
import { send } from '../util.js';
import { whatsOfficeOf } from '../../whatsoffice/index.js';

export const whatsOfficeRoutes = {
  read: {
    method: 'GET',
    prefix: '/api/whatsoffice',
    auth: 'session',
    handle(ctx, { res, url, path: p, session }) {
      const floor = floorParam(ctx, url, session);
      const workerId = str(url.searchParams.get('worker'), 32);
      if (!floor || !floor.workers.get(workerId)) return send(res, 404, { error: 'No such worker' });
      const wo = whatsOfficeOf(ctx);
      const me = { floor: floor.id, id: workerId };
      if (p === '/api/whatsoffice') return send(res, 200, { conversations: wo.conversationsOf(me) });
      if (p === '/api/whatsoffice/thread') {
        const r = wo.messagesOf(me, str(url.searchParams.get('id'), 16));
        return r ? send(res, 200, r) : send(res, 404, { error: 'No such conversation' });
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
