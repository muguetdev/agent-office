// The office phone: a worker calls a worker on any floor (its own too), and what each says reaches
// the other's session as a message from the office, once that one's free to read it (or woken up for
// it). A call stays open until one of them hangs up or it goes quiet for a while; nothing is saved.
// The workers call through the hook server (hooks/office-phone.ts), as the office-phone command and
// the MCP tools (bin/office-phone.js) do.
import { randomBytes } from 'node:crypto';
import type { WorkerCall, WorkerInfo } from '../../shared/protocol.js';
import { isBusy } from '../../shared/status.js';
import { findWorker } from '../office-workers.js';

/** A call goes quiet this long and it's over. */
export const IDLE_MS = 60 * 60_000;
/** A message rings this long on the phone it reached. */
export const RING_MS = 6000;
/** The most calls open at once, office-wide, and one message's most characters. */
export const MAX_CALLS = 200;
export const MAX_TEXT = 20_000;

/** A floor, as the phone sees it. */
export interface PhoneFloor {
  id: string;
  /** Its name, and its repository or server for the contacts. */
  name: string;
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

export interface PhoneDeps {
  floors(): Iterable<PhoneFloor>;
  floor(id: string): PhoneFloor | undefined;
  /** Whether a worker running as `owner` (an account, or none in a password-only office) may reach `floor`. */
  may(owner: string | undefined, floor: string): boolean;
  /** Says on a floor what happened (a call started or ended). */
  toast(floor: string, text: string): void;
  now?: () => number;
}

interface Party {
  floor: string;
  id: string;
}

interface Call {
  id: string;
  caller: Party;
  callee: Party;
  last: number;
}

/** Someone in the office a worker can call. */
export interface Contact {
  name: string;
  id: string;
  /** How to call it: name@floor. */
  address: string;
  floor: string;
  floorName: string;
  project?: string;
  status: string;
  task?: string;
  you?: true;
}

/** Splits `name@floor` (or an id) into the worker and the floor it names, if any. */
export function parseAddress(to: string): { who: string; floor?: string } {
  const t = to.trim();
  const at = t.lastIndexOf('@');
  return at > 0 ? { who: t.slice(0, at).trim(), floor: t.slice(at + 1).trim() } : { who: t };
}

export class Phone {
  private calls = new Map<string, Call>();
  /** What's waiting to reach each worker (`floor:id`), in order. */
  private queue = new Map<string, { call: string; text: string }[]>();
  /** Workers being given their messages right now: prompting one tells everyone it changed, which comes back here. */
  private delivering = new Set<string>();
  private now: () => number;

  constructor(private deps: PhoneDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Everyone `me` may call: every agent on every floor its owner may reach (itself marked). */
  contacts(me: Party): Contact[] {
    const owner = this.deps.floor(me.floor)?.workers.ownerOf(me.id);
    const out: Contact[] = [];
    for (const f of this.deps.floors()) {
      if (!this.deps.may(owner, f.id)) continue;
      for (const w of f.workers.list()) {
        if (w.kind !== 'agent') continue;
        out.push({
          name: w.name,
          id: w.id,
          address: `${w.name}@${f.id}`,
          floor: f.id,
          floorName: f.name,
          ...(f.project ? { project: f.project } : {}),
          status: w.status,
          ...(w.task?.name || w.activity ? { task: w.task?.name ?? w.activity } : {}),
          ...(f.id === me.floor && w.id === me.id ? { you: true as const } : {}),
        });
      }
    }
    return out;
  }

  /** Who `to` (name@floor, a name on `me`'s floor, or an id anywhere) is, or why not. */
  private find(me: Party, to: string): { floor: PhoneFloor; w: WorkerInfo } | string {
    const { who, floor } = parseAddress(to);
    const owner = this.deps.floor(me.floor)?.workers.ownerOf(me.id);
    const floors = [...this.deps.floors()].filter((f) => this.deps.may(owner, f.id));
    if (floor) {
      const f = floors.find((x) => x.id === floor || x.name.toLowerCase() === floor.toLowerCase());
      if (!f) return `No floor ${floor} you may call (floors: ${floors.map((x) => x.id).join(', ')})`;
      const w = findWorker(f.workers.list().filter((x) => x.kind === 'agent'), who);
      return typeof w === 'string' ? w : { floor: f, w };
    }
    // An id is the same worker anywhere; a bare name is looked for on your floor, then everywhere.
    for (const f of floors) {
      const w = f.workers.get(who);
      if (w && w.kind === 'agent') return { floor: f, w };
    }
    const mine = floors.find((f) => f.id === me.floor);
    const here = mine ? findWorker(mine.workers.list().filter((x) => x.kind === 'agent'), who) : undefined;
    if (here && typeof here !== 'string') return { floor: mine!, w: here };
    const everywhere = floors.flatMap((f) => f.workers.list().filter((x) => x.kind === 'agent' && x.name.toLowerCase() === who.toLowerCase()).map((w) => ({ floor: f, w })));
    if (everywhere.length === 1) return everywhere[0];
    if (everywhere.length > 1) return `More than one worker is called ${who}: say which with name@floor (${everywhere.map((x) => `${x.w.name}@${x.floor.id}`).join(', ')})`;
    return `Nobody called ${who}: list_contacts says who's in the office`;
  }

  /** `me` calls `to` with `text`: the new call, or why not. */
  call(me: Party, to: string, text: string): { id: string; to: Contact } | string {
    this.expire();
    const msg = text.trim();
    if (!msg) return 'Say what to tell them: message';
    if (msg.length > MAX_TEXT) return `Keep it under ${MAX_TEXT} characters`;
    const found = this.find(me, to);
    if (typeof found === 'string') return found;
    if (found.floor.id === me.floor && found.w.id === me.id) return "That's you";
    if (this.calls.size >= MAX_CALLS) return 'Too many calls are open in the office: hang up some first';
    const id = randomBytes(3).toString('hex');
    const call: Call = { id, caller: me, callee: { floor: found.floor.id, id: found.w.id }, last: this.now() };
    this.calls.set(id, call);
    const from = this.party(me);
    this.deps.toast(me.floor, `📞 ${from?.w.name ?? '?'} → ${found.w.name} (${found.floor.name})`);
    if (found.floor.id !== me.floor) this.deps.toast(found.floor.id, `📞 ${from?.w.name ?? '?'} (${from?.floor.name ?? '?'}) → ${found.w.name}`);
    this.send(call, 'callee', callText(call, from, msg));
    return { id, to: this.contacts(me).find((c) => c.floor === found.floor.id && c.id === found.w.id)! };
  }

  /** `me` says `text` on its call `callId` (or its only open one). */
  reply(me: Party, callId: string | undefined, text: string): { id: string; to: string } | string {
    this.expire();
    const msg = text.trim();
    if (!msg) return 'Say what to tell them: message';
    if (msg.length > MAX_TEXT) return `Keep it under ${MAX_TEXT} characters`;
    const call = this.callOf(me, callId);
    if (typeof call === 'string') return call;
    call.last = this.now();
    const side = sameParty(call.caller, me) ? 'callee' : 'caller';
    const other = this.party(call[side]);
    if (!other) return 'They have left the office: the call is over';
    this.send(call, side, replyText(call, this.party(me), msg));
    return { id: call.id, to: other.w.name };
  }

  /** `me` hangs up `callId` (or its only open one). */
  hangUp(me: Party, callId: string | undefined): { id: string } | string {
    const call = this.callOf(me, callId);
    if (typeof call === 'string') return call;
    this.end(call);
    return { id: call.id };
  }

  /** A worker changed (or went: `w` is its id): what's waiting for it may go in now; a call with one that's gone is over. */
  workerChanged(floor: string, w: WorkerInfo | string) {
    if (typeof w === 'string') {
      for (const c of [...this.calls.values()]) if (sameParty(c.caller, { floor, id: w }) || sameParty(c.callee, { floor, id: w })) this.end(c);
      this.queue.delete(`${floor}:${w}`);
      return;
    }
    this.deliver({ floor, id: w.id });
  }

  /** Every so often: calls gone quiet end, and anything waiting tries again. */
  tick() {
    this.expire();
    for (const key of [...this.queue.keys()]) {
      const [floor, id] = key.split(':');
      this.deliver({ floor, id });
    }
  }

  // ---------------------------------------------------------------------------------------------------

  private party(p: Party): { floor: PhoneFloor; w: WorkerInfo } | undefined {
    const floor = this.deps.floor(p.floor);
    const w = floor?.workers.get(p.id);
    return floor && w ? { floor, w } : undefined;
  }

  private callOf(me: Party, callId: string | undefined): Call | string {
    const mine = [...this.calls.values()].filter((c) => sameParty(c.caller, me) || sameParty(c.callee, me));
    if (callId) {
      const c = this.calls.get(callId.trim());
      return c && mine.includes(c) ? c : `You're not on a call ${callId}${mine.length ? ` (yours: ${mine.map((x) => x.id).join(', ')})` : ''}`;
    }
    if (mine.length === 1) return mine[0];
    return mine.length ? `You're on ${mine.length} calls: say which (${mine.map((x) => x.id).join(', ')})` : "You're not on a call";
  }

  private send(call: Call, side: 'caller' | 'callee', text: string) {
    const p = call[side];
    const key = `${p.floor}:${p.id}`;
    this.queue.set(key, [...(this.queue.get(key) ?? []), { call: call.id, text }]);
    this.show(call.caller);
    this.show(call.callee);
    this.deliver(p);
  }

  /** Whatever's waiting for `p` goes into its session, all at once, if it's free to read it (or asleep: it wakes up for it). */
  private deliver(p: Party) {
    const key = `${p.floor}:${p.id}`;
    const waiting = this.queue.get(key);
    if (!waiting?.length || this.delivering.has(key)) return;
    const found = this.party(p);
    if (!found) return void this.queue.delete(key);
    const { floor, w } = found;
    // In the middle of a turn, or waiting on a person: it hears once that's over.
    if (isBusy(w.status) || w.status === 'starting') return;
    const text = waiting.map((m) => m.text).join('\n\n---\n\n');
    // Off the queue before it goes in, and not again meanwhile: typing it in tells everyone the
    // worker changed, which comes straight back to deliver.
    this.queue.delete(key);
    this.delivering.add(key);
    try {
      let err = floor.workers.prompt(w.id, text, '📞');
      if (err) err = floor.workers.resume(w.id, text);
      if (err) {
        this.queue.set(key, [...waiting, ...(this.queue.get(key) ?? [])]);
        return;
      }
      w.phone = { calls: w.phone?.calls ?? [], ringingUntil: this.now() + RING_MS };
      floor.workers.relaunch(w.id, false);
    } finally {
      this.delivering.delete(key);
    }
  }

  /** What `p`'s phone shows: its open calls. */
  private show(p: Party) {
    const found = this.party(p);
    if (!found) return;
    const calls: WorkerCall[] = [];
    for (const c of this.calls.values()) {
      const out = sameParty(c.caller, p);
      if (!out && !sameParty(c.callee, p)) continue;
      const other = this.party(out ? c.callee : c.caller);
      if (other) calls.push({ id: c.id, with: other.w.name, floor: other.floor.name, dir: out ? 'out' : 'in' });
    }
    const ring = found.w.phone?.ringingUntil;
    if (calls.length || (ring && ring > this.now())) found.w.phone = { calls, ...(ring && ring > this.now() ? { ringingUntil: ring } : {}) };
    else delete found.w.phone;
    found.floor.workers.relaunch(found.w.id, false);
  }

  private end(call: Call) {
    this.calls.delete(call.id);
    for (const p of [call.caller, call.callee]) {
      const key = `${p.floor}:${p.id}`;
      const left = this.queue.get(key)?.filter((m) => m.call !== call.id);
      if (left?.length) this.queue.set(key, left);
      else this.queue.delete(key);
      this.show(p);
    }
  }

  private expire() {
    const t = this.now();
    for (const c of [...this.calls.values()]) if (t - c.last > IDLE_MS) this.end(c);
  }
}

const sameParty = (a: Party, b: Party) => a.floor === b.floor && a.id === b.id;

/** What the worker called reads: who's calling, from where, and how to answer (a prompt: in English). */
function callText(call: Call, from: { floor: PhoneFloor; w: WorkerInfo } | undefined, msg: string): string {
  const who = from ? `${from.w.name}, the worker on the "${from.floor.name}" floor${from.floor.project ? ` (${from.floor.project})` : ''}` : 'another worker';
  return (
    `📞 Phone call ${call.id} from ${who}:\n\n${msg}\n\n` +
    `(This is the office phone. Answer them with the reply_call tool, call_id "${call.id}" (or \`office-phone reply ${call.id}\` with your answer on stdin), ` +
    'after looking into your own project as much as you need to answer well: they rely on what you know about it. Keep talking that way as long as it helps, ' +
    "and hang_up when you're both done. Then carry on with whatever you were doing.)"
  );
}

/** What the other end reads when one says something on the call. */
function replyText(call: Call, from: { floor: PhoneFloor; w: WorkerInfo } | undefined, msg: string): string {
  const who = from ? `${from.w.name} ("${from.floor.name}" floor)` : 'The other worker';
  return `📞 ${who} on call ${call.id}:\n\n${msg}\n\n(Reply with reply_call, call_id "${call.id}", or hang_up when you're done.)`;
}
