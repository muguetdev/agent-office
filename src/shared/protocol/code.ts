// The Code tab, live (see server/codelive/ and client ui/code-live/): while someone has a worker's
// Code tab open, the office watches the worker's folder and tells them what changed in it as it
// happens, and which file the worker's agent is editing; and Ctrl+K there asks the worker about the
// lines you picked.

/** What happened to a file in a worker's folder. */
export type CodeChangeKind = 'added' | 'changed' | 'removed';

export interface CodeChange {
  /** Relative to the worker's folder, with '/' between folders. */
  path: string;
  kind: CodeChangeKind;
}

/** The file a worker's agent is editing now, from its latest tool call (only agents whose hooks say which file). */
export interface CodeEditing {
  path: string;
  /** The tool it's using: Edit, Write, MultiEdit… */
  tool: string;
  at: number;
}

/** At most this many changes in one 'code.changed' (more, and it says `more` so the tree is read again). */
export const CODE_CHANGES_MAX = 200;

export type CodeClientMsg =
  /** Your Code tab for this worker is open: tell me what changes in its folder. */
  | { t: 'code.watch'; workerId: string }
  /** It's closed. */
  | { t: 'code.unwatch'; workerId: string }
  /**
   * Ctrl+K in the Code tab: ask the worker to do `instruction` to lines `from`–`to` (1-based) of
   * `path`, which read `text`. Goes to the worker as a prompt, like one typed at its desk.
   */
  | { t: 'code.ask'; workerId: string; path: string; from: number; to: number; text: string; instruction: string };

export type CodeServerMsg =
  /** Files in the worker's folder changed (to the people with its Code tab open). */
  | { t: 'code.changed'; workerId: string; changes: CodeChange[]; more?: true }
  /** The worker's agent is editing this file now (or, undefined, nothing it said). */
  | { t: 'code.editing'; workerId: string; editing?: CodeEditing }
  /** Someone accepted or rejected some of the worker's edits: the review's baseline moved, so look again. */
  | { t: 'code.reviewed'; workerId: string };
