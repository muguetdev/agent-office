/**
 * A worker's helpers (WorkerInfo.helpers): the subagents its Claude Code calls in, each a little
 * worker of its own for as long as it works. It steps out of the elevator and sits at the free desk
 * nearest the worker who called it, its card saying what it's doing, and once it's done it packs up
 * and goes home like anyone sent home. They only borrow a desk: someone hired there takes it, and the
 * helper moves along to another (or, with none free, waits off the floor until one is).
 */
import type { WorkerHelper, WorkerInfo } from '../../../shared/protocol';
import { isAsleep } from '../../../shared/status';
import type { Ctx } from '../../core/context';
import { seatBuilt } from '../../core/floors';
import { noOutline } from '../../core/outline';
import { store } from '../../state';
import type { DeskView } from '../../world/types';
import { Worker } from '../../world/character';
import { Laptop } from '../workers/laptop';
import type { Arrivals, Departures } from '../workers/leaving';
import { L } from '../../i18n';

export interface HelpersDeps {
  /** The workers' own comings and goings, so the doors open for helpers too (see features/workers/views.ts). */
  arrivals: Arrivals;
  departures: Departures;
}

interface HelperView {
  parentId: string;
  helper: WorkerHelper;
  model: Worker;
  laptop: Laptop;
  deskId: string;
}

/** A helper's key: its worker's id and its own. */
const keyOf = (parentId: string, helperId: string) => `${parentId}:${helperId}`;

/** Its card: what it is, and what it was asked and is doing now. */
function cardOf(h: WorkerHelper): { name: string; summary: string } {
  return { name: `🤖 ${h.type}`, summary: h.activity ? `${h.description} · ${h.activity}` : h.description };
}

export function installHelpers(ctx: Ctx, deps: HelpersDeps) {
  const views = new Map<string, HelperView>();
  /** The floor the helpers showing are on: arriving on another, they're just there, nobody walks in. */
  let floorShown: string | null = null;

  /** The helpers that should show: those of the workers on this floor that are running. */
  function wanted(): Map<string, { parent: WorkerInfo; helper: WorkerHelper }> {
    const out = new Map<string, { parent: WorkerInfo; helper: WorkerHelper }>();
    for (const w of store.workers.values()) {
      if (!w.helpers?.length || isAsleep(w.status)) continue;
      for (const helper of w.helpers) out.set(keyOf(w.id, helper.id), { parent: w, helper });
    }
    return out;
  }

  /** The free desk nearest `near` (a desk id): built, not a board's or the meeting table's, nobody at it, no helper there. */
  function freeDesk(near: string): DeskView | undefined {
    const world = ctx.world();
    const taken = new Set([...views.values()].map((v) => v.deskId));
    const from = world.desks.get(near)?.def;
    let best: DeskView | undefined;
    let bestD = Infinity;
    for (const [id, desk] of world.desks) {
      const d = desk.def;
      if (d.station || d.room || d.beanbag || taken.has(id) || store.workerAtDesk(id) || deps.departures.seated(id) || !seatBuilt(id)) continue;
      const dist = from ? Math.hypot(d.x - from.x, d.z - from.z) : 0;
      if (dist < bestD) {
        bestD = dist;
        best = desk;
      }
    }
    return best;
  }

  function seat(v: HelperView, desk: DeskView, walkIn: boolean) {
    v.deskId = desk.def.id;
    desk.laptopAnchor.add(v.laptop.root);
    noOutline(desk.group);
    desk.chair.rotation.y = 0;
    desk.vacancy.visible = false;
    if (walkIn) deps.arrivals.add(v.model, desk);
    else {
      deps.arrivals.forget(v.model);
      desk.seatAnchor.add(v.model.root);
      v.model.root.position.set(0, 0, 0);
      v.model.root.rotation.set(0, 0, 0);
      v.model.root.scale.setScalar(1);
    }
  }

  function drop(key: string, v: HelperView, walkOut: boolean) {
    deps.arrivals.forget(v.model);
    const desk = ctx.world().desks.get(v.deskId);
    if (walkOut && desk) deps.departures.add(v.model, v.laptop, desk);
    else {
      v.model.root.removeFromParent();
      v.laptop.root.removeFromParent();
      v.model.dispose();
      v.laptop.dispose();
    }
    views.delete(key);
  }

  function sync() {
    const world = ctx.world();
    const arriving = store.floor !== floorShown;
    if (arriving) for (const [key, v] of views) drop(key, v, false);
    floorShown = store.floor;
    const want = wanted();
    // Done: up and off home.
    for (const [key, v] of views) if (!want.has(key)) drop(key, v, true);
    for (const [key, { parent, helper }] of want) {
      let v = views.get(key);
      // Someone was hired at its desk: it moves along to another.
      if (v && store.workerAtDesk(v.deskId)) {
        const next = freeDesk(parent.deskId);
        if (!next) {
          drop(key, v, false);
          continue;
        }
        seat(v, next, false);
      }
      if (!v) {
        const desk = freeDesk(parent.deskId);
        if (!desk) continue; // no free desk: it shows once one is
        const model = new Worker(L.helpers.name(parent.name), parent.color);
        model.setCostume(store.theme.active);
        const laptop = new Laptop(world.device);
        laptop.setPlaceholder(`🤖 ${helper.description}`);
        v = { parentId: parent.id, helper, model, laptop, deskId: desk.def.id };
        views.set(key, v);
        seat(v, desk, !arriving);
        model.setStatus('working', false);
      }
      v.helper = helper;
      v.model.setTask(cardOf(helper));
      v.model.setAction(helper.activity ? 'edit' : undefined);
    }
  }

  store.on('workers', sync);
  ctx.ticks.add('others', ({ dt, t }) => {
    const desks = ctx.world().desks;
    for (const v of views.values()) {
      v.model.update(dt, t);
      v.laptop.update(dt, undefined, Infinity, false);
      // The desk's "+" stays down while a helper's there (the workers' own seating puts it back up).
      const desk = desks.get(v.deskId);
      if (desk) desk.vacancy.visible = false;
    }
  });
}
