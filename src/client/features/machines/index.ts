/**
 * Agent machines (see server/machines/): asks the office how its machines host is set up as you come
 * in, puts a small 🖥️ by the name of each worker that has a computer of its own (🖥️⚠️ while it isn't
 * answering, 🖥️⏳ while it's being made), and gives hiring its 🖥️ With its own machine option. The
 * windows are in ui/machines/: the setting, the toggle and the 🖥️ Screen tab.
 */
import type * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { machineHireOption } from '../../ui/machines/toggle';
import type { Worker } from '../../world/character';
import { disposeSprite, textSprite } from '../../world/toon';

export interface MachinesDeps {
  /** The workers on this floor, as they're drawn (see features/workers/views.ts). */
  workerViews: ReadonlyMap<string, { model: Worker }>;
}

/** Under the name over its head, so neither hides the other. */
const BADGE_Y = 1.33;
/** How many frames between looks at who has a machine: it changes rarely. */
const EVERY = 20;

export function installMachines(ctx: Ctx, deps: MachinesDeps) {
  const ask = () => ctx.net.send({ t: 'machines.get' });
  ctx.messages.on('welcome', ask);
  // Made an admin, or not one any more: what you see of the setting changes.
  ctx.messages.on('me', ask);

  const badges = new Map<string, { kind: string; sprite: THREE.Sprite; on: THREE.Object3D }>();
  const kindOf = (id: string): string | undefined => {
    const w = store.workers.get(id);
    if (w?.machine) return w.machineDown ? '🖥️⚠️' : '🖥️';
    if (w?.machineBusy === 'giving') return '🖥️⏳';
    return undefined;
  };
  let frame = 0;
  ctx.ticks.add('hud', () => {
    if (++frame % EVERY) return;
    for (const [id, b] of badges) {
      const v = deps.workerViews.get(id);
      if (v?.model.root === b.on && kindOf(id) === b.kind) continue;
      b.on.remove(b.sprite);
      disposeSprite(b.sprite);
      badges.delete(id);
    }
    for (const [id, v] of deps.workerViews) {
      const kind = kindOf(id);
      if (!kind || badges.has(id)) continue;
      const sprite = textSprite(kind, { bg: '#2b2d42', color: '#fffaf3', size: 30, border: kind === '🖥️⚠️' ? '#ef476f' : '#fffaf3' });
      sprite.position.y = BADGE_Y;
      v.model.root.add(sprite);
      badges.set(id, { kind, sprite, on: v.model.root });
    }
  });

  return {
    /** The hire window's 🖥️ With its own machine option, or null when there's nothing to offer. */
    hireOption: machineHireOption,
    /** The worker about to be hired at `deskId` gets a machine, and `prompt` once it has it: send just before hiring it without one. */
    want(deskId: string, prompt?: string) {
      ctx.net.send({ t: 'machine.want', deskId, prompt });
    },
  };
}
