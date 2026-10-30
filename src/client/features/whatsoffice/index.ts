/**
 * WhatsOffice over the workers' heads (WorkerInfo.inbox, see server/whatsoffice/): 📬 and how many
 * messages one hasn't read yet, shaking a little; or, once it's read them, 💬 and who it's been
 * talking to, for a while after. The conversations are in each worker's 💬 WhatsOffice tab.
 */
import type * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import type { Worker } from '../../world/character';
import { disposeSprite, textSprite } from '../../world/toon';
import { L } from '../../i18n';

export interface WhatsOfficeDeps {
  /** The workers on this floor, as they're drawn (see features/workers/views.ts). */
  workerViews: ReadonlyMap<string, { model: Worker }>;
}

/** Beside its head (the machine badge has the spot above it), how long a talk shows, and how far 📬 shakes. */
const SPOT = { x: 0.5, y: 1.08 };
const RECENT_MS = 10 * 60_000;
const SHAKE = 0.2;

export function installWhatsOffice(ctx: Ctx, deps: WhatsOfficeDeps) {
  const badges = new Map<string, { sprite: THREE.Sprite; on: THREE.Object3D; label: string; unread: boolean }>();

  function sync() {
    const now = store.officeNow();
    for (const [id, v] of deps.workerViews) {
      const inbox = store.workers.get(id)?.inbox;
      const unread = !!inbox?.unread;
      const talking = !!inbox?.last && now - inbox.last.at < RECENT_MS;
      const label = unread ? L.whatsoffice.unread(inbox!.unread) : talking ? L.whatsoffice.talking(inbox!.last!.name, inbox!.last!.floor) : '';
      const b = badges.get(id);
      if (b && (b.on !== v.model.root || b.label !== label)) {
        b.on.remove(b.sprite);
        disposeSprite(b.sprite);
        badges.delete(id);
      }
      if (label && !badges.has(id)) {
        const sprite = textSprite(label, { bg: unread ? '#008069' : '#2b2d42', color: '#fffaf3', size: 26, border: unread ? '#25d366' : '#ffd166' });
        sprite.position.set(SPOT.x, SPOT.y, 0);
        v.model.root.add(sprite);
        badges.set(id, { sprite, on: v.model.root, label, unread });
      }
    }
    for (const [id, b] of badges) {
      if (deps.workerViews.has(id)) continue;
      b.on.remove(b.sprite);
      disposeSprite(b.sprite);
      badges.delete(id);
    }
  }

  store.on('workers', sync);
  ctx.ticks.add('hud', ({ t }) => {
    for (const b of badges.values()) b.sprite.material.rotation = b.unread ? Math.sin(t * 6) * SHAKE : 0;
  });
  // A talk gone quiet stops showing.
  setInterval(sync, 30_000);
}
