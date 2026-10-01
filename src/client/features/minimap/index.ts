/**
 * The minimap, down in the bottom-right corner, as games have it: a round window on the floor round
 * you, seen from straight above (the office itself, drawn from a camera just under the ceiling a few
 * times a second), turning as you turn so what's ahead of you is up, with an N on its rim for north.
 * You're the arrow in the middle; rings mark the people on the floor in their colours and the workers
 * by what they're doing. The mouse wheel over it zooms. J (or a click on it) opens the whole floor big
 * in the middle of the screen, north up, where a click on someone walks you over to them, and a click
 * on the floor walks you there. It shows or hides from the ☰ menu like the other panels.
 */
import './minimap.css';
import * as THREE from 'three';
import { BALCONY } from '../../../shared/layout';
import type { Bounds } from '../../../shared/nav';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { $, h, openModal } from '../../ui/dom';
import { L } from '../../i18n';

/** The corner map's size on screen (CSS pixels), and how many pixels it's drawn at. */
const SIZE = 190;
const PIXELS = 256;
/** How many times a second the floor is drawn again. */
const FPS = 6;
/** The camera's height over your feet: under the lamps and the ceiling, so it sees the floor, not the roof. */
const OVER = 2.45;
/** How far below the camera it still draws: the floor you're on, not the street or the floor below. */
const DEPTH = OVER + 0.7;
/** Meters across the corner map, and how far the wheel zooms it. */
let span = 16;
const SPAN = { min: 8, max: 34 };
/** The ring round a worker, by what it's doing. */
const WORKER: Record<string, string> = { working: '#06d6a0', needs_input: '#ffd166', starting: '#8ecae6', offline: '#8d99ae', exited: '#8d99ae' };
const RESTING = '#4895ef';
const IDLE = '#ffffff';
const BACKDROP = new THREE.Color('#5c4f45');

interface Mark {
  at: THREE.Vector3;
  color: string;
  /** Waiting on you: its ring pulses. */
  pulse?: boolean;
  /** Where clicking it (on the big map) takes you. */
  go?: () => void;
}

/** A view from straight above, drawn into pixels a 2D canvas can show. */
class TopView {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, DEPTH);
  private target: THREE.WebGLRenderTarget;
  private buffer: Uint8Array;
  private image: ImageData;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.target = new THREE.WebGLRenderTarget(w, h);
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.buffer = new Uint8Array(w * h * 4);
    this.image = new ImageData(w, h);
  }

  /** Frames `width` × `height` meters round (x, y, z), `up` the way that's at the top. */
  frame(x: number, y: number, z: number, width: number, height: number, up: THREE.Vector3) {
    const c = this.camera;
    Object.assign(c, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    c.updateProjectionMatrix();
    c.position.set(x, y + OVER, z);
    c.up.copy(up);
    c.lookAt(x, y, z);
    c.updateMatrixWorld();
  }

  /** Draws `scene` from above without the name tags and bubbles, and puts it on `g`. */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, g: CanvasRenderingContext2D) {
    const hidden: THREE.Object3D[] = [];
    scene.traverseVisible((o) => {
      if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    const background = scene.background;
    const shadows = renderer.shadowMap.autoUpdate;
    scene.background = BACKDROP;
    // The sun's shadows are drawn already this frame: no need to work them out again.
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, this.camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, this.w, this.h, this.buffer);
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = shadows;
    scene.background = background;
    for (const o of hidden) o.visible = true;
    // WebGL's rows run bottom up.
    const row = this.w * 4;
    for (let y = 0; y < this.h; y++) this.image.data.set(this.buffer.subarray((this.h - 1 - y) * row, (this.h - y) * row), y * row);
    g.putImageData(this.image, 0, 0);
  }

  /** Where `p` is on the picture, in its pixels. */
  project(p: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
    const v = p.clone().project(this.camera);
    return out.set(((v.x + 1) / 2) * this.w, ((1 - v.y) / 2) * this.h);
  }

  dispose() {
    this.target.dispose();
  }
}

export function installMinimap(ctx: Ctx, parts: Pick<Parts, 'worlds' | 'views' | 'peers' | 'walking' | 'dog' | 'actions'>) {
  const panel = $('minimap');
  const canvas = h('canvas.minimap-canvas', { width: PIXELS, height: PIXELS }) as HTMLCanvasElement;
  const north = h('span.minimap-north', {}, 'N');
  panel.append(canvas, h('span.minimap-you'), north);
  const top = new TopView(PIXELS, PIXELS);
  let big: { canvas: HTMLCanvasElement; view: TopView; bounds: Bounds; close: () => void } | null = null;
  let drawnAt = 0;
  let marks: Mark[] = [];
  const pt = new THREE.Vector2();

  /** What the big map covers: the floor, and on the office's, the balcony out front. */
  function floorBounds(): Bounds {
    const b = { ...ctx.world().nav.bounds };
    if (parts.worlds.inOffice()) b.maxZ = Math.max(b.maxZ, BALCONY.maxZ);
    return b;
  }

  /** The way you're looking, as an angle round from +z. */
  function heading(): number {
    const p = ctx.player;
    return p.view === 'first' ? p.camYaw + Math.PI : p.facing;
  }

  /** Everyone and everything worth a ring, where they are now. */
  function gather(): Mark[] {
    const out: Mark[] = [];
    for (const [id, v] of parts.views.workerViews) {
      const w = store.workers.get(id);
      if (!w) continue;
      const desk = ctx.plan().byId.get(w.deskId);
      out.push({ at: v.model.root.getWorldPosition(new THREE.Vector3()), color: w.resting ? RESTING : (WORKER[w.status] ?? IDLE), pulse: w.status === 'needs_input', go: desk ? () => parts.actions.standAt(desk) : undefined });
    }
    for (const [id, r] of parts.peers.remotes) {
      if (!r.person.root.visible) continue;
      out.push({ at: r.person.root.position.clone(), color: store.peers.get(id)?.color ?? '#ef476f', go: () => parts.walking.walkTo(id) });
    }
    return out;
  }

  /** The rings over the picture: one round each worker and person, a pulsing one for whoever's waiting on you. */
  function ring(g: CanvasRenderingContext2D, view: TopView, scale: number, beat: number) {
    for (const m of marks) {
      view.project(m.at, pt);
      if (pt.x < -10 || pt.y < -10 || pt.x > view.w + 10 || pt.y > view.h + 10) continue;
      if (m.pulse) {
        g.beginPath();
        g.arc(pt.x, pt.y, (9 + 7 * beat) * scale, 0, Math.PI * 2);
        g.lineWidth = 3 * scale;
        g.strokeStyle = `rgba(255, 209, 102, ${1 - beat})`;
        g.stroke();
      }
      g.beginPath();
      g.arc(pt.x, pt.y, 7 * scale, 0, Math.PI * 2);
      g.lineWidth = 3 * scale;
      g.strokeStyle = m.color;
      g.stroke();
    }
  }

  /** Whether you're somewhere the map is of: on this floor (not up on the roof, in the street or the garage). */
  function onTheFloor(): boolean {
    if (ctx.upTop() || ctx.activities.running('driver')) return false;
    const b = floorBounds();
    const p = ctx.player.pos;
    return p.x > b.minX - 1 && p.x < b.maxX + 1 && p.z > b.minZ - 1 && p.z < b.maxZ + 1 && p.y > -1 && p.y < 5;
  }

  /** The whole floor big in the middle of the screen, north up: click someone to walk over to them, or the floor to walk there. */
  function openBig() {
    if (big) return;
    const bounds = floorBounds();
    const aspect = (bounds.maxZ - bounds.minZ) / (bounds.maxX - bounds.minX);
    const width = Math.round(Math.min(window.innerWidth - 80, 1000, (window.innerHeight - 190) / aspect));
    const view = new TopView(width, Math.round(width * aspect));
    const c = h('canvas.minimap-big-canvas', { width: view.w, height: view.h }) as HTMLCanvasElement;
    const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
    const el = h('div.modal.minimap-big', { role: 'dialog', 'aria-label': L.minimap.title }, h('header', {}, h('h2', {}, `🗺️ ${L.minimap.title}`), close), c, h('p.minimap-tip', {}, L.minimap.tip));
    const modal = openModal(el, {
      onClose: () => {
        view.dispose();
        big = null;
      },
    });
    close.addEventListener('click', () => modal.close());
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const k = (bounds.maxX - bounds.minX) / r.width;
      const x = bounds.minX + (e.clientX - r.left) * k;
      const z = bounds.minZ + (e.clientY - r.top) * k;
      // Someone near where you clicked, the nearest first; else the floor there, if you can stand on it.
      const near = marks.filter((m) => m.go).sort((a, b) => Math.hypot(a.at.x - x, a.at.z - z) - Math.hypot(b.at.x - x, b.at.z - z))[0];
      if (near && Math.hypot(near.at.x - x, near.at.z - z) < 1.2) {
        modal.close();
        near.go!();
      } else if (ctx.world().nav.walkable(x, z)) {
        modal.close();
        parts.walking.walkThen({ x, z }, L.minimap.there, () => {});
      }
    });
    big = { canvas: c, view, bounds, close: () => modal.close() };
  }

  panel.addEventListener('click', openBig);
  panel.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      span = Math.min(SPAN.max, Math.max(SPAN.min, span * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
      drawnAt = 0;
    },
    { passive: false },
  );
  ctx.keys.bind({ code: 'KeyJ', when: () => onTheFloor() || !!big, run: () => (big ? big.close() : openBig()) });

  const up = new THREE.Vector3();
  ctx.ticks.add('hud', ({ now }) => {
    const here = onTheFloor();
    panel.classList.toggle('away', !here);
    if (now - drawnAt < 1000 / FPS) return;
    drawnAt = now;
    if (!here && !big) return;
    marks = gather();
    const beat = (now / 900) % 1;
    const p = ctx.player.pos;
    if (here && !panel.classList.contains('hud-off')) {
      // Turned so what's ahead of you is up; north's mark goes round the rim.
      const yaw = heading();
      top.frame(p.x, p.y, p.z, span, span, up.set(Math.sin(yaw), 0, Math.cos(yaw)));
      const g = canvas.getContext('2d')!;
      top.draw(ctx.renderer, ctx.scene, g);
      ring(g, top, PIXELS / SIZE, beat);
      north.style.transform = `rotate(${yaw - Math.PI}rad) translateY(${-SIZE / 2 + 2}px) rotate(${Math.PI - yaw}rad)`;
    }
    if (big) {
      const b = big.bounds;
      big.view.frame((b.minX + b.maxX) / 2, p.y, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - b.minZ, up.set(0, 0, -1));
      const g = big.canvas.getContext('2d')!;
      big.view.draw(ctx.renderer, ctx.scene, g);
      ring(g, big.view, big.view.w / 900, beat);
      // You, on the big map: an arrow the way you're facing.
      big.view.project(p, pt);
      const yaw = heading();
      const s = 11 * Math.max(0.6, big.view.w / 900);
      g.save();
      g.translate(pt.x, pt.y);
      g.rotate(-yaw);
      g.beginPath();
      g.moveTo(0, s * 1.3);
      g.lineTo(s * 0.85, -s * 0.8);
      g.lineTo(0, -s * 0.35);
      g.lineTo(-s * 0.85, -s * 0.8);
      g.closePath();
      g.fillStyle = '#ef476f';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = '#fffaf3';
      g.stroke();
      g.restore();
    }
  });
}
