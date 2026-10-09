import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { ChatLine, WorkerInfo } from '../shared/protocol.js';
import { canDiscuss, DISCUSSION_MESSAGES } from '../shared/discussions.js';
import { L } from './i18n.js';

export interface Discussion {
  id: string;
  topic: string;
  /** The implementation owner's worker id. */
  first: string;
  /** The independent reviewer's. */
  second: string;
  /** Whose turn it is. */
  next: string;
  limit: number;
  messages: { from: string; text: string; at: number }[];
  /** The prompt waiting for `to` to finish its turn before it's typed in. */
  pending?: { to: string; prompt: string };
  finished?: boolean;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** A discussion read back from disk, or undefined when it's not one. */
function readDiscussion(v: unknown): Discussion | undefined {
  const d = v as Partial<Discussion> | null;
  if (!d || !isStr(d.id) || !isStr(d.topic) || !isStr(d.first) || !isStr(d.second) || !isStr(d.next)) return undefined;
  if (typeof d.limit !== 'number' || !Array.isArray(d.messages)) return undefined;
  if (d.pending && (!isStr(d.pending.to) || !isStr(d.pending.prompt))) return undefined;
  return d as Discussion;
}

/**
 * One bounded conversation between two existing workers on a floor, kept in the floor's
 * .agent-office/discussions.json so its outstanding turn survives restarts. A new one replaces the
 * last. This is only the turns; DiscussionRoom delivers them.
 */
export class Discussions {
  private file: string;
  private current?: Discussion;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'discussions.json');
    try {
      this.current = readDiscussion(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      /* first run or damaged state */
    }
  }

  active(): Discussion | undefined {
    return this.current;
  }

  start(first: string, second: string, topic: string, limit: number): Discussion {
    const id = randomBytes(5).toString('hex');
    this.current = {
      id,
      first,
      second,
      topic,
      next: first,
      limit,
      messages: [],
      pending: {
        to: first,
        prompt: `Discussion ${id} with the other worker. Topic: ${topic}\n\nYou own implementation. The other worker independently reviews and does not edit this checkout. Prioritize robustness, efficiency, optimality, and long-term maintainability. Look for root causes, important edge cases, and practical tradeoffs. If this topic asks for implementation, do the work and include changed files and verification in your first reply; otherwise share a concrete plan and a question for review. Send your response with office-workers discuss ${id}, putting the message on stdin with a quoted here-document (or the discuss_with_worker tool). The exchange is visible in the floor's chat. Do not use tell_worker for this discussion. At most ${limit} total messages; stop when the office says it is complete.`,
      },
    };
    this.save();
    return this.current;
  }

  /** `from` says `text` in discussion `id`: the discussion as it is now, or why it can't. */
  post(id: string, from: string, text: string): Discussion | string {
    const d = this.current;
    if (!d || d.id !== id) return 'No such discussion';
    if (from !== d.first && from !== d.second) return 'You are not part of this discussion';
    if (d.finished) return 'This discussion is complete';
    if (d.next !== from) return 'Wait for your turn';
    if (d.pending) return 'Your turn has not been delivered yet';
    d.messages.push({ from, text, at: Date.now() });
    if (d.messages.length >= d.limit) d.finished = true;
    else {
      const to = from === d.first ? d.second : d.first;
      d.next = to;
      const last = d.messages.length === d.limit - 1;
      d.pending = {
        to,
        prompt: `Discussion ${id}, message ${d.messages.length + 1}/${d.limit}. Topic: ${d.topic}\n\n${from === d.first ? 'The implementation owner' : 'The independent reviewer'} said:\n${text}\n\n${to === d.second ? 'You are the independent reviewer. Read relevant code if useful, but do not edit the shared checkout. Identify material correctness, security, performance, and maintainability issues and offer concrete improvements.' : 'You own implementation. Consider the review and explain your decision or next steps. Keep the reviewer independent.'} Prioritize robustness, efficiency, optimality, and long-term maintainability. ${last ? 'This is the final reply. Summarize the decision, remaining risks, and who does what next.' : 'Respond with a concise, actionable message.'} Send it with office-workers discuss ${id}, putting the message on stdin with a quoted here-document (or the discuss_with_worker tool). Do not use tell_worker for this discussion.`,
      };
    }
    this.save();
    return d;
  }

  pending(): Discussion['pending'] {
    return this.current?.pending;
  }

  delivered(): void {
    if (!this.current?.pending) return;
    delete this.current.pending;
    this.save();
  }

  cancel(): void {
    if (!this.current) return;
    this.current.finished = true;
    delete this.current.pending;
    this.save();
  }

  private save(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.current), { mode: 0o600 });
    } catch {
      /* the chat still works if the disk is briefly unavailable */
    }
  }
}

/** What a floor's discussions need of it. */
export interface DiscussionDeps {
  get(id: string): WorkerInfo | undefined;
  prompt(id: string, text: string, by: string): string | undefined;
  resume(id: string, text: string): string | undefined;
  /** A line in the floor's chat. */
  say(line: Omit<ChatLine, 'at' | 'place'>): void;
  toast(text: string, level?: 'info' | 'warn'): void;
}

/** Who started a discussion, for its first line in the chat. */
export interface Starter {
  from: string;
  name: string;
  color: string;
  account?: boolean;
}

/** Statuses a worker is between turns in: its next prompt can be typed in (or wake it up). */
const BETWEEN_TURNS = new Set(['done', 'idle', 'exited', 'offline']);

/**
 * A floor's discussion between two of its workers, delivered a turn at a time: each prompt waits
 * until its worker has finished what it's doing, and every message is a line in the floor's chat.
 */
export class DiscussionRoom {
  readonly turns: Discussions;
  private delivering = false;
  /** The last thing that kept the pending prompt from going in, so it's said once. */
  private stuck?: string;

  constructor(
    dataDir: string,
    private deps: DiscussionDeps,
  ) {
    this.turns = new Discussions(dataDir);
  }

  /** Starts one between `firstId` (who implements) and `secondId` (who reviews): what went wrong, if anything. */
  start(firstId: string, secondId: string, topic: string, by: Starter): string | undefined {
    const first = this.deps.get(firstId);
    const second = this.deps.get(secondId);
    if (!first || !second || first.id === second.id || !canDiscuss(first) || !canDiscuss(second)) return L.discussion.pickTwo;
    if (!topic) return L.discussion.needTopic;
    const d = this.turns.start(first.id, second.id, topic, DISCUSSION_MESSAGES);
    this.stuck = undefined;
    this.deps.say({ ...by, text: L.discussion.startedLine(d.id, first.name, second.name, topic) });
    this.deps.toast(`💬 ${L.discussion.started(by.name, first.name, second.name)}`);
    this.pump();
    return undefined;
  }

  /** Worker `me` replies in discussion `id`: how many messages remain, or why it can't. */
  reply(id: string, me: WorkerInfo, text: string): { finished: boolean; remaining: number } | string {
    const d = this.turns.post(id, me.id, text);
    if (typeof d === 'string') return d;
    const to = this.deps.get(me.id === d.first ? d.second : d.first);
    this.deps.say({ from: `worker:${me.id}`, name: me.name, color: me.color, text: `→ ${to?.name ?? '?'} · ${text}` });
    if (d.finished) this.deps.toast(`💬 ${L.discussion.complete(d.messages.length)}`);
    else this.pump();
    return { finished: !!d.finished, remaining: d.limit - d.messages.length };
  }

  /** A worker changed: its turn may be over. Not from inside the change itself. */
  onWorker(w: WorkerInfo) {
    const p = this.turns.pending();
    if (p && p.to === w.id) queueMicrotask(() => this.pump());
  }

  onWorkerGone(workerId: string) {
    const d = this.turns.active();
    if (!d || d.finished || (d.first !== workerId && d.second !== workerId)) return;
    this.turns.cancel();
    this.deps.toast(`💬 ${L.discussion.stoppedLeft}`, 'warn');
  }

  /** Types the waiting prompt into its worker once it's between turns. */
  pump() {
    const d = this.turns.active();
    const pending = d?.pending;
    if (!d || !pending || this.delivering) return;
    const first = this.deps.get(d.first);
    const second = this.deps.get(d.second);
    if (!first || !second) {
      this.turns.cancel();
      this.deps.toast(`💬 ${L.discussion.stoppedLeft}`, 'warn');
      return;
    }
    const w = pending.to === first.id ? first : second;
    if (!canDiscuss(w)) {
      this.turns.cancel();
      this.deps.toast(`💬 ${L.discussion.stoppedUnavailable(w.name)}`, 'warn');
      return;
    }
    if (!BETWEEN_TURNS.has(w.status)) return;
    this.delivering = true;
    try {
      let err = this.deps.prompt(w.id, pending.prompt, L.discussion.by);
      // Stopped or asleep: it wakes up with this as its next message.
      if (err === L.workers.notRunning) err = this.deps.resume(w.id, pending.prompt);
      if (!err) {
        this.stuck = undefined;
        this.turns.delivered();
      } else if (err !== this.stuck) {
        this.stuck = err;
        this.deps.toast(`💬 ${L.discussion.waiting(w.name, err)}`, 'warn');
      }
    } finally {
      this.delivering = false;
    }
  }
}
