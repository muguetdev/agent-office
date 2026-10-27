// A worker's chat (see shared/protocol/transcript.ts): browsers following it, and the transcript
// polled for them while any does.
import { statSync } from 'node:fs';
import type { ChatItem, TranscriptClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { TranscriptLog } from '../../transcript.js';
import { mayEnter } from '../../office/access.js';
import { str } from '../../office/input.js';
import { L } from '../../i18n.js';
import { workerOf } from './common.js';
import type { FeatureHooks, HandlerMap } from './types.js';

/** How many items a browser gets at first, and per page of older ones. */
const PAGE = 80;
const POLL_MS = 1000;

interface Followed {
  log: TranscriptLog;
  viewers: Set<Client>;
  size: number;
}

const followed = new Map<string, Followed>();
let timer: NodeJS.Timeout | undefined;

function page(items: ChatItem[], end: number): { items: ChatItem[]; more: boolean } {
  const start = Math.max(0, end - PAGE);
  return { items: items.slice(start, end), more: start > 0 };
}

/** The worker's transcript file, or why there's no chat for it. */
function transcriptOf(w: NonNullable<ReturnType<typeof workerOf>>): { path: string } | { why: string } {
  if (w.info.kind !== 'agent' || (w.info.provider ?? w.floor.workers.officeDefault.provider) !== 'claude') return { why: L.transcript.notClaude };
  const path = w.floor.workers.transcriptOf(w.wid);
  return path ? { path } : { why: L.transcript.nothingYet(w.info.name) };
}

/** Sends everyone following `workerId` what's new in its transcript, and starts over if it's a new file (a /clear). */
function poll(ctx: Ctx) {
  for (const [workerId, f] of followed) {
    const floor = ctx.workerFloor(workerId);
    const info = floor?.workers.get(workerId);
    // Whoever may no longer go to its floor (or the worker's gone) stops following it.
    for (const c of f.viewers) if (!floor || !info || !mayEnter(ctx.accounts, c, floor.id)) unfollow(c, workerId);
    if (!floor || !info || !f.viewers.size) continue;
    const t = transcriptOf({ wid: workerId, floor, info });
    if ('why' in t) continue;
    if (t.path !== f.log.path) {
      f.log = new TranscriptLog(t.path);
      f.size = 0;
      f.log.read();
      const p = page(f.log.items, f.log.items.length);
      for (const c of f.viewers) ctx.sendTo(c, { t: 'transcript.items', workerId, mode: 'reset', ...p });
      continue;
    }
    let size: number;
    try {
      size = statSync(t.path).size;
    } catch {
      continue;
    }
    if (size === f.size) continue;
    f.size = size;
    const { added, patched } = f.log.read();
    for (const c of f.viewers) {
      if (added.length) ctx.sendTo(c, { t: 'transcript.items', workerId, mode: 'append', items: added });
      if (patched.length) ctx.sendTo(c, { t: 'transcript.items', workerId, mode: 'patch', items: patched });
    }
  }
}

function unfollow(c: Client, workerId?: string) {
  for (const [id, f] of followed) {
    if (workerId && id !== workerId) continue;
    f.viewers.delete(c);
    if (!f.viewers.size) followed.delete(id);
  }
  if (!followed.size && timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

export const transcriptHandlers = {
  'transcript.attach'(ctx, c, msg) {
    const w = workerOf(ctx, c, msg.workerId);
    if (!w) return ctx.sendTo(c, { t: 'transcript.none', workerId: str(msg.workerId, 32), why: L.srv.noSuchWorker });
    const t = transcriptOf(w);
    if ('why' in t) return ctx.sendTo(c, { t: 'transcript.none', workerId: w.wid, why: t.why });
    let f = followed.get(w.wid);
    if (!f || f.log.path !== t.path) {
      f = { log: new TranscriptLog(t.path), viewers: new Set(), size: 0 };
      followed.set(w.wid, f);
    }
    f.viewers.add(c);
    if (!f.size) {
      f.log.read();
      try {
        f.size = statSync(t.path).size;
      } catch {
        // read again at the next poll
      }
    }
    ctx.sendTo(c, { t: 'transcript.items', workerId: w.wid, mode: 'reset', ...page(f.log.items, f.log.items.length) });
    timer ??= setInterval(() => poll(ctx), POLL_MS);
  },
  'transcript.detach'(_ctx, c, msg) {
    const w = str(msg.workerId, 32);
    if (w) unfollow(c, w);
  },
  'transcript.more'(ctx, c, msg) {
    const w = workerOf(ctx, c, msg.workerId);
    const f = w && followed.get(w.wid);
    if (!w || !f || !f.viewers.has(c)) return;
    const before = typeof msg.before === 'string' ? msg.before : '';
    const end = f.log.items.findIndex((i) => i.id === before);
    if (end <= 0) return;
    ctx.sendTo(c, { t: 'transcript.items', workerId: w.wid, mode: 'prepend', ...page(f.log.items, end) });
  },
} satisfies HandlerMap<TranscriptClientMsg>;

export const transcriptHooks: FeatureHooks = {
  leaving: (_ctx, c) => unfollow(c),
  closed: (_ctx, c) => unfollow(c),
};
