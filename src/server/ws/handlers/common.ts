// Lookups most handlers start with.
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { L } from '../../i18n.js';
import { mayEnter } from '../../office/access.js';

/** The floor `c` is on, or a note to them that they have to be on one. */
export const here = (ctx: Ctx, c: Client): Floor | undefined => {
  const f = ctx.floorOf(c);
  if (!f) ctx.warn(c, L.srv.elevatorFirst);
  return f;
};

/** A worker by id, with the floor it sits on: one on a floor `c` may go to (see access.ts). */
export const workerOf = (ctx: Ctx, c: Client, id: unknown) => {
  const wid = str(id, 32);
  const floor = ctx.workerFloor(wid);
  return floor && mayEnter(ctx.accounts, c, floor.id) ? { wid, floor, info: floor.workers.get(wid)! } : undefined;
};
