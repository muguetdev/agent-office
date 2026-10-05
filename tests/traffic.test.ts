// The cars that drive round by themselves (features/traffic): their way round, and their models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUIT, CIRCUIT_LENGTH, LANE, onCircuit } from '../src/shared/traffic';
import { ROAD } from '../src/shared/layout';
import { openModel } from './glb';

test('the way round is closed, and each way drives on its own side of the road', () => {
  assert.ok(CIRCUIT_LENGTH > 1000, `${CIRCUIT_LENGTH} m round`);
  // Round once, it's back where it started.
  const a = onCircuit(10, 1);
  const b = onCircuit(10 + CIRCUIT_LENGTH, 1);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-6);
  // Down the street in front of the office: east on the far side, west on the near one, each on the right.
  const mid = (ROAD.minZ + ROAD.maxZ) / 2;
  const east = onCircuit(100, 1);
  const west = onCircuit(100, -1);
  assert.ok(Math.abs(east.z - (mid + LANE)) < 1e-6 && Math.abs(east.rotY - Math.PI / 2) < 1e-6, JSON.stringify(east));
  assert.ok(Math.abs(west.z - (mid - LANE)) < 1e-6 && Math.abs(west.rotY + Math.PI / 2) < 1e-6, JSON.stringify(west));
  // Every step of the way is a short one: no jumps between the street and the loop.
  for (let i = 1; i < CIRCUIT.length; i++) assert.ok(CIRCUIT[i].d - CIRCUIT[i - 1].d < 8, `a ${CIRCUIT[i].d - CIRCUIT[i - 1].d} m step at ${i}`);
});

test("traffic.glb has a car of each kind, painted with the colors features/traffic knows", () => {
  const cars = openModel('traffic');
  const known = ['TBlack', 'TWhite', 'TGrey', 'TWindows', 'THeadlights', 'TTailLights', 'TBlueLights', 'TWhiteLights', 'TYellow', 'TBlue', 'TLightBlue', 'TTrim'];
  for (const kind of ['police', 'taxi', 'suv', 'car', 'hatch']) assert.ok(cars.byName(kind) >= 0, `${kind} is there`);
  for (const m of cars.materials()) assert.ok(known.includes(m), `${m} has a color`);
});

test('each traffic car has its four wheels, each about its hub, front ones ahead and left ones on the left', () => {
  const cars = openModel('traffic');
  for (const kind of ['police', 'taxi', 'suv', 'car', 'hatch']) {
    for (const [w, sx, sz] of [['fl', 1, 1], ['fr', -1, 1], ['rl', 1, -1], ['rr', -1, -1]] as const) {
      const i = cars.byName(`${kind}_wheel_${w}`);
      assert.ok(i >= 0, `${kind} has its ${w} wheel`);
      const { at } = cars.placed(i);
      assert.ok(Math.sign(at.x) === sx && Math.sign(at.z) === sz && at.y > 0.2 && at.y < 0.4, `${kind}'s ${w} wheel's hub is at ${at.toArray().map((n) => n.toFixed(2))}`);
    }
  }
});
