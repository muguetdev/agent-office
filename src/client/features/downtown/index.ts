/**
 * Life in the city round the office (world/skyline.ts): the street's own cars (traffic.glb's taxis,
 * police cars, SUVs…) driving round its blocks on the right-hand side of the road, wheels rolling, and
 * stopping for you; and people walking round the blocks close by on the sidewalks. Like the street's
 * traffic, each browser's own, and solid: you bump into them.
 */
import * as THREE from 'three';
import { ROAD } from '../../../shared/layout';
import { randomLook } from '../../../shared/avatar';
import type { Ctx } from '../../core/context';
import { Person } from '../../world/character/person';
import { loadModel, piece } from '../../world/models';
import { DOWNTOWN, isCityBlock } from '../../world/skyline';
import type { Collider } from '../../world/types';
import { KINDS, PAINT } from '../traffic';

const { blockAt, CURB } = DOWNTOWN;
const PERIOD = 56;
/** Each way round: the lane's middle, a quarter of the road in from its middle. */
const LANE = (ROAD.maxZ - ROAD.minZ) / 4;
/** How far from a block's middle the people walk round it: on the sidewalk, clear of the lamps and the trees. */
const WALK_RING = PERIOD / 2 - (ROAD.maxZ - ROAD.minZ) / 2 - 1.8;
/** Within this of you, the people walk (further off they're too far to see). */
const NEAR = 140;
const CAR_LENGTH = 4.3;
const STOP_AT = 7;
const LOOK_AHEAD = 16;
const SHIRTS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#8338ec', '#ffbe0b', '#3a86ff', '#6a994e', '#ef476f', '#264653'];

/** A loop of road: its corners in order, and its length. */
interface Loop {
  pts: THREE.Vector2[];
  length: number;
}

/** The loop round blocks i0…i1 by j0…j1 (the streets round them), or null if they aren't all the city's. */
function around(i0: number, i1: number, j0: number, j1: number, inset = 0): Loop | null {
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (!isCityBlock(blockAt(i, j).x, blockAt(i, j).z)) return null;
  const x0 = blockAt(i0, 0).x - PERIOD / 2 + inset;
  const x1 = blockAt(i1, 0).x + PERIOD / 2 - inset;
  const z0 = blockAt(0, j0).z - PERIOD / 2 + inset;
  const z1 = blockAt(0, j1).z + PERIOD / 2 - inset;
  const pts = [new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z0), new THREE.Vector2(x1, z1), new THREE.Vector2(x0, z1)];
  return { pts, length: 2 * (x1 - x0 + z1 - z0) };
}

/** Where on `loop` (s along it, either way round) and which way it's facing, a car's `right` off its middle. */
function at(loop: Loop, s: number, dir: 1 | -1, right: number, out: { x: number; z: number; rotY: number }) {
  s = ((s % loop.length) + loop.length) % loop.length;
  if (dir < 0) s = loop.length - s;
  const pts = dir > 0 ? loop.pts : [...loop.pts].reverse();
  for (let k = 0; k < 4; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % 4];
    const len = a.distanceTo(b);
    if (s > len && k < 3) {
      s -= len;
      continue;
    }
    const fx = (b.x - a.x) / len;
    const fz = (b.y - a.y) / len;
    // Round the corner: the last few meters turn toward the next side.
    const c = pts[(k + 2) % 4];
    const nx = (c.x - b.x) / b.distanceTo(c);
    const nz = (c.y - b.y) / b.distanceTo(c);
    const turn = Math.max(0, 1 - (len - s) / 4) * 0.5;
    const hx = fx + (nx - fx) * turn;
    const hz = fz + (nz - fz) * turn;
    out.x = a.x + fx * s - hz * right;
    out.z = a.y + fz * s + hx * right;
    out.rotY = Math.atan2(hx, hz);
    return out;
  }
  return out;
}

interface Driver {
  root: THREE.Object3D;
  wheels: THREE.Object3D[];
  radius: number;
  box: Collider;
  loop: Loop;
  dir: 1 | -1;
  s: number;
  cruise: number;
  speed: number;
  pose: { x: number; z: number; rotY: number };
}

interface Walker {
  person: Person;
  box: Collider;
  loop: Loop;
  dir: 1 | -1;
  s: number;
  pace: number;
  pose: { x: number; z: number; rotY: number };
}

export function installDowntown(ctx: Ctx) {
  const group = new THREE.Group();
  group.name = 'downtown';
  group.visible = false;
  ctx.scene.add(group);
  const box = (): Collider => {
    const c: Collider = { minX: 1e9, maxX: 1e9, minZ: 1e9, maxZ: 1e9, top: 0 };
    ctx.office.colliders.push(c);
    return c;
  };

  // The loops the cars go round, each two blocks by two, and the ones the people walk, a block each.
  const roads = [around(-2, -1, -3, -2), around(0, 1, -3, -2), around(2, 3, -3, -2), around(-1, 2, -4, -4), around(5, 5, -1, 1), around(-3, 0, -5, -5)].filter((l): l is Loop => !!l);
  const drivers: Driver[] = [];
  void loadModel('traffic')
    .then(() => {
      roads.forEach((loop, k) => {
        for (let c = 0; c < 3; c++) {
          const kind = KINDS[(k * 3 + c) % KINDS.length];
          const root = piece('traffic', kind, PAINT);
          group.add(root);
          const wheels = ['fl', 'fr', 'rl', 'rr'].map((w) => root.getObjectByName(`${kind}_wheel_${w}`)).filter((w): w is THREE.Object3D => !!w);
          const cruise = 8 + ((k * 5 + c * 3) % 5);
          drivers.push({ root, wheels, radius: wheels[0]?.position.y || 0.3, box: box(), loop, dir: c % 2 ? -1 : 1, s: (c / 3) * loop.length, cruise, speed: cruise, pose: { x: 0, z: 0, rotY: 0 } });
        }
      });
    })
    .catch(() => {});

  const walkers: Walker[] = [];
  for (let i = -3; i <= 3; i++) {
    for (const j of [-2, -3]) {
      const b = blockAt(i, j);
      if (!isCityBlock(b.x, b.z) || Math.hypot(b.x, b.z) > 180) continue;
      const half = WALK_RING;
      const loop: Loop = {
        pts: [new THREE.Vector2(b.x - half, b.z - half), new THREE.Vector2(b.x + half, b.z - half), new THREE.Vector2(b.x + half, b.z + half), new THREE.Vector2(b.x - half, b.z + half)],
        length: 8 * half,
      };
      for (let k = 0; k < 2; k++) {
        const person = new Person('', SHIRTS[(i * 3 + j * 5 + k * 7 + 40) % SHIRTS.length], randomLook());
        person.showLabel(false);
        group.add(person.root);
        walkers.push({ person, box: box(), loop, dir: k ? -1 : 1, s: (k * 0.5 + (i + 3) * 0.13) * loop.length, pace: 1.1 + ((i + j * 3 + k) % 4) * 0.12, pose: { x: 0, z: 0, rotY: 0 } });
      }
    }
  }

  ctx.ticks.add('env', ({ t, dt }) => {
    const here = ctx.inOffice() && !ctx.upTop();
    group.visible = here;
    if (!here) {
      for (const c of [...drivers.map((d) => d.box), ...walkers.map((w) => w.box)]) c.minX = c.maxX = 1e9;
      return;
    }
    const street = ctx.player.street;
    group.position.y = street;
    const me = ctx.player.pos;
    const onFoot = Math.abs(me.y - street - CURB) < 1.6;
    for (const d of drivers) {
      // Slows for you, or the car ahead on its loop, and stops short of either.
      let gap = Infinity;
      const f = d.pose;
      const ahead = (ox: number, oz: number) => {
        const dx = ox - f.x;
        const dz = oz - f.z;
        const along = dx * Math.sin(f.rotY) + dz * Math.cos(f.rotY);
        const side = Math.abs(dx * Math.cos(f.rotY) - dz * Math.sin(f.rotY));
        if (along > 0 && along < LOOK_AHEAD && side < 1.7) gap = Math.min(gap, along);
      };
      if (onFoot) ahead(me.x, me.z);
      for (const o of drivers) if (o !== d) ahead(o.pose.x, o.pose.z);
      const want = gap < STOP_AT ? 0 : gap < LOOK_AHEAD ? (d.cruise * (gap - STOP_AT)) / (LOOK_AHEAD - STOP_AT) : d.cruise;
      d.speed += (want - d.speed) * Math.min(1, dt * (want < d.speed ? 4 : 1.2));
      d.s += d.speed * dt;
      for (const w of d.wheels) w.rotation.x = (w.rotation.x + (d.speed * dt) / d.radius) % (Math.PI * 2);
      at(d.loop, d.s, d.dir, LANE, d.pose);
      d.root.position.set(d.pose.x, 0, d.pose.z);
      d.root.rotation.y = d.pose.rotY;
      const ex = Math.abs(Math.cos(d.pose.rotY)) * 0.95 + Math.abs(Math.sin(d.pose.rotY)) * (CAR_LENGTH / 2);
      const ez = Math.abs(Math.sin(d.pose.rotY)) * 0.95 + Math.abs(Math.cos(d.pose.rotY)) * (CAR_LENGTH / 2);
      Object.assign(d.box, { minX: d.pose.x - ex, maxX: d.pose.x + ex, minZ: d.pose.z - ez, maxZ: d.pose.z + ez, bottom: street, top: street + 1.4 });
    }
    for (const w of walkers) {
      const near = Math.hypot(w.pose.x - me.x, w.pose.z - me.z) < NEAR;
      w.person.root.visible = near;
      if (!near) {
        w.box.minX = w.box.maxX = 1e9;
        w.s += w.pace * dt;
        at(w.loop, w.s, w.dir, 0, w.pose);
        continue;
      }
      // Stops for you in their way.
      const fx = Math.sin(w.pose.rotY);
      const fz = Math.cos(w.pose.rotY);
      const dx = me.x - w.pose.x;
      const dz = me.z - w.pose.z;
      const blocked = onFoot && dx * fx + dz * fz > 0 && dx * fx + dz * fz < 1.4 && Math.abs(dx * fz - dz * fx) < 0.8;
      if (!blocked) w.s += w.pace * dt;
      at(w.loop, w.s, w.dir, 0, w.pose);
      w.person.root.position.set(w.pose.x, CURB, w.pose.z);
      w.person.root.rotation.y = w.pose.rotY;
      Object.assign(w.box, { minX: w.pose.x - 0.25, maxX: w.pose.x + 0.25, minZ: w.pose.z - 0.25, maxZ: w.pose.z + 0.25, bottom: street, top: street + 1.8 });
      w.person.update(dt, t, !blocked, false, w.pace / 1.3);
    }
  });
}
