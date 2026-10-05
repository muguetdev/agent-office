// Inside the office the light comes from the lamps overhead, never the sky's sun, and casts no shadows:
// decided point by point (sky.ts's skyInOffice), so the office looks the same from inside and from the
// street, and everything outside it (the street, the garage under it) keeps the sun and its shadows.
import * as THREE from 'three';

/** Where the light indoors comes from (nearly straight down, a little off so walls aren't side-on to it), and how bright and warm it is once the lamps are on. */
export const INDOOR_LIGHT = { dir: new THREE.Vector3(0.22, 1, 0.14).normalize(), lamp: 0.7, color: new THREE.Color('#ffe2b8') };

/** The indoor light: its direction (world space) and its color times its brightness. */
export const indoorUniforms = { skyIndoorDir: { value: INDOOR_LIGHT.dir }, skyIndoorColor: { value: new THREE.Color() } };

export const INDOOR_PARS = /* glsl */ `
uniform vec3 skyIndoorDir;
uniform vec3 skyIndoorColor;
`;

const ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';
const SHADOWED = '( directLight.visible && receiveShadow )';

/**
 * three.js's lights, with the sun turned into the indoor light, and its shadows off, as far as `skyIndoor`
 * (sky.ts's SURFACE) says the point's indoors. A surface facing away from the light takes no shadows
 * either: it's on its own dark side already, and the garage's ceiling would otherwise catch the shadows
 * of whatever stands on the floor over it.
 */
export const INDOOR_LIGHTS = THREE.ShaderChunk.lights_fragment_begin
  .replace(
    ANCHOR,
    `${ANCHOR}
		directLight.direction = normalize( mix( directLight.direction, normalize( ( viewMatrix * vec4( skyIndoorDir, 0.0 ) ).xyz ), skyIndoor ) );
		directLight.color = mix( directLight.color, skyIndoorColor, skyIndoor );`,
  )
  .replaceAll(SHADOWED, '( directLight.visible && receiveShadow && skyIndoor < 0.5 && dot( geometryNormal, directLight.direction ) > 0.0 )');

/** The indoor light as bright as the sun is, or as the lamps when they're brighter. */
export function lightIndoors(sun: THREE.DirectionalLight, lampsOn: number) {
  const lamp = INDOOR_LIGHT.lamp * lampsOn;
  const c = indoorUniforms.skyIndoorColor.value.copy(sun.color);
  let i = sun.intensity;
  if (lamp > i) {
    c.lerp(INDOOR_LIGHT.color, (lamp - i) / lamp);
    i = lamp;
  }
  c.multiplyScalar(i);
}
