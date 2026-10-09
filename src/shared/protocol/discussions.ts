// Two workers already on a floor talking something through in its chat (see server/discussions.ts).

export type DiscussionClientMsg =
  /** Start a bounded chat between two existing workers on the floor. The first owns implementation; the second reviews. */
  { t: 'discussion.start'; first: string; second: string; topic: string };
