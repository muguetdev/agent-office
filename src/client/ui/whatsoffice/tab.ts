// The 💬 WhatsOffice tab beside a worker's terminal (see termtabs.ts): its conversations with the other
// workers (server/whatsoffice/), like a messaging app: who it talks to down the side, with the last
// message and how many it hasn't read, and the conversation open as bubbles, its own on the right.
// Only to look at: the conversations are the workers' own, and looking doesn't mark anything read.
import './tab.css';
import type { WoMessage, WoThread } from '../../../shared/protocol';
import { h } from '../dom';
import { store } from '../../state';
import { L } from '../../i18n';

/** How often it looks again while it's open. */
const POLL_MS = 4000;

type Conversation = WoThread & { me: 0 | 1; unread: number };

/** A name's colour, the same every time. */
function hue(name: string): number {
  let x = 0;
  for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x % 360;
}

function avatar(name: string): HTMLElement {
  return h('span.wo-avatar', { style: `background:hsl(${hue(name)} 55% 45%)`, 'aria-hidden': 'true' }, name.slice(0, 1).toUpperCase());
}

/** A time as the list shows it: the hour today, else the day. */
function when(at: number): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

export interface WoTab {
  el: HTMLElement;
  shows(): boolean;
  show(on: boolean): void;
}

export function woTab(workerId: string): WoTab {
  const list = h('div.wo-list', { role: 'list' });
  const head = h('div.wo-chat-head');
  const msgs = h('div.wo-msgs', { role: 'log', 'aria-live': 'polite' });
  const chat = h('section.wo-chat', {}, head, msgs, h('div.wo-foot', {}, L.whatsoffice.readOnly));
  const el = h('div.wo-pane.hidden', {}, h('aside.wo-side', {}, h('div.wo-side-head', {}, L.whatsoffice.title), list), chat);
  let open = false;
  let picked: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** The conversation showing, so a look that changes nothing doesn't redraw it (and lose your scroll). */
  let drawn = '';

  const url = (path: string, extra: Record<string, string> = {}) => `${path}?${new URLSearchParams({ floor: store.floor ?? '', worker: workerId, ...extra })}`;
  const get = async <T>(u: string): Promise<T | undefined> => {
    try {
      const r = await fetch(u, { credentials: 'same-origin', cache: 'no-store' });
      return r.ok ? ((await r.json()) as T) : undefined;
    } catch {
      return undefined;
    }
  };

  function paintList(cs: Conversation[]) {
    if (!cs.length) return void list.replaceChildren(h('p.wo-empty', {}, L.whatsoffice.none));
    list.replaceChildren(
      ...cs.map((c) => {
        const other = c.members[c.me === 0 ? 1 : 0];
        const preview = c.last ? `${c.last.from === c.me ? `${L.whatsoffice.you}: ` : ''}${c.last.text.replace(/\s+/g, ' ')}` : '';
        return h(
          'button.wo-item',
          { type: 'button', role: 'listitem', class: c.id === picked ? 'on' : '', onclick: () => pick(c.id) },
          avatar(other.name),
          h(
            'span.wo-item-text',
            {},
            h('span.wo-item-top', {}, h('span.wo-name', {}, other.name), h('span.wo-time', {}, c.last ? when(c.last.at) : '')),
            h('span.wo-floor', {}, other.floorName),
            h('span.wo-item-bottom', {}, h('span.wo-preview', {}, preview), c.unread ? h('span.wo-unread', { title: L.whatsoffice.unreadTip }, String(c.unread)) : null),
          ),
        );
      }),
    );
  }

  function paintChat(thread: WoThread & { me: 0 | 1 }, messages: WoMessage[]) {
    const key = `${thread.id}:${messages.length}`;
    if (key === drawn) return;
    const atEnd = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
    drawn = key;
    const other = thread.members[thread.me === 0 ? 1 : 0];
    const back = h('button.wo-back', { type: 'button', 'aria-label': L.whatsoffice.back, onclick: () => el.classList.remove('wo-reading') }, '←');
    head.replaceChildren(back, avatar(other.name), h('span.wo-chat-name', {}, other.name), h('span.wo-chat-floor', {}, other.floorName));
    let day = '';
    const items: HTMLElement[] = [];
    for (const m of messages) {
      const d = new Date(m.at).toLocaleDateString([], { day: '2-digit', month: 'long' });
      if (d !== day) {
        day = d;
        items.push(h('div.wo-day', {}, d));
      }
      const mine = m.from === thread.me;
      items.push(h(`div.wo-bubble.${mine ? 'mine' : 'theirs'}`, {}, h('span.wo-text', {}, m.text), h('span.wo-at', {}, new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))));
    }
    msgs.replaceChildren(...items);
    if (atEnd || !msgs.dataset.seen) msgs.scrollTop = msgs.scrollHeight;
    msgs.dataset.seen = '1';
  }

  async function refresh() {
    const r = await get<{ conversations: Conversation[] }>(url('/api/whatsoffice'));
    if (!r || !open) return;
    picked ??= r.conversations[0]?.id;
    paintList(r.conversations);
    if (!picked) {
      head.replaceChildren();
      msgs.replaceChildren(h('p.wo-empty', {}, L.whatsoffice.pick));
      return;
    }
    const t = await get<{ thread: WoThread & { me: 0 | 1 }; messages: WoMessage[] }>(url('/api/whatsoffice/thread', { id: picked }));
    if (t && open) paintChat(t.thread, t.messages);
  }

  function pick(id: string) {
    picked = id;
    drawn = '';
    delete msgs.dataset.seen;
    el.classList.add('wo-reading');
    void refresh();
  }
  // On a phone the list and the conversation take turns: the ← in its header is the list again.

  return {
    el,
    shows: () => store.workers.get(workerId)?.kind === 'agent',
    show(on) {
      open = on;
      el.classList.toggle('hidden', !on);
      clearInterval(timer);
      timer = undefined;
      if (!on) return;
      void refresh();
      timer = setInterval(() => {
        if (!el.isConnected) return void clearInterval(timer);
        void refresh();
      }, POLL_MS);
    },
  };
}
