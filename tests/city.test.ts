import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CITY_LINKS, CITY_NORTH, PERIOD, STREET_X, blockAt, inCity, isCityBlock, onCityRoad } from '../src/shared/city.ts';
import { paved } from '../src/shared/garage.ts';
import { ROAD } from '../src/shared/layout.ts';

test('the avenue west of the office joins the street out front to the city: a car can drive all the way up it', () => {
  const west = CITY_LINKS[0];
  for (let z = ROAD.maxZ - 1; z >= CITY_NORTH; z -= 0.5) assert.ok(paved(west.x, z), `paved at (${west.x}, ${z})`);
  // And on along the city's street at the top of it, either way.
  for (let x = west.x - 50; x <= west.x + 50; x += 1) assert.ok(paved(x, CITY_NORTH), `paved at (${x}, ${CITY_NORTH})`);
});

test('the city keeps clear of the office, its street and the loop, and its blocks are not roads', () => {
  assert.ok(!onCityRoad(0, 0));
  assert.ok(!onCityRoad(0, 27));
  assert.ok(!isCityBlock(0, -1));
  const b = blockAt(0, -2);
  assert.ok(isCityBlock(b.x, b.z));
  assert.ok(!onCityRoad(b.x, b.z), 'the middle of a block is no road');
  assert.ok(onCityRoad(STREET_X, b.z), 'its side is');
  assert.ok(!onCityRoad(STREET_X + PERIOD / 2, CITY_NORTH + 20), 'nor the grass between the city and the neighbours');
});

test("the city's ground takes in its blocks, roads and avenues, and none of the street's", () => {
  const b = blockAt(0, -2);
  assert.ok(inCity(b.x, b.z));
  assert.ok(inCity(CITY_LINKS[0].x, 0), 'the avenue west of the office');
  assert.ok(!inCity(0, 0) && !inCity(0, 27) && !inCity(60, -20));
});
