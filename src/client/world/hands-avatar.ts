import * as THREE from 'three';
import type { EmoteId } from '../../shared/emotes';
import { model } from './models';
import { mesh } from './toon';

/**
 * Your arms in first person as the office avatar has them (features/avatars, blender/avatar): its own
 * hand, out of the model, at the end of a soft sleeve in your top's colour with a ribbed cuff, or of a
 * bare forearm in a tee. In world/hands.ts's arm frame: the wrist at the origin, the arm back along +z.
 */

/** The hand's length, knuckles to wrist, on screen (the old round hand was 0.11 across). */
const HAND = 0.135;
/** Turned about the forearm so the back of the hand is up and the palm faces in a little. */
const ROLL = 0.35;

/** The hand's shapes (the model's fists and its gesture hands, blender/avatar 03_forms.py). */
export type HandPose = 'fist' | 'open' | 'point' | 'thumb';
const POSES: Record<HandPose, string> = { fist: 'Body_Hands', open: 'Body_HandsOpen', point: 'Body_HandsPoint', thumb: 'Body_HandsThumb' };

/** The hands each emote makes: the right one's and the left one's (the rest of the time, fists). */
export const GESTURES: Partial<Record<EmoteId, [HandPose, HandPose]>> = {
  wave: ['open', 'fist'],
  thumbs: ['thumb', 'fist'],
  clap: ['open', 'open'],
  dance: ['open', 'open'],
  point: ['point', 'fist'],
  facepalm: ['open', 'fist'],
};

const sources = new Map<string, THREE.SkinnedMesh | null>();

/** One of the avatar's hands meshes (both hands in one), from one copy of the model. */
function handsMesh(pose: HandPose): THREE.SkinnedMesh | null {
  const name = `CH_OfficeAvatar_${POSES[pose]}_LOD0`;
  if (!sources.has(name)) {
    let found: THREE.SkinnedMesh | null = null;
    (copy ??= model('avatar')?.scene ?? null)?.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!found && m.isSkinnedMesh && (m.name === name || m.parent?.name === name)) found = m;
    });
    sources.set(name, found);
  }
  return sources.get(name)!;
}
let copy: THREE.Object3D | null = null;
/** How much the hands are scaled on screen: the fist's length to HAND, the same for every shape. */
let size = 0;

/** The avatar's hand on `side` (1 is your right) in `pose`, knuckles toward -z; null without the model. */
function avatarHand(side: 1 | -1, pose: HandPose): THREE.BufferGeometry | null {
  const src = handsMesh(pose);
  const bone = src?.skeleton.bones.findIndex((b) => b.name === (side === 1 ? 'hand_R' : 'hand_L')) ?? -1;
  if (!src || bone < 0) return null;
  const pos = src.geometry.getAttribute('position');
  const nor = src.geometry.getAttribute('normal');
  const index = src.geometry.index;
  const corner = (i: number) => (index ? index.getX(i) : i);
  const count = index ? index.count : pos.count;
  const p: number[] = [];
  const n: number[] = [];
  const v = new THREE.Vector3();
  for (let t = 0; t < count; t += 3) {
    // Only this side's hand: the character faces +z, so its right hand is out at -x.
    let x = 0;
    for (let k = 0; k < 3; k++) x += v.fromBufferAttribute(pos, corner(t + k)).applyMatrix4(src.bindMatrix).x;
    if (x * side > 0) continue;
    for (let k = 0; k < 3; k++) {
      p.push(...v.fromBufferAttribute(pos, corner(t + k)).toArray());
      n.push(...v.fromBufferAttribute(nor, corner(t + k)).toArray());
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  // Into the hand bone's frame (+y out to the fingers), then the fingers forward (-z).
  geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(src.skeleton.boneInverses[bone], src.bindMatrix));
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(side * ROLL));
  if (pose === 'fist' && !size) {
    geo.computeBoundingBox();
    size = HAND / (geo.boundingBox!.max.z - geo.boundingBox!.min.z);
  }
  geo.scale(size || 1, size || 1, size || 1);
  return geo;
}

export interface AvatarArm {
  /** The sleeve and its cuff, or (in a tee) the bare forearm. */
  sleeve: THREE.Mesh[];
  forearm: THREE.Mesh;
  /** The hand, its shapes in it (the avatar's, or a round one if the model isn't there), one shown at a time. */
  hand: THREE.Group;
  poses: Partial<Record<HandPose, THREE.Mesh>>;
}

/** Shows `arm`'s hand in `pose` (a fist if it has no such shape). */
export function showPose(arm: AvatarArm, pose: HandPose) {
  const want = arm.poses[pose] ? pose : 'fist';
  for (const [k, m] of Object.entries(arm.poses)) m.visible = k === want;
}

/** One arm on `group`: a sleeve from the wrist back past the camera, its far end always off screen. */
export function avatarArm(group: THREE.Group, side: 1 | -1, cloth: THREE.Material, skin: THREE.Material): AvatarArm {
  const tube = mesh(new THREE.CylinderGeometry(0.064, 0.054, 0.52, 20, 1, true).rotateX(Math.PI / 2), cloth, 0, 0, 0.32, false);
  const rib = mesh(new THREE.TorusGeometry(0.05, 0.015, 10, 22), cloth, 0, 0, 0.065, false);
  rib.scale.z = 1.6;
  const forearm = mesh(new THREE.CylinderGeometry(0.046, 0.034, 0.56, 16, 1, true).rotateX(Math.PI / 2), skin, 0, 0, 0.29, false);
  forearm.visible = false;
  const hand = new THREE.Group();
  const poses: AvatarArm['poses'] = {};
  for (const pose of Object.keys(POSES) as HandPose[]) {
    const geo = avatarHand(side, pose);
    if (geo) poses[pose] = mesh(geo, skin, 0, 0, 0.03, false);
  }
  poses.fist ??= mesh(new THREE.SphereGeometry(0.056, 20, 16), skin, 0, 0, -0.012, false);
  hand.add(...Object.values(poses));
  group.add(tube, rib, forearm, hand);
  const arm = { sleeve: [tube, rib], forearm, hand, poses };
  showPose(arm, 'fist');
  return arm;
}
