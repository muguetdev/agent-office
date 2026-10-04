// The way round for the cars that drive by themselves (the client's features/traffic): along the street
// from its west end to its east end, then the scenic loop from there round to the west end again, a
// closed circuit. Each drives on the right of it, either way round.
import { LOOP, STREET_END, STREET_Z } from './scenic.js';

export interface CircuitPoint {
  x: number;
  z: number;
  /** Meters round from the street's west end. */
  d: number;
}

/** The circuit's points, a few meters apart, and how long it is all the way round. */
export const CIRCUIT: CircuitPoint[] = (() => {
  const pts: { x: number; z: number }[] = [];
  for (let x = -STREET_END; x < STREET_END; x += 4) pts.push({ x, z: STREET_Z });
  for (const p of LOOP) pts.push({ x: p.x, z: p.z });
  const out: CircuitPoint[] = [];
  let d = 0;
  pts.forEach((p, i) => {
    if (i) d += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    out.push({ x: p.x, z: p.z, d });
  });
  return out;
})();
const last = CIRCUIT[CIRCUIT.length - 1];
export const CIRCUIT_LENGTH = last.d + Math.hypot(CIRCUIT[0].x - last.x, CIRCUIT[0].z - last.z);

/** How far right of the middle of the road a car drives (its lane's middle). */
export const LANE = 2;

/**
 * Where a car `s` meters round is, driving the way `dir` says (1 the circuit's way, -1 against it): its
 * middle, in its lane on the right, and the way it faces (rotY, its nose being +z).
 */
export function onCircuit(s: number, dir: 1 | -1): { x: number; z: number; rotY: number } {
  const d = ((s % CIRCUIT_LENGTH) + CIRCUIT_LENGTH) % CIRCUIT_LENGTH;
  let lo = 0;
  let hi = CIRCUIT.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (CIRCUIT[mid].d <= d) lo = mid;
    else hi = mid - 1;
  }
  const a = CIRCUIT[lo];
  const b = CIRCUIT[(lo + 1) % CIRCUIT.length];
  const span = (lo + 1 < CIRCUIT.length ? b.d : CIRCUIT_LENGTH) - a.d || 1;
  const k = (d - a.d) / span;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const hx = ((b.x - a.x) / len) * dir;
  const hz = ((b.z - a.z) / len) * dir;
  // Right of the way it's going: facing east (+x), that's south (+z).
  return { x: a.x + (b.x - a.x) * k - hz * LANE, z: a.z + (b.z - a.z) * k + hx * LANE, rotY: Math.atan2(hx, hz) };
}
