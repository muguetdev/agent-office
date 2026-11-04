// Web Push for the office's phones (and any browser that asks): when a worker starts waiting on
// someone (it needs input, or finished its turn and nobody has looked), every subscription that may
// go to its floor and wants that kind gets a notification, even with the office's app closed. Once
// per change: a worker that keeps waiting isn't sent again, and the same worker and status not twice
// in DEBOUNCE_MS. Sending never holds up or throws into the worker's update.
import type { WorkerInfo } from '../../shared/protocol.js';
import { alertDetail } from '../../shared/status.js';
import { messages } from '../../shared/i18n.js';
import { encrypt, MAX_PAYLOAD } from './encrypt.js';
import type { PushKinds, PushSub } from './store.js';

/** Not again for the same worker and status within this long (ms). */
export const DEBOUNCE_MS = 20_000;
/** How long a push service keeps a message for a phone that's off (s). */
const TTL = 86_400;
/** The longest the detail line gets, so the message stays well inside one record. */
const MAX_DETAIL = 600;

export type PushKind = 'needs_input' | 'done' | 'chat' | 'test';

/** What the service worker is sent, as JSON, and shows. */
export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  workerId?: string;
  floor?: string;
  requireInteraction?: boolean;
  kind: PushKind;
  /** How many workers are waiting on someone on the floors this subscription may go to: the app icon's badge. */
  waiting?: number;
}

/** What a push service said: its status (0 when it couldn't be reached). */
export interface PushResult {
  ok: boolean;
  status: number;
}

export interface NotifierDeps {
  subs(): PushSub[];
  /** Whether a subscription may hear about `floor` (its account may go there). */
  may(sub: PushSub, floor: string): boolean;
  /** Forgets a subscription the push service says is gone. */
  drop(endpoint: string): void;
  /** Sends one encrypted message (fetch, in the office). */
  post(endpoint: string, headers: Record<string, string>, body: Buffer): Promise<number>;
  authorization(endpoint: string, sub: PushSub): string;
  /** How many workers wait on someone, on every floor the subscription may go to. */
  waiting(sub: PushSub): number;
  now?: () => number;
}

/** Waiting on a person (as the page's notify.ts has it): needs input, or done and not looked at. */
export const waitingFor = (w: WorkerInfo): 'needs_input' | 'done' | '' => (w.status === 'needs_input' ? 'needs_input' : w.status === 'done' && !w.acked ? 'done' : '');

const KIND_OF: Record<Exclude<PushKind, 'test'>, keyof PushKinds> = { needs_input: 'needsInput', done: 'done', chat: 'chat' };

/** A payload cut down to fit one record, if its detail ran long. */
function fit(p: PushPayload): string {
  let json = JSON.stringify(p);
  while (Buffer.byteLength(json) > MAX_PAYLOAD - 64 && p.body.length > 20) {
    p = { ...p, body: `${p.body.slice(0, Math.floor(p.body.length * 0.7))}…` };
    json = JSON.stringify(p);
  }
  return json;
}

export class Notifier {
  /** What each worker was last seen waiting for ('' for nothing). A worker first seen waiting isn't news. */
  private seen = new Map<string, string>();
  private sent = new Map<string, number>();
  /** Failures already in the log, so a broken push service doesn't fill it. */
  private logged = new Set<string>();
  private now: () => number;

  constructor(private deps: NotifierDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** A worker on `floor` changed, or (an id) went away. */
  workerChanged(floor: string, w: WorkerInfo | string) {
    if (typeof w === 'string') {
      this.seen.delete(w);
      return;
    }
    const now = waitingFor(w);
    const before = this.seen.get(w.id);
    this.seen.set(w.id, now);
    if (before === undefined || !now || now === before) return;
    const key = `${w.id}:${now}`;
    const t = this.now();
    if (t - (this.sent.get(key) ?? -Infinity) < DEBOUNCE_MS) return;
    this.sent.set(key, t);
    for (const [k, at] of this.sent) if (t - at >= DEBOUNCE_MS) this.sent.delete(k);
    this.toAll(floor, now, (sub) => {
      const L = messages(sub.lang);
      const detail = alertDetail(w)?.slice(0, MAX_DETAIL);
      return {
        title: now === 'done' ? L.notify.done(w.name) : L.notify.needsInput(w.name),
        body: [w.task?.name, detail].filter(Boolean).join('\n'),
        tag: `worker-${w.id}`,
        url: `/lite?floor=${encodeURIComponent(floor)}&worker=${encodeURIComponent(w.id)}`,
        workerId: w.id,
        floor,
        ...(now === 'needs_input' ? { requireInteraction: true } : {}),
        kind: now,
        waiting: this.deps.waiting(sub),
      };
    });
  }

  /** Sends `make(sub)` to every subscription on `floor` that wants `kind`, without waiting. */
  private toAll(floor: string, kind: Exclude<PushKind, 'test'>, make: (sub: PushSub) => PushPayload) {
    for (const sub of this.deps.subs()) {
      if (!sub.kinds[KIND_OF[kind]] || !this.deps.may(sub, floor)) continue;
      void this.send(sub, make(sub)).catch(() => {});
    }
  }

  /** Sends one message to one subscription; one the push service says is gone (404, 410) is forgotten. */
  async send(sub: PushSub, payload: PushPayload): Promise<PushResult> {
    let status = 0;
    try {
      const body = encrypt(fit(payload), sub.keys.p256dh, sub.keys.auth);
      const topic = payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
      status = await this.deps.post(
        sub.endpoint,
        {
          authorization: this.deps.authorization(sub.endpoint, sub),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: String(TTL),
          urgency: payload.kind === 'needs_input' || payload.kind === 'test' ? 'high' : 'normal',
          ...(topic ? { topic } : {}),
        },
        body,
      );
    } catch (err) {
      this.logOnce(sub.endpoint, `couldn't send to ${host(sub.endpoint)}: ${(err as Error).message}`);
      return { ok: false, status: 0 };
    }
    if (status === 404 || status === 410) this.deps.drop(sub.endpoint);
    else if (status < 200 || status >= 300) this.logOnce(`${host(sub.endpoint)} ${status}`, `${host(sub.endpoint)} answered ${status}`);
    return { ok: status >= 200 && status < 300, status };
  }

  /** The badge for `sub` right now. */
  waiting(sub: PushSub): number {
    return this.deps.waiting(sub);
  }

  private logOnce(key: string, text: string) {
    if (this.logged.has(key)) return;
    this.logged.add(key);
    console.error(`agent-office: push: ${text}`);
  }
}

const host = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'a push service';
  }
};
