// Phone notifications (see push/): the office's VAPID public key to subscribe with (GET
// /api/push/key), and a browser's subscription made, dropped or sent a test (POST
// /api/push/subscribe, /unsubscribe, /test). Signed in, not a guest (the router); changes only from
// the office's own page. A subscription is the account's that made it: only it can test or drop it.
import type http from 'node:http';
import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import { pushOf } from '../../push/index.js';
import { kindsOf, langOf, parseSubscription } from '../../push/store.js';
import { messages } from '../../../shared/i18n.js';
import { locale } from '../../i18n.js';

/** Done, with nothing to say. */
const done = (res: http.ServerResponse) => void res.writeHead(204, { 'cache-control': 'no-store' }).end();

export const pushRoutes = {
  key: {
    method: 'GET',
    path: '/api/push/key',
    auth: 'session',
    handle: (ctx, { res }) => send(res, 200, { publicKey: pushOf(ctx).vapid().publicKey }),
  },
  change: {
    method: 'POST',
    path: ['/api/push/subscribe', '/api/push/unsubscribe', '/api/push/test'],
    auth: 'session',
    async handle(ctx, { req, res, path: p, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: { subscription?: unknown; lang?: unknown; kinds?: unknown; endpoint?: unknown };
      try {
        body = JSON.parse(await readBody(req, 16 * 1024)) ?? {};
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const push = pushOf(ctx);
      const accountId = session.account?.id;
      if (p === '/api/push/subscribe') {
        const sub = parseSubscription(body.subscription);
        if (!sub) return send(res, 400, { error: 'Bad subscription' });
        push.store.put({
          ...sub,
          ...(session.account ? { accountId, accountName: session.account.name } : {}),
          lang: langOf(body.lang, locale),
          ...(req.headers.origin ? { origin: req.headers.origin } : {}),
          createdAt: push.store.get(sub.endpoint)?.createdAt ?? Date.now(),
          kinds: kindsOf(body.kinds),
        });
        return done(res);
      }
      const sub = typeof body.endpoint === 'string' ? push.store.get(body.endpoint) : undefined;
      if (!sub || sub.accountId !== accountId) {
        // Already gone is what unsubscribing wanted.
        return p === '/api/push/unsubscribe' ? done(res) : send(res, 404, { error: 'No such subscription' });
      }
      if (p === '/api/push/unsubscribe') {
        push.store.remove(sub.endpoint);
        return done(res);
      }
      const L = messages(sub.lang);
      const r = await push.notifier.send(sub, { title: L.notify.on, body: L.notify.sample, tag: 'push-test', url: '/lite', kind: 'test', waiting: push.notifier.waiting(sub) });
      return r.ok ? done(res) : send(res, 502, { error: 'Push service refused', status: r.status });
    },
  },
} satisfies Record<string, Route>;
