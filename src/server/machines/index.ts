// The office's agent machines (see service.ts), one per office, made the first time a part of the
// office asks for them, with what they need of it.
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { Floor } from '../floor.js';
import type { MachinesState } from '../../shared/protocol.js';
import { Machines } from './service.js';

const offices = new WeakMap<Ctx, Machines>();

export function machinesOf(ctx: Ctx): Machines {
  let m = offices.get(ctx);
  if (!m) {
    m = new Machines({
      dataDir: ctx.cfg.dataDir,
      officeName: () => ctx.officeName(),
      floors: () => ctx.floors.values(),
      floor: (id) => ctx.floors.get(id),
      toast: (floor, text, level) => ctx.toastFloor(floor as Floor, text, level),
      changed: () => {
        for (const c of ctx.clients.values()) ctx.sendTo(c, { t: 'machines', state: machinesStateFor(ctx, c) });
      },
    });
    offices.set(ctx, m);
  }
  return m;
}

/** The setting as `c` sees it: admins get all of it. */
export function machinesStateFor(ctx: Ctx, c: Client): MachinesState {
  const me = ctx.meOf(c.accountId, c.guest);
  return machinesOf(ctx).state(me.admin, !!me.guest);
}

/** As the office starts (once its floors are open): the forwards to the machines in use open again. */
export function startMachines(ctx: Ctx) {
  const m = machinesOf(ctx);
  void m.start().catch((err) => console.error(`agent-office: machines: ${(err as Error).message}`));
  // Should the office die without stopping, its forwards don't outlive it.
  process.once('exit', () => m.tunnels.closeAll());
}

export function stopMachines(ctx: Ctx) {
  offices.get(ctx)?.stop();
}
