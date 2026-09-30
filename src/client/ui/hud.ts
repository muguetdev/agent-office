import { BUZZ_SECONDS, type Caffeine } from '../caffeine';
import { ROOF, ROOF_NAME } from '../../shared/rooftop';
import { store } from '../state';
import type { Voice } from '../voice';
import type { ChatLine } from '../../shared/protocol';
import { $, h, openModal, STATUS_LABEL } from './dom';
import { usageLabel, usageTitle } from './usage';
import { providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';
import { whereabouts } from './whereabouts';
import { DESK_BY_ID } from '../../shared/layout';
import { IS_MAC } from './termkeys';
import { L } from '../i18n';

/** What the people list last showed, so it's only drawn again when something in it changed. */
let peopleKey = '';

/** The people list in the sidebar. Click yourself to change your character, or anyone else to walk over to them. */
export function renderPeople(voice: Voice, onEditProfile: () => void, onWalkTo: (id: string) => void, force = true) {
  const peers = [...store.peers.values()].sort((a, b) => (a.id === store.you ? -1 : b.id === store.you ? 1 : a.name.localeCompare(b.name)));
  // What each of them is up to changes as they walk about (onto the balcony, up the stairs).
  const doing = peers.map((p) => (p.id === store.you ? undefined : whereabouts(p, store.carOf(p.id))));
  const key = peers.map((p, i) => `${p.id}|${doing[i] ?? ''}`).join('\n');
  if (!force && key === peopleKey) return;
  peopleKey = key;
  const ul = $('people');
  ul.replaceChildren();
  peers.forEach((p, i) => {
    const you = p.id === store.you;
    const mic = !p.voice ? '' : p.muted ? '🔇' : '🎙️';
    const sub = doing[i];
    const li = h(
      'li',
      { 'data-peer': p.id, class: p.lite && !you ? undefined : 'walk', title: you ? L.hud.changeCharacter : p.lite ? L.hud.onLite(p.name) : `${store.onMyFloor(p) ? L.hud.walkTo(p.name) : L.hud.elevatorTo(p.name)}${sub ? ` (${sub})` : ''}` },
      h('span.dot', { style: `background:${p.color}` }),
      h('span.name', {}, p.name, sub ? h('span.sub', {}, sub) : null),
      p.account ? h('span.acct', { title: you ? L.hud.ownAccountYou : L.hud.ownAccount }, '✓') : null,
      you ? h('span.you', {}, L.hud.you) : null,
      // Somewhere else in the building: which floor.
      !you && !store.onMyFloor(p)
        ? p.floor === ROOF
          ? h('span.where', { title: L.hud.onRoof }, `🍸 ${ROOF_NAME}`)
          : h('span.where', { title: L.hud.otherFloor }, `🛗 ${store.floors.find((f) => f.id === p.floor)?.name ?? L.hud.lobby}`)
        : null,
      p.sharing ? h('span', { title: L.hud.sharing }, '🖥️') : null,
      h('span.mic', {}, mic),
    );
    li.addEventListener('click', () => (you ? onEditProfile() : onWalkTo(p.id)));
    ul.append(li);
  });
  $('people-count').textContent = String(peers.length);
  void voice;
}

export function updateSpeaking(voice: Voice) {
  for (const li of document.querySelectorAll<HTMLElement>('#people li[data-peer]')) {
    const lvl = voice.levelOf(li.dataset.peer!);
    li.classList.toggle('speaking', lvl > 0.04);
  }
}

export function renderWorkers(onOpen: (id: string) => void) {
  const ul = $('workers');
  ul.replaceChildren();
  const workers = [...store.workers.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const w of workers) {
    const provider = w.kind === 'agent' ? providerLabel(w.provider, store.project) : null;
    const providerKind = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const usageState = w.kind === 'agent' ? providerUsageState(w.provider, store.project, w.usage) : undefined;
    const waiting = usageState === 'waiting' ? providerWaitingLabel(providerKind, store.project) : '';
    const usageNote = usageState === 'untracked' ? ` · ${L.hud.untracked}` : waiting ? ` · ${waiting}` : '';
    const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort) : undefined;
    const sub = [provider && `⚙️ ${provider}${badge ? ` · ${badge}` : ''}${usageNote}`, w.worktree && `🌿 ${w.worktree.branch}`, w.repos?.length && `🗂️ ${w.repos.length + 1} repos`, w.pr && `🔀 PR #${w.pr.number}`, w.activity || w.title || w.prompt].filter(Boolean).join(' · ');
    ul.append(
      h(
        'li',
        { onclick: () => onOpen(w.id), title: L.hud.openTerminal(w.name) },
        h('span.dot', { style: `background:${w.color}` }),
        h('span.name', {}, w.name, sub ? h('span.sub', {}, sub) : null,
          usageState === 'tracked' && w.usage ? h('span.cost', { title: usageTitle(w.usage, providerKind) }, usageLabel(w.usage, providerKind)) : null),
        w.lost ? h('span.pill.lost', { title: L.hud.lostTip }, L.game.worktreeDeleted) : h('span.pill', { class: w.status }, STATUS_LABEL[w.status] ?? w.status),
      ),
    );
  }
  if (!workers.length) ul.append(h('li.empty', {}, L.hud.hireOne));
  // The count is the workers hired onto desks and bean bags (and a meeting's table): the board agents
  // standing at the Issues, PR and queue kiosks are listed but aren't counted.
  const hired = workers.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length;
  $('worker-count').textContent = hired ? String(hired) : '';
}

let caffeineKey = '';
/** The caffeine meter: a cup per coffee in a row, and a bar that drains over the buzz's minute. */
export function renderCaffeine(caffeine: Caffeine, now: number) {
  const left = caffeine.left(now);
  const jittery = caffeine.jitter(now) > 0;
  const k = `${Math.ceil(left)}|${caffeine.cups}|${jittery}`;
  if (k === caffeineKey) return;
  caffeineKey = k;
  const el = $('caffeine');
  el.classList.toggle('hidden', !left);
  el.classList.toggle('jittery', jittery);
  if (!left) return;
  $('caffeine-cups').textContent = '☕'.repeat(Math.min(caffeine.cups, 3));
  // The bar eases down a second at a time (see its CSS transition), so aim for where it will be in one.
  $('caffeine-fill').style.width = `${(Math.max(0, left - 1) / BUZZ_SECONDS) * 100}%`;
  $('caffeine-left').textContent = `${Math.ceil(left)}s`;
}

/** How long a chat line stays up before it fades away. Hovering the chat, or typing in it, brings them all back. */
const CHAT_LINGER = 12_000;
/** When this page first showed each line. */
const chatSeen = new WeakMap<ChatLine, number>();

export function renderChat() {
  const log = $('chat-log');
  const now = performance.now();
  log.replaceChildren(
    ...store.chat.slice(-60).map((c) => {
      const seen = chatSeen.get(c) ?? now;
      chatSeen.set(c, seen);
      // Older lines start their fade in the past, so they're already gone.
      return h(
        'li',
        { style: `animation-delay:${Math.round(CHAT_LINGER - (now - seen))}ms` },
        h('b', { style: `color:${c.color}`, title: c.account ? L.hud.chatAccount(c.name) : undefined }, c.name),
        c.account ? h('span.acct', {}, ' ✓') : null,
        ': ',
        c.text,
      );
    }),
  );
  log.scrollTop = log.scrollHeight;
}

export function openHelp() {
  const rows = L.help.rows(IS_MAC ? '⌘K' : 'Ctrl+K');
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': L.menu.controls },
    h('header', {}, h('h2', {}, L.help.title), close),
    h('div.body', {}, h('div.help-grid', {}, ...rows.flatMap(([k, v]) => [h('span.key', {}, k), h('span', {}, v)]))),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
}
