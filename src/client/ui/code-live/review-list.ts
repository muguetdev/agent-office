// The list of files to review, at the foot of the Code tab's file list (see review.ts): each changed
// file with what happened to it and how many lines, its own ✓ and ✕, and ✓ Accept all / ✕ Reject all.
import { h } from '../dom';
import { L } from '../../i18n';
import type { ReviewFile } from './api';

export interface ReviewListActions {
  go(path: string): void;
  acceptFile(f: ReviewFile): void;
  rejectFile(f: ReviewFile): void;
  acceptAll(): void;
  rejectAll(): void;
}

export function reviewList(a: ReviewListActions) {
  const count = h('span.cl-list-count');
  const acceptAll = h('button.btn.cl-accept', { type: 'button', title: L.codeLive.acceptAllTip, onclick: a.acceptAll }, L.codeLive.acceptAll) as HTMLButtonElement;
  const rejectAll = h('button.btn.cl-reject', { type: 'button', title: L.codeLive.rejectAllTip, onclick: a.rejectAll }, L.codeLive.rejectAll) as HTMLButtonElement;
  const rows = h('div.cl-list-rows');
  const el = h('section.cl-list', { 'aria-label': L.codeLive.reviewTitle }, h('div.cl-list-head', {}, h('strong', {}, L.codeLive.reviewTitle), count), h('div.cl-list-all', {}, acceptAll, rejectAll), rows);
  return {
    el,
    render(files: readonly ReviewFile[], open: string | undefined) {
      count.textContent = String(files.length);
      acceptAll.disabled = rejectAll.disabled = !files.length;
      if (!files.length) return void rows.replaceChildren(h('p.cl-list-empty', {}, L.codeLive.nothing));
      rows.replaceChildren(
        ...files.map((f) =>
          h(
            'div.cl-list-row',
            { class: f.path === open ? 'on' : '' },
            h(
              'button.cl-list-path',
              { type: 'button', title: f.path, disabled: f.status === 'deleted', onclick: () => a.go(f.path) },
              f.status === 'added' ? h('span.cl-tag.add', {}, L.codeLive.added) : f.status === 'deleted' ? h('span.cl-tag.del', {}, L.codeLive.removedFile) : null,
              f.path,
            ),
            h('span.cl-list-n', {}, f.added ? h('span.add', {}, `+${f.added}`) : null, f.removed ? h('span.del', {}, `−${f.removed}`) : null),
            h('button.cl-mini.cl-accept', { type: 'button', title: L.codeLive.acceptFile, 'aria-label': L.codeLive.acceptFile, onclick: () => a.acceptFile(f) }, '✓'),
            h('button.cl-mini.cl-reject', { type: 'button', title: L.codeLive.rejectFile, 'aria-label': L.codeLive.rejectFile, onclick: () => a.rejectFile(f) }, '✕'),
          ),
        ),
      );
    },
  };
}
