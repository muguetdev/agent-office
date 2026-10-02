/**
 * The rest of the building, from whichever floor you're on (FloorInfo.crew): under the Workers panel, the
 * other floors in a line each (who's working, who's waiting on you, who's done), each opening onto its
 * workers; and a strip under the top bar when a worker on another floor stops to ask you something.
 * Clicking one takes you there: the elevator, its desk, its terminal open.
 */
import './building.css';
import type { CrewMember } from '../../../shared/crew';
import type { FloorInfo } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { $, h, STATUS_LABEL, timeAgo } from '../../ui/dom';
import { L, workerName } from '../../i18n';

/** Remembered in the browser: whether the other floors are open, and which of them. */
const KEY = 'agent-office.building';

const asking = (w: CrewMember) => w.status === 'needs_input';
const done = (w: CrewMember) => w.status === 'done' && !w.acked;
const working = (w: CrewMember) => w.status === 'working' || w.status === 'starting';

/** The floors other than yours that have anyone working on them. */
function others(): FloorInfo[] {
  return store.floors.filter((f) => f.id !== store.floor && !f.cloning && f.crew?.length);
}

/** "⌨️ 3 · 🙋 1 · ✅ 2", leaving out what's none. */
function tally(crew: readonly CrewMember[]): string {
  const n = (f: (w: CrewMember) => boolean) => crew.filter(f).length;
  return [n(asking) && `🙋 ${n(asking)}`, n(working) && `⌨️ ${n(working)}`, n(done) && `✅ ${n(done)}`].filter(Boolean).join(' · ') || L.building.idle;
}

export function installBuilding(ctx: Ctx, parts: Pick<Parts, 'travel' | 'waiting'>) {
  let saved: { open?: boolean; floors?: string[] } = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    // no storage: it starts closed
  }
  let open = !!saved.open;
  const openFloors = new Set(saved.floors ?? []);
  const keep = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ open, floors: [...openFloors] }));
    } catch {
      // no storage: only for now
    }
  };

  /** Where you asked to go: once you've arrived there and its workers are in, over to this one. */
  let going: { floor: string; id: string; until: number } | null = null;
  function goTo(floor: string, id: string) {
    if (floor === store.floor) return parts.waiting.answerWorker(id);
    going = { floor, id, until: performance.now() + 60_000 };
    parts.travel.ride(floor);
  }
  ctx.ticks.add('hud', ({ now }) => {
    if (!going) return;
    if (now > going.until) going = null;
    else if (going.floor === store.floor && !ctx.trip() && store.workers.has(going.id)) {
      const id = going.id;
      going = null;
      parts.waiting.answerWorker(id);
    }
  });

  // ---- Under the Workers panel ----
  const section = h('div.building.hidden');
  $('workers-panel').append(section);

  function row(f: FloorInfo, w: CrewMember): HTMLElement {
    const ask = asking(w) ? h('span.ask', {}, `🙋 ${w.activity ?? L.hud.waitingAnswer}${w.waitingSince ? ` · ${timeAgo(w.waitingSince)}` : ''}`) : null;
    return h(
      'li',
      { class: asking(w) ? 'needs-you-row' : '', title: L.building.goTip(workerName(w.name), f.name), onclick: () => goTo(f.id, w.id) },
      h('span.dot', { style: `background:${w.color}` }),
      h('span.name', {}, workerName(w.name), !asking(w) && w.activity ? h('span.sub', {}, w.activity) : null),
      h('span.pill', { class: w.status }, asking(w) ? L.hud.needsYouPill : (STATUS_LABEL[w.status] ?? w.status)),
      ask,
    );
  }

  function render() {
    const floors = others();
    section.classList.toggle('hidden', !floors.length);
    if (!floors.length) return;
    const all = floors.flatMap((f) => f.crew ?? []);
    const head = h(
      'button.building-head',
      { type: 'button', 'aria-expanded': String(open), onclick: () => ((open = !open), keep(), render()) },
      h('span', {}, `${open ? '▾' : '▸'} 🏢 ${L.building.title}`),
      h('span.building-tally', {}, tally(all)),
    );
    const body: Node[] = [];
    if (open) {
      for (const f of floors) {
        const crew = [...(f.crew ?? [])].sort((a, b) => Number(asking(b)) - Number(asking(a)) || Number(done(b)) - Number(done(a)));
        const isOpen = openFloors.has(f.id) || crew.some(asking);
        body.push(
          h(
            'button.building-floor',
            {
              type: 'button',
              'aria-expanded': String(isOpen),
              class: crew.some(asking) ? 'asking' : '',
              onclick: () => (openFloors.has(f.id) ? openFloors.delete(f.id) : openFloors.add(f.id), keep(), render()),
            },
            h('span', {}, `${isOpen ? '▾' : '▸'} ${f.name}`),
            h('span.building-tally', {}, tally(crew)),
          ),
        );
        if (isOpen) body.push(h('ul.building-crew', {}, ...crew.map((w) => row(f, w))));
      }
    }
    section.replaceChildren(head, ...body);
  }

  // ---- The strip: someone on another floor needs you ----
  const strip = h('div.needs-you-elsewhere.hidden', { role: 'status', 'aria-live': 'polite' });
  $('hud').append(strip);
  /** Who was asking last time, by floor and worker, so a new one rings and an old one doesn't. */
  let seen = new Set<string>();
  /** Put away until someone else starts asking. */
  let hidden = new Set<string>();
  let first = true;

  function paintStrip() {
    const askingNow = others().flatMap((f) => (f.crew ?? []).filter(asking).map((w) => ({ f, w, key: `${f.id}/${w.id}` })));
    const now = new Set(askingNow.map((a) => a.key));
    const fresh = askingNow.filter((a) => !seen.has(a.key));
    seen = now;
    hidden = new Set([...hidden].filter((k) => now.has(k)));
    if (fresh.length && !first && ctx.settings.needsYouSound !== 'off') ctx.sound.needsYou();
    first = false;
    const show = askingNow.filter((a) => !hidden.has(a.key));
    strip.classList.toggle('hidden', !show.length);
    if (!show.length) return;
    const [top] = show;
    strip.replaceChildren(
      h(
        'button.needs-you-elsewhere-go',
        { type: 'button', title: L.building.goTip(workerName(top.w.name), top.f.name), onclick: () => goTo(top.f.id, top.w.id) },
        h('span', { 'aria-hidden': 'true' }, '🙋'),
        h('span.needs-you-elsewhere-text', {}, h('strong', {}, L.building.needsYou(workerName(top.w.name), top.f.name)), top.w.activity ? h('span', {}, top.w.activity) : null),
        show.length > 1 ? h('span.needs-you-more', {}, L.needsYou.more(show.length - 1)) : null,
        h('span.needs-you-elsewhere-cta', {}, L.building.go),
      ),
      h(
        'button.needs-you-elsewhere-x',
        { type: 'button', 'aria-label': L.page.hide, title: L.needsYou.hideTip, onclick: () => ((hidden = new Set([...hidden, ...show.map((a) => a.key)])), paintStrip()) },
        '✕',
      ),
    );
  }

  const paint = () => {
    render();
    paintStrip();
  };
  store.on('floors', paint);
  store.on('floor', paint);
  paint();
  return { goTo };
}
