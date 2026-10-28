// The live Code tab's line to the office (see server/codelive/): a Code tab that's open asks for its
// worker's folder to be watched ('code.watch'), hears what changes there and what the worker is
// editing, and stops when it's closed. Both the 3D office (features/codelive) and the 2D view (lite.ts)
// link their socket here; the editor is loaded later, on its own, and finds it. After a reconnect the
// office has forgotten who was watching, so every open tab asks again.
import type { CodeClientMsg, CodeServerMsg, ServerMsg } from '../../../shared/protocol';

/** What a socket needs to give the Code tab (the office's Net has it). */
export interface CodeLiveNet {
  send(msg: CodeClientMsg): void;
  onMessage(fn: (msg: ServerMsg) => void): void;
}

type Listener = (msg: CodeServerMsg) => void;

let net: CodeLiveNet | null = null;
/** Open Code tabs, by worker: each one's listener. */
const watching = new Map<string, Set<Listener>>();

const isCode = (msg: ServerMsg): msg is CodeServerMsg => msg.t === 'code.changed' || msg.t === 'code.editing' || msg.t === 'code.reviewed';

/** Links the page's socket (once). */
export function linkCodeLive(n: CodeLiveNet) {
  if (net) return;
  net = n;
  n.onMessage((msg) => {
    if (msg.t === 'welcome') {
      for (const workerId of watching.keys()) n.send({ t: 'code.watch', workerId });
      return;
    }
    if (!isCode(msg)) return;
    for (const fn of watching.get(msg.workerId) ?? []) fn(msg);
  });
}

/** Whether there's a socket to hear changes on (a Code tab without one checks every few seconds instead). */
export const codeLiveLinked = () => !!net;

/** Hears `workerId`'s folder's changes until the returned function is called. */
export function watchCode(workerId: string, fn: Listener): () => void {
  let set = watching.get(workerId);
  if (!set) {
    set = new Set();
    watching.set(workerId, set);
    net?.send({ t: 'code.watch', workerId });
  }
  set.add(fn);
  return () => {
    const s = watching.get(workerId);
    if (!s?.delete(fn) || s.size) return;
    watching.delete(workerId);
    net?.send({ t: 'code.unwatch', workerId });
  };
}

/** Ctrl+K: asks the worker about some lines. */
export function askCode(msg: Omit<Extract<CodeClientMsg, { t: 'code.ask' }>, 't'>) {
  net?.send({ t: 'code.ask', ...msg });
}
