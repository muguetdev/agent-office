// The 2D view (/lite): the office without the 3D, for a phone or a computer the 3D office is too
// much for. Every worker on the floor and how it's doing, the ones waiting on someone first; its
// terminal, with the keys a phone's keyboard hasn't got and a box to send it a prompt; and the boards
// and the task queue. You're in the office as someone on the 2D view (PeerInfo.lite), not standing
// anywhere in it.

import { Net } from './net';
import { AVATAR_COLORS, loadProfile, loadSettings, saveProfile, store } from './state';
import { randomLook } from '../shared/avatar';
import { cloneLabel } from '../shared/floors';
import { ROOF } from '../shared/rooftop';
import { DESK_BY_ID, nextFreeSeat } from '../shared/layout';
import { isAsleep } from '../shared/status';
import type { AgentEffort, AgentProvider, WorkerInfo } from '../shared/protocol';
import { $, closeAllModals, doingNow, h, onDoingChange, onModalChange, openModal, readingNow, toast } from './ui/dom';
import { openTerminal, openTerminalFor, routeTerminalMessage } from './ui/terminal';
import { openChanges, openChangesFor, routeChangesMessage } from './ui/changes';
import { linkCodeLive } from './ui/code-live/link';
import { lostWorktreeDialog, openPrompt, routeWorktreeMessage, sendHomeDialog } from './ui/prompt';
import { openBoard } from './ui/boards';
import type { BoardActions } from './ui/github/prompts';
import { openPull, routePullMessage } from './ui/pull';
import { openQueue } from './ui/queue';
import { openAsk } from './ui/ask';
import { openMeeting, type MeetingPreset } from './ui/meeting';
import { openSignIns } from './ui/signins';
import { byUrgency, waitingInOrder, waitingLabel } from './nextup';
import { DesktopNotifier, waitingOnSomeone } from './notify';
import { repoChoices } from './shared/hiring';
// The tab title counts the workers waiting on someone, on every floor, as the 3D office's does.
import { renderTitle } from './shared/title';
import { L, placeLabel, translatePage } from './i18n';
import { registerApp, setBadge, type SwMessage } from './mobile/pwa';
import { pushState, refresh as refreshPush } from './mobile/push';
import { openFloors, openMore } from './mobile/menu';
import { workerCard as card, type Filter, FILTERS, matches } from './mobile/cards';

translatePage();

// Sent here because this browser can't draw the 3D office (see noWebGL in core/scene.ts).
if (new URLSearchParams(location.search).get('why') === 'webgl') {
  history.replaceState(null, '', location.pathname);
  toast(L.lite.noWebgl, 'warn');
}

// Your name and color from the 3D office, if this browser has been in it. Nobody sees a character
// of yours from here, so a look is only made up to connect with.
const saved = loadProfile();
store.profile = { name: saved?.name ?? 'Guest', color: saved?.color ?? AVATAR_COLORS[1], look: saved?.look ?? randomLook() };
const net = new Net(() => store.profile, () => null, true);
const settings = loadSettings();
/** This phone gets the office's push notifications (mobile/push.ts): those show instead of the page's own. */
let pushOn = false;
const notifier = new DesktopNotifier(() => settings.notify && !pushOn, (id) => openWorker(id));

/** The server version this page was loaded with. */
let bootVersion = '';

net.onStatus((up) => {
  $('conn').classList.toggle('hidden', up);
  $('conn-dot').classList.toggle('down', !up);
});
// A worker's Code tab hears what changes in its folder as it happens (see ui/code-live/).
linkCodeLive(net);
net.onMessage((msg) => {
  store.apply(msg);
  routeTerminalMessage(msg);
  routeChangesMessage(msg);
  routePullMessage(msg);
  routeWorktreeMessage(msg);
  switch (msg.t) {
    case 'welcome': {
      // Back from a restart on another version: this page's code is stale, so load the new one.
      if (!bootVersion) bootVersion = msg.version;
      else if (msg.version !== bootVersion) return location.reload();
      offTheRoof();
      pendingFloor();
      void refreshPush();
      // After a reconnect the server has forgotten which terminal we had open, and what we're doing.
      sendDoing(true);
      const openId = openTerminalFor();
      if (openId && store.workers.has(openId)) net.send({ t: 'worker.attach', workerId: openId });
      const watching = openChangesFor();
      if (watching && store.workers.has(watching.workerId)) net.send({ t: 'changes.watch', ...watching });
      break;
    }
    case 'floor.enter':
      offTheRoof();
      break;
    case 'toast':
      toast(msg.text, msg.level);
      break;
    case 'signins.needed':
      openSignIns(net, msg.why);
      break;
    case 'upgrade':
      if (msg.state.phase === 'restarting') {
        net.expectRestart();
        toast(L.lite.restarting);
      }
      break;
  }
});

/** Nothing to see up on the roof from here: down to the first floor instead (the 3D office left you up there, say). */
function offTheRoof() {
  if (store.floor !== ROOF) return;
  const to = store.floors.find((f) => !f.cloning && !f.locked);
  if (to) net.send({ t: 'floor.go', floor: to.id });
}

// ---- The floor you're on ------------------------------------------------------------------------
function renderFloors() {
  const f = store.currentFloor();
  $('floor-name').textContent = f ? `${f.name}${f.cloning ? ` (${cloneLabel(f.clone)})` : ''}` : store.floors.length ? '…' : L.lite.noFloors;
  const p = store.project;
  $('floor-meta').textContent = p ? [p.branch && `⎇ ${p.branch}`, f?.repo ?? p.dir.split(/[\\/]/).pop(), f && `👥 ${L.lite.here(f.people)}`].filter(Boolean).join(' · ') : store.floors.length ? '' : L.lite.addProject;
  // Someone waiting on another floor: a way straight there.
  const elsewhere = store.floors.filter((o) => o.id !== store.floor && o.waiting > 0 && !o.cloning);
  const box = $('elsewhere');
  box.classList.toggle('hidden', !elsewhere.length);
  box.replaceChildren(
    ...elsewhere.map((o) =>
      h('button.btn.lite-go', { type: 'button', onclick: () => net.send({ t: 'floor.go', floor: o.id }) }, `🙋 ${L.lite.waitingOn(o.waiting, o.name)}`, h('span', { 'aria-hidden': 'true' }, '→')),
    ),
  );
  // Everyone waiting, on every floor, on the app's icon.
  setBadge(store.floors.reduce((n, o) => n + (o.waiting || 0), 0));
  renderTitle();
}
$('floor-btn').addEventListener('click', () => openFloors(net));
store.on('floors', renderFloors);
store.on('floor', renderFloors);
store.on('project', renderFloors);

// ---- Workers ------------------------------------------------------------------------------------
/** What each worker was last, to tell when one starts waiting on someone. */
const lastStatus = new Map<string, string>();

/** Which workers the list shows (the chips over it), kept for next time. */
let filter: Filter = (() => {
  try {
    const f = localStorage.getItem('agent-office.lite-filter') as Filter | null;
    return f && FILTERS.includes(f) ? f : 'all';
  } catch {
    return 'all';
  }
})();

function setFilter(f: Filter) {
  filter = f;
  try {
    localStorage.setItem('agent-office.lite-filter', f);
  } catch {
    // only this visit then
  }
  renderWorkers();
}

function renderWorkers() {
  const all = byUrgency(store.workers.values());
  const list = all.filter((w) => matches(w, filter));
  const ul = $('workers');
  ul.replaceChildren(...list.map((w) => card(w, { open: openWorker, prompt: promptWorker })));
  if (!all.length) ul.append(h('li.lite-empty', {}, h('span.lite-empty-art', { 'aria-hidden': 'true' }, '🪑'), store.project ? L.lite.nobody : L.lite.noWorkers));
  else if (!list.length) ul.append(h('li.lite-empty', {}, h('span.lite-empty-art', { 'aria-hidden': 'true' }, '🌤️'), L.mobile.noneHere, h('button.btn', { type: 'button', onclick: () => setFilter('all') }, L.mobile.showAll)));
  $('filters').replaceChildren(
    ...FILTERS.map((f) => {
      const n = all.filter((w) => matches(w, f)).length;
      if (f !== 'all' && f !== filter && !n) return '';
      return h('button.lite-chip', { type: 'button', role: 'tab', 'aria-selected': String(f === filter), class: `${f}${f === filter ? ' on' : ''}`, onclick: () => setFilter(f) }, L.mobile.filter[f], h('span.n', {}, String(n)));
    }),
  );
  const waiting = waitingInOrder(all);
  const n = $('btn-workers').querySelector('.n')!;
  n.textContent = waiting.length ? String(waiting.length) : '';
  n.setAttribute('title', waitingLabel(waiting));
  renderTitle();
}

/** A worker needs input or is done: a notification while you're elsewhere, and a buzz. */
function noticeWorkers() {
  for (const w of store.workers.values()) {
    const before = lastStatus.get(w.id);
    lastStatus.set(w.id, w.status);
    if (before === undefined || before === w.status || !waitingOnSomeone(w)) continue;
    notifier.alert(w);
    if (w.status === 'needs_input') navigator.vibrate?.(200);
  }
  notifier.sync(store.workers);
}

store.on('workers', () => {
  noticeWorkers();
  renderWorkers();
  pendingWorker();
});
store.on('project', renderWorkers);
// "3m ago" moves on by itself.
setInterval(renderWorkers, 30_000);

/** Its terminal, with the keypad, waking it up first if it's asleep. */
function openWorker(id: string) {
  const w = store.workers.get(id);
  if (!w) return;
  if (w.lost) return fixLostWorktree(w);
  if (isAsleep(w.status)) {
    if (!w.sessionId && w.kind !== 'shell') toast(L.lite.noSession(w.name), 'warn');
    net.send({ t: 'worker.resume', workerId: id });
  }
  openTerminal(net, id, () => openChanges(net, id, () => openWorker(id)), undefined, { keypad: true });
}

/** Its worktree was deleted outside agent-office: put it back (everyone's who lost theirs), or send it home. */
function fixLostWorktree(w: WorkerInfo) {
  if (!w.lost || !w.worktree) return;
  const worktree = w.worktree;
  const others = [...store.workers.values()].filter((o) => o.lost && o.id !== w.id);
  lostWorktreeDialog({
    name: w.name,
    worktree,
    lost: w.lost,
    workspace: w.repos?.length ? worktree.path.replace(/[\\/][^\\/]*$/, '') : undefined,
    others: others.map((o) => o.name),
    openTerminal: isAsleep(w.status) ? undefined : () => openTerminal(net, w.id, () => openChanges(net, w.id, () => openWorker(w.id)), undefined, { keypad: true }),
    rebuild: (all) => {
      toast(all ? L.game.rebuildingMany(others.length + 1) : L.game.rebuilding(w.name));
      net.send({ t: 'worker.rebuild', workerId: w.id, all });
    },
    sendHome: () =>
      sendHomeDialog({
        workerId: w.id,
        name: w.name,
        where: DESK_BY_ID.has(w.deskId) ? placeLabel(DESK_BY_ID.get(w.deskId)!) : L.lite.itsDesk,
        worktree,
        repos: w.repos?.length ? [worktree.path.split(/[\\/]/).pop() ?? L.lite.itsOwn, ...w.repos.map((r) => r.name)] : undefined,
        ask: () => net.send({ t: 'worker.worktree', workerId: w.id }),
        onConfirm: (cleanup) => net.send({ t: 'worker.kill', workerId: w.id, cleanup }),
      }),
  });
}

function promptWorker(id: string) {
  const w = store.workers.get(id);
  if (!w) return;
  openPrompt({
    title: `✍️ ${L.lite.promptTitle(w.name)}`,
    subtitle: w.status === 'working' ? L.lite.busy(w.name) : undefined,
    placeholder: L.lite.nextPlaceholder,
    submitLabel: 'Send',
    onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: id, prompt: text }),
  });
}

// ---- New work: a prompt for a worker who's here, or a new one at a free desk -------------------
function hire(deskId: string, prompt: string, worktree: boolean, provider?: AgentProvider, model?: string, effort?: AgentEffort, repos?: string[], issue?: number) {
  net.send({ t: 'worker.spawn', deskId, prompt, worktree, provider, model, effort, issue, repos: repos?.length ? repos : undefined });
}

/** With `issue`, the worker the prompt goes to takes that GitHub issue. */
function sendToWorker(title: string, text: { context?: string; initial?: string } = {}, issue?: number) {
  if (!store.project) return toast(L.lite.pickFloor, 'warn');
  // The back office's desks too, as far as the floor's built out (see WING).
  const desk = nextFreeSeat((id) => !!store.workerAtDesk(id), store.floorPlan.wing)?.id;
  const awake = [...store.workers.values()].filter((w) => w.kind === 'agent' && !isAsleep(w.status));
  if (!desk && !awake.length) return toast(L.main.allTaken, 'warn');
  openAsk({
    title,
    ...text,
    newDesk: desk ? DESK_BY_ID.get(desk)!.label : undefined,
    workers: awake.map((w) => ({ id: w.id, name: w.name, color: w.color, status: w.status })),
    worktreeOption: !!store.project.branch,
    providerOption: true,
    repoOptions: repoChoices(),
    onSubmit: (prompt, to, worktree, provider, model, effort, repos) => {
      if (to) net.send({ t: 'worker.prompt', workerId: to, prompt, issue });
      else if (desk) hire(desk, prompt, worktree, provider, model, effort, repos, issue);
    },
  });
}

// ---- The boards, the queue and the meeting room -------------------------------------------------
function boardActions(): BoardActions {
  return {
    queue: (prompt, title, issue, provider, model, effort) => net.send({ t: 'queue.add', prompt, title, issue, provider, model, effort }),
    assign: (prompt, title, issue) => sendToWorker(`🤖 ${title}`, { initial: prompt }, issue),
    ask: (context, title) => sendToWorker(`✍️ ${title}`, { context }),
    // There's no desk to walk to from here: its terminal instead.
    goToDesk: (deskId) => {
      const w = store.workerAtDesk(deskId);
      if (!w) return;
      closeAllModals();
      openWorker(w.id);
    },
    meeting: (preset) => showMeeting(preset),
  };
}

function showMeeting(preset?: MeetingPreset) {
  openMeeting(
    net,
    {
      openTerminal: openWorker,
      openPr: (id) => {
        const w = store.workers.get(id);
        if (!w) return;
        const it = w.pr && store.pulls.items.find((p) => p.number === w.pr!.number);
        if (it) openPull(it, net, boardActions());
        else if (w.pr) window.open(w.pr.url, '_blank', 'noopener');
        else net.send({ t: 'worker.pr', workerId: id });
      },
    },
    preset,
  );
}

$('btn-issues').addEventListener('click', () => openBoard('issues', net, boardActions()));
$('btn-pulls').addEventListener('click', () => openBoard('pulls', net, boardActions()));
$('btn-queue').addEventListener('click', () => openQueue(net, { openTerminal: openWorker }));
$('btn-new').addEventListener('click', () => sendToWorker(L.lite.newTask));
$('btn-more').addEventListener('click', () => openMore({ meeting: () => showMeeting() }));
// Back to the list, at the top.
$('btn-workers').addEventListener('click', () => {
  closeAllModals();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function renderNav() {
  const count = (id: string, n: number) => ($(id).querySelector('.n')!.textContent = n ? String(n) : '');
  count('btn-issues', store.issues.items.filter((i) => i.state === 'OPEN').length);
  count('btn-pulls', store.pulls.items.filter((p) => p.state === 'OPEN').length);
  count('btn-queue', store.queue.tasks.filter((t) => t.status !== 'done').length);
}
store.on('issues', renderNav);
store.on('pulls', renderNav);
store.on('queue', renderNav);

// ---- What you have open, for the others (see PeerInfo.doing) -----------------------------------
let doingSent: string | undefined;
let readingSent = false;
function sendDoing(reconnected = false) {
  if (reconnected) {
    doingSent = undefined;
    readingSent = false;
  }
  const what = doingNow();
  const reading = readingNow();
  if (what === doingSent && reading === readingSent) return;
  doingSent = what;
  readingSent = reading;
  net.send({ t: 'doing', what, reading });
}
onModalChange(() => sendDoing());
onDoingChange(() => sendDoing());

// ---- The app: installed on a phone, push, and links straight to a worker --------------------------
/** A worker to open once you're on its floor and it's arrived (a tapped notification, a link). */
let want: { floor?: string; worker?: string } = {};

function goTo(floor?: string, worker?: string) {
  want = { floor, worker };
  pendingFloor();
  pendingWorker();
}
function pendingFloor() {
  if (!want.floor || !store.floor) return;
  if (want.floor !== store.floor && store.floors.some((f) => f.id === want.floor)) net.send({ t: 'floor.go', floor: want.floor });
  want.floor = undefined;
}
function pendingWorker() {
  if (!want.worker || want.floor || !store.workers.has(want.worker)) return;
  const id = want.worker;
  want.worker = undefined;
  closeAllModals();
  openWorker(id);
}

registerApp((m: SwMessage) => {
  if (m.t === 'open') goTo(m.floor, m.workerId);
  else if (m.data.kind === 'needs_input') navigator.vibrate?.([120, 60, 120]);
});
const checkPush = () => void pushState().then((st) => (pushOn = st === 'on'));
checkPush();
window.addEventListener('focus', checkPush);

{
  const q = new URLSearchParams(location.search);
  if (q.get('worker')) goTo(q.get('floor') ?? undefined, q.get('worker')!);
  const f = q.get('filter') as Filter | null;
  if (f && FILTERS.includes(f)) filter = f;
  if (q.get('new')) setTimeout(() => store.project && sendToWorker(L.lite.newTask), 1500);
  if ([...q.keys()].length) history.replaceState(null, '', location.pathname);
}

// ---- In ----------------------------------------------------------------------------------------
/** Your name, the first time this browser comes in on the shared password. */
function askName(done: (name: string) => void) {
  const input = h('input', { type: 'text', maxlength: 24, placeholder: L.character.name, 'aria-label': L.character.name, autocomplete: 'nickname' }) as HTMLInputElement;
  const form = h(
    'form.modal.lite-name',
    {},
    h('header', {}, h('h2', {}, L.lite.whoIsIt)),
    h('div.body', {}, h('p', {}, L.lite.nameNote), input),
    h('footer', {}, h('button.btn.primary', { type: 'submit' }, L.auth.comeIn)),
  );
  const modal = openModal(form, { escCloses: false, backdropCloses: false });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return input.focus();
    modal.close();
    done(name);
  });
  setTimeout(() => input.focus(), 30);
}

void (async () => {
  try {
    const res = await fetch('/api/whoami', { cache: 'no-store' });
    if (res.status === 401) return void (location.href = '/login?next=/lite');
    const { me } = (await res.json()) as { me?: typeof store.me };
    if (me) store.me = me;
  } catch {
    // the welcome message says it too
  }
  // With an account of your own, your name is that account's.
  if (store.me.account) store.profile.name = store.me.account.name;
  if (saved || store.me.account) return net.connect();
  askName((name) => {
    store.profile.name = name;
    // No look: the 3D office still has you pick a character the first time you go in.
    saveProfile({ name, color: store.profile.color });
    net.connect();
  });
})();

renderFloors();
renderWorkers();
renderNav();

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__lite = { store, net };
