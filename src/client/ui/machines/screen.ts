// The 🖥️ Screen tab beside a worker's terminal (see termtabs.ts), for a worker with a machine of its
// own (see server/machines/): its desktop, through the office's proxy, live. It opens on 👀 Just
// watch, where clicks and keys don't reach it, so nobody takes it over by accident; 🎮 Take control
// hands it the mouse and keyboard.
import './machines.css';
import type { WorkerInfo } from '../../../shared/protocol';
import { desktopPath } from '../../../shared/machines';
import { h } from '../dom';
import { store } from '../../state';
import { L } from '../../i18n';

export interface ScreenTab {
  /** The pane, in the tab's pages; hidden until its tab's picked. */
  el: HTMLElement;
  /** Whether the worker has a tab for it: it has a machine, or one is on its way. */
  shows(): boolean;
  /** Its tab's picked (`on`), or another one is. */
  show(on: boolean): void;
  /** Runs `fn` whenever what it shows may have changed; returns what stops that. */
  onChange(fn: () => void): () => void;
}

/** What's happening to the worker's machine, for the line over its screen; undefined while it's simply there. */
function statusLine(w: WorkerInfo | undefined): string | undefined {
  if (!w) return undefined;
  if (w.machineBusy === 'giving') return L.machines.giving;
  if (w.machineBusy === 'taking') return L.machines.takingAway;
  if (w.machineBusy === 'soon-give') return L.machines.soon;
  if (w.machineBusy === 'soon-take') return L.machines.soonGone;
  if (w.machineDown) return L.machines.downNote;
  return undefined;
}

export function screenTab(workerId: string): ScreenTab {
  const note = h('span.machine-note');
  const out = h('a.btn.machine-out', { target: '_blank', rel: 'noopener', href: desktopPath(workerId), title: L.machines.openOutTip }, L.machines.openOut) as HTMLAnchorElement;
  const mode = h('button.btn.machine-mode', { type: 'button' });
  const area = h('div.machine-area');
  // Over the screen while you only watch: it takes the clicks, so the desktop never gets them (or the keys after).
  const shield = h('div.machine-shield');
  const el = h('div.machine-pane.hidden', {}, h('div.machine-bar', {}, note, h('span.grow'), mode, out), area);
  let frame: HTMLIFrameElement | null = null;
  let frameFor: string | undefined;
  let open = false;
  let control = false;

  const paintMode = () => {
    mode.textContent = control ? L.machines.watch : L.machines.control;
    mode.title = control ? L.machines.watchTip : L.machines.controlTip;
    mode.setAttribute('aria-pressed', String(control));
    shield.classList.toggle('hidden', control);
    if (!control) frame?.blur();
  };
  mode.addEventListener('click', () => {
    control = !control;
    paintMode();
    if (control) frame?.focus();
  });
  paintMode();

  /** The desktop's frame, made once it's shown with a machine there, and made again for another machine. */
  const sync = () => {
    const w = store.workers.get(workerId);
    const m = w?.machine;
    const line = statusLine(w);
    note.textContent = line ?? '';
    note.classList.toggle('hidden', !line);
    out.classList.toggle('hidden', !m);
    mode.classList.toggle('hidden', !m);
    // Kept while you look at another tab, so its stream doesn't start over each time you come back.
    const want = m && (open || frameFor === m.id) ? m.id : undefined;
    if (want === frameFor) return;
    frame?.remove();
    frame = null;
    frameFor = want;
    if (!want) return;
    frame = h('iframe.machine-frame', { src: desktopPath(workerId), title: L.machines.tab, allow: 'clipboard-read; clipboard-write; fullscreen; autoplay', referrerpolicy: 'same-origin' }) as HTMLIFrameElement;
    area.replaceChildren(frame, shield);
  };

  return {
    el,
    shows: () => {
      const w = store.workers.get(workerId);
      return !!(w?.machine || w?.machineBusy === 'giving' || w?.machineBusy === 'soon-give');
    },
    show(on) {
      open = on;
      el.classList.toggle('hidden', !on);
      sync();
    },
    onChange(fn) {
      return store.on('workers', () => {
        sync();
        fn();
      });
    },
  };
}
