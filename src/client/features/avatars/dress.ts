/**
 * The office avatar on a Person (blender/avatar: one body, one skeleton, swappable pieces): the model
 * dresses the Person, whose own cartoon body stays and keeps posing (walking, sitting, emotes, a golf
 * swing, a throw…) but is drawn no more; the avatar's bones copy its limbs and head every frame. Whatever
 * the Person holds or wears (a mug, a card, a hat) is still on its own body, so it shows as before.
 *
 * What each person wears is their look: skin, hair colour, the shirt colour and the outfit they picked in the
 * character editor (the cut, the top, trousers, shoes, glasses, a beard); someone who hasn't picked one yet
 * gets one from their name, so everyone sees the same on them.
 */
import * as THREE from 'three';
import {
  AVATAR_BEARDS, AVATAR_BOTTOMS, AVATAR_CUTS, AVATAR_GLASSES, AVATAR_SHOES, AVATAR_TOPS, FRAME_COLORS, HAIR_COLORS, INNER_COLORS, PANTS_COLORS, SHOE_COLORS, SKIN_TONES,
  outfitOf, type Look,
} from '../../../shared/avatar';
import type { EmoteId } from '../../../shared/emotes';
import type { Person } from '../../world/character/person';
import { HIPS } from '../../world/character/rig';
import { model } from '../../world/models';
import { AvatarHands } from './hands';
import { avatarMaterial } from './material';

const A = 'CH_OfficeAvatar_';
const LOD = '_LOD0';
/** The avatar's height to the Person's (its 1.55 m to the cartoon's 1.7). */
const SCALE = 1.1;
/** The avatar's hips over its feet, scaled (thigh joints at 0.49 m), against the Person's (HIPS). */
const AVATAR_HIPS = 0.49 * SCALE;

/** What a top hides of the body under it (the pieces' `covers`). */
const COVERS: Record<string, string[]> = { HoodieOpen: ['Body_Torso', 'Body_Arms'], Jacket: ['Body_Torso', 'Body_Arms'], Sweater: ['Body_Torso', 'Body_Arms'], Tee: ['Body_Torso'], TeePrint: ['Body_Torso'] };
/** The model's pieces for a top: the tee with the sheet's print is the tee and the print. */
const TOP_PIECES: Record<string, string[]> = { TeePrint: ['Top_Tee', 'Print_Squares'] };
const FIXED: Record<string, string> = { M_Eyes: '#17120F', M_EyeHighlight: '#FFFFFF', M_Mouth: '#8A2E22', M_Teeth: '#FAFAF7', M_Print: '#F2A541', M_Lanyard: '#2F7FF0', M_Badge: '#F4F4F2' };

export interface Dress {
  pieces: string[];
  colors: Record<string, string>;
}

/** The pieces and role colours for someone called `name`, in `shirt` and with `look`. */
export function outfitFor(name: string, shirt: string, look: Look): Dress {
  const o = outfitOf(name, look);
  const top = AVATAR_TOPS[o.top];
  const pieces = ['Body_Head', 'Body_Neck', 'Body_Hands', 'Body_Legs', 'Face_Eyes', 'Face_Brows', 'Face_Mouth', ...(TOP_PIECES[top] ?? [`Top_${top}`]), `Bottom_${AVATAR_BOTTOMS[o.bottom]}`, `Shoes_${AVATAR_SHOES[o.shoes]}`];
  for (const part of ['Body_Torso', 'Body_Arms']) if (!COVERS[top].includes(part)) pieces.push(part);
  if (AVATAR_CUTS[o.cut] !== 'Bald') pieces.push(`Hair_${AVATAR_CUTS[o.cut]}`);
  if (o.glasses) pieces.push(`Glasses_${AVATAR_GLASSES[o.glasses]}`);
  if (o.beard) pieces.push(`Beard_${AVATAR_BEARDS[o.beard]}`);
  if (o.badge) pieces.push('Badge_Lanyard');
  return {
    pieces,
    colors: {
      ...FIXED,
      M_Skin: SKIN_TONES[look.skin],
      M_Hair: HAIR_COLORS[look.hair],
      M_PrimaryClothing: shirt,
      M_SecondaryClothing: INNER_COLORS[o.inner],
      M_Accessories: FRAME_COLORS[o.frames],
      M_Pants: PANTS_COLORS[o.pants],
      M_Shoes: SHOE_COLORS[o.shoeColor],
      // The stripes blue, or white on blue shoes.
      M_ShoesAccent: SHOE_COLORS[o.shoeColor === 1 ? 0 : 1],
    },
  };
}

/** A Person's limbs (see world/character/rig.ts) and the avatar bones that copy them. Forward is +z, so the Person's armR (on +x) is the character's left. */
const DRIVEN: [keyof Person['rig'], string][] = [
  ['head', 'head'],
  ['armR', 'upperarm_L'],
  ['armL', 'upperarm_R'],
  ['legR', 'thigh_L'],
  ['legL', 'thigh_R'],
];

interface Drive {
  part: THREE.Object3D;
  bone: THREE.Bone;
  /** The bone's parent's orientation in the Person's body at rest (inverted), and the bone's own. */
  parentInv: THREE.Quaternion;
  rest: THREE.Quaternion;
}

interface Knee {
  leg: THREE.Object3D;
  shin: THREE.Bone;
  rest: THREE.Quaternion;
  /** The axis across the body, in the thigh's frame, that the knee bends about. */
  axis: THREE.Vector3;
}

/** What's on the head, not drawn in first person (the camera's inside it). */
const HEAD = /_(Body_Head|Body_Neck|Face_|Hair_|Beard_|Glasses_)/;

/**
 * Gestures the avatar's bigger head and hands need beyond the cartoon's pose: the right hand turned about
 * its length (radians; a wave's palm out to whoever you wave at, a facepalm's onto the face) and the right
 * arm brought forward (radians about the body's x) so the hand lands on the face, not in it.
 */
const GESTURE_FIX: Partial<Record<EmoteId, { twist: number; forward: number }>> = {
  wave: { twist: -1.5, forward: 0 },
  facepalm: { twist: -1.2, forward: 0.35 },
};

const q = new THREE.Quaternion();
const qa = new THREE.Quaternion();
const down = new THREE.Vector3();
const off = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);

/** One person's avatar: the model's pieces they wear, posed after their cartoon body. */
export class Avatar {
  readonly root: THREE.Object3D;
  private drives: Drive[] = [];
  private knees: Knee[] = [];
  private faces: THREE.Mesh[] = [];
  /** The cartoon body's own meshes, drawn no more while the avatar's on. */
  private hidden: THREE.Object3D[];
  private key = '';
  private hands: AvatarHands;
  private fp = false;
  /** The thighs' rest places on the pelvis, and the right hand with the axis along it (to its fingers). */
  private thighs: { bone: THREE.Bone; rest: THREE.Vector3 }[] = [];
  private handR: { bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3 } | null = null;
  private gesture = { twist: 0, forward: 0 };
  private blinkIn = 2 + Math.random() * 3;
  private blinkT = -1;

  constructor(readonly person: Person) {
    const m = model('avatar')!;
    this.root = m.scene;
    person.root.userData.avatar = this;
    this.root.scale.setScalar(SCALE);
    const rig = person.rig;
    rig.body.add(this.root);
    // The cartoon body's meshes: the torso, everything on the head as it's made (the face and the hair
    // group), the limbs' capsules, the hands and the emotes' thumb and finger; not what's added later (a hat,
    // an outfit) or held (a mug, a cigarette: groups).
    this.hidden = [rig.torso, ...rig.head.children, ...[rig.armL, rig.armR].flatMap((a) => a.children.filter((c) => (c as THREE.Mesh).isMesh)), rig.legL.children[0], rig.legR.children[0]];
    this.hands = new AvatarHands(this.root, A, LOD);
    this.dress();
    // The bones' rest orientations in the body, for copying the limbs onto them.
    rig.body.updateMatrixWorld(true);
    const bodyInv = new THREE.Quaternion();
    rig.body.getWorldQuaternion(bodyInv).invert();
    const inBody = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion()).premultiply(bodyInv);
    for (const [part, name] of DRIVEN) {
      const bone = this.root.getObjectByName(name) as THREE.Bone | undefined;
      if (!bone?.parent) continue;
      this.drives.push({ part: rig[part] as THREE.Object3D, bone, parentInv: inBody(bone.parent).invert(), rest: inBody(bone) });
    }
    for (const side of ['L', 'R']) {
      const bone = this.root.getObjectByName(`thigh_${side}`) as THREE.Bone | undefined;
      if (bone) this.thighs.push({ bone, rest: bone.position.clone() });
    }
    const hand = this.root.getObjectByName('hand_R') as THREE.Bone | undefined;
    const fingers = this.root.getObjectByName('fingers_R');
    if (hand && fingers) this.handR = { bone: hand, rest: hand.quaternion.clone(), axis: fingers.position.clone().normalize() };
    for (const [leg, side] of [['legR', 'L'], ['legL', 'R']] as const) {
      const shin = this.root.getObjectByName(`shin_${side}`) as THREE.Bone | undefined;
      const thigh = this.root.getObjectByName(`thigh_${side}`);
      if (!shin || !thigh) continue;
      this.knees.push({ leg: rig[leg], shin, rest: shin.quaternion.clone(), axis: new THREE.Vector3(1, 0, 0).applyQuaternion(inBody(thigh).invert()) });
    }
  }

  /** Puts on the pieces and colours for who they are now, if that's changed. */
  dress() {
    const p = this.person;
    const shirt = `#${p.shirt.color.getHexString()}`;
    const key = `${p.name}|${shirt}|${JSON.stringify(p.look)}|${this.fp}`;
    if (key === this.key) return;
    this.key = key;
    const outfit = outfitFor(p.name, shirt, p.look);
    const wear = new Set(outfit.pieces.map((n) => A + n + LOD));
    this.faces = [];
    this.root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      // A piece is a node of the model, its mesh itself or (one per material) the meshes under it.
      const piece = wear.has(mesh.name) ? mesh.name : (mesh.parent?.name ?? '');
      mesh.visible = wear.has(piece) && !(this.fp && HEAD.test(piece));
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      // Each material is a role (M_Skin…), painted the person's colour for it: shared toon materials,
      // so everyone in the same colour shares one. The roles are kept on the mesh the first time.
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const roles: string[] = (mesh.userData.roles ??= mats.map((mt) => mt.name));
      const painted = roles.map((r) => avatarMaterial(outfit.colors[r] ?? '#ff00ff', piece.startsWith(A + 'Face_')));
      mesh.material = Array.isArray(mesh.material) ? painted : painted[0];
      if (mesh.visible && mesh.morphTargetDictionary && piece.startsWith(A + 'Face_')) this.faces.push(mesh);
    });
  }

  /**
   * You in first person: no head (the camera's in it) and no arms (your hands are drawn on their own), and
   * kept when the rest of you is hidden (world/character/person-first.ts).
   */
  firstPerson(on: boolean) {
    if (on === this.fp) return;
    this.fp = this.root.userData.firstPerson = on;
    for (const n of ['upperarm_L', 'upperarm_R']) this.root.getObjectByName(n)?.scale.setScalar(on ? 0.001 : 1);
    this.key = '';
    if (!on) for (const t of this.thighs) t.bone.position.copy(t.rest);
  }

  /** Turns the avatar on (the cartoon body hidden) or off (the cartoon back). */
  show(on: boolean) {
    this.root.visible = on;
    for (const o of this.hidden) o.traverse((m) => m.layers.set(on ? 31 : 0));
  }

  /** Each frame: the bones after the Person's limbs, the knees bent as they sit, the face talking and blinking. */
  update(dt: number) {
    this.dress();
    // Hair rebuilt on the head (a new style) is new meshes: hidden too. So is a holiday outfit made for
    // the cartoon's body (its hat stays, on the avatar's head).
    const layer = this.root.visible ? 31 : 0;
    for (const o of this.hidden) o.traverse((m) => m.layers.set(layer));
    const rig = this.person.rig;
    for (const part of [rig.torso, rig.armL, rig.armR, rig.legL, rig.legR, rig.body])
      for (const c of part.children) if (c.userData.outfit) c.traverse((m) => m.layers.set(layer));
    if (!this.root.visible) return;
    const emote = this.person.emoteId;
    this.hands.pose(emote);
    // The gesture's fixes, eased in and out with it.
    const fix = (emote && GESTURE_FIX[emote]) || { twist: 0, forward: 0 };
    const ease = Math.min(1, dt * 8);
    this.gesture.twist += (fix.twist - this.gesture.twist) * ease;
    this.gesture.forward += (fix.forward - this.gesture.forward) * ease;
    for (const d of this.drives) {
      qa.copy(d.part.quaternion);
      if (d.bone.name === 'upperarm_R' && this.gesture.forward) qa.premultiply(q.setFromAxisAngle(X, this.gesture.forward));
      d.bone.quaternion.copy(d.parentInv).multiply(qa).multiply(d.rest);
    }
    if (this.handR) this.handR.bone.quaternion.copy(this.handR.rest).multiply(q.setFromAxisAngle(this.handR.axis, this.gesture.twist));
    // A leg out in front (sitting) bends at the knee, the shin hanging down; the hips come down onto the seat.
    let sit = 0;
    for (const k of this.knees) {
      down.set(0, -1, 0).applyQuaternion(k.leg.quaternion);
      const forward = Math.atan2(down.z, -down.y);
      const bend = THREE.MathUtils.clamp((forward - 0.5) / 0.8, 0, 1);
      sit = Math.max(sit, bend);
      k.shin.quaternion.copy(q.setFromAxisAngle(k.axis, forward * bend)).multiply(k.rest);
    }
    this.root.position.y = (HIPS - AVATAR_HIPS) * sit;
    // In first person your body stands back from the camera (see person-first.ts), which would sit your
    // legs back in the seat, under its cushion: seated, the thighs come forward again, out over it.
    if (this.fp) {
      const body = this.person.rig.body.position;
      for (const t of this.thighs) {
        const pelvis = t.bone.parent!;
        this.root.getWorldQuaternion(q).invert();
        pelvis.getWorldQuaternion(qa);
        off.set(-body.x, 0, -body.z).multiplyScalar(sit / SCALE).applyQuaternion(q.multiply(qa).invert());
        t.bone.position.copy(t.rest).add(off);
      }
    }
    // The face: the mouth after the voice, a blink every few seconds.
    this.blinkIn -= dt;
    if (this.blinkIn < 0) {
      this.blinkT = 0;
      this.blinkIn = 2.5 + Math.random() * 3.5;
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      blink = Math.max(0, 1 - Math.abs(this.blinkT - 0.07) / 0.07);
      if (this.blinkT > 0.14) this.blinkT = -1;
    }
    const talk = this.person.mouthOpen;
    for (const f of this.faces) {
      const dict = f.morphTargetDictionary!;
      const w = f.morphTargetInfluences!;
      if (dict.Blink_Left !== undefined) w[dict.Blink_Left] = w[dict.Blink_Right] = blink;
      if (dict.Talk_A !== undefined) w[dict.Talk_A] = talk;
    }
  }
}
