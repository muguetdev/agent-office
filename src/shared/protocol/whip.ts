// The toy whip: crack it at a worker on your floor and it flinches for everyone there. Purely for
// fun: nothing is sent to the worker, its terminal or its code.

/** How often one person can crack it at a worker (ms): the server drops cracks closer together than this. */
export const WHIP_EVERY_MS = 1500;

export type WhipClientMsg =
  /** Crack the whip at a worker on your floor. */
  { t: 'worker.whip'; workerId: string };

export type WhipServerMsg =
  /** Someone cracked the whip at a worker on your floor: `by` is their connection (PeerInfo.id), `name` what they're called. */
  { t: 'worker.whipped'; workerId: string; by: string; name: string };
