// A window that comes up from the bottom of a phone's screen, as apps' menus do (a dialog on a wide
// screen). Pulled down by its handle it closes, as do its ✕, Esc and the back gesture (see pwa.ts).
import './mobile.css';
import { h, openModal, type Modal } from '../ui/dom';

export function openSheet(title: string, ...body: (HTMLElement | null)[]): Modal {
  const grip = h('div.sheet-grip', { 'aria-hidden': 'true' });
  const header = h('header', {}, h('h2', {}, title));
  const el = h('div.modal.sheet', { role: 'dialog', 'aria-label': title }, grip, header, h('div.body', {}, ...body.filter((b): b is HTMLElement => !!b)));
  const modal = openModal(el);
  dragToClose(el, [grip, header], () => modal.close());
  return modal;
}

/** Pulled down past a third of its height (or flicked), it goes. */
function dragToClose(el: HTMLElement, handles: HTMLElement[], close: () => void) {
  let y0 = 0;
  let t0 = 0;
  let dy = 0;
  let dragging = false;
  for (const handle of handles) {
    handle.addEventListener('touchstart', (e) => {
      if ((e.target as Element).closest('button')) return;
      dragging = true;
      y0 = e.touches[0].clientY;
      t0 = performance.now();
      dy = 0;
      el.style.transition = 'none';
    }, { passive: true });
    handle.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      el.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    handle.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      el.style.transition = '';
      const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
      if (dy > el.offsetHeight / 3 || (fast && dy > 30)) close();
      else el.style.transform = '';
    });
  }
}

/** A row in a sheet: an icon, a title and a line under it, and what's on its right. */
export function sheetRow(icon: string, title: string, sub: string | null, opts: { onclick?: () => void; right?: HTMLElement | string | null; disabled?: boolean; on?: boolean } = {}): HTMLElement {
  return h(
    opts.onclick ? 'button.sheet-row' : 'div.sheet-row',
    { type: opts.onclick ? 'button' : undefined, onclick: opts.onclick, disabled: opts.disabled, class: opts.on ? 'on' : '' },
    h('span.sheet-icon', { 'aria-hidden': 'true' }, icon),
    h('span.sheet-text', {}, h('span.sheet-title', {}, title), sub ? h('span.sheet-sub', {}, sub) : null),
    opts.right ? (typeof opts.right === 'string' ? h('span.sheet-right', {}, opts.right) : opts.right) : null,
  );
}
