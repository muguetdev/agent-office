// Floors that are servers (see server/servers.ts): adding one, its key for the server's
// authorized_keys, and trying the way in. Admins only: it's a way into a machine.
import { mkdirSync } from 'node:fs';
import type { ServersClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { publicKey, sshTarget, testServer } from '../../servers.js';
import type { HandlerMap } from './types.js';
import { L } from '../../i18n.js';

const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId, c.guest).admin) return true;
  ctx.warn(c, L.servers.adminsOnly);
  return false;
};

/** A server's floor, by id. */
const serverFloor = (ctx: Ctx, id: unknown) => {
  const floor = ctx.floors.get(str(id, 64));
  return floor?.def.ssh ? floor : undefined;
};

export const serversHandlers = {
  'server.add'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const name = str(msg.name, 60).trim();
    if (!name) return ctx.sendTo(c, { t: 'server.added', error: L.servers.needName });
    const target = sshTarget(msg.host, msg.user, msg.port);
    if (typeof target === 'string') return ctx.sendTo(c, { t: 'server.added', error: target });
    const def = ctx.building.addServer(name, target, who);
    if (typeof def === 'string') return ctx.sendTo(c, { t: 'server.added', error: def });
    // Opening it makes its key, its way in and its note for the agents (see openFloors).
    mkdirSync(def.dir, { recursive: true });
    const floor = ctx.openFloor(def);
    if (!floor) {
      ctx.building.remove(def.id, who);
      return ctx.sendTo(c, { t: 'server.added', error: L.servers.couldntOpen });
    }
    console.log(`  ${L.servers.addedLog(who, name, `${target.user}@${target.host}:${target.port}`)}`);
    ctx.floorsChanged();
    ctx.toastAll(L.servers.added(who, name));
    ctx.sendTo(c, { t: 'server.added', floor: def.id, publicKey: publicKey(ctx.cfg.dataDir, def.id) });
  },
  'server.key'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    const floor = serverFloor(ctx, msg.floor);
    if (!floor) return ctx.warn(c, L.srv.noSuchFloor);
    ctx.sendTo(c, { t: 'server.key', floor: floor.id, publicKey: publicKey(ctx.cfg.dataDir, floor.id) });
  },
  'server.test'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    const floor = serverFloor(ctx, msg.floor);
    if (!floor) return ctx.warn(c, L.srv.noSuchFloor);
    void testServer(ctx.cfg.dataDir, floor.id).then((r) => ctx.sendTo(c, { t: 'server.tested', floor: floor.id, ...r }));
  },
} satisfies HandlerMap<ServersClientMsg>;
