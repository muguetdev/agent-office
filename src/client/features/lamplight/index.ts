import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { FLOOR, WALL_HEIGHT, WING } from '../../../shared/layout';

/**
 * Indoors the light that casts shadows comes from the lamps overhead, not the street's sun: the office is
 * lit as if it had no roof, so the sun's shadows fell across the walls from nowhere anyone could see.
 * INDOOR_LIGHT is where that light comes from (nearly straight down, a little off so walls aren't
 * side-on to it), how dark its shadows are, and how bright and warm it is once the lamps are on.
 */
const INDOOR_LIGHT = { dir: new THREE.Vector3(0.22, 1, 0.14).normalize(), shadow: 0.7, lamp: 0.7, color: new THREE.Color('#ffe2b8') };

/** Indoors in the office, after the sky's had its say (core/loop.ts's env tick): the shadows come from overhead (the inside of the walls never takes any, see shadowless in world/office/materials.ts). */
export function installLamplight(ctx: Ctx, parts: Pick<Parts, 'stage' | 'place'>) {
  /** 0 outdoors to 1 indoors, eased as you come in or go out. */
  let indoorness = 0;
  const from = new THREE.Vector3();
  /**
   * Indoors the shadows only need to cover the office, not the whole lot outside: a box round all of it
   * (the room, the loft, and the back office built out to the north), which never moves, so every
   * corner of it has its shadows and none swim as you walk. A tighter box has finer texels.
   */
  const OUTDOORS = { left: -32, right: 32, top: 30, bottom: -30 };
  const OFFICE = { x: 0, z: (FLOOR.maxZ + FLOOR.minZ - WING.rows * WING.row) / 2, half: Math.max(FLOOR.maxX, (FLOOR.maxZ - FLOOR.minZ + WING.rows * WING.row) / 2) + 1.5 };
  let tight = false;
  /**
   * From outside, the sun would fall across everything in the office (it has no roof to stop it), in
   * shadows that are gone once you step in, where the light's overhead: so out there nothing in the
   * office takes the sun's shadows. The walls' outsides still do (and their insides never do).
   */
  const sphere = new THREE.Sphere();
  const inOffice = (o: THREE.Mesh) => {
    const g = o.geometry;
    if (!g) return false;
    if (!g.boundingSphere) g.computeBoundingSphere();
    sphere.copy(g.boundingSphere!).applyMatrix4(o.matrixWorld);
    const { x, y, z } = sphere.center;
    if (sphere.radius > 12 || y > WALL_HEIGHT) return false;
    return (x > FLOOR.minX && x < FLOOR.maxX && z > FLOOR.minZ && z < FLOOR.maxZ) || (x > WING.minX && x < WING.maxX && z > FLOOR.minZ - WING.rows * WING.row && z <= FLOOR.minZ);
  };
  let wasOut = false;
  let lookAgain = 0;
  const shade = (out: boolean) => {
    ctx.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.wall) return;
      if (out && m.receiveShadow && inOffice(m)) {
        m.receiveShadow = false;
        m.userData.sunless = true;
      } else if (!out && m.userData.sunless) {
        m.receiveShadow = true;
        delete m.userData.sunless;
      }
    });
  };

  ctx.ticks.add('env', ({ dt }) => {
    const { sun } = parts.stage;
    const { sky } = ctx;
    // A map of its own (the castle) lights itself (see World.mood), and the roof's out under the sky.
    const inside = ctx.inOffice() && !ctx.upTop() && parts.place.indoors();
    indoorness += ((inside ? 1 : 0) - indoorness) * (1 - Math.exp(-dt * 3));
    // Outdoors, looked over now and then for whatever's come in (workers, a box being carried); indoors, put back.
    const out = ctx.inOffice() && !inside;
    lookAgain -= dt;
    if (out !== wasOut || (out && lookAgain <= 0)) {
      shade(out);
      wasOut = out;
      lookAgain = 0.5;
    }
    const cam = sun.shadow.camera;
    if (inside !== tight) {
      tight = inside;
      Object.assign(cam, inside ? { left: -OFFICE.half, right: OFFICE.half, top: OFFICE.half, bottom: -OFFICE.half } : OUTDOORS);
      cam.updateProjectionMatrix();
    }
    // Where the light comes from, before the box moves over to you.
    from.copy(sun.position).sub(sun.target.position).normalize();
    if (inside) {
      sun.target.position.set(OFFICE.x, 0, OFFICE.z);
      sun.target.updateMatrixWorld();
      if (indoorness <= 0.001) sun.position.copy(sun.target.position).addScaledVector(from, 45);
    }
    if (indoorness > 0.001) {
      sun.position.copy(sun.target.position).addScaledVector(from.lerp(INDOOR_LIGHT.dir, indoorness).normalize(), 45);
      const lamp = INDOOR_LIGHT.lamp * sky.lampsOn;
      if (lamp > sun.intensity) {
        sun.color.lerp(INDOOR_LIGHT.color, indoorness * Math.min(1, (lamp - sun.intensity) / lamp));
        sun.intensity += (lamp - sun.intensity) * indoorness;
      }
    }
    sun.shadow.intensity = 1 + (INDOOR_LIGHT.shadow - 1) * indoorness;
  });
}
