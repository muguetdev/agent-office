import * as THREE from 'three';
import type { EmoteId } from '../../../shared/emotes';
import { GESTURES, type HandPose } from '../../world/hands-avatar';

/**
 * The avatar's hands in third person: the model's fists and its gesture hands (an open hand, pointing, a
 * thumbs up), each split into its right and left hand so each side shows the shape the emote needs.
 */
const POSES: Record<string, HandPose> = { Body_Hands: 'fist', Body_HandsOpen: 'open', Body_HandsPoint: 'point', Body_HandsThumb: 'thumb' };

/** Each hands geometry's two halves (they share its buffers): the character's right hand (at -x) and left. */
const halves = new Map<THREE.BufferGeometry, [THREE.BufferGeometry, THREE.BufferGeometry]>();

function split(mesh: THREE.SkinnedMesh): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const geo = mesh.geometry;
  let out = halves.get(geo);
  if (out) return out;
  const pos = geo.getAttribute('position');
  const index = geo.index;
  const count = index ? index.count : pos.count;
  const sides: [number[], number[]] = [[], []];
  const v = new THREE.Vector3();
  for (let t = 0; t < count; t += 3) {
    const tri = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k));
    const x = tri.reduce((sum, i) => sum + v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).x, 0);
    sides[x < 0 ? 0 : 1].push(...tri);
  }
  out = sides.map((idx) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
    g.setIndex(idx);
    g.boundingSphere = geo.boundingSphere;
    return g;
  }) as [THREE.BufferGeometry, THREE.BufferGeometry];
  halves.set(geo, out);
  return out;
}

export class AvatarHands {
  /** Each shape's right and left hand. */
  private sides = new Map<HandPose, [THREE.SkinnedMesh, THREE.SkinnedMesh]>();

  /** Splits the hands meshes under `root` (the model's piece nodes, by name), before it's first dressed. */
  constructor(root: THREE.Object3D, prefix: string, suffix: string) {
    const found: [THREE.SkinnedMesh, HandPose][] = [];
    root.traverse((o) => {
      const pose = POSES[o.name.slice(prefix.length, o.name.length - suffix.length)];
      if (pose && (o as THREE.SkinnedMesh).isSkinnedMesh) found.push([o as THREE.SkinnedMesh, pose]);
    });
    for (const [mesh, pose] of found) {
      const [r, l] = split(mesh).map((g) => {
        const half = mesh.clone() as THREE.SkinnedMesh;
        half.geometry = g;
        mesh.parent!.add(half);
        return half;
      });
      mesh.removeFromParent();
      this.sides.set(pose, [r, l]);
    }
  }

  /** After dressing (which shows the fists): the shapes for `emote`, each hand its own. */
  pose(emote: EmoteId | null) {
    const want = (emote && GESTURES[emote]) || null;
    for (const [pose, halves] of this.sides)
      halves.forEach((m, side) => {
        const shape = want?.[side] ?? 'fist';
        m.visible = (pose === shape || (pose === 'fist' && !this.sides.has(shape)));
      });
  }
}
