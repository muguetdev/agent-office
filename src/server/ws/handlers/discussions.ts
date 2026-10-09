// Two workers already on a floor talking something through in its chat (see discussions.ts).
import type { DiscussionClientMsg } from '../../../shared/protocol.js';
import { DISCUSSION_TOPIC_MAX, discussionText } from '../../../shared/discussions.js';
import { mayEnter } from '../../office/access.js';
import { str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';

export const discussionHandlers = {
  'discussion.start'(ctx, c, msg) {
    const floor = here(ctx, c);
    // Only someone who may be on this floor sets its workers talking (a guest can't send this at all).
    if (!floor || !mayEnter(ctx.accounts, c, floor.id)) return;
    const topic = discussionText(str(msg.topic, DISCUSSION_TOPIC_MAX));
    const by = { from: c.id, name: c.peer.name, color: c.peer.color, ...(c.accountId ? { account: true } : {}) };
    ctx.warn(c, floor.discussions.start(str(msg.first, 32), str(msg.second, 32), topic, by));
  },
} satisfies HandlerMap<DiscussionClientMsg>;
