// The lounge jukebox on every floor.
import type { Floor } from '../../floor.js';
import { JUKEBOX_TUNES, STREAM } from '../../../shared/jukebox.js';
import type { JukeboxClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';
import { L } from '../../i18n.js';

/** How long a jukebox plays to an empty floor before it turns itself off, and how often that's looked at. */
export const IDLE_OFF_MS = 10 * 60_000;
const LOOK_MS = 60_000;
let idle: NodeJS.Timeout | undefined;
/** Since when each floor's had nobody on it, while its jukebox is on. */
const emptySince = new Map<string, number>();

/** Turns off every jukebox that's played to an empty floor for IDLE_OFF_MS (from the first time anyone's put one on, or come to a floor with one on). */
export function idleJukeboxes(ctx: Ctx, now = Date.now()) {
  for (const floor of ctx.floors.values()) {
    const here = [...ctx.clients.values()].some((c) => c.peer.floor === floor.id);
    if (!floor.jukebox.state().on || here) {
      emptySince.delete(floor.id);
      continue;
    }
    const since = emptySince.get(floor.id) ?? now;
    emptySince.set(floor.id, since);
    if (now - since >= IDLE_OFF_MS && floor.jukebox.stop('')) {
      emptySince.delete(floor.id);
      jukeboxChanged(ctx, floor);
    }
  }
}

function watchIdle(ctx: Ctx) {
  if (idle) return;
  idle = setInterval(() => idleJukeboxes(ctx), LOOK_MS);
  idle.unref();
}

export const jukeboxView: ViewPieces['jukebox'] = (ctx, floor) => {
  watchIdle(ctx);
  return floor?.jukebox.state() ?? { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), elapsed: 0 };
};
export const jukeboxChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'jukebox', state: floor.jukebox.state() });

export const jukeboxHandlers = {
  'jukebox.play'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    watchIdle(ctx);
    const r = floor.jukebox.play({ track: msg.track, url: msg.url }, who);
    if ('error' in r) return ctx.warn(c, r.error);
    if (!r.changed) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, floor.jukebox.state().track === STREAM ? L.srv.tuned(who, floor.jukebox.title()) : L.srv.putOn(who, floor.jukebox.title()));
  },
  'jukebox.skip'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    floor.jukebox.skip(who);
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, L.srv.skipped(who, floor.jukebox.title()));
  },
  'jukebox.yt'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const skip = msg.next === 'skip';
    if (!floor || !floor.jukebox.youtube(msg.at, msg.video, msg.title, !!msg.next, skip ? who : undefined)) return;
    jukeboxChanged(ctx, floor);
    if (skip) ctx.toastFloor(floor, L.srv.skipped(who, floor.jukebox.title()));
  },
  'jukebox.stop'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor || !floor.jukebox.stop(who)) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, L.srv.jukeboxOff(who));
  },
} satisfies HandlerMap<JukeboxClientMsg>;
