/**
 * The round buttons in the bottom-right corner: Use (E, labelled with what the hint bar says E does),
 * Jump (Space, labelled with what the hint bar says Space does when it says: a swing at the golf tee,
 * a throw at the dart board, held down and let go as the key would be), Next (N, the next worker waiting on someone), Leave (whatever you're in the middle of,
 * a seat or the telescope) and ⋯, which has the hint bar's other keys, the workers, the command palette and the rest. Every one presses its key, so it goes down
 * the same chain in ctx.keys a key on a keyboard does (see input/keyboard.ts).
 */
import type { Ctx } from '../../core/context';
import { $, h } from '../../ui/dom';
import { L } from '../../i18n';

/** What KeyboardEvent.key is for a code we press. */
function keyOf(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  return { Space: ' ', Slash: '/' }[code] ?? code;
}

/** Presses (or lets go of) a key, as the keyboard would: on the canvas, so it bubbles up to the window. */
export function press(ctx: Ctx, code: string, down = true) {
  ctx.canvas.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: keyOf(code), bubbles: true, cancelable: true }));
}

/** The code for a key the hint bar names (E, Q, 1, Space, Esc), or null for one that isn't a single key (W A S D). */
function codeOf(k: string): string | null {
  if (/^[A-Z]$/.test(k)) return `Key${k}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  // The hint bar writes Space in the office's language.
  if (k === L.hints.space) return 'Space';
  return { Space: 'Space', Esc: 'Escape', Enter: 'Enter', Tab: 'Tab' }[k] ?? null;
}

/** The keys the hint bar shows now, with what each does: [code, its key, what it does]. */
function hintKeys(): [string, string, string][] {
  const el = $('hint');
  if (el.classList.contains('hidden')) return [];
  const out: [string, string, string][] = [];
  for (const k of el.querySelectorAll<HTMLElement>('.key')) {
    const name = k.textContent?.trim() ?? '';
    const code = codeOf(name);
    if (!code || out.some(([c]) => c === code)) continue;
    const label = (k.parentElement?.textContent ?? '').replace(name, '').trim();
    out.push([code, name, label]);
  }
  return out;
}

/** A round button that holds `code` down while a finger's on it. */
function keyButton(ctx: Ctx, cls: string, icon: string, label: () => string, code: string) {
  const lbl = h('span.lbl', {}, label());
  const b = h(`button.touch-btn.${cls}`, { type: 'button', 'aria-label': label() }, h('span.ico', {}, icon), lbl);
  let down = false;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    down = true;
    press(ctx, code);
  });
  const up = () => {
    if (!down) return;
    down = false;
    press(ctx, code, false);
  };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('pointerleave', up);
  // Held still, a phone would offer to copy the label.
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return { b, lbl, down: () => down };
}

/** Something on ⋯ that isn't a key: the workers, the command palette. */
export interface MoreItem {
  icon: string;
  label: string;
  run: () => void;
}

export function mountButtons(ctx: Ctx, layer: HTMLElement, extras: MoreItem[] = []) {
  const { player } = ctx;
  const use = keyButton(ctx, 'use', '✋', () => L.touch.use, 'KeyE');
  const jump = keyButton(ctx, 'jump', '⤒', () => L.touch.jump, 'Space');
  const next = keyButton(ctx, 'next', '🙋', () => L.touch.next, 'KeyN');

  /** Gets you out of whatever you're in: the activity, the seat, the telescope. */
  function leave() {
    if (document.body.classList.contains('telescope-active')) return press(ctx, 'Escape');
    // E is what gets you out of most (the ladder, the tee, the dart board, a car); whatever's still on after it is stopped.
    if (ctx.activities.busy()) {
      if (!ctx.activities.running('hanger')) {
        press(ctx, 'KeyE');
        press(ctx, 'KeyE', false);
      }
      if (ctx.activities.busy()) ctx.activities.stopAll('start');
      return;
    }
    // Up off a seat as jumping up does (see GET_UP in player/index.ts), held until you're up.
    if (player.seat) {
      player.setKey('Space', true);
      gettingUp = 3;
    }
  }
  /** Frames left to hold Space for getting up off a seat (see leave). */
  let gettingUp = 0;
  ctx.ticks.add('moved', () => {
    if (gettingUp && (!player.seat || --gettingUp === 0)) {
      gettingUp = 0;
      player.setKey('Space', false);
    }
  });
  const back = h('button.touch-btn.back', { type: 'button', 'aria-label': L.touch.back }, h('span.ico', {}, '↩'), h('span.lbl', {}, L.touch.back));
  back.addEventListener('click', leave);

  // ⋯: the hint bar's other keys (a worker's desk has a few), then the workers, finding anything, chat, the map, the help and the menu.
  const sheet = h('div.touch-more.panel.hidden', { role: 'menu' });
  const more = h('button.touch-btn.more', { type: 'button', 'aria-label': L.touch.more, 'aria-expanded': 'false' }, h('span.ico', {}, '⋯'));
  function closeMore() {
    sheet.classList.add('hidden');
    more.setAttribute('aria-expanded', 'false');
  }
  function item(name: string, label: string, code: string) {
    const b = h('button.btn.touch-item', { type: 'button', role: 'menuitem' }, h('span.key', {}, name), label);
    b.addEventListener('click', () => {
      closeMore();
      press(ctx, code);
      press(ctx, code, false);
    });
    return b;
  }
  function action(x: MoreItem) {
    const b = h('button.btn.touch-item', { type: 'button', role: 'menuitem' }, h('span.key', {}, x.icon), x.label);
    b.addEventListener('click', () => {
      closeMore();
      x.run();
    });
    return b;
  }
  more.addEventListener('click', () => {
    if (!sheet.classList.contains('hidden')) return closeMore();
    const fixed: [string, string, string][] = [
      ['KeyG', '😀', L.touch.emotes],
      ['KeyT', '💬', L.touch.chat],
      ['KeyJ', '🗺️', L.touch.map],
      ['KeyH', '❓', L.touch.help],
      ['Tab', '☰', L.touch.menu],
    ];
    // Not the ones the stick holds down (the ladder's W and S): a tap would only nudge.
    const busy = ctx.activities.busy();
    const here = hintKeys().filter(([c]) => c !== 'KeyE' && c !== 'Space' && !(busy && /^Key[WASD]$/.test(c)));
    sheet.replaceChildren(...here.map(([c, k, l]) => item(k, l, c)), h('div.touch-more-row', {}, ...extras.map(action), ...fixed.map(([c, k, l]) => item(k, l, c))));
    sheet.classList.remove('hidden');
    more.setAttribute('aria-expanded', 'true');
  });
  // A tap anywhere else puts it away.
  window.addEventListener('pointerdown', (e) => {
    if (!sheet.contains(e.target as Node) && e.target !== more && !more.contains(e.target as Node)) closeMore();
  });

  const pad = h('div.touch-pad', {}, more, next.b, back, jump.b, use.b);
  layer.append(pad, sheet);

  // What E does here, on the Use button, and what Space does on Jump; Leave only while there's something to leave.
  let shown = '';
  let jumpWas = '';
  const jumpHeld = () => jump.down();
  ctx.ticks.add('hud', () => {
    const keys = hintKeys();
    const e = keys.find(([c]) => c === 'KeyE');
    // Held down mid-swing, the hint bar says to let go: the button keeps saying what it's doing.
    const space = jumpHeld() ? jumpWas : (keys.find(([c]) => c === 'Space')?.[2] ?? '');
    jumpWas = space;
    const busy = ctx.activities.busy() || !!player.seat || document.body.classList.contains('telescope-active');
    const waiting = !$('waiting').classList.contains('hidden');
    const k = `${e?.[2] ?? ''}|${space}|${busy}|${waiting}`;
    if (k === shown) return;
    shown = k;
    use.lbl.textContent = e?.[2] || L.touch.use;
    use.b.classList.toggle('ready', !!e);
    jump.lbl.textContent = space || L.touch.jump;
    jump.b.classList.toggle('act', !!space);
    back.classList.toggle('hidden', !busy);
    next.b.classList.toggle('dim', !waiting);
  });

  return { closeMore };
}
