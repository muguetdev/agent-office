// Push notifications for the office (see notifier.ts), one per office, made the first time a part of
// the office asks for it: its VAPID key (vapid.ts) and its subscriptions (store.ts) in .agent-office.
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import { mayEnter } from '../office/access.js';
import { Vapid } from './vapid.js';
import { PushStore, type PushSub } from './store.js';
import { Notifier, waitingFor } from './notifier.js';

/** Who a push says it's from when the page that subscribed wasn't on https (VAPID's subject). */
const FALLBACK_SUBJECT = 'https://github.com/webdevcody/agent-office';
/** How long a push service gets to answer (ms). */
const POST_TIMEOUT_MS = 15_000;

export interface Push {
  /** The VAPID key, made (and saved) the first time it's needed. */
  vapid(): Vapid;
  store: PushStore;
  notifier: Notifier;
  /** A worker on `floor` changed, or went away: never throws. */
  workerChanged(floor: Floor, w: WorkerInfo | string): void;
}

const offices = new WeakMap<Ctx, Push>();

export const subjectOf = (sub: Pick<PushSub, 'origin'>) => process.env.AGENT_OFFICE_PUSH_SUBJECT || (sub.origin?.startsWith('https://') ? sub.origin : FALLBACK_SUBJECT);

export function pushOf(ctx: Ctx): Push {
  let push = offices.get(ctx);
  if (push) return push;
  let key: Vapid | undefined;
  const vapid = () => (key ??= new Vapid(path.join(ctx.cfg.dataDir, 'push-vapid.json')));
  const store = new PushStore(path.join(ctx.cfg.dataDir, 'push-subscriptions.json'));
  const notifier = new Notifier({
    subs: () => store.list(),
    may: (sub, floor) => mayEnter(ctx.accounts, { accountId: sub.accountId }, floor),
    drop: (endpoint) => store.remove(endpoint),
    waiting: (sub) => {
      let n = 0;
      for (const f of ctx.floors.values()) if (mayEnter(ctx.accounts, { accountId: sub.accountId }, f.id)) for (const w of f.workers.list()) if (waitingFor(w)) n++;
      return n;
    },
    authorization: (endpoint, sub) => vapid().authorization(endpoint, subjectOf(sub)),
    post: async (endpoint, headers, body) => (await fetch(endpoint, { method: 'POST', headers, body: new Uint8Array(body), signal: AbortSignal.timeout(POST_TIMEOUT_MS), redirect: 'error' })).status,
  });
  let failed = false;
  push = {
    vapid,
    store,
    notifier,
    workerChanged(floor, w) {
      try {
        notifier.workerChanged(floor.id, w);
      } catch (err) {
        if (!failed) console.error(`agent-office: push: ${(err as Error).message}`);
        failed = true;
      }
    },
  };
  offices.set(ctx, push);
  return push;
}
