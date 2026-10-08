import { ROAD } from './layout.js';

// The city round the office (client/world/skyline.ts draws it): a grid of streets, a block between
// each, wherever the street's own world leaves room (behind the office past the neighbours out back,
// and east of the scenic loop's pines), and the avenue that joins it to the street out front, west of
// the office. (Not to the scenic loop: every way onto it is on the outside of a bend, where a car going
// fast rides the edge and would be off up the avenue instead of round.) Laid out here,
// as numbers, so the drawing, the cars you drive (garage.ts paved) and the traffic agree on it.

/** A block and the street beside it; streets run down x = STREET_X + PERIOD k and z = STREET_Z + PERIOD k. */
export const PERIOD = 56;
export const STREET_X = 28;
export const STREET_Z = 27;
/** The road (as wide as the street out front), and a sidewalk either side. */
export const CITY_ROAD = ROAD.maxZ - ROAD.minZ;
export const CITY_WALK = 2;
/** How far out it goes: past this the haze has it anyway. */
export const CITY_RADIUS = 330;
/** Its edges: the street behind the office's (z), the one east of the pines (x), and clear of the coast to the west (x). */
export const CITY_NORTH = STREET_Z - 2 * PERIOD;
export const CITY_EAST = STREET_X + 4 * PERIOD;
export const CITY_WEST = STREET_X - 4 * PERIOD;

/** The middle of block (i, j). */
export const blockAt = (i: number, j: number) => ({ x: STREET_X - PERIOD / 2 + i * PERIOD, z: STREET_Z - PERIOD / 2 + j * PERIOD });

/** Whether the block with its middle at (x, z) is the city's. */
export function isCityBlock(x: number, z: number): boolean {
  return (z < CITY_NORTH || x > CITY_EAST) && x > CITY_WEST && Math.hypot(x, z) <= CITY_RADIUS;
}

/** The avenue joining the city to the rest: down a grid line from its edge to the street out front's north curb, west of the office and its neighbours. */
export const CITY_LINKS: { x: number; z0: number; z1: number }[] = [{ x: STREET_X - 2 * PERIOD, z0: CITY_NORTH, z1: ROAD.minZ }];

/** Whether (x, z) is on one of the city's roads (its grid's, or an avenue's): where a car can drive. */
export function onCityRoad(x: number, z: number): boolean {
  const half = CITY_ROAD / 2;
  for (const l of CITY_LINKS) if (Math.abs(x - l.x) <= half && z >= l.z0 - half && z <= l.z1) return true;
  // Down a grid line along z (x fixed): a road if a block either side of it there is the city's.
  const kx = Math.round((x - STREET_X) / PERIOD);
  const lineX = STREET_X + kx * PERIOD;
  if (Math.abs(x - lineX) <= half) {
    const j = Math.round((z - STREET_Z + PERIOD / 2) / PERIOD);
    const cz = blockAt(0, j).z;
    if (Math.abs(z - cz) <= PERIOD / 2 + half && (isCityBlock(lineX - PERIOD / 2, cz) || isCityBlock(lineX + PERIOD / 2, cz))) return true;
  }
  // Along a grid line along x (z fixed).
  const kz = Math.round((z - STREET_Z) / PERIOD);
  const lineZ = STREET_Z + kz * PERIOD;
  if (Math.abs(z - lineZ) <= half) {
    const i = Math.round((x - STREET_X + PERIOD / 2) / PERIOD);
    const cx = blockAt(i, 0).x;
    if (Math.abs(x - cx) <= PERIOD / 2 + half && (isCityBlock(cx, lineZ - PERIOD / 2) || isCityBlock(cx, lineZ + PERIOD / 2))) return true;
  }
  return false;
}

/** Whether (x, z) is the city's ground, `margin` meters round included: its blocks, its roads and the avenues with their sidewalks. */
export function inCity(x: number, z: number, margin = 0): boolean {
  const reach = CITY_ROAD / 2 + CITY_WALK + margin;
  for (const l of CITY_LINKS) if (Math.abs(x - l.x) <= reach && z >= l.z0 - reach && z <= l.z1 + margin) return true;
  const i = Math.round((x - STREET_X + PERIOD / 2) / PERIOD);
  const j = Math.round((z - STREET_Z + PERIOD / 2) / PERIOD);
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const b = blockAt(i + di, j + dj);
      if (isCityBlock(b.x, b.z) && Math.abs(x - b.x) <= PERIOD / 2 + margin && Math.abs(z - b.z) <= PERIOD / 2 + margin) return true;
    }
  }
  return false;
}
