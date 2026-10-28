// Agent machines (see server/machines/): the machines host's setting (admins only, it's a way into a
// server), and giving a worker its own computer or taking it away (admins, or members on the worker's
// floor when an admin allows it; never guests).
import type { MachinesClientMsg } from '../../../shared/protocol.js';
import { MACHINE_ID_RE, parseMachinesHost } from '../../../shared/machines.js';
import { machinesOf, machinesStateFor } from '../../machines/index.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { mayEnter } from '../../office/access.js';
import { workerOf } from './common.js';
import type { HandlerMap } from './types.js';
import { L } from '../../i18n.js';

const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId, c.guest).admin) return true;
  ctx.warn(c, L.machines.adminsOnly);
  return false;
};

/** Whether `c` may give and take machines at all. */
const mayGive = (ctx: Ctx, c: Client): boolean => {
  const me = ctx.meOf(c.accountId, c.guest);
  if (machinesOf(ctx).may(me.admin, !!me.guest)) return true;
  ctx.warn(c, L.machines.notAllowed);
  return false;
};

export const machinesHandlers = {
  'machines.get'(ctx, c) {
    ctx.sendTo(c, { t: 'machines', state: machinesStateFor(ctx, c) });
  },
  'machines.set'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    const host = str(msg.host, 300).trim();
    if (host && !parseMachinesHost(host)) return ctx.warn(c, L.machines.badHost);
    const office = str(msg.office, 60).trim();
    if (!MACHINE_ID_RE.test(office)) return ctx.warn(c, L.machines.badOffice);
    const m = machinesOf(ctx);
    m.config.save({ host, office, mem: str(msg.mem, 12), cpus: Number(msg.cpus), perFloor: Number(msg.perFloor), members: msg.members === true });
    m.config.publicKey();
    ctx.toastAll(L.machines.saved(c.peer.name));
    for (const o of ctx.clients.values()) ctx.sendTo(o, { t: 'machines', state: machinesStateFor(ctx, o) });
  },
  'machines.remove'(ctx, c) {
    if (!admin(ctx, c)) return;
    const m = machinesOf(ctx);
    m.config.save({ ...m.config.settings, host: '' });
    ctx.toastAll(L.machines.removed(c.peer.name));
    for (const o of ctx.clients.values()) ctx.sendTo(o, { t: 'machines', state: machinesStateFor(ctx, o) });
  },
  'machines.test'(ctx, c) {
    if (!admin(ctx, c)) return;
    void machinesOf(ctx)
      .test()
      .then((r) => ctx.sendTo(c, { t: 'machines.tested', ...r }));
  },
  'machine.give'(ctx, c, msg) {
    if (!mayGive(ctx, c)) return;
    const w = workerOf(ctx, c, msg.workerId);
    if (!w) return ctx.warn(c, L.srv.noSuchWorker);
    const m = machinesOf(ctx);
    const later = msg.later === true;
    ctx.warn(c, msg.on === true ? m.give(w.floor, w.wid, c.peer.name, later) : m.take(w.floor, w.wid, c.peer.name, later));
  },
  'machine.want'(ctx, c, msg) {
    if (!mayGive(ctx, c)) return;
    const floor = ctx.floorOf(c);
    if (!floor || !mayEnter(ctx.accounts, c, floor.id)) return ctx.warn(c, L.srv.elevatorFirst);
    const prompt = typeof msg.prompt === 'string' ? msg.prompt.slice(0, 100_000) : undefined;
    ctx.warn(c, machinesOf(ctx).want(floor, str(msg.deskId, 64), c.peer.name, prompt));
  },
} satisfies HandlerMap<MachinesClientMsg>;
