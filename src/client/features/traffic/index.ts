/**
 * Life on the street: cars driving round the street and the scenic loop by themselves (a police car, a
 * taxi, an SUV, everyday cars), each on its side of the road, slowing behind one another and stopping
 * for you, your car or anyone's; and people walking up and down both sidewalks, who stop for you too.
 * Only for show, and each browser's own: nobody else sees the same car in the same place.
 */
import * as THREE from 'three';
import type { CarPose } from '../../../shared/garage';
import { ROAD } from '../../../shared/layout';
import { CIRCUIT_LENGTH, onCircuit } from '../../../shared/traffic';
import { randomLook } from '../../../shared/avatar';
import type { Ctx } from '../../core/context';
import { loadModel, palette, piece } from '../../world/models';
import { Person } from '../../world/character/person';

export interface TrafficDeps {
  /** The car you're in, as it's going; null on foot. */
  myCar(): CarPose | null;
}

/** traffic.glb's cars (see blender/scripts/build_traffic.py), and the colors of their parts. */
const KINDS = ['police', 'taxi', 'suv', 'car', 'hatch'] as const;
const PAINT = palette({
  TBlack: '#1d1f24',
  TWhite: '#f1f3f5',
  TGrey: '#8d939b',
  TWindows: '#233347',
  THeadlights: '#fff6c9',
  TTailLights: '#ff2d3f',
  TBlueLights: '#2d7bff',
  TWhiteLights: '#ffffff',
  TYellow: '#ffd23f',
  TBlue: '#3a6ea5',
  TLightBlue: '#c7d3dc',
  TTrim: '#4a4f57',
});

/** Which car, which way round, where it starts and how fast it likes to go (m/s): spread round the circuit. */
const FLEET: { kind: (typeof KINDS)[number]; dir: 1 | -1; at: number; speed: number }[] = [
  { kind: 'taxi', dir: 1, at: 0.02, speed: 11 },
  { kind: 'police', dir: -1, at: 0.1, speed: 13 },
  { kind: 'car', dir: 1, at: 0.25, speed: 10 },
  { kind: 'suv', dir: -1, at: 0.35, speed: 11.5 },
  { kind: 'hatch', dir: 1, at: 0.5, speed: 9.5 },
  { kind: 'taxi', dir: -1, at: 0.6, speed: 10.5 },
  { kind: 'car', dir: 1, at: 0.75, speed: 12 },
  { kind: 'suv', dir: -1, at: 0.85, speed: 10 },
];

/** The sidewalks' walking lines (z), clear of the trees and the lamp posts, and how far along them people go (x). */
const WALKS = [ROAD.minZ - 0.35, ROAD.maxZ + 0.3];
const WALK_X = 70;
const SHIRTS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#8338ec', '#ffbe0b', '#3a86ff', '#6a994e', '#ef476f', '#264653'];

interface Driver {
  root: THREE.Object3D;
  dir: 1 | -1;
  s: number;
  cruise: number;
  speed: number;
}

interface Walker {
  person: Person;
  z: number;
  x: number;
  dir: 1 | -1;
  pace: number;
}

/** How close something ahead stops a car (m), and the slowest it creeps along behind another. */
const STOP_AT = 7;
const LOOK_AHEAD = 16;

export function installTraffic(ctx: Ctx, deps: TrafficDeps) {
  const group = new THREE.Group();
  group.visible = false;
  ctx.scene.add(group);
  const drivers: Driver[] = [];
  const walkers: Walker[] = [];

  void loadModel('traffic')
    .then(() => {
      for (const f of FLEET) {
        const root = piece('traffic', f.kind, PAINT);
        group.add(root);
        drivers.push({ root, dir: f.dir, s: f.at * CIRCUIT_LENGTH, cruise: f.speed, speed: f.speed });
      }
    })
    .catch(() => {});
  WALKS.forEach((z, side) => {
    for (let i = 0; i < 5; i++) {
      const person = new Person('', SHIRTS[(i * 3 + side * 5) % SHIRTS.length], randomLook());
      person.showLabel(false);
      group.add(person.root);
      walkers.push({ person, z: z + (i % 2 ? 0.35 : -0.35), x: -WALK_X + ((i * 2 + side) / 10) * WALK_X * 2, dir: i % 2 ? 1 : -1, pace: 1.1 + ((i * 7 + side * 3) % 5) * 0.1 });
    }
  });

  /** Is something within the box ahead of a car facing `rotY` from (x, z): returns how far ahead, or Infinity. */
  const ahead = (x: number, z: number, rotY: number, ox: number, oz: number) => {
    const dx = ox - x;
    const dz = oz - z;
    const f = dx * Math.sin(rotY) + dz * Math.cos(rotY);
    const l = Math.abs(dx * Math.cos(rotY) - dz * Math.sin(rotY));
    return f > 0 && f < LOOK_AHEAD && l < 1.7 ? f : Infinity;
  };

  ctx.ticks.add('env', ({ t, dt }) => {
    const here = ctx.inOffice() && !ctx.upTop();
    group.visible = here;
    if (!here) return;
    const street = ctx.player.street;
    group.position.y = street;
    // What a car stops for: you on foot down at the street, the car you're in, the garage's cars, and the people walking.
    const me = ctx.player.pos;
    const mine = deps.myCar();
    const obstacles: { x: number; z: number }[] = [];
    if (mine) obstacles.push(mine);
    else if (Math.abs(me.y - street) < 1.5) obstacles.push(me);
    for (const v of ctx.office.cars.cars) obstacles.push(v.pose);
    const poses = drivers.map((d) => onCircuit(d.s, d.dir));
    drivers.forEach((d, i) => {
      const p = poses[i];
      let gap = Infinity;
      for (const o of obstacles) gap = Math.min(gap, ahead(p.x, p.z, p.rotY, o.x, o.z));
      poses.forEach((q, j) => j !== i && (gap = Math.min(gap, ahead(p.x, p.z, p.rotY, q.x, q.z))));
      const want = gap < STOP_AT ? 0 : gap < LOOK_AHEAD ? (d.cruise * (gap - STOP_AT)) / (LOOK_AHEAD - STOP_AT) : d.cruise;
      // Brakes harder than it pulls away.
      d.speed += (want - d.speed) * Math.min(1, dt * (want < d.speed ? 4 : 1.2));
      d.s += d.dir * d.speed * dt;
      const now = onCircuit(d.s, d.dir);
      d.root.position.set(now.x, 0, now.z);
      d.root.rotation.y = now.rotY;
    });
    for (const w of walkers) {
      // Turns round at the ends of its stretch; stops for you (on foot) in its way.
      if (Math.abs(w.x) > WALK_X) w.dir = w.x > 0 ? -1 : 1;
      const blocked = !mine && Math.abs(me.y - street) < 1.5 && Math.abs(me.z - w.z) < 0.9 && (me.x - w.x) * w.dir > 0 && (me.x - w.x) * w.dir < 1.4;
      if (!blocked) w.x += w.dir * w.pace * dt;
      w.person.root.position.set(w.x, 0, w.z);
      w.person.root.rotation.y = w.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      w.person.update(dt, t, !blocked, false, w.pace / 1.3);
    }
  });
}
