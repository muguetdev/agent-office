/**
 * The office avatar on a Person (blender/avatar: one body, one skeleton, swappable pieces): the model
 * dresses the Person, whose own cartoon body stays and keeps posing (walking, sitting, emotes, a golf
 * swing, a throw…) but is drawn no more; the avatar's bones copy its limbs and head every frame. Whatever
 * the Person holds or wears (a mug, a card, a hat) is still on its own body, so it shows as before.
 *
 * What each person wears comes from what they already chose (skin, hair colour and style, shirt colour)
 * and, for what they couldn't choose yet (the top, trousers, shoes, glasses, a beard, their colours),
 * from their name, so everyone sees the same outfit on them.
 */
import * as THREE from 'three';
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type Look } from '../../../shared/avatar';
import type { Person } from '../../world/character/person';
import { HIPS } from '../../world/character/rig';
import { model } from '../../world/models';
import { toon } from '../../world/toon';

const A = 'CH_OfficeAvatar_';
const LOD = '_LOD0';
/** The avatar's height to the Person's (its 1.55 m to the cartoon's 1.7). */
const SCALE = 1.1;
/** The avatar's hips over its feet, scaled (thigh joints at 0.49 m), against the Person's (HIPS). */
const AVATAR_HIPS = 0.49 * SCALE;

/** What the pieces are, by slot (blender/avatar/CH_OfficeAvatar/avatar-palette.json has the colours). */
const HAIR: Record<string, string | null> = { Short: 'Hair_Wavy', Long: 'Hair_Bob', Bun: 'Hair_Bun', Spiky: 'Hair_Wavy', Curly: 'Hair_Wavy', Ponytail: 'Hair_Bun', Bald: null };
const TOPS = ['Top_HoodieOpen', 'Top_Jacket', 'Top_Tee'];
const BOTTOMS = ['Bottom_Trousers', 'Bottom_Joggers'];
const SHOES = ['Shoes_Sneakers', 'Shoes_Runners'];
/** What a top hides of the body under it (the pieces' `covers`). */
const COVERS: Record<string, string[]> = { Top_HoodieOpen: ['Body_Torso', 'Body_Arms'], Top_Jacket: ['Body_Torso', 'Body_Arms'], Top_Tee: ['Body_Torso'] };
const PANTS = ['#2A3044', '#3B4256', '#7F858F', '#B8A486'];
const SHOE_COLORS = ['#F4F4F4', '#2F7FF0', '#2B2F37', '#B9BCC2'];
const ACCENTS = ['#2F7FF0', '#F4F4F4', '#2B2F37', '#2E8A84'];
const FIXED: Record<string, string> = { M_Eyes: '#17120F', M_EyeHighlight: '#FFFFFF', M_Mouth: '#8A2E22', M_Teeth: '#FAFAF7', M_Accessories: '#22252B', M_SecondaryClothing: '#F4F4F2' };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Outfit {
  pieces: string[];
  colors: Record<string, string>;
}

/** What someone called `name`, in `shirt` and with `look`, wears. */
export function outfitFor(name: string, shirt: string, look: Look): Outfit {
  const h = hash(name || 'someone');
  const top = TOPS[h % TOPS.length];
  const pieces = ['Body_Head', 'Body_Neck', 'Body_Hands', 'Body_Legs', 'Face_Eyes', 'Face_Brows', 'Face_Mouth', top, BOTTOMS[(h >>> 3) % BOTTOMS.length], SHOES[(h >>> 5) % SHOES.length]];
  for (const part of ['Body_Torso', 'Body_Arms']) if (!COVERS[top].includes(part)) pieces.push(part);
  const hair = HAIR[HAIR_STYLES[look.style]] ?? null;
  if (hair) pieces.push(hair);
  const g = (h >>> 7) % 8;
  if (g === 0) pieces.push('Glasses_Round');
  else if (g === 1) pieces.push('Glasses_Square');
  const b = (h >>> 11) % 10;
  if (b === 0) pieces.push('Beard_Stubble');
  else if (b === 1) pieces.push('Beard_Full');
  return {
    pieces,
    colors: {
      ...FIXED,
      M_Skin: SKIN_TONES[look.skin],
      M_Hair: HAIR_COLORS[look.hair],
      M_PrimaryClothing: shirt,
      M_Pants: PANTS[(h >>> 13) % PANTS.length],
      M_Shoes: SHOE_COLORS[(h >>> 15) % SHOE_COLORS.length],
      M_ShoesAccent: ACCENTS[(h >>> 17) % ACCENTS.length],
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

const q = new THREE.Quaternion();
const qa = new THREE.Quaternion();
const down = new THREE.Vector3();

/** One person's avatar: the model's pieces they wear, posed after their cartoon body. */
export class Avatar {
  readonly root: THREE.Object3D;
  private drives: Drive[] = [];
  private knees: Knee[] = [];
  private faces: THREE.Mesh[] = [];
  /** The cartoon body's own meshes, drawn no more while the avatar's on. */
  private hidden: THREE.Object3D[];
  private key = '';
  private blinkIn = 2 + Math.random() * 3;
  private blinkT = -1;

  constructor(readonly person: Person) {
    const m = model('avatar')!;
    this.root = m.scene;
    this.root.scale.setScalar(SCALE);
    const rig = person.rig;
    rig.body.add(this.root);
    // The cartoon body's meshes: the torso, everything on the head as it's made (the face and the hair
    // group), the limbs' capsules and the hands; not what's added later (a hat, an outfit) or held.
    this.hidden = [rig.torso, ...rig.head.children, ...[rig.armL, rig.armR].flatMap((a) => a.children.slice(0, 2)), rig.legL.children[0], rig.legR.children[0]];
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
    const key = `${p.name}|${shirt}|${p.look.skin},${p.look.hair},${p.look.style}`;
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
      mesh.visible = wear.has(piece);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      // Each material is a role (M_Skin…), painted the person's colour for it: shared toon materials,
      // so everyone in the same colour shares one. The roles are kept on the mesh the first time.
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const roles: string[] = (mesh.userData.roles ??= mats.map((mt) => mt.name));
      const painted = roles.map((r) => toon(outfit.colors[r] ?? '#ff00ff'));
      mesh.material = Array.isArray(mesh.material) ? painted : painted[0];
      if (mesh.visible && mesh.morphTargetDictionary && piece.startsWith(A + 'Face_')) this.faces.push(mesh);
    });
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
    for (const d of this.drives) d.bone.quaternion.copy(d.parentInv).multiply(qa.copy(d.part.quaternion)).multiply(d.rest);
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
