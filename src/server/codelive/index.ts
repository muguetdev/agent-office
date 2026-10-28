// The live Code tab, put together for the office: one hub (hub.ts) for the whole building, sending
// only to connections that may still see the worker's floor, and one review (review.ts) per floor,
// kept in its .agent-office folder. Made the first time they're needed, so nothing runs (and no
// folder is watched) until someone opens a Code tab.
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { Floor } from '../floor.js';
import { mayEnter } from '../office/access.js';
import { CodeLive } from './hub.js';
import { CodeReview } from './review.js';

const hubs = new WeakMap<Ctx, CodeLive<Client>>();
const reviews = new WeakMap<Floor, CodeReview>();

/** Of `paths` in `dir`, the ones git ignores (none when it isn't a git checkout). */
export function gitIgnored(dir: string, paths: string[]): Promise<Set<string>> {
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const p = spawn('git', ['check-ignore', '--stdin', '-z'], { cwd: dir, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    p.stdout.on('data', (b: Buffer) => out.push(b));
    p.on('error', () => resolve(new Set()));
    p.on('close', () => resolve(new Set(Buffer.concat(out).toString('utf8').split('\0').filter(Boolean))));
    p.stdin.on('error', () => undefined);
    p.stdin.end(paths.join('\0'));
  });
}

/** The office's live Code tab hub. */
export function codeLive(ctx: Ctx): CodeLive<Client> {
  let hub = hubs.get(ctx);
  if (!hub) {
    hub = new CodeLive<Client>({
      dirOf: (workerId) => ctx.workerFloor(workerId)?.code.dir(workerId),
      files: async (workerId) => {
        const t = await ctx.workerFloor(workerId)?.code.tree(workerId);
        return t && !('error' in t) ? t.files : undefined;
      },
      // Still connected, not a guest, and still allowed on the worker's floor (see access.ts).
      allowed: (c, workerId) => {
        const floor = ctx.workerFloor(workerId);
        return !!floor && !c.guest && ctx.clients.get(c.id) === c && mayEnter(ctx.accounts, c, floor.id);
      },
      send: (c, msg) => ctx.sendTo(c, msg),
      gitIgnored: (workerId, paths) => {
        const dir = ctx.workerFloor(workerId)?.code.dir(workerId);
        return dir ? gitIgnored(dir, paths) : Promise.resolve(new Set());
      },
    });
    hubs.set(ctx, hub);
  }
  return hub;
}

/** A floor's reviews of its workers' edits. */
export function reviewOf(floor: Floor): CodeReview {
  let r = reviews.get(floor);
  if (!r) {
    r = new CodeReview(floor.code, path.join(floor.dir, '.agent-office'));
    reviews.set(floor, r);
  }
  return r;
}

/** A hook event a worker's agent sent (already checked to be its own), for 👀 Follow. */
export function codeHook(ctx: Ctx, workerId: string, event: string, payload: unknown) {
  codeLive(ctx).hook(workerId, event, payload);
}
