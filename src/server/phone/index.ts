// The office phone (see calls.ts), one per office, made the first time a part of the office asks
// for it, with what it needs of it.
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { mayEnter } from '../office/access.js';
import { Phone, type PhoneFloor } from './calls.js';

const offices = new WeakMap<Ctx, Phone>();
/** How often what's waiting tries again, and quiet calls end. */
const TICK_MS = 5000;

function asPhoneFloor(f: Floor): PhoneFloor {
  const ssh = f.def.ssh;
  return { id: f.id, name: f.def.name, project: f.def.repo ?? (ssh ? `server ${ssh.user}@${ssh.host}` : undefined), workers: f.workers };
}

export function phoneOf(ctx: Ctx): Phone {
  let p = offices.get(ctx);
  if (!p) {
    p = new Phone({
      floors: () => [...ctx.floors.values()].map(asPhoneFloor),
      floor: (id) => {
        const f = ctx.floors.get(id);
        return f && asPhoneFloor(f);
      },
      may: (owner, floor) => !owner || mayEnter(ctx.accounts, { accountId: owner }, floor),
      toast: (floor, text) => ctx.toastFloor(ctx.floors.get(floor), text),
    });
    const phone = p;
    setInterval(() => phone.tick(), TICK_MS).unref();
    offices.set(ctx, p);
  }
  return p;
}
