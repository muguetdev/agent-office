/**
 * The diorama look (⚙️ → You → Look): the office as a scale model seen from high up at a slant, the
 * way a management game shows it, instead of through your own eyes. You're in it, in third person,
 * and the camera hangs back over you, looking down through a narrow lens so it reads almost
 * isometric; the walls and everything over head height are cut away (as on the minimap), there's
 * no haze between you and the floor, and no ink round things (its outlines take no notice of the
 * cut, so they'd draw what's cut away as dark shapes). Drag turns the model round, the wheel zooms, WASD walks you
 * across the screen as it's turned. A click on the floor walks you there; a click on something you
 * can use walks you over to it and uses it. Off, the office is as it always was.
 */
import * as THREE from 'three';
import { FLOOR, LOFT, WALL_T } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import type { Interactable } from '../../world/types';
import { L } from '../../i18n';

/** How narrow the lens is (degrees), how steeply it looks down, and where the walls are cut over the floor (m). */
const FOV = 24;
const TILT = THREE.MathUtils.degToRad(52);
const CUT = 2.9;
/** How far back the camera hangs: the third-person distance (the wheel's, 2.5–16) stretched to this. */
const dist = (camDist: number) => 10 + camDist * 4;
/** Which way it looks from as you first switch it on: from the south-east, as isometric games do. */
const START_YAW = Math.PI / 4;

export function installDiorama(ctx: Ctx, parts: Pick<Parts, 'stage' | 'settings' | 'place' | 'worlds' | 'walking' | 'pointer' | 'hanging' | 'hoops' | 'emotes'>) {
  const { player, camera, renderer, scene } = ctx;
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const target = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  /** The floor you're on: where your feet last were on the ground, so a jump doesn't lift the camera. */
  let floorY = 0;
  let was = false;
  let fogFar = 0;

  /** Whether it's on now: picked, and nothing else has the camera (the tee, the telescope, a car, the arcade up close). */
  const on = () => parts.settings.look === 'diorama' && !ctx.activities.any('takesCamera') && !ctx.activities.running('driver') && !ctx.view.covered();

  /** Whether there's a ceiling over you to cut away: indoors, or anywhere under the office's footprint (the garage). */
  function underRoof(): boolean {
    if (parts.place.indoors()) return true;
    const p = player.pos;
    return parts.worlds.inOffice() && !ctx.upTop() && p.x > FLOOR.minX - WALL_T && p.x < FLOOR.maxX + WALL_T && p.z > FLOOR.minZ - WALL_T && p.z < FLOOR.maxZ + WALL_T;
  }

  /** Where the walls are cut: over the storey's floor (over the loft's when you're up there), or the street's down in the garage. */
  function cutAt(): number {
    const office = parts.worlds.inOffice() && !ctx.upTop() && floorY > -1;
    return (office ? (floorY > 1 ? LOFT.y : 0) : floorY) + CUT;
  }

  ctx.view.add({
    fov: (fov) => (on() ? FOV : fov),
    // Each frame, once the third-person camera's placed: lifted up and back over you, looking down.
    update: () => {
      const now = on();
      if (now !== was) {
        was = now;
        if (now) {
          player.setView('third');
          player.camYaw = START_YAW;
        } else player.setView(parts.settings.view);
      }
      if (!now) return;
      // Picked on, it stays third person (⚙️'s camera choice comes back when it's off).
      if (player.view !== 'third') player.setView('third');
      if (player.grounded) floorY = player.pos.y;
      target.set(player.pos.x, floorY + 1, player.pos.z);
      const d = dist(player.camDist);
      const yaw = player.camYaw;
      camera.position.set(target.x + Math.sin(yaw) * Math.cos(TILT) * d, target.y + Math.sin(TILT) * d, target.z + Math.cos(yaw) * Math.cos(TILT) * d);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    },
    // While it's drawn: the walls cut over head height, no haze over the model, and no ink.
    filter: {
      begin: () => {
        if (!on()) return false;
        parts.stage.effect.enabled = false;
        clip.constant = cutAt();
        renderer.clippingPlanes = underRoof() ? [clip] : [];
        const fog = scene.fog as THREE.Fog | null;
        if (fog) {
          fogFar = fog.far;
          fog.far = Math.max(fog.far, 400);
        }
        return true;
      },
      end: () => {
        parts.stage.effect.enabled = true;
        renderer.clippingPlanes = [];
        const fog = scene.fog as THREE.Fog | null;
        if (fog && fogFar) fog.far = fogFar;
      },
    },
  });

  // A click on the model: on something you can use, walk over and use it; on the floor, walk there.
  const base = player.onClick;
  player.onClick = (ndc) => {
    const busy = parts.hanging.hanger.active || parts.hoops.holding() || parts.emotes.emoteWheel.isOpen;
    if (!on() || busy || !clicked(ndc)) base?.(ndc);
  };

  /** Where on the model a click lands: the first thing it meets that isn't cut away or hidden. */
  function landsAt(ndc: THREE.Vector2): THREE.Vector3 | null {
    ray.setFromCamera(ndc, camera);
    const cut = underRoof() ? cutAt() : Infinity;
    for (const hit of ray.intersectObject(scene, true)) {
      if (hit.point.y > cut + 0.01 || (hit.object as THREE.Sprite).isSprite) continue;
      let shown = true;
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (!o.visible) shown = false;
      if (shown) return hit.point;
    }
    return null;
  }

  /** Does what a click at `ndc` asks for; false if there's nothing for it to do (the third-person click does). */
  function clicked(ndc: THREE.Vector2): boolean {
    const at = landsAt(ndc);
    if (!at) return false;
    // Something you can use where it landed: the nearest within its reach of the spot.
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const list of parts.pointer.usable())
      for (const it of list) {
        if (it.off || Math.abs((it.y ?? 0) - floorY) > 1.5) continue;
        const d = Math.hypot(it.x - at.x, it.z - at.z);
        if (d < Math.max(it.radius, 1.2) && d < bestD) {
          best = it;
          bestD = d;
        }
      }
    if (best) {
      const it = best;
      const reach = Math.hypot(it.x - player.pos.x, it.z - player.pos.z) < it.radius;
      if (reach) parts.pointer.use(it, 'E', null);
      else parts.walking.walkThen({ x: it.x, z: it.z }, it.label ?? L.minimap.there, () => parts.pointer.use(it, 'E', null));
      return true;
    }
    if (!ctx.world().nav.walkable(at.x, at.z) || Math.abs(at.y - floorY) > 0.6) return false;
    parts.walking.walkThen({ x: at.x, z: at.z }, L.minimap.there, () => {});
    return true;
  }
}
