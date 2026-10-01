/**
 * The minimap, down in the bottom-right corner: the floor you're on seen from above (its walkways and
 * what's in the way, from the floor's own grid), with you as an arrow, the people on the floor in their
 * colours, the workers by what they're doing and the dog. J (or a click on it) opens it big in the
 * middle of the screen, where a click on someone walks you over to them, and a click on the floor
 * walks you there. It shows or hides from the ☰ menu like the other panels.
 */
import './minimap.css';
import * as THREE from 'three';
import { BALCONY } from '../../../shared/layout';
import type { Bounds, NavGrid } from '../../../shared/nav';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { $, h, openModal } from '../../ui/dom';
import { L } from '../../i18n';

/** Meters a pixel of the floor's picture covers. */
const RES = 0.2;
/** How many times a second the dots are redrawn. */
const FPS = 10;
/** What a worker's dot looks like, by what it's doing. */
const WORKER: Record<string, string> = { working: '#06d6a0', needs_input: '#ffd166', starting: '#8ecae6', offline: '#8d99ae', exited: '#8d99ae' };
const RESTING = '#4895ef';
const IDLE = '#ffffff';

interface Dot {
  x: number;
  z: number;
  color: string;
  r: number;
  /** Where clicking it (on the big map) takes you. */
  go?: () => void;
  /** Waiting on you: it pulses, with a ring round it. */
  pulse?: boolean;
}

export function installMinimap(ctx: Ctx, parts: Pick<Parts, 'worlds' | 'views' | 'peers' | 'walking' | 'dog' | 'actions'>) {
  const panel = $('minimap');
  const small = h('canvas.minimap-canvas') as HTMLCanvasElement;
  panel.append(small);
  /** The floor's picture, made again when the floor (or its back office) changes. */
  let floor: { nav: NavGrid; wing: number; bounds: Bounds; img: HTMLCanvasElement } | null = null;
  let big: { canvas: HTMLCanvasElement; close: () => void } | null = null;
  let drawnAt = 0;
  let dots: Dot[] = [];
  const at = new THREE.Vector3();

  /** What the map covers: the floor, and on the office's, the balcony out front. */
  function boundsOf(nav: NavGrid): Bounds {
    const b = { ...nav.bounds };
    if (parts.worlds.inOffice()) b.maxZ = Math.max(b.maxZ, BALCONY.maxZ);
    return b;
  }

  /** The floor seen from above: floor where you can walk, darker where something's in the way. */
  function paintFloor(nav: NavGrid, b: Bounds): HTMLCanvasElement {
    const w = Math.ceil((b.maxX - b.minX) / RES);
    const hgt = Math.ceil((b.maxZ - b.minZ) / RES);
    const c = h('canvas') as HTMLCanvasElement;
    c.width = w;
    c.height = hgt;
    const g = c.getContext('2d')!;
    const img = g.createImageData(w, hgt);
    const nb = nav.bounds;
    const balcony = parts.worlds.inOffice();
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const wx = b.minX + (x + 0.5) * RES;
        const wz = b.minZ + (y + 0.5) * RES;
        const inside = wx > nb.minX && wx < nb.maxX && wz > nb.minZ && wz < nb.maxZ;
        const onBalcony = balcony && wx > BALCONY.minX && wx < BALCONY.maxX && wz > BALCONY.minZ && wz < BALCONY.maxZ;
        let rgb: [number, number, number, number] | null = null;
        if (inside) rgb = nav.walkable(wx, wz) ? [244, 226, 196, 255] : [176, 150, 120, 255];
        else if (onBalcony) rgb = [214, 186, 150, 255];
        if (!rgb) continue;
        img.data.set(rgb, (y * w + x) * 4);
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function currentFloor() {
    const nav = ctx.world().nav;
    const wing = parts.worlds.officeWing();
    if (!floor || floor.nav !== nav || floor.wing !== wing) {
      const bounds = boundsOf(nav);
      floor = { nav, wing, bounds, img: paintFloor(nav, bounds) };
    }
    return floor;
  }

  /** Everyone and everything on the floor, where they are now. */
  function gather(): Dot[] {
    const out: Dot[] = [];
    for (const [id, v] of parts.views.workerViews) {
      const w = store.workers.get(id);
      if (!w) continue;
      v.model.root.getWorldPosition(at);
      const color = w.resting ? RESTING : (WORKER[w.status] ?? IDLE);
      const desk = ctx.plan().byId.get(w.deskId);
      out.push({ x: at.x, z: at.z, color, r: 3.2, pulse: w.status === 'needs_input', go: desk ? () => parts.actions.standAt(desk) : undefined });
    }
    const dog = parts.dog.root.getWorldPosition(at);
    out.push({ x: dog.x, z: dog.z, color: '#b5651d', r: 2.4 });
    for (const [id, r] of parts.peers.remotes) {
      if (!r.person.root.visible) continue;
      const p = r.person.root.position;
      out.push({ x: p.x, z: p.z, color: store.peers.get(id)?.color ?? '#ef476f', r: 3.6, go: () => parts.walking.walkTo(id) });
    }
    return out;
  }

  /** Draws the floor and the dots onto `c`, `beat` (0–1) how far through its pulse whoever's waiting on you is. */
  function draw(c: HTMLCanvasElement, cssWidth: number, beat: number) {
    const f = currentFloor();
    const aspect = (f.bounds.maxZ - f.bounds.minZ) / (f.bounds.maxX - f.bounds.minX);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(cssWidth);
    const ch = Math.round(cssWidth * aspect);
    if (c.width !== cw * dpr || c.height !== ch * dpr) {
      c.width = cw * dpr;
      c.height = ch * dpr;
      c.style.width = `${cw}px`;
      c.style.height = `${ch}px`;
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = true;
    g.drawImage(f.img, 0, 0, cw, ch);
    const k = cw / (f.bounds.maxX - f.bounds.minX);
    const px = (x: number) => (x - f.bounds.minX) * k;
    const py = (z: number) => (z - f.bounds.minZ) * k;
    const scale = cssWidth / 200;
    for (const d of dots) {
      if (d.pulse) {
        g.beginPath();
        g.arc(px(d.x), py(d.z), (d.r + 2 + 4 * beat) * scale, 0, Math.PI * 2);
        g.lineWidth = 2 * scale;
        g.strokeStyle = `rgba(255, 209, 102, ${1 - beat})`;
        g.stroke();
      }
      g.beginPath();
      g.arc(px(d.x), py(d.z), (d.r + (d.pulse ? 0.8 : 0)) * scale, 0, Math.PI * 2);
      g.fillStyle = d.color;
      g.fill();
      g.lineWidth = 1.2 * scale;
      g.strokeStyle = '#2b2d42';
      g.stroke();
    }
    // You: an arrow the way you're facing.
    const p = ctx.player;
    const yaw = p.view === 'first' ? p.camYaw + Math.PI : p.facing;
    g.save();
    g.translate(px(p.pos.x), py(p.pos.z));
    // Forward is (sin yaw, cos yaw) in x and z, which is down the map at yaw 0.
    g.rotate(-yaw);
    const s = 6 * scale;
    g.beginPath();
    g.moveTo(0, s * 1.3);
    g.lineTo(s * 0.85, -s * 0.8);
    g.lineTo(0, -s * 0.35);
    g.lineTo(-s * 0.85, -s * 0.8);
    g.closePath();
    g.fillStyle = '#ef476f';
    g.fill();
    g.lineWidth = 1.5 * scale;
    g.strokeStyle = '#fffaf3';
    g.stroke();
    g.restore();
  }

  /** Whether you're somewhere the map is of: on this floor (not up on the roof, in the street or the garage). */
  function onTheFloor(): boolean {
    if (ctx.upTop() || ctx.activities.running('driver')) return false;
    const b = currentFloor().bounds;
    const p = ctx.player.pos;
    return p.x > b.minX - 1 && p.x < b.maxX + 1 && p.z > b.minZ - 1 && p.z < b.maxZ + 1 && p.y > -1 && p.y < 4;
  }

  /** The map big in the middle of the screen: click someone to walk over to them, or the floor to walk there. */
  function openBig() {
    if (big) return;
    const canvas = h('canvas.minimap-big-canvas') as HTMLCanvasElement;
    const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
    const el = h(
      'div.modal.minimap-big',
      { role: 'dialog', 'aria-label': L.minimap.title },
      h('header', {}, h('h2', {}, `🗺️ ${L.minimap.title}`), close),
      canvas,
      h('p.minimap-tip', {}, L.minimap.tip),
    );
    const modal = openModal(el, { onClose: () => (big = null) });
    close.addEventListener('click', () => modal.close());
    canvas.addEventListener('click', (e) => {
      const f = currentFloor();
      const r = canvas.getBoundingClientRect();
      const k = (f.bounds.maxX - f.bounds.minX) / r.width;
      const x = f.bounds.minX + (e.clientX - r.left) * k;
      const z = f.bounds.minZ + (e.clientY - r.top) * k;
      // Someone near where you clicked, the nearest first; else the floor there, if you can stand on it.
      const near = dots.filter((d) => d.go).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      if (near && Math.hypot(near.x - x, near.z - z) < 1.2) {
        modal.close();
        near.go!();
      } else if (f.nav.walkable(x, z)) {
        modal.close();
        parts.walking.walkThen({ x, z }, L.minimap.there, () => {});
      }
    });
    big = { canvas, close: () => modal.close() };
  }

  panel.addEventListener('click', openBig);
  ctx.keys.bind({ code: 'KeyJ', when: () => onTheFloor() || !!big, run: () => (big ? big.close() : openBig()) });

  ctx.ticks.add('hud', ({ now }) => {
    const here = onTheFloor();
    panel.classList.toggle('away', !here);
    if (now - drawnAt < 1000 / FPS) return;
    drawnAt = now;
    if (!here && !big) return;
    dots = gather();
    const beat = (now / 900) % 1;
    if (!panel.classList.contains('hud-off') && here) draw(small, 200, beat);
    if (big) {
      // As big as fits, wide and tall, with room for the heading and the tip.
      const b = currentFloor().bounds;
      const aspect = (b.maxZ - b.minZ) / (b.maxX - b.minX);
      draw(big.canvas, Math.min(window.innerWidth - 80, 900, (window.innerHeight - 190) / aspect), beat);
    }
  });
}
