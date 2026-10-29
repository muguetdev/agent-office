// Naps: an agent that has sat ready or done for a while, with nobody at its terminal, has its process
// stopped so it stops holding the office's memory (a Claude Code process keeps 200-400 MB). It shows
// asleep like any stopped worker and carries on its session when it's next needed: its terminal
// opened, a prompt, a message from another worker. A restart doesn't wake it (WorkerInfo.napping).
import type { WorkerInfo } from '../../shared/protocol.js';

/** How long an agent sits quiet before it naps: AGENT_OFFICE_NAP_HOURS (2 by default, 0 never). */
export function napAfterMs(env = process.env.AGENT_OFFICE_NAP_HOURS): number {
  const hours = env === undefined || env === '' ? 2 : Number(env);
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 0;
}

const CHECK_MS = 10 * 60_000;

/** The manager, as naps see it. */
export interface Nappers {
  list(): WorkerInfo[];
  /** Stops its process if it's still free to stop; whether it did. */
  nap(id: string): boolean;
}

/** What it was doing when last looked at: any change starts its quiet time over. */
function look(w: WorkerInfo): string {
  return `${w.status}|${w.activity ?? ''}|${w.lastInput?.at ?? ''}|${w.viewers.length}`;
}

/** Whether `w` may nap at all: an agent with a session to carry on, waiting on nobody, watched by nobody. */
export function mayNap(w: WorkerInfo): boolean {
  return w.kind === 'agent' && !!w.sessionId && (w.status === 'idle' || w.status === 'done') && !w.viewers.length && !w.lost && !w.prOpening;
}

/** Watches a floor's workers and puts the quiet ones to sleep. Returns what stops it. */
export function startNaps(workers: Nappers, after = napAfterMs(), now = () => Date.now()): () => void {
  if (!after) return () => {};
  const seen = new Map<string, { look: string; since: number }>();
  const check = () => {
    const t = now();
    const ids = new Set<string>();
    for (const w of workers.list()) {
      ids.add(w.id);
      const l = look(w);
      const last = seen.get(w.id);
      if (!last || last.look !== l) seen.set(w.id, { look: l, since: t });
      else if (mayNap(w) && t - last.since >= after && workers.nap(w.id)) seen.delete(w.id);
    }
    for (const id of seen.keys()) if (!ids.has(id)) seen.delete(id);
  };
  check();
  const timer = setInterval(check, Math.min(CHECK_MS, after));
  timer.unref?.();
  return () => clearInterval(timer);
}
