// Small helpers the workers' modules share.
import type { WorkerStatus } from '../../shared/protocol.js';
import { isBusy } from '../../shared/status.js';

/** `s` on one line, cut to `n` characters with an ellipsis. */
export function truncate(s: string, n: number) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Compares two secrets in constant time (for their length). */
export function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Presses Enter once `text`, just pasted into an agent's prompt, has had time to land: a long paste
 * (which Claude Code folds into "[Pasted text …]") takes a while, and an Enter that comes before it's
 * done is lost, leaving the prompt there for someone to send. If the agent still isn't at work a
 * moment later, it presses Enter again; never once it is, when an Enter could answer whatever it
 * asks next (a permission prompt).
 */
export function submitPaste(write: (s: string) => void, status: () => WorkerStatus, text: string, schedule = setTimeout) {
  const first = clamp(120 + Math.ceil(text.length / 6), 120, 2500);
  schedule(() => write('\r'), first);
  schedule(() => {
    if (!isBusy(status())) write('\r');
  }, first + 1200);
}
