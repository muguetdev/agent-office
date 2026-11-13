/**
 * BLOCKFALL by touch: round buttons on either side of the cabinet's screen, ◀ ▼ ▶ under the left
 * thumb and turn, drop, hold and pause under the right. Each one presses the key it stands for (held
 * down while the finger is, so ◀ ▶ and ▼ slide and drop on their own time as held keys do), so the
 * game goes by the same keys it plays on with a keyboard (see KEYS in ui.ts). Only with the touch
 * controls on (features/touch).
 */
import './touch.css';
import { h } from '../../ui/dom';
import { L } from '../../i18n';

/** [the key it presses, what's on it, its name] */
type Pad = [string, string, () => string];

const LEFT: Pad[] = [
  ['ArrowLeft', '◀', () => L.touch.pad.left],
  ['ArrowDown', '▼', () => L.touch.pad.down],
  ['ArrowRight', '▶', () => L.touch.pad.right],
];
const RIGHT: Pad[] = [
  ['KeyC', '⇄', () => L.touch.pad.hold],
  ['KeyP', '⏸', () => L.touch.pad.pause],
  ['Space', '⤓', () => L.touch.pad.drop],
  ['ArrowUp', '⟳', () => L.touch.pad.turn],
];

/** Presses or lets go of a key, from the page's body as a real one would come, so the game's capture listener on the window takes it first. */
function press(code: string, down: boolean) {
  const key = { Space: ' ', KeyC: 'c', KeyP: 'p' }[code] ?? code;
  document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key, bubbles: true, cancelable: true }));
}

function button([code, icon, name]: Pad): HTMLElement {
  const b = h('button.cabinet-key', { type: 'button', 'aria-label': name(), title: name(), 'data-key': code }, icon);
  let down = false;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (down) return;
    down = true;
    b.setPointerCapture?.(e.pointerId);
    press(code, true);
  });
  const up = () => {
    if (!down) return;
    down = false;
    press(code, false);
  };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

/** Puts the buttons on the game's window (`backdrop`, the whole screen), if the touch controls are on. */
export function cabinetPad(backdrop: HTMLElement) {
  if (!document.body.classList.contains('touch')) return;
  backdrop.append(h('div.cabinet-pad', { 'aria-hidden': 'true' }, h('div.cabinet-keys.left', {}, ...LEFT.map(button)), h('div.cabinet-keys.right', {}, ...RIGHT.map(button))));
}
