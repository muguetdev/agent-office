import * as THREE from 'three';
import { FLOOR } from '../../../shared/layout';
import { mesh, recolor, roundedBox, toon } from '../toon';
import type { Collider } from '../types';
import type { Fixture } from './fixture';

// A server's floor (see FloorPalette.night): an executive's office at night. Its furniture goes black
// leather and dark walnut, its lamps brass, and two server racks stand in the north-west corner where the
// potted plant is on any other floor, their lights blinking away.

/** The colours a server's floor paints the shared ones (see recolor), by hex. */
const NIGHT: Readonly<Record<string, string>> = {
  // The desks' tops, and the wood of the tables, boards and loft.
  f7f3ea: '3a2a20',
  c98b5a: '4a3123',
  // Every chair (and its mug) in black leather.
  ff8a5b: '1f2026',
  '5bc0eb': '1f2026',
  '9bc53d': '1f2026',
  b388eb: '1f2026',
  ffb400: '1f2026',
  f7aef8: '1f2026',
  // The rugs in deep tones.
  bde0fe: '2e3440',
  ffd6a5: '3b2f2c',
  caffbf: '2d3a33',
  ffc6ff: '3a2c33',
  // The lounge's couch in leather, its wood darker; the pendant lamps' shades brass.
  '5b8def': '25262d',
  '8a5a3b': '3a2619',
  ffd166: 'c9a227',
};

/** The racks: against the north wall in the west corner, fronts to the room. */
const RACK = { width: 0.68, depth: 0.9, height: 2.05, units: 9 } as const;
const RACKS_X = [FLOOR.minX + 0.06 + RACK.width / 2, FLOOR.minX + 0.06 + RACK.width * 1.5 + 0.04];
const RACKS_Z = FLOOR.minZ + 0.04 + RACK.depth / 2;

const LED_ON = { green: new THREE.MeshBasicMaterial({ color: '#39ff7a' }), amber: new THREE.MeshBasicMaterial({ color: '#ffb000' }), blue: new THREE.MeshBasicMaterial({ color: '#4cc9f0' }) };

function rack(leds: THREE.Mesh[]): THREE.Group {
  const g = new THREE.Group();
  const body = toon('#15161b');
  const unit = toon('#2a2c33');
  const vent = toon('#0c0d10');
  g.add(mesh(roundedBox(RACK.width, RACK.height, RACK.depth, 0.03), body, 0, RACK.height / 2, 0));
  const pitch = (RACK.height - 0.3) / RACK.units;
  for (let i = 0; i < RACK.units; i++) {
    const y = 0.18 + pitch * (i + 0.5);
    g.add(mesh(new THREE.BoxGeometry(RACK.width - 0.08, pitch - 0.035, 0.02), unit, 0, y, RACK.depth / 2 + 0.005, false));
    // A grille across most of its face, and a few lights at its end.
    g.add(mesh(new THREE.BoxGeometry(RACK.width * 0.5, pitch * 0.45, 0.01), vent, -0.06, y, RACK.depth / 2 + 0.02, false));
    for (let k = 0; k < 3; k++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.01), LED_ON.green);
      led.position.set(RACK.width / 2 - 0.07 - k * 0.04, y, RACK.depth / 2 + 0.022);
      g.add(led);
      leds.push(led);
    }
  }
  return g;
}

export const serverRoom: Fixture = (site) => {
  const group = new THREE.Group();
  group.visible = false;
  const leds: THREE.Mesh[] = [];
  for (const x of RACKS_X) {
    const r = rack(leds);
    r.position.set(x, 0, RACKS_Z);
    group.add(r);
  }
  const collider: Collider = { minX: FLOOR.minX, maxX: RACKS_X[1] + RACK.width / 2, minZ: FLOOR.minZ, maxZ: RACKS_Z + RACK.depth / 2, top: RACK.height };
  // The potted plant the racks stand in for (the first of PLANTS, in that corner).
  const plant = site.get('plants')[0];
  let night = false;
  site.looks.night.push((on) => {
    if (on === night) return;
    night = on;
    group.visible = on;
    if (plant) plant.visible = !on;
    const i = site.colliders.indexOf(collider);
    if (on && i < 0) site.colliders.push(collider);
    else if (!on && i >= 0) site.colliders.splice(i, 1);
    recolor(on ? NIGHT : null);
  });
  // Each light blinks on its own beat: mostly green, now and then amber or blue, as a busy rack's do.
  const beats = leds.map((_, i) => ({ speed: 0.6 + ((i * 37) % 23) / 6, phase: (i * 1.7) % 6.28, color: i % 11 === 3 ? LED_ON.amber : i % 13 === 5 ? LED_ON.blue : LED_ON.green }));
  return {
    group,
    update(t) {
      if (!night) return;
      leds.forEach((led, i) => {
        const b = beats[i];
        led.visible = Math.sin(t * b.speed * 4 + b.phase) > -0.35;
        led.material = b.color;
      });
    },
  };
};
