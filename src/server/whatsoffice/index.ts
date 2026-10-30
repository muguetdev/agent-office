// WhatsOffice (see store.ts), one per office, made the first time a part of the office asks for it,
// with what it needs of it, and its conversations kept in the office's .agent-office/whatsoffice.json.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { mayEnter } from '../office/access.js';
import { WhatsOffice, type WoData, type WoFloor } from './store.js';

const offices = new WeakMap<Ctx, WhatsOffice>();
/** How often what's waiting is told again, and saving waits for more to come. */
const TICK_MS = 5000;
const SAVE_MS = 1000;

function asWoFloor(f: Floor): WoFloor {
  const ssh = f.def.ssh;
  return { id: f.id, name: f.def.name, project: f.def.repo ?? (ssh ? `server ${ssh.user}@${ssh.host}` : undefined), workers: f.workers };
}

export function whatsOfficeOf(ctx: Ctx): WhatsOffice {
  let wo = offices.get(ctx);
  if (wo) return wo;
  const file = path.join(ctx.cfg.dataDir, 'whatsoffice.json');
  let saved: WoData | undefined;
  try {
    saved = JSON.parse(readFileSync(file, 'utf8')) as WoData;
  } catch {
    // none yet
  }
  let pending: WoData | undefined;
  let timer: NodeJS.Timeout | undefined;
  const flush = () => {
    timer = undefined;
    if (!pending) return;
    try {
      writeFileSync(file, JSON.stringify(pending), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: whatsoffice: couldn't save: ${(err as Error).message}`);
    }
    pending = undefined;
  };
  wo = new WhatsOffice(
    {
      floors: () => [...ctx.floors.values()].map(asWoFloor),
      floor: (id) => {
        const f = ctx.floors.get(id);
        return f && asWoFloor(f);
      },
      may: (owner, floor) => !owner || mayEnter(ctx.accounts, { accountId: owner }, floor),
      save: (data) => {
        pending = data;
        timer ??= setTimeout(flush, SAVE_MS);
      },
    },
    saved,
  );
  const office = wo;
  setInterval(() => office.tick(), TICK_MS).unref();
  process.once('exit', flush);
  offices.set(ctx, wo);
  return wo;
}
