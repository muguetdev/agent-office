import * as THREE from 'three';

/**
 * The avatars' paint: toon, like the rest of the office, but with a soft ramp (the concept sheet's
 * clay look: rounded shading, a shadow side that stays light) instead of the office's three flat bands.
 * Shared per colour; the face's thin pieces (the mouth, the eyes) drawn from both sides.
 */
let ramp: THREE.DataTexture | null = null;

function softRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const steps = [150, 178, 205, 228, 244, 255];
  const data = new Uint8Array(steps.flatMap((v) => [v, v, v, 255]));
  ramp = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  return ramp;
}

const cache = new Map<string, THREE.MeshToonMaterial>();

export function avatarMaterial(color: string, twoSided = false): THREE.MeshToonMaterial {
  const key = `${color}|${twoSided}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: softRamp(), side: twoSided ? THREE.DoubleSide : THREE.FrontSide });
    cache.set(key, m);
  }
  return m;
}
