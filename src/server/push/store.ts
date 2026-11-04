// The phones and browsers that asked for the office's push notifications (see index.ts), each by its
// push endpoint, kept in .agent-office/push-subscriptions.json (only the office's user may read it).
import { readFileSync, writeFileSync } from 'node:fs';
import { LOCALES, type Locale } from '../../shared/i18n.js';

/** Which notifications a subscription wants. */
export interface PushKinds {
  needsInput: boolean;
  done: boolean;
  chat: boolean;
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The account that subscribed, if the office has accounts: it only hears about floors it may go to. */
  accountId?: string;
  accountName?: string;
  lang: Locale;
  /** The office's address as the page that subscribed saw it, signed into each push (VAPID's subject). */
  origin?: string;
  createdAt: number;
  kinds: PushKinds;
}

/** The most subscriptions kept (the oldest go first). */
export const MAX_SUBS = 500;

const b64url = (v: unknown, min: number, max: number) => typeof v === 'string' && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v);

/**
 * A push endpoint a browser could have been given: https, on a named host (not an address or
 * localhost, so a subscription can't point the office at its own network).
 */
export function validEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password && host.includes('.') && !/^[\d.]+$/.test(host) && !host.startsWith('[') && !host.endsWith('.localhost') && !host.endsWith('.local') && !host.endsWith('.internal');
  } catch {
    return false;
  }
}

/** The subscription a browser's PushSubscription.toJSON() describes, or undefined if it isn't one. */
export function parseSubscription(v: unknown): Pick<PushSub, 'endpoint' | 'keys'> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!validEndpoint(s.endpoint) || !s.keys || typeof s.keys !== 'object') return undefined;
  const { p256dh, auth } = s.keys;
  if (!b64url(p256dh, 86, 90) || !b64url(auth, 16, 32)) return undefined;
  return { endpoint: s.endpoint, keys: { p256dh: p256dh as string, auth: auth as string } };
}

export const langOf = (v: unknown, fallback: Locale): Locale => (LOCALES as readonly unknown[]).includes(v) ? (v as Locale) : fallback;

export function kindsOf(v: unknown): PushKinds {
  const k = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const on = (x: unknown) => x !== false;
  return { needsInput: on(k.needsInput), done: on(k.done), chat: on(k.chat) };
}

export class PushStore {
  private subs = new Map<string, PushSub>();

  constructor(private file: string) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { subs?: PushSub[] };
      for (const s of saved.subs ?? []) if (s && validEndpoint(s.endpoint) && s.keys) this.subs.set(s.endpoint, { ...s, kinds: kindsOf(s.kinds) });
    } catch {
      // none yet
    }
  }

  list(): PushSub[] {
    return [...this.subs.values()];
  }

  get(endpoint: string): PushSub | undefined {
    return this.subs.get(endpoint);
  }

  /** Adds a subscription, or replaces the one with its endpoint (a new language, other kinds, another account). */
  put(sub: PushSub) {
    this.subs.delete(sub.endpoint);
    this.subs.set(sub.endpoint, sub);
    while (this.subs.size > MAX_SUBS) this.subs.delete(this.subs.keys().next().value!);
    this.save();
  }

  remove(endpoint: string): boolean {
    if (!this.subs.delete(endpoint)) return false;
    this.save();
    return true;
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify({ subs: this.list() }), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: push: couldn't save the subscriptions: ${(err as Error).message}`);
    }
  }
}
