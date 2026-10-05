// Inside the office the light comes from the lamps overhead, never the sky's sun: a light of its own (see
// features/lamplight), with its own shadows, that only lights what's inside the office, while the sun only
// lights what's outside it. Which is which is decided point by point (sky.ts's skyInOffice), so the office
// looks the same, its shadows included, from inside and from the street.
import * as THREE from 'three';

/** Where the light indoors comes from (nearly straight down, a little off so walls aren't side-on to it), how dark its shadows are, and how bright and warm it is once the lamps are on. */
export const INDOOR_LIGHT = { dir: new THREE.Vector3(0.22, 1, 0.14).normalize(), shadow: 0.7, lamp: 0.7, color: new THREE.Color('#ffe2b8') };

const ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';

/**
 * three.js's lights, with the sun (the first directional light) lighting only what `skyIndoor` (sky.ts's
 * SURFACE) says is outdoors and the indoor light (the second) only what's indoors. A scene with the sun
 * alone (a preview) keeps it everywhere.
 */
export const INDOOR_LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  ANCHOR,
  `${ANCHOR}
		#if NUM_DIR_LIGHTS > 1
		directLight.color *= UNROLLED_LOOP_INDEX == 1 ? skyIndoor : 1.0 - skyIndoor;
		#endif`,
);

/** The indoor light as bright as the sun is, or as the lamps when they're brighter. */
export function lightIndoors(light: THREE.DirectionalLight, sun: THREE.DirectionalLight, lampsOn: number) {
  const lamp = INDOOR_LIGHT.lamp * lampsOn;
  light.color.copy(sun.color);
  light.intensity = sun.intensity;
  if (lamp > sun.intensity) {
    light.color.lerp(INDOOR_LIGHT.color, (lamp - sun.intensity) / lamp);
    light.intensity = lamp;
  }
}
