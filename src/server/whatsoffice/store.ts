// WhatsOffice: the workers' messages to each other, like a messaging app. Each pair of workers has
// one conversation, on whichever floors they are; a message waits in it until the other reads it
// (read_messages), and the office only tells that worker, in a line, that something's waiting, once
// it's free (in the middle of a turn, after; asleep, it wakes up for it). The conversations are kept
// in the office's .agent-office/whatsoffice.json, so a restart loses nothing. The workers use it
// through the hook server (hooks/office-chat.ts), as the whatsoffice command and the MCP tools
// (bin/whatsoffice.js) do; people read it in the 💬 WhatsOffice window (http/routes/whatsoffice.ts).
import { createHash } from 'node:crypto';
import type { WoMember, WoMessage, WoThread, WorkerInfo } from '../../shared/protocol.js';
import { isBusy } from '../../shared/status.js';
import { findWorker } from '../office-workers.js';

/** The most conversations kept (the quietest go first), messages each, and characters a message. */
export const MAX_THREADS = 300;
export const MAX_MESSAGES = 300;
export const MAX_TEXT = 20_000;
/** How long after its last message a conversation still shows over a worker's head (ms). */
export const RECENT_MS = 10 * 60_000;

/** A floor, as WhatsOffice sees it. */
export interface WoFloor {
  id: string;
  name: string;
  /** Its repository, or the server it manages, for the contacts. */
  project?: string;
  workers: {
    get(id: string): WorkerInfo | undefined;
    list(): WorkerInfo[];
    ownerOf(id: string): string | undefined;
    prompt(id: string, text: string, by?: string): string | undefined;
    resume(id: string, prompt?: string): string | undefined;
    /** With restart false: only tells everyone how it is now. */
    relaunch(id: string, restart?: boolean): string | undefined;
  };
}

export interface WoDeps {
  floors(): Iterable<WoFloor>;
  floor(id: string): WoFloor | undefined;
  /** Whether a worker running as `owner` (an account, or none in a password-only office) may reach `floor`. */
  may(owner: string | undefined, floor: string): boolean;
  /** Keeps the conversations (debounced by whoever saves). */
  save(data: WoData): void;
  now?: () => number;
}

/** A worker in a conversation: where it is, and its name and floor's as they were (it may have gone since). */
interface Member extends WoMember {
  id: string;
  /** How many of the conversation's messages it has read, and been told of. */
  read: number;
  told: number;
}

interface Thread {
  id: string;
  members: [Member, Member];
  messages: WoMessage[];
  /** Messages dropped off the front (MAX_MESSAGES), so read and told still count from the start. */
  dropped: number;
  at: number;
}

export interface WoData {
  threads: Thread[];
}

/** Someone a worker can message. */
export interface Contact {
  name: string;
  id: string;
  /** How to reach it: name@floor. */
  address: string;
  floor: string;
  floorName: string;
  project?: string;
  status: string;
  task?: string;
  you?: true;
  unread?: number;
}

interface Party {
  floor: string;
  id: string;
}

const keyOf = (p: Party) => `${p.floor}:${p.id}`;
const threadId = (a: Party, b: Party) => createHash('sha1').update([keyOf(a), keyOf(b)].sort().join('|')).digest('hex').slice(0, 10);
const is = (m: Member, p: Party) => m.floor === p.floor && m.id === p.id;

/** A conversation as the 💬 WhatsOffice window lists it. */
function summary(t: Thread): WoThread {
  const last = t.messages[t.messages.length - 1];
  return {
    id: t.id,
    members: t.members.map(({ name, floor, floorName }) => ({ name, floor, floorName })) as WoThread['members'],
    count: t.dropped + t.messages.length,
    ...(last ? { last: { from: last.from, text: last.text.slice(0, 200), at: last.at } } : {}),
  };
}

/** Splits `name@floor` (or an id) into the worker and the floor it names, if any. */
export function parseAddress(to: string): { who: string; floor?: string } {
  const t = to.trim();
  const at = t.lastIndexOf('@');
  return at > 0 ? { who: t.slice(0, at).trim(), floor: t.slice(at + 1).trim() } : { who: t };
}

export class WhatsOffice {
  private threads = new Map<string, Thread>();
  /** Workers being told right now: telling one tells everyone it changed, which comes back here. */
  private telling = new Set<string>();
  private now: () => number;

  constructor(
    private deps: WoDeps,
    saved?: WoData,
  ) {
    this.now = deps.now ?? Date.now;
    for (const t of saved?.threads ?? []) if (t?.id && Array.isArray(t.members) && t.members.length === 2 && Array.isArray(t.messages)) this.threads.set(t.id, { ...t, dropped: t.dropped ?? 0 });
  }

  // ---- For the workers --------------------------------------------------------------------------------

  /** Everyone `me` may message: every agent on every floor its owner may reach (itself marked). */
  contacts(me: Party): Contact[] {
    const out: Contact[] = [];
    for (const f of this.reachable(me)) {
      for (const w of f.workers.list()) {
        if (w.kind !== 'agent') continue;
        const self = f.id === me.floor && w.id === me.id;
        const t = self ? undefined : this.threads.get(threadId(me, { floor: f.id, id: w.id }));
        const mine = t?.members.find((m) => is(m, me));
        const unread = t && mine ? t.dropped + t.messages.length - mine.read : 0;
        out.push({
          name: w.name,
          id: w.id,
          address: `${w.name}@${f.id}`,
          floor: f.id,
          floorName: f.name,
          ...(f.project ? { project: f.project } : {}),
          status: w.status,
          ...(w.task?.name || w.activity ? { task: w.task?.name ?? w.activity } : {}),
          ...(self ? { you: true as const } : {}),
          ...(unread > 0 ? { unread } : {}),
        });
      }
    }
    return out;
  }

  /** `me` messages `to` (name@floor, a name, or an id): where it went, or why not. */
  send(me: Party, to: string, text: string): { thread: string; to: { name: string; floor: string } } | string {
    const msg = text.trim();
    if (!msg) return 'Say what to tell them: message';
    if (msg.length > MAX_TEXT) return `Keep it under ${MAX_TEXT} characters`;
    const found = this.find(me, to);
    if (typeof found === 'string') return found;
    if (found.floor.id === me.floor && found.w.id === me.id) return "That's you";
    const self = this.party(me);
    if (!self) return 'You are not in the office';
    const other = { floor: found.floor.id, id: found.w.id };
    const t = this.thread(me, self, other, found);
    t.messages.push({ from: is(t.members[0], me) ? 0 : 1, text: msg, at: this.now() });
    t.at = this.now();
    if (t.messages.length > MAX_MESSAGES) {
      const cut = t.messages.length - MAX_MESSAGES;
      t.messages.splice(0, cut);
      t.dropped += cut;
    }
    // What it says it has read: everything up to its own message.
    const mine = t.members.find((m) => is(m, me))!;
    mine.read = mine.told = t.dropped + t.messages.length;
    this.changed();
    this.show(me);
    this.show(other);
    this.tell(other);
    return { thread: t.id, to: { name: found.w.name, floor: found.floor.name } };
  }

  /**
   * What's waiting for `me`: every unread message, by conversation, marked read now. With `from`
   * (as for send), that conversation's latest `last` messages instead, read or not.
   */
  read(me: Party, from?: string, last = 30): { conversations: { with: string; address: string; messages: { from: string; text: string; at: string }[] }[] } | string {
    const pick: Thread[] = [];
    if (from) {
      const found = this.find(me, from);
      if (typeof found === 'string') return found;
      const t = this.threads.get(threadId(me, { floor: found.floor.id, id: found.w.id }));
      if (!t) return `No messages with ${found.w.name} yet`;
      pick.push(t);
    } else {
      for (const t of this.threads.values()) {
        const mine = t.members.find((m) => is(m, me));
        if (mine && t.dropped + t.messages.length > mine.read) pick.push(t);
      }
    }
    const conversations = pick.map((t) => {
      const mineAt = is(t.members[0], me) ? 0 : 1;
      const mine = t.members[mineAt];
      const other = t.members[1 - mineAt];
      const start = from ? Math.max(0, t.messages.length - last) : Math.max(0, mine.read - t.dropped);
      const messages = t.messages.slice(start).map((m) => ({ from: m.from === mineAt ? 'you' : other.name, text: m.text, at: new Date(m.at).toISOString() }));
      mine.read = mine.told = t.dropped + t.messages.length;
      return { with: `${other.name} (${other.floorName})`, address: `${other.name}@${other.floor}`, messages };
    });
    if (conversations.length) {
      this.changed();
      this.show(me);
    }
    return { conversations };
  }

  // ---- For people --------------------------------------------------------------------------------------

  /** A worker's conversations, latest first, for its 💬 WhatsOffice tab (`me`: which member it is in each). */
  conversationsOf(p: Party): (WoThread & { me: 0 | 1; unread: number })[] {
    return [...this.threads.values()]
      .filter((t) => t.members.some((m) => is(m, p)))
      .sort((a, b) => b.at - a.at)
      .map((t) => {
        const me = is(t.members[0], p) ? 0 : 1;
        return { ...summary(t), me, unread: Math.max(0, t.dropped + t.messages.length - t.members[me].read) };
      });
  }

  /** One of a worker's conversations, its messages as they are (people looking don't mark them read). */
  messagesOf(p: Party, id: string): { thread: WoThread & { me: 0 | 1 }; messages: WoMessage[] } | undefined {
    const t = this.threads.get(id);
    if (!t || !t.members.some((m) => is(m, p))) return undefined;
    return { thread: { ...summary(t), me: is(t.members[0], p) ? 0 : 1 }, messages: t.messages };
  }

  // ---- As the office goes ------------------------------------------------------------------------------

  /** A worker changed (or went: `w` is its id): what's waiting for it may be told now, and it shows its inbox. */
  workerChanged(floor: string, w: WorkerInfo | string) {
    if (typeof w === 'string') return;
    this.show({ floor, id: w.id });
    this.tell({ floor, id: w.id });
  }

  /** Every so often: whoever has something waiting and is free now hears of it, and a talk gone quiet stops showing. */
  tick() {
    const recent = this.now() - RECENT_MS * 2;
    for (const t of this.threads.values()) {
      for (const m of t.members) {
        if (t.dropped + t.messages.length > m.told) this.tell(m);
        if (t.at > recent) this.show(m);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------

  private reachable(me: Party): WoFloor[] {
    const owner = this.deps.floor(me.floor)?.workers.ownerOf(me.id);
    return [...this.deps.floors()].filter((f) => this.deps.may(owner, f.id));
  }

  private party(p: Party): { floor: WoFloor; w: WorkerInfo } | undefined {
    const floor = this.deps.floor(p.floor);
    const w = floor?.workers.get(p.id);
    return floor && w ? { floor, w } : undefined;
  }

  /** Who `to` (name@floor, a name on `me`'s floor or else the only one anywhere, or an id) is, or why not. */
  private find(me: Party, to: string): { floor: WoFloor; w: WorkerInfo } | string {
    const { who, floor } = parseAddress(to);
    if (!who) return 'Say who: name@floor (list_contacts says who is where)';
    const floors = this.reachable(me);
    const agents = (f: WoFloor) => f.workers.list().filter((x) => x.kind === 'agent');
    if (floor) {
      const f = floors.find((x) => x.id === floor || x.name.toLowerCase() === floor.toLowerCase());
      if (!f) return `No floor ${floor} you may reach (floors: ${floors.map((x) => x.id).join(', ')})`;
      const w = findWorker(agents(f), who);
      return typeof w === 'string' ? w : { floor: f, w };
    }
    for (const f of floors) {
      const w = f.workers.get(who);
      if (w && w.kind === 'agent') return { floor: f, w };
    }
    const mine = floors.find((f) => f.id === me.floor);
    const here = mine ? findWorker(agents(mine), who) : undefined;
    if (here && typeof here !== 'string') return { floor: mine!, w: here };
    const everywhere = floors.flatMap((f) => agents(f).filter((x) => x.name.toLowerCase() === who.toLowerCase()).map((w) => ({ floor: f, w })));
    if (everywhere.length === 1) return everywhere[0];
    if (everywhere.length > 1) return `More than one worker is called ${who}: say which with name@floor (${everywhere.map((x) => `${x.w.name}@${x.floor.id}`).join(', ')})`;
    return `Nobody called ${who}: list_contacts says who's in the office`;
  }

  /** The conversation between `me` and `other` (made now if new), its names brought up to date. */
  private thread(me: Party, self: { floor: WoFloor; w: WorkerInfo }, other: Party, found: { floor: WoFloor; w: WorkerInfo }): Thread {
    const id = threadId(me, other);
    let t = this.threads.get(id);
    const member = (p: Party, x: { floor: WoFloor; w: WorkerInfo }, old?: Member): Member => ({ id: p.id, floor: p.floor, name: x.w.name, floorName: x.floor.name, read: old?.read ?? 0, told: old?.told ?? 0 });
    if (!t) {
      t = { id, members: [member(me, self), member(other, found)], messages: [], dropped: 0, at: this.now() };
      this.threads.set(id, t);
      if (this.threads.size > MAX_THREADS) {
        const quietest = [...this.threads.values()].sort((a, b) => a.at - b.at)[0];
        this.threads.delete(quietest.id);
      }
    } else t.members = t.members.map((m) => (is(m, me) ? member(me, self, m) : member(other, found, m))) as [Member, Member];
    return t;
  }

  /** Tells `p` in a line what's waiting for it, if anything new is and it's free to hear it (asleep, it wakes up for it). */
  private tell(p: Party) {
    const key = keyOf(p);
    if (this.telling.has(key)) return;
    const found = this.party(p);
    if (!found || found.w.kind !== 'agent') return;
    const waiting: { t: Thread; m: Member }[] = [];
    for (const t of this.threads.values()) {
      const m = t.members.find((x) => is(x, p));
      if (m && t.dropped + t.messages.length > m.told) waiting.push({ t, m });
    }
    if (!waiting.length) return;
    const { floor, w } = found;
    // In the middle of a turn, or waiting on a person: it hears once that's over.
    if (isBusy(w.status)) return;
    let n = 0;
    const from: string[] = [];
    for (const { t, m } of waiting) {
      n += t.dropped + t.messages.length - Math.max(m.read, m.told);
      const other = t.members.find((x) => !is(x, p))!;
      from.push(`${other.name} (${other.floorName})`);
    }
    const line = `📬 WhatsOffice: ${n > 0 ? n : 'new'} message${n === 1 ? '' : 's'} from ${from.join(', ')}. Read them with the read_messages tool (or \`whatsoffice read\`) and answer with send_message.`;
    this.telling.add(key);
    try {
      let err = floor.workers.prompt(w.id, line, '📬');
      if (err) err = floor.workers.resume(w.id, line);
      if (err) return;
      for (const { t, m } of waiting) m.told = t.dropped + t.messages.length;
      this.changed();
    } finally {
      this.telling.delete(key);
    }
  }

  /** What `p` shows over its head now: its unread messages, and who it last talked to. */
  private show(p: Party) {
    const found = this.party(p);
    if (!found) return;
    let unread = 0;
    let last: { name: string; floor: string; at: number } | undefined;
    for (const t of this.threads.values()) {
      const m = t.members.find((x) => is(x, p));
      if (!m) continue;
      unread += Math.max(0, t.dropped + t.messages.length - m.read);
      const other = t.members.find((x) => !is(x, p))!;
      if (!last || t.at > last.at) last = { name: other.name, floor: other.floorName, at: t.at };
    }
    const next = unread || (last && this.now() - last.at < RECENT_MS) ? { unread, ...(last ? { last } : {}) } : undefined;
    if (JSON.stringify(next) === JSON.stringify(found.w.inbox)) return;
    if (next) found.w.inbox = next;
    else delete found.w.inbox;
    found.floor.workers.relaunch(found.w.id, false);
  }

  private changed() {
    this.deps.save({ threads: [...this.threads.values()] });
  }
}
