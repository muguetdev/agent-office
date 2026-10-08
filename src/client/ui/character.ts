import './character.css';
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import {
  AVATAR_BEARDS, AVATAR_BOTTOMS, AVATAR_CUTS, AVATAR_GLASSES, AVATAR_SHOES, AVATAR_TOPS, CUT_STYLE, FRAME_COLORS, HAIR_COLORS, INNER_COLORS, PANTS_COLORS, SHOE_COLORS, SKIN_TONES,
  outfitFromSeed, randomLook, randomName, type Look, type Outfit,
} from '../../shared/avatar';
import { AVATAR_COLORS, saveProfile, store, type Profile } from '../state';
import { Person } from '../world/character';
import { skyShading } from '../world/sky';
import { toonUnique } from '../world/toon';
import { h, openModal } from './dom';
import { L } from '../i18n';

/** A turntable with your character on it, drawn with its own small renderer. */
class Preview {
  readonly person: Person;
  private renderer: THREE.WebGLRenderer;
  private effect: OutlineEffect;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  private raf = 0;
  private resize: ResizeObserver;
  private yaw = 0.5;
  private dragging = false;
  private lastDrag = -Infinity;
  private hopT = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    p: Profile,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.effect = new OutlineEffect(this.renderer, { defaultThickness: 0.0045, defaultColor: [0.17, 0.18, 0.26] });

    this.scene.add(new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5));
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.5));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    sun.position.set(-3, 6, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 20 });
    this.scene.add(sun);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), toonUnique('#ffd6a5'));
    rug.rotation.x = -Math.PI / 2;
    rug.receiveShadow = true;
    rug.material.userData.outlineParameters = { visible: false };
    this.scene.add(rug);

    this.person = new Person(p.name, p.color, p.look);
    this.person.showLabel(false);
    this.scene.add(this.person.root);
    this.camera.position.set(0, 1.35, 4.6);
    this.camera.lookAt(0, 0.95, 0);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    this.fit();

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += e.movementX * 0.012;
      this.lastDrag = performance.now();
    });
    const release = () => {
      this.dragging = false;
      this.lastDrag = performance.now();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.tick(dt, now / 1000);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** A little hop and wave, to show a change landed. */
  cheer() {
    this.hopT = 0;
    this.person.reach();
  }

  private fit() {
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    if (!w || !hgt) return;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  private tick(dt: number, t: number) {
    // Left alone, the character sways from side to side so you see the hair from every angle.
    if (!this.dragging && performance.now() - this.lastDrag > 1500) {
      const want = Math.sin(t * 0.6) * 1.1;
      this.yaw += (want - this.yaw) * Math.min(1, dt * 1.5);
    }
    this.person.root.rotation.y = this.yaw;
    let y = 0;
    if (this.hopT >= 0) {
      this.hopT += dt * 3.2;
      y = Math.sin(Math.min(1, this.hopT) * Math.PI) * 0.18;
      if (this.hopT >= 1) this.hopT = -1;
    }
    this.person.root.position.y = y;
    this.person.update(dt, t, false, y > 0.01);
    // The avatar (features/avatars) dressed and posed now, whether or not the office is drawing frames.
    (this.person.root.userData.avatar as { update(dt: number): void } | undefined)?.update(dt);
    // In its own light, not the office's (where the preview's spot, the origin, would be indoors).
    skyShading(false);
    this.effect.render(this.scene, this.camera);
    skyShading(true);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/**
 * The character select screen: your name, skin tone, hair and shirt, with a live preview.
 * `first` is the one you see when you join: closing it goes in as whoever's picked so far.
 */
export function openCharacter(first: boolean, onSave: (p: Profile) => void) {
  const pick: Profile = { ...store.profile, look: { ...store.profile.look } };
  // Someone who hasn't picked an outfit starts from the one they've been seen in (from their name).
  pick.look.outfit ??= outfitFromSeed(pick.name, pick.look.style);
  const canvas = h('canvas', { 'aria-label': L.character.preview }) as HTMLCanvasElement;
  const preview = new Preview(canvas, pick);
  // For screenshots and debugging, like window.__office.
  (window as unknown as { __charPreview?: Preview }).__charPreview = preview;

  // Leave the name blank (or skip this) and you go by the made-up one in the box; 🎲 deals another.
  // Guest is what you were before you picked one, so it isn't a name to keep.
  const input = h('input', { type: 'text', maxlength: 24, value: pick.name === 'Guest' ? '' : pick.name, placeholder: randomName(), 'aria-label': L.character.name }) as HTMLInputElement;
  const reroll = h('button.btn', { type: 'button', title: L.character.randomName, 'aria-label': L.character.randomName }, '🎲');
  reroll.addEventListener('click', () => {
    let name = randomName();
    while (name === input.value || name === input.placeholder) name = randomName();
    input.value = input.placeholder = name;
    input.focus();
  });
  const typedName = () => input.value.trim().slice(0, 24) || input.placeholder;
  // Your account's name is the one everyone sees; only the look is yours to change here.
  const account = store.me.account;
  if (account) {
    input.value = account.name;
    input.readOnly = true;
    input.title = L.character.accountName;
  }

  const skinRow = h('div.swatches', { role: 'radiogroup', 'aria-label': L.character.skinTone });
  const hairRow = h('div.swatches', { role: 'radiogroup', 'aria-label': L.character.hairColor });
  const shirtRow = h('div.swatches', { role: 'radiogroup', 'aria-label': L.character.topColor });
  const C = L.character;
  // The avatar's pieces: a row of choices each, and a colour row for the trousers and shoes.
  const kinds: [keyof Outfit, string, readonly string[], readonly string[]][] = [
    ['cut', C.hairStyle, AVATAR_CUTS, C.cuts],
    ['beard', C.beard, AVATAR_BEARDS, C.beards],
    ['glasses', C.glasses, AVATAR_GLASSES, C.glassesKinds],
    ['top', C.top, AVATAR_TOPS, C.tops],
    ['bottom', C.pants, AVATAR_BOTTOMS, C.bottoms],
    ['shoes', C.shoes, AVATAR_SHOES, C.shoeKinds],
    ['badge', C.badge, ['None', 'Lanyard'], C.badgeKinds],
  ];
  const rows = Object.fromEntries(kinds.map(([k, label]) => [k, h('div.seg', { role: 'radiogroup', 'aria-label': label })])) as Record<string, HTMLElement>;
  const pantsRow = h('div.swatches', { role: 'radiogroup', 'aria-label': C.pantsColor });
  const shoeRow = h('div.swatches', { role: 'radiogroup', 'aria-label': C.shoesColor });
  const innerRow = h('div.swatches', { role: 'radiogroup', 'aria-label': C.innerColor });
  const framesRow = h('div.swatches', { role: 'radiogroup', 'aria-label': C.framesColor });

  const swatch = (color: string, label: string, on: boolean, choose: () => void) =>
    h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(on), style: `background:${color}`, class: on ? 'sel' : '', 'aria-label': label, title: label, onclick: choose });

  const change = (look: Partial<Look>, color?: string) => {
    Object.assign(pick.look, look);
    // The classic cartoon's hair follows the avatar's cut, for whoever sees the classic people.
    if (pick.look.outfit) pick.look.style = CUT_STYLE[pick.look.outfit.cut];
    if (color) pick.color = color;
    preview.person.setLook(pick.look);
    preview.person.setColor(pick.color);
    preview.cheer();
    paint();
  };

  const paint = () => {
    const { skin, hair } = pick.look;
    const o = pick.look.outfit!;
    const wear = (part: Partial<Outfit>) => change({ outfit: { ...o, ...part } });
    skinRow.replaceChildren(...SKIN_TONES.map((c, i) => swatch(c, L.character.skinToneN(i + 1, SKIN_TONES.length), i === skin, () => change({ skin: i }))));
    for (const [k, , names, labels] of kinds)
      rows[k].replaceChildren(
        ...names.map((name, i) => h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(i === o[k]), class: i === o[k] ? 'on' : '', onclick: () => wear({ [k]: i }) }, labels[i] ?? name)),
      );
    pantsRow.replaceChildren(...PANTS_COLORS.map((c, i) => swatch(c, C.colorN(i + 1, PANTS_COLORS.length), i === o.pants, () => wear({ pants: i }))));
    shoeRow.replaceChildren(...SHOE_COLORS.map((c, i) => swatch(c, C.colorN(i + 1, SHOE_COLORS.length), i === o.shoeColor, () => wear({ shoeColor: i }))));
    innerRow.replaceChildren(...INNER_COLORS.map((c, i) => swatch(c, C.colorN(i + 1, INNER_COLORS.length), i === o.inner, () => wear({ inner: i }))));
    framesRow.replaceChildren(...FRAME_COLORS.map((c, i) => swatch(c, C.colorN(i + 1, FRAME_COLORS.length), i === o.frames, () => wear({ frames: i }))));
    framesRow.hidden = !o.glasses;
    hairRow.replaceChildren(...HAIR_COLORS.map((c, i) => swatch(c, L.character.hairColors[i], i === hair, () => change({ hair: i }))));
    shirtRow.replaceChildren(...AVATAR_COLORS.map((c) => swatch(c, L.character.shirtN(c), c === pick.color, () => change({}, c))));
  };
  paint();

  const surprise = h('button.btn', { type: 'button', title: L.character.randomLook }, L.character.surprise);
  surprise.addEventListener('click', () => change(randomLook(), AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]));
  const save = h('button.btn.primary', { type: 'submit' }, first ? L.character.enter : L.character.save);
  const close = h('button.btn.close', { type: 'button', 'aria-label': L.character.close, title: first ? L.character.skip : L.common.closeEsc }, '✕');

  const form = h(
    'form.modal.charsel',
    { role: 'dialog', 'aria-label': L.character.dialog },
    h('header', {}, h('h2', {}, first ? L.character.titleFirst : L.character.title), close),
    h(
      'div.body',
      {},
      h('div.charsel-stage', {}, canvas, h('span.tip', {}, L.character.dragToSpin)),
      h(
        'div.charsel-opts',
        {},
        h('label', {}, L.character.name),
        account ? input : h('div.webhook', {}, input, reroll),
        account ? h('p.setting-note', {}, L.character.signedInAs(account.name)) : null,
        h('label', {}, L.character.skinTone),
        skinRow,
        h('label', {}, L.character.hair),
        rows.cut,
        hairRow,
        h('label', {}, C.beard),
        rows.beard,
        h('label', {}, C.glasses),
        rows.glasses,
        framesRow,
        h('label', {}, C.top),
        rows.top,
        shirtRow,
        h('label', {}, C.innerColor),
        innerRow,
        h('label', {}, C.badge),
        rows.badge,
        h('div.charsel-pair', {}, h('div', {}, h('label', {}, C.pants), rows.bottom, pantsRow), h('div', {}, h('label', {}, C.shoes), rows.shoes, shoeRow)),
      ),
    ),
    h('footer', {}, surprise, h('span.grow'), save),
  ) as HTMLFormElement;

  let done = false;
  const finish = (name: string) => {
    done = true;
    store.profile = { name, color: pick.color, look: { ...pick.look } };
    saveProfile(store.profile);
    modal.close();
    onSave(store.profile);
  };
  const modal = openModal(form, {
    // A stray click shouldn't skip the first one; ✕ and Esc still do.
    backdropCloses: !first,
    doing: L.character.doing,
    onClose: () => {
      preview.dispose();
      // The office only lets you in with a character: skipping it goes in with this one, and the name in the box.
      if (first && !done) finish(typedName());
    },
  });
  close.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    finish(typedName());
  });
  if (!account) setTimeout(() => input.focus(), 30);
}
