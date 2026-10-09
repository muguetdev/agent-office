// Two workers already on a floor talking something through (see server/discussions.ts): what both
// sides agree on about who can take part and how long it runs.
import type { WorkerInfo } from './protocol.js';
import { DESK_BY_ID } from './layout.js';

/** Messages in one discussion, both workers' together. */
export const DISCUSSION_MESSAGES = 6;
/** The longest topic someone can give it. */
export const DISCUSSION_TOPIC_MAX = 1000;
/** The longest reply a worker can post. */
export const DISCUSSION_REPLY_MAX = 4000;

/**
 * Whether a worker can take part: an agent (a shell would run its prompt as a command), with its
 * worktree there, and not already busy with a meeting or a board's kiosk, which drive it themselves.
 */
export const canDiscuss = (w: WorkerInfo): boolean => w.kind === 'agent' && !w.lost && !w.meeting && !DESK_BY_ID.get(w.deskId)?.station;

/**
 * Text for a discussion, as typed into a worker's terminal: line breaks as \n, and no other control
 * characters, so a reply can't end the terminal's bracketed paste early and type keys of its own.
 */
// eslint-disable-next-line no-control-regex
export const discussionText = (s: string): string => s.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
