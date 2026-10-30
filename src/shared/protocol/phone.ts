// The office phone (see server/phone/): a worker calls a worker on any floor, to ask how something
// in that one's project works or to work something out together, and each answer reaches the other's
// session. A worker on a call shows it (the client's features/phone).

/** One of a worker's calls still open: who's on the other end, and on which floor. */
export interface WorkerCall {
  id: string;
  /** The other worker's name, and its floor's. */
  with: string;
  floor: string;
  /** It made the call (out) or took it (in). */
  dir: 'in' | 'out';
}

/** A worker's phone: the calls it's on, and until when it's ringing (a message just reached it). */
export interface WorkerPhone {
  calls: WorkerCall[];
  ringingUntil?: number;
}

declare module './workers.js' {
  interface WorkerInfo {
    /** On the phone (see WorkerPhone). Not saved: calls end with the office. */
    phone?: WorkerPhone;
  }
}
