// WhatsOffice (see server/whatsoffice/): the workers' messages to each other, on any floor, kept as
// conversations (one per pair of workers) that each reads when it's ready, like a messaging app. A
// worker shows what's waiting for it; people read the conversations in the 💬 WhatsOffice window.

/** What a worker's inbox shows over its head: how many messages it hasn't read, and who it last talked to. */
export interface WorkerInbox {
  unread: number;
  /** Its latest conversation: the other worker, its floor, and when (ms). */
  last?: { name: string; floor: string; at: number };
}

declare module './workers.js' {
  interface WorkerInfo {
    /** Its WhatsOffice inbox (see WorkerInbox), while there's something in it. */
    inbox?: WorkerInbox;
  }
}

/** One side of a conversation, as people see it. */
export interface WoMember {
  name: string;
  floor: string;
  floorName: string;
}

/** A conversation in the 💬 WhatsOffice window's list. */
export interface WoThread {
  id: string;
  members: [WoMember, WoMember];
  count: number;
  last?: { from: 0 | 1; text: string; at: number };
}

/** One message: which member sent it, what and when. */
export interface WoMessage {
  from: 0 | 1;
  text: string;
  at: number;
}
