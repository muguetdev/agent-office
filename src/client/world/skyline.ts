import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STREET_Y } from '../../shared/layout';
import { mulberry32 } from '../../shared/rng';
import { PERIOD, ROAD, STREET_X, STREET_Z, WALK, buildLots, glowTexture, groundTexture, layBlocks, painter } from './city-blocks';
import type { Fixture, StreetSite } from './office/fixture';
import { toon } from './toon';

// The city round the office's street (the rooftop bar's city, city.ts, is the same kind, from the same
// blocks): blocks of buildings out to the haze wherever the street's own world leaves room for them.
// That's behind the office, past the neighbours out back, with downtown's towers off to the north-east,
// and east of the scenic loop's pines; never over the street, the neighbours, the loop and what's
// along it (the farm, the lake, the mountains, the beach), or the sea. Its streets have lamps that
// glow at night and cars going up and down them; the buildings' windows light up with the
// neighbours'. You can walk out to it, and its buildings stop you.

const G = STREET_Y;
/** How far out it goes: past this the haze has it anyway. */
const RADIUS = 330;
/** Its edges: the street behind the office's (z), the one east of the pines (x), and clear of the coast to the west (x). */
const NORTH = STREET_Z - 2 * PERIOD;
const EAST = STREET_X + 4 * PERIOD;
const WEST = STREET_X - 4 * PERIOD;
/** A street's half, sidewalks included. */
const HALF = ROAD / 2 + WALK;

/** Whether the block with its middle at (x, z) is the city's. */
const isCity = (x: number, z: number) => (z < NORTH || x > EAST) && x > WEST && Math.hypot(x, z) <= RADIUS;
/** Whether (x, z) is on the city's ground: its blocks and the streets round them. */
const onGround = (x: number, z: number) => (z < NORTH + HALF ? x > WEST - HALF : x > EAST - HALF) && Math.hypot(x, z) <= RADIUS + PERIOD / 2;

/** The streets and blocks as a plane `[x0, x1] × [z0, z1]`, its texture lined up with the city's grid. */
function ground(x0: number, x1: number, z0: number, z1: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, G - 0.006, (z0 + z1) / 2);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - STREET_X) / PERIOD + 0.5, (pos.getZ(i) - STREET_Z) / PERIOD + 0.5);
  return new THREE.Mesh(geo, mat);
}

interface Car {
  alongX: boolean;
  lane: number;
  dir: number;
  at: number;
  speed: number;
  /** The stretch of its street that's the city's. */
  from: number;
  to: number;
}

/** The city round the street (see above): built once, down on the street, its cars driving each frame. */
export const skyline: Fixture<never, StreetSite> = (site) => {
  const night = site.get('night');
  const group = new THREE.Group();
  // Its own numbers, the same every time, so everyone sees the same city.
  const r = mulberry32(20261007);
  const n = Math.ceil(RADIUS / PERIOD) + 1;

  const groundMat = new THREE.MeshToonMaterial({ map: groundTexture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  group.add(ground(WEST - HALF, RADIUS + PERIOD / 2, -RADIUS - PERIOD / 2, NORTH + HALF, groundMat));
  group.add(ground(EAST - HALF, RADIUS + PERIOD / 2, NORTH + HALF, RADIUS * 0.75, groundMat));

  // The blocks, and their buildings, as tall as they were laid out (round a roof six floors up).
  const { lots, parks } = layBlocks(r, n, (_i, _j, x, z) => isCity(x, z));
  parks.position.y = G;
  group.add(parks);
  const built = buildLots(lots, () => 1, painter(night));
  for (const m of built.meshes) {
    m.position.y = G;
    group.add(m);
  }
  // Solid: you stop at their walls.
  for (const lot of lots) {
    const h = lot.h + (lot.step?.up ?? 0);
    site.groundColliders.push({ minX: lot.x - lot.w / 2, maxX: lot.x + lot.w / 2, minZ: lot.z - lot.d / 2, maxZ: lot.z + lot.d / 2, bottom: G, top: G + h });
  }

  // Lamps down both sides of its streets, glowing at night, and the masts' red lights.
  const glow = glowTexture();
  const lampAt: number[] = [];
  for (let k = -n; k <= n; k++) {
    for (let a = -RADIUS; a <= RADIUS; a += 28) {
      for (const s of [-1, 1]) {
        const off = s * (ROAD / 2 + 0.6);
        const sx = STREET_X + k * PERIOD;
        const sz = STREET_Z + k * PERIOD;
        if (onGround(sx + off, a) && Math.hypot(sx, a) < RADIUS) lampAt.push(sx + off, G + 5, a);
        if (onGround(a, sz + off) && Math.hypot(a, sz) < RADIUS) lampAt.push(a, G + 5, sz + off);
      }
    }
  }
  const points = (at: number[], size: number, color: string, max: number) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(at, 3));
    const mat = new THREE.PointsMaterial({ size, map: glow, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    night.glows.push({ mat, max });
    group.add(new THREE.Points(geo, mat));
  };
  points(lampAt, 4, '#ffcf8a', 1);
  points(
    built.beacons.map((v, i) => (i % 3 === 1 ? v + G : v)),
    5,
    '#ff3b30',
    0.9,
  );

  // Cars up and down its streets, each on the stretch of its street that's the city's.
  const cars: Car[] = [];
  const lane = (alongX: boolean, line: number, from: number, to: number) => {
    for (let k = 0; k < 4; k++) {
      const dir = k % 2 ? 1 : -1;
      cars.push({ alongX, lane: line + dir * (ROAD / 4) * (alongX ? 1 : -1), dir, at: from + r() * (to - from), speed: 9 + r() * 6, from, to });
    }
  };
  for (let j = 2; j <= 4; j++) lane(true, STREET_Z - j * PERIOD, WEST, Math.sqrt(RADIUS ** 2 - (STREET_Z - j * PERIOD) ** 2));
  for (let i = -3; i <= 3; i++) lane(false, STREET_X + i * PERIOD, -Math.sqrt(RADIUS ** 2 - (STREET_X + i * PERIOD) ** 2), NORTH);
  const east = STREET_X + 5 * PERIOD;
  lane(false, east, -Math.sqrt(RADIUS ** 2 - east ** 2), Math.sqrt(RADIUS ** 2 - east ** 2) * 0.7);
  const body = mergeGeometries([new THREE.BoxGeometry(4.2, 1.05, 1.9).translate(0, 0.9, 0), new THREE.BoxGeometry(2.2, 0.7, 1.7).translate(-0.3, 1.75, 0)]);
  const carMesh = new THREE.InstancedMesh(body, toon('#ffffff'), cars.length);
  const paints = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de', '#3d405b', '#e07a5f', '#8ecae6'];
  cars.forEach((_, i) => carMesh.setColorAt(i, new THREE.Color(paints[Math.floor(r() * paints.length)])));
  carMesh.frustumCulled = false;
  group.add(carMesh);
  const place = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const move = (dt: number) => {
    cars.forEach((c, i) => {
      c.at += c.dir * c.speed * dt;
      const span = c.to - c.from;
      if (c.at > c.to) c.at -= span;
      if (c.at < c.from) c.at += span;
      if (c.alongX) at.set(c.at, G, c.lane);
      else at.set(c.lane, G, c.at);
      // The car's nose is +x: turned to face the way it's going.
      q.setFromAxisAngle(up, c.alongX ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      carMesh.setMatrixAt(i, place.compose(at, q, one));
    });
    carMesh.instanceMatrix.needsUpdate = true;
  };
  move(0);

  site.ground.add(group);
  return { update: (_t, dt) => move(dt) };
};
