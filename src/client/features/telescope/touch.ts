/**
 * The telescope by touch: a finger dragged across the scene turns it, and two pinched together or
 * apart zoom it out or in. The mouse turns it with the pointer captured (controller.ts), which a
 * finger can't do, so this follows where each finger was instead. Only on a touch screen, and only
 * while you're looking through it.
 */
import type { TelescopeView } from './controller';
import { h } from '../../ui/dom';
import { L } from '../../i18n';

/** A finger's drag turns the scope this many times what the mouse's move would. */
const DRAG = 1.6;

export function telescopeTouch(canvas: HTMLElement, overlay: HTMLElement, view: TelescopeView) {
  // What a finger does here, on the eyepiece (shown only with the touch controls on, see ui.css in features/touch).
  overlay.append(h('div.telescope-touch-tip', { 'aria-hidden': 'true' }, L.touch.telescopeTip));
  /** Where each finger on the scene is now. */
  const fingers = new Map<number, { x: number; y: number }>();
  /** How far apart the two fingers of a pinch were, the last time they moved. */
  let spread = 0;
  const apart = () => {
    const [a, b] = [...fingers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !view.active) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    spread = apart();
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // The mouse is captured (a touch screen on a computer): its fingers still come here.
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId);
    if (!f || !view.active) return;
    const dx = e.clientX - f.x;
    const dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    if (fingers.size === 1) return view.turn(dx * DRAG, dy * DRAG);
    const now = apart();
    if (spread > 0 && now > 0) view.zoomBy(now / spread);
    spread = now;
  });
  const up = (e: PointerEvent) => {
    if (!fingers.delete(e.pointerId)) return;
    spread = apart();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}
