/**
 * The office phone (WorkerInfo.phone, see server/phone/): a worker on a call has a 📞 by its head
 * saying who's on the other end (and on which floor), which shakes while a message has just reached
 * it. What they say is in each one's 💬 Chat, as the messages the office gave them.
 */
import type * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import type { Worker } from '../../world/character';
import { disposeSprite, textSprite } from '../../world/toon';
import { L } from '../../i18n';

export interface PhoneDeps {
  /** The workers on this floor, as they're drawn (see features/workers/views.ts). */
  workerViews: ReadonlyMap<string, { model: Worker }>;
}

/** Beside its head (the machine badge has the spot above it), and how far the ring shakes it. */
const SPOT = { x: 0.5, y: 1.08 };
const SHAKE = 0.35;

export function installPhone(ctx: Ctx, deps: PhoneDeps) {
  const badges = new Map<string, { sprite: THREE.Sprite; on: THREE.Object3D; label: string }>();

  function sync() {
    for (const [id, v] of deps.workerViews) {
      const w = store.workers.get(id);
      const phone = w?.phone;
      const on = !!phone && (phone.calls.length > 0 || (phone.ringingUntil ?? 0) > store.officeNow());
      const calls = phone?.calls ?? [];
      const label = calls.length === 1 ? L.phone.badge(calls[0].with, calls[0].floor) : calls.length > 1 ? L.phone.badgeMany(calls.length) : '📞';
      const b = badges.get(id);
      if (b && (!on || b.on !== v.model.root || b.label !== label)) {
        b.on.remove(b.sprite);
        disposeSprite(b.sprite);
        badges.delete(id);
      }
      if (on && !badges.has(id)) {
        const sprite = textSprite(label, { bg: '#2b2d42', color: '#fffaf3', size: 26, border: '#ffd166' });
        sprite.position.set(SPOT.x, SPOT.y, 0);
        v.model.root.add(sprite);
        badges.set(id, { sprite, on: v.model.root, label });
      }
    }
  }

  store.on('workers', sync);
  ctx.ticks.add('hud', ({ t }) => {
    const now = store.officeNow();
    for (const [id, b] of badges) {
      const ringing = (store.workers.get(id)?.phone?.ringingUntil ?? 0) > now;
      b.sprite.material.rotation = ringing ? Math.sin(t * 28) * SHAKE : 0;
      b.sprite.position.y = SPOT.y + (ringing ? Math.abs(Math.sin(t * 14)) * 0.05 : 0);
    }
  });
  // A ring that ran out takes the badge away from someone no longer on a call.
  setInterval(sync, 2000);
}
