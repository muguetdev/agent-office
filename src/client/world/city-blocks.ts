import * as THREE from 'three';
import { CITY_ROAD as ROAD, CITY_WALK as WALK, PERIOD, STREET_X, STREET_Z, blockAt } from '../../shared/city';
import { roofDrop } from '../../shared/layout';
import { mulberry32 } from '../../shared/rng';
import type { NightParts } from './outside';
import { tilingCanvasTexture } from './texture';
import { mergeByMaterial, mesh, toon } from './toon';

// City blocks, for the city round the rooftop bar (city.ts) and the one round the office's street
// (skyline.ts): a grid of streets and blocks, the blocks split into lots with a building on each (or
// now and then a park), the buildings' painted walls with their windows lit at night, and what stands
// on their roofs. All from a handful of shared materials, merged into a few meshes.

/** The city grid's (shared/city.ts), for the roof's city and the street's. */
export { PERIOD, ROAD, STREET_X, STREET_Z, WALK, blockAt };
/** One storey, and one bay of windows, in meters. */
export const STOREY = 3.3;
export const BAY = 2.8;
/** How far down the street was from the roof the neighbours' heights were picked for: six floors. */
export const LAID_OUT = roofDrop(6);


/** How a building's walls look: its paint, and the windows in it (glass towers are nearly all window). */
export interface Paint {
  wall: string;
  glass: string;
  /** The window's share of a bay across and of a storey up. */
  wide: number;
  tall: number;
}

export const PAINTS: Paint[] = [
  { wall: '#d9a27e', glass: '#a9d6f5', wide: 0.5, tall: 0.55 },
  { wall: '#c96f5a', glass: '#b8e0f7', wide: 0.45, tall: 0.55 },
  { wall: '#e9dcc3', glass: '#9cc9ea', wide: 0.55, tall: 0.6 },
  { wall: '#b9c0c9', glass: '#bfe3ff', wide: 0.6, tall: 0.55 },
  { wall: '#a7c4d9', glass: '#e6f4ff', wide: 0.5, tall: 0.6 },
  { wall: '#e8b4b8', glass: '#bfe3ff', wide: 0.5, tall: 0.55 },
  { wall: '#f1e3b3', glass: '#a9d6f5', wide: 0.45, tall: 0.5 },
  // Glass towers.
  { wall: '#4f6d8a', glass: '#7fb8d8', wide: 0.9, tall: 0.82 },
  { wall: '#3e7c7c', glass: '#8fd3d0', wide: 0.9, tall: 0.82 },
];
export const GLASS_TOWERS = [7, 8];

/** One bay of one storey: the wall with a window in it. */
export function bayTexture(p: Paint): THREE.CanvasTexture {
  const S = 64;
  return tilingCanvasTexture(S, S, (g) => {
    g.fillStyle = p.wall;
    g.fillRect(0, 0, S, S);
    const w = S * p.wide;
    const h = S * p.tall;
    const x = (S - w) / 2;
    const y = S * 0.18;
    g.fillStyle = p.glass;
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(x + w * 0.12, y, w * 0.1, h);
    // A sill under it.
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(x - 2, y + h, w + 4, 3);
  });
}

/** Which windows are lit at night: 16 × 16 bays of them, each building showing a different part. */
export function litTexture(p: Paint, seed: number): THREE.CanvasTexture {
  const N = 16;
  const C = 16;
  const r = mulberry32(seed);
  return tilingCanvasTexture(N * C, N * C, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, N * C, N * C);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (r() < 0.5) continue;
        const k = r();
        g.fillStyle = k < 0.12 ? '#9ec9ff' : k < 0.55 ? '#ffd27a' : '#ffe6b0';
        const w = C * p.wide;
        const h = C * p.tall;
        g.fillRect(i * C + (C - w) / 2, j * C + C * 0.18, w, h);
      }
    }
  });
}

/** Wall faces piling up for one material, to be one mesh. */
export class Walls {
  pos: number[] = [];
  norm: number[] = [];
  uv: number[] = [];
  index: number[] = [];

  /** A quad from its bottom-left corner `a` along `u` (across) and up `h`, facing `n`; `uv` is [u0, v0, u1, v1]. */
  quad(a: [number, number, number], u: [number, number, number], h: number, n: [number, number, number], uv: [number, number, number, number]) {
    const i = this.pos.length / 3;
    const [x, y, z] = a;
    const up: [number, number, number] = n[1] === 1 ? [0, 0, -h] : [0, h, 0];
    this.pos.push(x, y, z, x + u[0], y + u[1], z + u[2], x + u[0] + up[0], y + u[1] + up[1], z + u[2] + up[2], x + up[0], y + up[1], z + up[2]);
    for (let k = 0; k < 4; k++) this.norm.push(...n);
    const [u0, v0, u1, v1] = uv;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** The four walls of a box from y0 to y1, windows a bay across and a storey up, lit windows from (ou, ov) of the pattern. */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, ou: number, ov: number) {
    const hw = w / 2;
    const hd = d / 2;
    const floors = Math.max(1, Math.round((y1 - y0) / STOREY));
    const h = y1 - y0;
    const across = (span: number) => Math.max(1, Math.round(span / BAY));
    const cw = across(w);
    const cd = across(d);
    this.quad([cx - hw, y0, cz + hd], [w, 0, 0], h, [0, 0, 1], [ou, ov, ou + cw, ov + floors]);
    this.quad([cx + hw, y0, cz - hd], [-w, 0, 0], h, [0, 0, -1], [ou + 3, ov, ou + 3 + cw, ov + floors]);
    this.quad([cx + hw, y0, cz + hd], [0, 0, -d], h, [1, 0, 0], [ou + 7, ov, ou + 7 + cd, ov + floors]);
    this.quad([cx - hw, y0, cz - hd], [0, 0, d], h, [-1, 0, 0], [ou + 11, ov, ou + 11 + cd, ov + floors]);
  }

  /** A flat top at y. */
  top(cx: number, cz: number, w: number, d: number, y: number) {
    this.quad([cx - w / 2, y, cz + d / 2], [w, 0, 0], d, [0, 1, 0], [0, 0, 1, 1]);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** The streets and blocks, a block at a time: roads, sidewalks, crossings and the lane markings. */
export function groundTexture(): THREE.CanvasTexture {
  const S = 512;
  const px = S / PERIOD;
  return tilingCanvasTexture(S, S, (g) => {
    g.fillStyle = '#b3aea4';
    g.fillRect(0, 0, S, S);
    const mid = S / 2;
    const road = ROAD * px;
    const walk = (ROAD + WALK * 2) * px;
    g.fillStyle = '#d9d3c5';
    g.fillRect(mid - walk / 2, 0, walk, S);
    g.fillRect(0, mid - walk / 2, S, walk);
    g.fillStyle = '#4b505c';
    g.fillRect(mid - road / 2, 0, road, S);
    g.fillRect(0, mid - road / 2, S, road);
    // Dashed yellow down the middle of each road, stopping short of the crossing.
    g.fillStyle = '#ffd166';
    for (let i = 0; i < S; i += 24) {
      if (Math.abs(i + 6 - mid) < walk * 0.9) continue;
      g.fillRect(mid - 1.5, i, 3, 12);
      g.fillRect(i, mid - 1.5, 12, 3);
    }
    // Zebra crossings round the intersection.
    g.fillStyle = '#f1f1f1';
    for (let k = -road / 2 + 3; k < road / 2 - 3; k += 7) {
      for (const s of [-1, 1]) {
        g.fillRect(mid + k, mid + s * (walk / 2 + 2) - (s < 0 ? 16 : 0), 4, 16);
        g.fillRect(mid + s * (walk / 2 + 2) - (s < 0 ? 16 : 0), mid + k, 16, 4);
      }
    }
  });
}

export function tree(r: () => number): THREE.Group {
  const t = new THREE.Group();
  const s = 0.8 + r() * 0.7;
  t.add(mesh(new THREE.CylinderGeometry(0.25 * s, 0.32 * s, 2.4 * s, 6), toon('#8a5a3b'), 0, 1.2 * s, 0, false));
  t.add(mesh(new THREE.SphereGeometry(1.9 * s, 8, 6), toon(r() < 0.5 ? '#5fb760' : '#4ea657'), 0, 3.4 * s, 0, false));
  return t;
}

/** Soft round blob, for lamps seen from far off. */
export function glowTexture(): THREE.CanvasTexture {
  return tilingCanvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

/**
 * A building on a lot, as it was laid out round a roof LAID_OUT up. How much of that height it
 * stands depends on how far out it is (`ring`: close by, further out, or on the skyline) and on how
 * tall the office's building is (see rise).
 */
export interface Lot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  paint: number;
  /** Where its lit windows start in the pattern. */
  ou: number;
  ov: number;
  ring: 0 | 1 | 2;
  /** Tall ones step back on the way up: the top part's footprint, and how much taller it goes. */
  step?: { w: number; d: number; up: number };
  /** On its roof: a mast with a red light, a water tower, or a box of air conditioning. */
  top?: { kind: 'mast' } | { kind: 'tank'; x: number; z: number } | { kind: 'plant'; x: number; z: number; w: number; d: number };
}

/**
 * How much of its laid-out height a building in `ring` stands with the street `drop` below the roof.
 * Close by they come down with the roof, to stay under it; further out a bit less, and the skyline
 * stays the skyline. Up to six floors, where they were laid out; no taller past that.
 */
export function rise(ring: number, drop: number): number {
  const k = Math.min(1, drop / LAID_OUT);
  return ring === 0 ? k : ring === 1 ? Math.sqrt(k) : 1;
}

/** The parks laid out with the lots: their lawns and trees, merged, and the lots they took. */
export interface Blocks {
  lots: Lot[];
  parks: THREE.Group;
}

/** A block's own ground inside its sidewalks. */
export const INNER = PERIOD - ROAD - WALK * 2;

/**
 * Lays out the blocks out to `n` either way that `take` takes (by block, its middle and how far that is
 * from the origin): parks now and then, the rest split into lots, each with a building whose height
 * goes with how far out it is, tallest downtown (`downtown`, off to the north-east).
 */
export function layBlocks(r: () => number, n: number, take: (i: number, j: number, x: number, z: number, dist: number) => boolean, downtown = { x: 210, z: -220 }): Blocks {
  const lots: Lot[] = [];
  const parks = new THREE.Group();
  const inner = INNER;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const { x: bx, z: bz } = blockAt(i, j);
      const dist = Math.hypot(bx, bz);
      if (!take(i, j, bx, bz, dist)) continue;
      // Now and then a park, with trees.
      if (r() < 0.1 && dist > 60) {
        const park = mesh(new THREE.PlaneGeometry(inner, inner).rotateX(-Math.PI / 2), toon('#8fcf7a'), bx, 0.03, bz, false);
        parks.add(park);
        for (let k = 0; k < 7; k++) {
          const t = tree(r);
          t.position.set(bx + (r() - 0.5) * (inner - 6), 0, bz + (r() - 0.5) * (inner - 6));
          parks.add(t);
        }
        continue;
      }
      // The block split into lots: one big one, two halves or four quarters.
      const split = r();
      const plots: [number, number, number, number][] = [];
      const gap = 2;
      if (split < 0.25) plots.push([bx, bz, inner, inner]);
      else if (split < 0.6) {
        const w = (inner - gap) / 2;
        const alongX = r() < 0.5;
        for (const s of [-1, 1]) plots.push(alongX ? [bx + (s * (w + gap)) / 2, bz, w, inner] : [bx, bz + (s * (w + gap)) / 2, inner, w]);
      } else {
        const w = (inner - gap) / 2;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) plots.push([bx + (sx * (w + gap)) / 2, bz + (sz * (w + gap)) / 2, w, w]);
      }
      // Lower than the roof round about, so you see out over them; taller further out, and tallest
      // downtown, where the skyline is.
      const down = Math.max(0, 1 - Math.hypot(bx - downtown.x, bz - downtown.z) / 150);
      for (const [lx, lz, lw, ld] of plots) {
        const back = 1 + r() * 3;
        const w = lw - back * 2;
        const d = ld - back * 2;
        if (w < 6 || d < 6) continue;
        let h: number;
        if (dist < 100) h = 9 + r() * 24 + (r() < 0.1 ? 8 : 0);
        else if (dist < 190) h = r() < 0.1 ? 50 + r() * 40 : 12 + r() * 28;
        else h = r() < 0.2 ? 65 + r() * 95 : 20 + r() * 30;
        h *= 1 + down * 1.3;
        const glassy = h > 70 && r() < 0.6;
        const paint = glassy ? GLASS_TOWERS[Math.floor(r() * GLASS_TOWERS.length)] : Math.floor(r() * 7);
        const lot: Lot = { x: lx, z: lz, w, d, h, paint, ou: Math.floor(r() * 16), ov: Math.floor(r() * 16), ring: dist < 100 ? 0 : dist < 190 ? 1 : 2 };
        let tall = h;
        let tw = w;
        let td = d;
        // Tall ones step back once on the way up.
        if (h > 55 && r() < 0.6) {
          tw = w * (0.55 + r() * 0.25);
          td = d * (0.55 + r() * 0.25);
          lot.step = { w: tw, d: td, up: 12 + r() * h * 0.5 };
          tall += lot.step.up;
        }
        // On the roof: a water tower, a box of air conditioning, or a mast with a red light.
        const what = r();
        if (tall > 90) lot.top = { kind: 'mast' };
        else if (what < 0.3) lot.top = { kind: 'tank', x: lx + (r() - 0.5) * tw * 0.4, z: lz + (r() - 0.5) * td * 0.4 };
        else if (what < 0.65) {
          const pw = 3 + r() * 3;
          const pd = 2 + r() * 2;
          lot.top = { kind: 'plant', w: pw, d: pd, x: lx + (r() - 0.5) * tw * 0.4, z: lz + (r() - 0.5) * td * 0.4 };
        }
        lots.push(lot);
      }
    }
  }
  return { lots, parks };
}

/** The buildings' paints, a material each (their windows lit at night along with the neighbours'), shared by a city's buildings. */
export function painter(night: NightParts): (paint: number) => THREE.MeshToonMaterial {
  const gradient = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  const mats = new Map<number, THREE.MeshToonMaterial>();
  return (i) => {
    let m = mats.get(i);
    if (!m) {
      const p = PAINTS[i];
      const lit = litTexture(p, i + 1);
      lit.repeat.set(1 / 16, 1 / 16);
      m = new THREE.MeshToonMaterial({ map: bayTexture(p), emissive: '#ffffff', emissiveMap: lit, emissiveIntensity: 0, gradientMap: gradient });
      night.windows.push(m);
      mats.set(i, m);
    }
    return m;
  };
}

const mastGeo = new THREE.CylinderGeometry(0.2, 0.35, 12, 6);
const legGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5);
const tankGeo = new THREE.CylinderGeometry(1.6, 1.6, 3.2, 12);
const capGeo = new THREE.ConeGeometry(1.8, 1.3, 12);
const unitGeo = new THREE.BoxGeometry(1, 1.6, 1);

/**
 * The lots' buildings, each `scale(lot)` of its laid-out height: their walls a mesh per paint, their
 * roofs, and what's on them; and where the masts' red lights go.
 */
export function buildLots(lots: Lot[], scale: (lot: Lot) => number, paintOf: (paint: number) => THREE.Material): { meshes: THREE.Object3D[]; beacons: number[] } {
  const walls = new Map<number, Walls>();
  const tops = new Walls();
  const extras = new THREE.Group();
  const beacons: number[] = [];
  for (const lot of lots) {
    const k = scale(lot);
    let bucket = walls.get(lot.paint);
    if (!bucket) walls.set(lot.paint, (bucket = new Walls()));
    let topY = lot.h * k;
    bucket.box(lot.x, lot.z, lot.w, lot.d, 0, topY, lot.ou, lot.ov);
    let tw = lot.w;
    let td = lot.d;
    if (lot.step) {
      tops.top(lot.x, lot.z, lot.w, lot.d, topY);
      tw = lot.step.w;
      td = lot.step.d;
      bucket.box(lot.x, lot.z, tw, td, topY, topY + lot.step.up * k, lot.ou + 5, lot.ov + 3);
      topY += lot.step.up * k;
    }
    tops.top(lot.x, lot.z, tw, td, topY);
    const top = lot.top;
    if (top?.kind === 'mast') {
      extras.add(mesh(mastGeo, toon('#8d99ae'), lot.x, topY + 6, lot.z, false));
      beacons.push(lot.x, topY + 12.3, lot.z);
    } else if (top?.kind === 'tank') {
      const wt = new THREE.Group();
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        wt.add(mesh(legGeo, toon('#5b3a29'), sx * 1.1, 1.2, sz * 1.1, false));
      wt.add(mesh(tankGeo, toon('#9c6b4a'), 0, 4, 0, false));
      wt.add(mesh(capGeo, toon('#6b4a35'), 0, 6.25, 0, false));
      wt.position.set(top.x, topY, top.z);
      extras.add(wt);
    } else if (top?.kind === 'plant') {
      const unit = mesh(unitGeo, toon('#c9ccd4'), top.x, topY + 0.8, top.z, false);
      unit.scale.set(top.w, 1, top.d);
      extras.add(unit);
    }
  }
  const meshes: THREE.Object3D[] = [];
  for (const [paint, w] of walls) meshes.push(new THREE.Mesh(w.geometry(), paintOf(paint)));
  meshes.push(new THREE.Mesh(tops.geometry(), toon('#a19d97')), mergeByMaterial(extras));
  return { meshes, beacons };
}
