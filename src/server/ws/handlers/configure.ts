// Changing a worker after it's hired: another provider, model or effort. It starts again on it,
// carrying on its conversation where its provider can (see WorkerManager.relaunch).
import { OPEN_CODE_MODEL_MAX, PROVIDER_META } from '../../../shared/providers.js';
import { isAgentEffort, isAgentProvider, type WorkerConfigureClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { workerOf } from './common.js';
import type { HandlerMap } from './types.js';
import { L } from '../../i18n.js';

export const configureHandlers = {
  'worker.configure'(ctx, c, msg) {
    const who = c.peer.name;
    const w = workerOf(ctx, c, msg.workerId);
    if (!w) return ctx.warn(c, L.srv.noSuchWorker);
    const { floor, wid } = w;
    const info = floor.workers.get(wid);
    if (!info || info.kind !== 'agent') return ctx.warn(c, L.configure.agentsOnly);
    if (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider)) return ctx.warn(c, L.srv.unknownProvider);
    const provider = msg.provider;
    const model = str(msg.model, OPEN_CODE_MODEL_MAX + 1).trim() || undefined;
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    if (provider === info.provider && model === info.model && effort === info.effort) return;
    // Another provider's CLI can't carry on this one's conversation, and some CLIs can't carry one on
    // on another model: it starts a new one.
    const fresh = provider !== info.provider || !PROVIDER_META[provider].switchesModel;
    info.provider = provider;
    if (model) info.model = model;
    else delete info.model;
    if (effort) info.effort = effort;
    else delete info.effort;
    if (fresh) delete info.sessionId;
    const err = floor.workers.relaunch(wid);
    if (err) return ctx.warn(c, err);
    ctx.toastFloor(floor, L.configure.changed(who, info.name, [provider, model, effort].filter(Boolean).join(' · '), fresh));
  },
} satisfies HandlerMap<WorkerConfigureClientMsg>;
