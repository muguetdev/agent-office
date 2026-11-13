/**
 * The office by touch, on a phone or a tablet: a thumbstick to walk (fingers.ts), dragging to look
 * around, a tap to use what's there, and round buttons for the keys that matter most (buttons.ts).
 * Installed everywhere, it only shows on a touch screen: on a computer with a mouse nothing changes,
 * and a laptop with a touch screen gets it once a finger touches the scene.
 */
import './ui.css';
import type { Ctx } from '../../core/context';
import { isTyping } from '../../player';
import { h, modalOpen, onModalChange } from '../../ui/dom';
import { L } from '../../i18n';
import { mountButtons } from './buttons';
import { mountFingers } from './fingers';
import { mountWorkersSheet } from './workers';
import { IS_MAC } from '../../ui/termkeys';

/** Whether this device has a touch screen at all. */
function touchCapable(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function installTouch(ctx: Ctx) {
  if (!touchCapable()) return;
  const { player, canvas } = ctx;
  const fingersOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  player.touch = { owned: true, fingersOnly };

  const layer = h('div.touch-controls.hidden', { id: 'touch-controls' });
  document.getElementById('hud')?.append(layer);
  const fingers = mountFingers(ctx, layer);
  const workers = mountWorkersSheet();
  // The command palette, as Ctrl+K (⌘K) opens it: workers, issues, PRs and the office's actions by name.
  const find = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', ctrlKey: !IS_MAC, metaKey: IS_MAC, bubbles: true, cancelable: true }));
  const buttons = mountButtons(ctx, layer, [
    { icon: '🤖', label: L.touch.workers, run: workers.open },
    { icon: '🔎', label: L.touch.find, run: find },
  ]);

  /** Shows the controls, from the start on a phone, or from the first finger on the scene. */
  function start() {
    if (document.body.classList.contains('touch')) return;
    document.body.classList.add('touch');
    sync();
  }
  if (fingersOnly) start();
  canvas.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && start());

  /** Out of the way while a window's open or you're typing. */
  function sync() {
    const away = modalOpen() || isTyping();
    layer.classList.toggle('hidden', away || !document.body.classList.contains('touch'));
    if (away) {
      fingers.release();
      buttons.closeMore();
    }
  }
  onModalChange(() => sync());
  document.addEventListener('focusin', () => sync());
  document.addEventListener('focusout', () => setTimeout(sync, 0));

  // No pinching the page or zooming it with a double tap: the fingers are the controls.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
}
