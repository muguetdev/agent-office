/**
 * A server's floor at work (see world/office/server-room.ts): the room's light lower and warmer, as an
 * executive's office at night, and its racks blinking with how many of its workers are working.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { setRackLoad } from '../../world/office/server-room';

export interface ServerFloorDeps {
  /** The scene's lights (see core/scene.ts), which the sky has just set (see core/loop.ts updateSky). */
  lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight };
}

const WARM = new THREE.Color('#ffc98a');

export function installServerFloor(ctx: Ctx, deps: ServerFloorDeps) {
  let level = 0;
  ctx.ticks.add('env', ({ dt }) => {
    const here = !!store.currentFloor()?.ssh && ctx.inOffice() && !ctx.upTop();
    level += ((here ? 1 : 0) - level) * (1 - Math.exp(-dt * 2));
    if (here) {
      let working = 0;
      for (const w of store.workers.values()) if (w.status === 'working') working++;
      setRackLoad(working / 4);
    }
    if (level < 0.01) return;
    const { hemi, ambient } = deps.lights;
    hemi.intensity *= 1 - 0.38 * level;
    ambient.intensity *= 1 - 0.3 * level;
    hemi.color.lerp(WARM, 0.35 * level);
    ambient.color.lerp(WARM, 0.3 * level);
  });
}
