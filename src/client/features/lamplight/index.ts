import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { FLOOR, WING } from '../../../shared/layout';
import { INDOOR_LIGHT, lightIndoors } from '../../world/indoor-light';

/**
 * The light inside the office (see world/indoor-light.ts): from overhead, as bright as the sun is or as
 * the lamps once it's dark enough for them, casting its own shadows over a box round the whole office
 * (the room, the loft, and the back office built out to the north), which never moves, so every corner of
 * it has its shadows and none swim as you walk. It's set after the sky's had its say (core/loop.ts's env
 * tick), so it follows the sun of the moment; where you stand doesn't come into it.
 */
export function installLamplight(ctx: Ctx, parts: Pick<Parts, 'stage'>) {
  const { sun } = parts.stage;
  const OFFICE = { x: 0, z: (FLOOR.maxZ + FLOOR.minZ - WING.rows * WING.row) / 2, half: Math.max(FLOOR.maxX, (FLOOR.maxZ - FLOOR.minZ + WING.rows * WING.row) / 2) + 1.5 };
  const light = new THREE.DirectionalLight();
  light.target.position.set(OFFICE.x, 0, OFFICE.z);
  light.position.copy(light.target.position).addScaledVector(INDOOR_LIGHT.dir, 45);
  light.castShadow = true;
  light.shadow.mapSize.copy(sun.shadow.mapSize);
  Object.assign(light.shadow.camera, { left: -OFFICE.half, right: OFFICE.half, top: OFFICE.half, bottom: -OFFICE.half, near: 1, far: 100 });
  light.shadow.camera.up.set(0, 0, -1);
  light.shadow.bias = sun.shadow.bias;
  light.shadow.normalBias = sun.shadow.normalBias;
  light.shadow.intensity = INDOOR_LIGHT.shadow;
  // After the sun, so it's the second directional light the shaders see (see INDOOR_LIGHTS).
  ctx.scene.add(light, light.target);
  ctx.ticks.add('env', () => {
    lightIndoors(light, sun, ctx.sky.lampsOn);
    // Up on the roof, or on a map of its own, there's no office under it to light (dark rather than
    // hidden: one light fewer would have every material's shader made again).
    if (!ctx.inOffice() || ctx.upTop()) light.intensity = 0;
  });
}
