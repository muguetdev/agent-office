import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STREET_Y } from '../../shared/layout';
import { mulberry32 } from '../../shared/rng';
import { CITY_EAST, CITY_LINKS, CITY_NORTH, CITY_RADIUS, CITY_ROAD as ROAD, CITY_WALK as WALK, PERIOD, isCityBlock } from '../../shared/city';
import { STOREY, Walls, layBlocks, type Lot } from './city-blocks';
import type { Fixture, StreetSite } from './office/fixture';
import { bulb, roadTexture, tree, type NightParts } from './outside';
import { tilingCanvasTexture } from './texture';
import { mergeByMaterial, mesh, toon } from './toon';

// The city round the office's street, in the street's own style: roads like the one out front (asphalt,
// white edges, a dashed yellow middle) between raised sidewalks, street lamps and trees along them, and
// on the blocks buildings like the neighbours (pastel paint, rows of pale blue windows, a white cap on
// the roof), the ones close by with shops along the bottom under striped awnings. It's wherever the
// street's world leaves room: behind the office past the neighbours out back, with downtown's towers
// off to the north-east, and east of the scenic loop's pines; never over the street, the loop and
// what's along it, or the sea. Cars and people go round its blocks (features/downtown).

const G = STREET_Y;
const RADIUS = CITY_RADIUS;
/** A street's half, sidewalks included, and how high the sidewalks stand. */
const HALF = ROAD / 2 + WALK;
const CURB = 0.12;
/** A block's sidewalk all round it, and how round its corners are. */
const BLOCK = PERIOD - ROAD;
const CORNER = 4;
/** The zebra crossings across each end of a street, how far along it they reach. */
const ZEBRA = 3;
/** Closer than this, buildings get shops along the bottom, the streets lamps and trees. */
const NEAR = 200;

/** The city's layout, for what goes round it (features/downtown): how high its sidewalks stand. */
export const DOWNTOWN = { CURB } as const;

/** The neighbours' kind of paint: walls, and their windows (see outside.ts building). */
const PAINTS = ['#8ecae6', '#ffb4a2', '#cdb4db', '#ffd6a5', '#a2d2ff', '#f4acb7', '#ffe5b4', '#bde0fe', '#e9c46a', '#b8c0c8', '#f6bd60', '#c9e4de'];
const AWNINGS = ['#e63946', '#2a9d8f', '#f4a261', '#3a86ff', '#ef476f', '#6a994e'];

/** One bay of a storey, the neighbours' way: the wall, a pale blue window with a glint down its side. */
function bayTexture(wall: string): THREE.CanvasTexture {
  return tilingCanvasTexture(64, 64, (c) => {
    c.fillStyle = wall;
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#bfe3ff';
    c.fillRect(16, 17, 32, 30);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(16, 17, 8, 30);
  });
}

/** The shops' storey, a bay at a time: a big window, its frame, and a door now and then. */
function shopTexture(wall: string): THREE.CanvasTexture {
  return tilingCanvasTexture(128, 64, (c) => {
    c.fillStyle = wall;
    c.fillRect(0, 0, 128, 64);
    c.fillStyle = '#3d405b';
    c.fillRect(6, 10, 116, 54);
    c.fillStyle = '#9fd3f0';
    c.fillRect(10, 14, 70, 50);
    c.fillStyle = '#7fa8c4';
    c.fillRect(86, 14, 32, 50);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(10, 14, 14, 50);
  });
}

/** Which windows are lit at night, 16 × 16 bays of them (each building shows a different part). */
function litTexture(seed: number, shop = false): THREE.CanvasTexture {
  const r = mulberry32(seed);
  const N = 16;
  const C = 16;
  return tilingCanvasTexture(N * C * (shop ? 2 : 1), N * C, (c) => {
    c.fillStyle = '#000000';
    c.fillRect(0, 0, N * C * 2, N * C);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (!shop && r() < 0.5) continue;
        const k = r();
        c.fillStyle = shop ? '#ffe6b0' : k < 0.12 ? '#9ec9ff' : k < 0.55 ? '#ffd27a' : '#ffe6b0';
        if (shop) c.fillRect(i * C * 2 + 3, j * C + 4, C * 2 - 6, C - 4);
        else c.fillRect(i * C + C / 4, j * C + (17 / 64) * C, C / 2, (30 / 64) * C);
      }
    }
  });
}

/** A lit-at-night toon material with `map` on the walls. */
function wallMaterial(night: NightParts, map: THREE.Texture, lit: THREE.Texture): THREE.MeshToonMaterial {
  lit.repeat.set(1 / 16, 1 / 16);
  const m = new THREE.MeshToonMaterial({ map, emissive: '#ffffff', emissiveMap: lit, emissiveIntensity: 0, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  night.windows.push(m);
  return m;
}

/** A straight road `len` long from its middle (x, z), along x or along z: the street out front's asphalt. */
function road(x: number, z: number, len: number, alongX: boolean, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(len, ROAD).rotateX(-Math.PI / 2);
  if (!alongX) geo.rotateY(Math.PI / 2);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * len) / 8);
  geo.translate(x, G - (alongX ? 0.008 : 0.007), z);
  return new THREE.Mesh(geo, mat);
}

/** A plain flat rectangle on the ground at height y. */
function flat(x0: number, x1: number, z0: number, z1: number, y: number, mat: THREE.Material): THREE.Mesh {
  return mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), mat, (x0 + x1) / 2, y, (z0 + z1) / 2, false);
}

/** A zebra crossing's white bars, across the road. */
function zebraTexture(): THREE.CanvasTexture {
  return tilingCanvasTexture(128, 32, (c) => {
    c.clearRect(0, 0, 128, 32);
    c.fillStyle = '#f1f1f1';
    for (let i = 0; i < 8; i++) c.fillRect(i * 16 + 3, 3, 10, 26);
  });
}

/** A zebra crossing at (x, z) across a road along x (or along z). */
function crossing(x: number, z: number, alongX: boolean, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ROAD - 0.6, ZEBRA - 0.6).rotateX(-Math.PI / 2);
  if (alongX) geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo.translate(x, G - 0.004, z), mat);
}

/** A square `size` across with its corners rounded `r`, in the x–y plane round the origin. */
function roundedSquare(size: number, r: number): THREE.Shape {
  const h = size / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false);
  s.lineTo(h, h - r);
  s.absarc(h - r, h - r, r, 0, Math.PI / 2, false);
  s.lineTo(-h + r, h);
  s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-h, -h + r);
  s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** The city round the street (see above), built once, down on the street. */
export const skyline: Fixture<never, StreetSite> = (site) => {
  const night = site.get('night');
  const colliders = site.groundColliders;
  const group = new THREE.Group();
  // Its own numbers, the same every time, so everyone sees the same city.
  const r = mulberry32(20261007);
  const n = Math.ceil(RADIUS / PERIOD) + 1;
  const blocks: { x: number; z: number }[] = [];
  const { lots, parks } = layBlocks(r, n, (_i, _j, x, z) => {
    const take = isCityBlock(x, z);
    if (take) blocks.push({ x, z });
    return take;
  });

  // The streets: one asphalt under the whole grid (so where two cross it's one piece of road), the lane
  // markings like the street out front's between the crossings, a zebra crossing across each end, and
  // each block a raised sidewalk all round it with rounded corners.
  const asphalt = new THREE.MeshToonMaterial({ map: roadTexture().clone(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  asphalt.map!.wrapS = THREE.RepeatWrapping;
  asphalt.map!.needsUpdate = true;
  const streets = new THREE.Group();
  const plain = toon('#5b606c');
  const extent = (bs: { x: number; z: number }[]) =>
    bs.length && streets.add(flat(Math.min(...bs.map((b) => b.x)) - PERIOD / 2, Math.max(...bs.map((b) => b.x)) + PERIOD / 2, Math.min(...bs.map((b) => b.z)) - PERIOD / 2, Math.max(...bs.map((b) => b.z)) + PERIOD / 2, G - 0.01, plain));
  extent(blocks.filter((b) => b.z < CITY_NORTH));
  extent(blocks.filter((b) => b.z >= CITY_NORTH && b.x > CITY_EAST));
  const zebra = new THREE.MeshToonMaterial({ map: zebraTexture(), transparent: true, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const ways = new Set<string>();
  // The textured ones (the lanes' markings, the zebras) merged keeping their UVs, which mergeByMaterial drops.
  const lanes: THREE.BufferGeometry[] = [];
  const zebras: THREE.BufferGeometry[] = [];
  const kerb = new THREE.ExtrudeGeometry(roundedSquare(BLOCK, CORNER), { depth: CURB, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2);
  const pavement = toon('#e3ddd0');
  for (const b of blocks) {
    for (const [dx, dz, alongX] of [
      [0, -1, true],
      [0, 1, true],
      [-1, 0, false],
      [1, 0, false],
    ] as const) {
      const x = b.x + (dx * PERIOD) / 2;
      const z = b.z + (dz * PERIOD) / 2;
      const key = `${x},${z}`;
      if (ways.has(key)) continue;
      ways.add(key);
      lanes.push(road(x, z, BLOCK - ZEBRA * 2, alongX, asphalt).geometry);
      for (const end of [-1, 1]) {
        const along = end * (BLOCK / 2 - ZEBRA / 2);
        zebras.push(crossing(alongX ? x + along : x, alongX ? z : z + along, alongX, zebra).geometry);
      }
    }
    streets.add(new THREE.Mesh(kerb.clone().translate(b.x, G - 0.01, b.z), pavement));
  }

  // The avenues out of it, to the street out front and to the scenic loop: a road down each, a sidewalk
  // either side, and lamps and trees along them.
  for (const l of CITY_LINKS) {
    const z0 = l.z0 + ROAD / 2;
    const len = l.z1 - z0;
    lanes.push(road(l.x, z0 + len / 2, len, false, asphalt).geometry);
    zebras.push(crossing(l.x, z0 + ZEBRA / 2, false, zebra).geometry);
    for (const s of [-1, 1]) streets.add(mesh(new THREE.BoxGeometry(WALK, CURB, len - CORNER), pavement, l.x + s * (ROAD / 2 + WALK / 2), G + CURB / 2 - 0.01, z0 + CORNER / 2 + len / 2, false));
  }
  group.add(mergeByMaterial(streets), new THREE.Mesh(mergeGeometries(lanes), asphalt), new THREE.Mesh(mergeGeometries(zebras), zebra));
  parks.position.y = G + CURB;
  group.add(mergeByMaterial(parks));

  // The buildings, the neighbours' way.
  group.add(buildings(lots, night, colliders, r));

  // Street lamps and trees along the sidewalks of the blocks close by.
  const lamps = new THREE.Group();
  const trees = new THREE.Group();
  const glass = bulb(night, '#fff3d6');
  const ink = toon('#3d405b');
  for (const b of blocks) {
    if (Math.hypot(b.x, b.z) > NEAR) continue;
    const edge = PERIOD / 2 - ROAD / 2 - 0.6;
    for (const [ux, uz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      for (const along of [-14, 14]) {
        // A lamp on each side of the block, its arm out over the road; a tree between them.
        const x = b.x + ux * edge + (uz ? along : 0);
        const z = b.z + uz * edge + (ux ? along : 0);
        const lx = x + ux * 1.2;
        const lz = z + uz * 1.2;
        if (along < 0) {
          lamps.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 8), ink, x, G + CURB + 2.5, z));
          lamps.add(mesh(new THREE.BoxGeometry(ux ? 1.3 : 0.08, 0.08, uz ? 1.3 : 0.08), ink, x + ux * 0.6, G + CURB + 4.95, z + uz * 0.6));
          lamps.add(mesh(new THREE.CylinderGeometry(0.12, 0.42, 0.26, 12), ink, lx, G + CURB + 4.9, lz));
          lamps.add(mesh(new THREE.SphereGeometry(0.22, 12, 8), glass, lx, G + CURB + 4.7, lz, false));
          night.halos.push({ at: new THREE.Vector3(lx, G + CURB + 4.66, lz), size: 2.4, color: '#ffd89a', ground: true });
          colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2, bottom: G, top: G + 5 });
        } else {
          const t = tree(0.85 + r() * 0.3);
          t.position.set(x, G + CURB, z);
          trees.add(t);
          colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, bottom: G, top: G + 2.2 });
        }
      }
    }
  }
  for (const l of CITY_LINKS) {
    for (let z = l.z0 + ROAD / 2 + 10; z < l.z1 - 6; z += 14) {
      for (const s of [-1, 1]) {
        const x = l.x + s * (ROAD / 2 + 0.6);
        if (Math.round((z - l.z0) / 14) % 2) {
          lamps.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 5, 8), ink, x, G + CURB + 2.5, z));
          lamps.add(mesh(new THREE.BoxGeometry(1.3, 0.08, 0.08), ink, x - s * 0.6, G + CURB + 4.95, z));
          lamps.add(mesh(new THREE.CylinderGeometry(0.12, 0.42, 0.26, 12), ink, x - s * 1.2, G + CURB + 4.9, z));
          lamps.add(mesh(new THREE.SphereGeometry(0.22, 12, 8), glass, x - s * 1.2, G + CURB + 4.7, z, false));
          night.halos.push({ at: new THREE.Vector3(x - s * 1.2, G + CURB + 4.66, z), size: 2.4, color: '#ffd89a', ground: true });
          colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2, bottom: G, top: G + 5 });
        } else {
          const t = tree(0.85 + r() * 0.3);
          t.position.set(x + s * 0.9, G + CURB, z);
          trees.add(t);
          colliders.push({ minX: x + s * 0.9 - 0.25, maxX: x + s * 0.9 + 0.25, minZ: z - 0.25, maxZ: z + 0.25, bottom: G, top: G + 2.2 });
        }
      }
    }
  }
  group.add(mergeByMaterial(lamps), mergeByMaterial(trees));

  site.ground.add(group);
  return {};
};

/** The lots' buildings: walls a mesh per paint (shops along the bottom close by), white roof caps, and what's on the roofs. */
function buildings(lots: Lot[], night: NightParts, colliders: StreetSite['groundColliders'], r: () => number): THREE.Group {
  const out = new THREE.Group();
  const walls = new Map<number, Walls>();
  const shops = new Map<number, Walls>();
  const caps = new THREE.Group();
  const extras = new THREE.Group();
  const capMat = toon('#fffaf3');
  const unitGeo = new THREE.BoxGeometry(1, 1.6, 1);
  const tankGeo = new THREE.CylinderGeometry(1.6, 1.6, 3.2, 12);
  const base = G + CURB;
  for (const lot of lots) {
    const paint = Math.floor(r() * PAINTS.length);
    const h = Math.max(STOREY * 2, lot.h);
    const shop = Math.hypot(lot.x, lot.z) < NEAR;
    const bottom = shop ? 4 : 0;
    if (shop) {
      let s = shops.get(paint);
      if (!s) shops.set(paint, (s = new Walls()));
      // The shops' storey: two bays of the texture to a storey's width of wall.
      s.box(lot.x, lot.z, lot.w, lot.d, base, base + bottom, lot.ou, lot.ov);
      // Striped awnings over the shop windows on the two long sides.
      const awning = toon(AWNINGS[Math.floor(r() * AWNINGS.length)]);
      const alongX = lot.w >= lot.d;
      for (const side of [-1, 1]) {
        const a = mesh(new THREE.BoxGeometry(alongX ? lot.w * 0.9 : 1.4, 0.18, alongX ? 1.4 : lot.d * 0.9), awning, lot.x + (alongX ? 0 : side * (lot.w / 2 + 0.65)), base + bottom - 0.5, lot.z + (alongX ? side * (lot.d / 2 + 0.65) : 0), false);
        a.rotation[alongX ? 'x' : 'z'] = side * (alongX ? -0.25 : 0.25);
        extras.add(a);
      }
    }
    let w = walls.get(paint);
    if (!w) walls.set(paint, (w = new Walls()));
    let top = base + h;
    w.box(lot.x, lot.z, lot.w, lot.d, base + bottom, top, lot.ou, lot.ov);
    caps.add(mesh(new THREE.BoxGeometry(lot.w + 0.4, 0.4, lot.d + 0.4), capMat, lot.x, top + 0.2, lot.z));
    let tw = lot.w;
    let td = lot.d;
    if (lot.step) {
      tw = lot.step.w;
      td = lot.step.d;
      w.box(lot.x, lot.z, tw, td, top + 0.4, top + 0.4 + lot.step.up, lot.ou + 5, lot.ov + 3);
      top += 0.4 + lot.step.up;
      caps.add(mesh(new THREE.BoxGeometry(tw + 0.4, 0.4, td + 0.4), capMat, lot.x, top + 0.2, lot.z));
    }
    if (lot.top?.kind === 'tank') extras.add(mesh(tankGeo, toon('#9c6b4a'), lot.top.x, top + 2, lot.top.z, false));
    else if (lot.top?.kind === 'plant') {
      const unit = mesh(unitGeo, toon('#c9ccd4'), lot.top.x, top + 1.2, lot.top.z, false);
      unit.scale.set(lot.top.w, 1, lot.top.d);
      extras.add(unit);
    }
    colliders.push({ minX: lot.x - lot.w / 2, maxX: lot.x + lot.w / 2, minZ: lot.z - lot.d / 2, maxZ: lot.z + lot.d / 2, bottom: G, top });
  }
  for (const [paint, w] of walls) out.add(new THREE.Mesh(w.geometry(), wallMaterial(night, bayTexture(PAINTS[paint]), litTexture(paint + 1))));
  for (const [paint, s] of shops) out.add(new THREE.Mesh(s.geometry(), wallMaterial(night, shopTexture(PAINTS[paint]), litTexture(paint + 40, true))));
  out.add(mergeByMaterial(caps), mergeByMaterial(extras));
  return out;
}
