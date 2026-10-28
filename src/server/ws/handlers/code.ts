// The live Code tab (see codelive/): opening and closing a worker's Code tab, which watches its
// folder for you while it's open, and Ctrl+K there, which asks the worker about the lines you picked.
// Only for people who may go to the worker's floor (never a guest: see workerOf and access.ts).
import type { CodeClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { workerOf } from './common.js';
import type { FeatureHooks, HandlerMap } from './types.js';
import { L } from '../../i18n.js';
import { uploadParts } from '../../code.js';
import { codeLive } from '../../codelive/index.js';
import { ASK_INSTRUCTION_MAX, ASK_TEXT_MAX, askPrompt } from '../../codelive/ask.js';

export const codeHandlers = {
  'code.watch'(ctx, c, msg) {
    const w = workerOf(ctx, c, msg.workerId);
    if (!w || c.guest) return;
    void codeLive(ctx)
      .watch(c, w.wid)
      .then((err) => {
        if (err === 'too many') ctx.warn(c, L.codeLive.tooMany);
      });
  },
  'code.unwatch'(ctx, c, msg) {
    codeLive(ctx).unwatch(c.id, str(msg.workerId, 32));
  },
  'code.ask'(ctx, c, msg) {
    const w = workerOf(ctx, c, msg.workerId);
    if (!w || c.guest) return ctx.warn(c, L.srv.noSuchWorker);
    const { info } = w;
    if (info.kind !== 'agent') return ctx.warn(c, L.codeLive.notAgent(info.name));
    // Only once it's free: typed into the middle of a turn, it would land who knows where.
    if (info.status !== 'idle' && info.status !== 'done') return ctx.warn(c, L.codeLive.busy(info.name));
    const file = str(msg.path, 4096);
    if (!uploadParts(file)) return ctx.warn(c, L.code.notFound);
    const prompt = askPrompt({
      path: file,
      from: Number(msg.from),
      to: Number(msg.to),
      text: str(msg.text, ASK_TEXT_MAX),
      instruction: str(msg.instruction, ASK_INSTRUCTION_MAX),
      by: c.peer.name,
    });
    if (!prompt) return;
    const err = w.floor.workers.prompt(w.wid, prompt, c.peer.name);
    if (err) return ctx.warn(c, err);
    ctx.sendTo(c, { t: 'toast', text: L.codeLive.asked(info.name), level: 'info' });
  },
} satisfies HandlerMap<CodeClientMsg>;

export const codeHooks: FeatureHooks = {
  closed: (ctx, c) => codeLive(ctx).unwatchAll(c.id),
};
