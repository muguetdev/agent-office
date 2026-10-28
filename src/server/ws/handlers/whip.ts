// The toy whip (shared/protocol/whip.ts): a crack at a worker is only passed on to everyone on the
// sender's floor, for the flinch. Nothing reaches the worker itself. Guests can't send it (it isn't
// in access.ts's GUEST_SENDS).
import { WHIP_EVERY_MS, type WhipClientMsg } from '../../../shared/protocol.js';
import { throttle } from '../../office/client.js';
import { here, workerOf } from './common.js';
import type { HandlerMap } from './types.js';

export const whipHandlers = {
  'worker.whip'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    // Only a worker on your own floor, and a crack at a time (a little more lenient than the page's own).
    const w = workerOf(ctx, c, msg.workerId);
    if (!w || w.floor !== floor || !w.info) return;
    if (!throttle(c, 'whip', WHIP_EVERY_MS * 0.8)) return;
    ctx.toFloor(floor, { t: 'worker.whipped', workerId: w.wid, by: c.id, name: c.peer.name }, true);
  },
} satisfies HandlerMap<WhipClientMsg>;
