import type { Bounds } from '../../../shared/nav';

/** The closest the big map zooms in: this many meters across. */
const CLOSEST = 24;
/** A wheel notch's (or a button's) zoom. */
const STEP = 1.25;

/**
 * The part of the map the big map shows, as GTA's map has it: dragged about, zoomed in and out round the
 * pointer (the wheel, a pinch on a trackpad, the + and − buttons or keys), never out past the whole of
 * `full` nor off its edges. North is up, so a canvas pixel is the same many meters either way.
 */
export class MapWindow {
  /** The middle of what's shown, and how many meters it is across. */
  cx: number;
  cz: number;
  span: number;

  constructor(
    readonly full: Bounds,
    /** The canvas's height over its width. */
    readonly aspect: number,
    at?: { x: number; z: number; span: number },
  ) {
    this.cx = at?.x ?? (full.minX + full.maxX) / 2;
    this.cz = at?.z ?? (full.minZ + full.maxZ) / 2;
    this.span = at?.span ?? this.widest();
    this.clamp();
  }

  /** As far out as it goes: the whole of it in view. */
  private widest(): number {
    return Math.max(this.full.maxX - this.full.minX, (this.full.maxZ - this.full.minZ) / this.aspect);
  }

  /** What's in view now. */
  bounds(): Bounds {
    const hw = this.span / 2;
    const hh = (this.span * this.aspect) / 2;
    return { minX: this.cx - hw, maxX: this.cx + hw, minZ: this.cz - hh, maxZ: this.cz + hh };
  }

  /** The map point at (u, v) across and down the canvas (0–1). */
  at(u: number, v: number): { x: number; z: number } {
    const b = this.bounds();
    return { x: b.minX + u * (b.maxX - b.minX), z: b.minZ + v * (b.maxZ - b.minZ) };
  }

  /** Zooms by `k` (over 1 is in) keeping the point at (u, v) where it is on the canvas. */
  zoom(k: number, u = 0.5, v = 0.5) {
    const before = this.at(u, v);
    this.span = Math.min(this.widest(), Math.max(CLOSEST, this.span / k));
    const after = this.at(u, v);
    this.cx += before.x - after.x;
    this.cz += before.z - after.z;
    this.clamp();
  }

  /** Drags it by (du, dv) of the canvas: the map moves with the pointer. */
  drag(du: number, dv: number) {
    this.cx -= du * this.span;
    this.cz -= dv * this.span * this.aspect;
    this.clamp();
  }

  centre(x: number, z: number) {
    this.cx = x;
    this.cz = z;
    this.clamp();
  }

  /** Keeps the middle of the view over the map. */
  private clamp() {
    this.cx = Math.min(this.full.maxX, Math.max(this.full.minX, this.cx));
    this.cz = Math.min(this.full.maxZ, Math.max(this.full.minZ, this.cz));
  }

  /**
   * Hands the canvas `c` over to it: drag to move, wheel or pinch to zoom; a press that hardly moves is a
   * click at that map point (`click`). Hands back what lets go of the window's keys.
   */
  attach(c: HTMLCanvasElement, click: (x: number, z: number) => void, changed: () => void): () => void {
    let down: { x: number; y: number; moved: boolean } | null = null;
    const frac = (e: { clientX: number; clientY: number }) => {
      const r = c.getBoundingClientRect();
      return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
    };
    c.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (!down) return;
      const { w, h } = frac(e);
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) < 4) return;
      down.moved = true;
      this.drag(dx / w, dy / h / this.aspect);
      down.x = e.clientX;
      down.y = e.clientY;
      changed();
    });
    const up = (e: PointerEvent) => {
      if (!down) return;
      const wasClick = !down.moved;
      down = null;
      c.classList.remove('dragging');
      if (wasClick) {
        const { u, v } = frac(e);
        const p = this.at(u, v);
        click(p.x, p.z);
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => {
      down = null;
      c.classList.remove('dragging');
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const { u, v } = frac(e);
        // A trackpad's pinch comes as a wheel with ctrl held, in small steps.
        const k = e.ctrlKey ? Math.exp(-e.deltaY * 0.02) : e.deltaY < 0 ? STEP : 1 / STEP;
        this.zoom(k, u, v);
        changed();
      },
      { passive: false },
    );
    const keys = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') this.zoom(STEP);
      else if (e.key === '-' || e.key === '_') this.zoom(1 / STEP);
      else return;
      changed();
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }
}
