// A worker on the phone app's list (lite.ts): who it is, what it's on and what it's asking, in a card
// you tap to open its terminal, and the chips over the list that pick which ones show.
import type { WorkerInfo } from '../../shared/protocol';
import { DESK_BY_ID } from '../../shared/layout';
import { isAsleep } from '../../shared/status';
import { store } from '../state';
import { clip, h, STATUS_LABEL, timeAgo } from '../ui/dom';
import { modelBadge, providerLabel } from '../ui/provider';
import { waitingOnSomeone } from '../notify';
import { L } from '../i18n';

export const FILTERS = ['all', 'waiting', 'working', 'asleep'] as const;
export type Filter = (typeof FILTERS)[number];

export function matches(w: WorkerInfo, f: Filter): boolean {
  if (f === 'waiting') return waitingOnSomeone(w);
  if (f === 'working') return w.status === 'working' || w.status === 'starting';
  if (f === 'asleep') return isAsleep(w.status);
  return true;
}

/** Up to two letters of its name, for its round face. */
export function initials(name: string): string {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  return ((parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)) || '?').toUpperCase();
}

export interface CardActions {
  open(id: string): void;
  prompt(id: string): void;
}

export function workerCard(w: WorkerInfo, act: CardActions): HTMLElement {
  const desk = DESK_BY_ID.get(w.deskId);
  const waiting = waitingOnSomeone(w);
  const asleep = isAsleep(w.status);
  const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort, w.usage?.model) : undefined;
  const task = w.task?.name ?? w.title ?? (w.prompt ? clip(w.prompt, 90) : undefined);
  // What it's asking, doing or did, in a line.
  const now = w.lost
    ? L.lite.lost
    : w.status === 'needs_input'
      ? `🙋 ${w.activity ?? L.lite.waitingAnswer}`
      : asleep
        ? L.lite.asleep
        : w.status === 'done'
          ? w.task?.summary && `✅ ${w.task.summary}`
          : (w.task?.summary ?? w.activity);
  const sub = [
    w.kind === 'agent' ? `${providerLabel(w.provider, store.project)}${badge ? ` · ${badge}` : ''}` : '🐚 shell',
    desk && (desk.station ? `📌 ${desk.label}` : desk.label),
    w.worktree && `🌿 ${w.worktree.branch}`,
    w.pr && `🔀 #${w.pr.number}`,
    w.lastInput && `⌨️ ${w.lastInput.by} ${timeAgo(w.lastInput.at)}`,
  ].filter(Boolean);
  const unread = w.inbox?.unread ?? 0;
  const status = STATUS_LABEL[w.status] ?? w.status;
  const face = h(
    'span.lite-face',
    { style: `--c:${w.color}`, 'aria-hidden': 'true' },
    initials(w.name),
    h('span.lite-face-dot', { class: w.status }),
    unread ? h('span.lite-face-mail', { title: L.whatsoffice.unread(unread) }, String(unread)) : null,
  );
  // One that's asking something is answered in its terminal, where the question is.
  const say = asleep || w.lost || w.status === 'needs_input'
    ? null
    : h('button.lite-say', { type: 'button', title: L.lite.sendPrompt(w.name), 'aria-label': L.lite.sendPrompt(w.name), onclick: () => act.prompt(w.id) }, '✍️');
  return h(
    'li.lite-worker',
    { class: `${w.status}${waiting ? ' waiting' : ''}` },
    h(
      'button.lite-card',
      { type: 'button', onclick: () => act.open(w.id), 'aria-label': L.lite.openTerminal(w.name, status) },
      face,
      h(
        'span.lite-info',
        {},
        h(
          'span.lite-top',
          {},
          h('span.lite-name', {}, w.name),
          h('span.pill', { class: w.status }, status),
          waiting && w.waitingSince ? h('small.lite-since', {}, timeAgo(w.waitingSince)) : null,
        ),
        task ? h('span.lite-task', {}, task) : null,
        now ? h('span.lite-now', {}, now) : null,
        h('span.lite-sub', {}, sub.join(' · ')),
      ),
    ),
    w.status === 'needs_input' ? h('button.lite-answer', { type: 'button', onclick: () => act.open(w.id) }, L.mobile.answer) : say,
  );
}
