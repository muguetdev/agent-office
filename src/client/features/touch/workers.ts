/**
 * On a phone the panels down the side give way to the 3D (ui.css), so 🤖 on the top bar (and 👥,
 * and ⋯'s Workers) opens them as a window instead: the workers first, then who's in and the spend.
 * The panels themselves are lent to the window, so they stay live, and a row does what it does on
 * the side (a worker's terminal, walking over to someone) once the window has stepped aside.
 */
import { h, openModal, type Modal } from '../../ui/dom';
import { L } from '../../i18n';

/** The phone layout of ui.css, where the side panels are hidden. */
const PHONE = matchMedia('(pointer: coarse) and (max-width: 640px), (pointer: coarse) and (max-height: 500px)');

export function mountWorkersSheet() {
  let modal: Modal | null = null;

  function open() {
    const side = document.querySelector<HTMLElement>('#hud .side');
    if (!side || modal) return;
    const home = side.parentElement!;
    const after = side.nextSibling;
    // A row picked: what it opens comes up over the office, not over this.
    const picked = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest('li, #waiting') && !t.closest('.panel-x')) modal?.close();
    };
    side.addEventListener('click', picked, true);
    const el = h('div.modal.touch-workers', { role: 'dialog', 'aria-label': L.touch.workers }, h('header', {}, h('h2', {}, `🤖 ${L.touch.workers}`)), h('div.body', {}, side));
    modal = openModal(el, {
      onClose: () => {
        side.removeEventListener('click', picked, true);
        home.insertBefore(side, after);
        modal = null;
      },
    });
  }

  // 🤖 and 👥 on the top bar would show a panel that isn't there on a phone: they open the window.
  document.getElementById('dock')?.addEventListener(
    'click',
    (e) => {
      if (!PHONE.matches || !document.body.classList.contains('touch')) return;
      if (!(e.target as HTMLElement).closest('.dock-panel')) return;
      e.preventDefault();
      e.stopPropagation();
      open();
    },
    true,
  );

  return { open };
}
