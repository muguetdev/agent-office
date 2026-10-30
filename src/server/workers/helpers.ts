// A worker's helpers: the subagents its Claude Code runs (the Agent tool), kept in WorkerInfo.helpers
// for the office to show at desks of their own while they work. Claude Code's hooks say it all: the
// Agent call (what it's for), SubagentStart (its id), the tool calls it makes (marked with its id),
// SubagentStop, and on Stop the background agents still running. A Claude Code started before the
// office asked for SubagentStart and SubagentStop (its hooks are read once, as it starts) still shows
// its helpers: one comes in with its first tool call, or with the Agent call's answer for one in the
// background, and goes with the answer of one that ran to the end, or on Stop. Nothing is saved: a
// new run of the worker starts with none.
import type { WorkerInfo } from '../../shared/protocol.js';
import type { WorkerHandle } from './types.js';
import { truncate } from './util.js';

/** The most helpers one worker shows at once. */
export const MAX_HELPERS = 12;
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Agent calls made and not started yet, oldest first: SubagentStart pairs each with its id. */
const pending = new WeakMap<WorkerInfo, { description: string; type: string }[]>();
/** Helpers gone already, so a late tool call of one doesn't bring it back. */
const gone = new WeakMap<WorkerInfo, Set<string>>();

const text = (v: unknown, max: number) => (typeof v === 'string' ? truncate(v.replace(/\s+/g, ' ').trim(), max) : '');

/** A helper comes in (once): what it was asked is the oldest Agent call not yet paired, unless `asked` says. */
function start(h: WorkerHandle, id: string, agentType: unknown, now: number, asked?: { description: string; type: string }): void {
  const { info } = h;
  if (info.helpers?.some((x) => x.id === id) || gone.get(info)?.has(id) || (info.helpers?.length ?? 0) >= MAX_HELPERS) return;
  const queue = pending.get(info);
  // Told what it was asked: that Agent call is paired now, whichever it was.
  if (asked && queue) queue.splice(Math.max(0, queue.findIndex((q) => q.description === asked.description)), 1);
  const call = asked ?? queue?.shift();
  const type = text(agentType, 40) || call?.type || 'agent';
  info.helpers = [...(info.helpers ?? []), { id, type, description: call?.description || type, since: now }];
  h.emit();
}

function remove(info: WorkerInfo, id: string): boolean {
  let ended = gone.get(info);
  if (!ended) gone.set(info, (ended = new Set()));
  ended.add(id);
  if (ended.size > 200) ended.delete(ended.values().next().value!);
  const before = info.helpers?.length ?? 0;
  info.helpers = info.helpers?.filter((x) => x.id !== id);
  if (!info.helpers?.length) delete info.helpers;
  return (info.helpers?.length ?? 0) !== before;
}

/**
 * A Claude Code hook, as it bears on helpers. True when it's the helper's own (a tool call one of
 * them made), which then isn't the worker's activity; false for everything else, which the worker
 * handles as ever.
 */
export function helperHook(h: WorkerHandle, event: string, payload: any, describe: (payload: any) => string, now = Date.now()): boolean {
  const { info } = h;
  const agentId = typeof payload?.agent_id === 'string' && ID.test(payload.agent_id) ? payload.agent_id : undefined;
  switch (event) {
    case 'SessionStart':
      // A new run of Claude Code: whoever helped the last one is gone with it.
      if (payload?.source === 'startup' || payload?.source === 'resume') {
        pending.delete(info);
        gone.delete(info);
        if (info.helpers) {
          delete info.helpers;
          h.emit();
        }
      }
      return false;
    case 'SubagentStart':
      if (agentId) start(h, agentId, payload?.agent_type, now);
      return true;
    case 'SubagentStop':
      if (agentId && remove(info, agentId)) h.emit();
      return true;
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (agentId) {
        // One of its helpers at work: what it's doing goes on its card, not the worker's. Without
        // SubagentStart (an older run), its first tool call is how it comes in.
        if (event === 'PreToolUse') start(h, agentId, payload?.agent_type, now);
        const helper = info.helpers?.find((x) => x.id === agentId);
        if (helper && event === 'PreToolUse') {
          helper.activity = describe(payload);
          h.emit();
        }
        return true;
      }
      if (AGENT_TOOLS.has(payload?.tool_name)) {
        const input = payload?.tool_input ?? {};
        const description = text(input.description, 80) || text(input.prompt, 80);
        if (event === 'PreToolUse') {
          const queue = pending.get(info) ?? [];
          queue.push({ description, type: text(input.subagent_type, 40) });
          pending.set(info, queue.slice(-MAX_HELPERS));
        } else {
          // Its answer names the helper: one in the background has just started (the sure pairing
          // with what it was asked), one that wasn't has run to its end.
          const res = payload?.tool_response;
          const id = typeof res?.agentId === 'string' && ID.test(res.agentId) ? res.agentId : undefined;
          if (id && res?.isAsync === true) {
            const helper = info.helpers?.find((x) => x.id === id);
            if (!helper) start(h, id, input.subagent_type, now, { description, type: text(input.subagent_type, 40) });
            else if (description && helper.description !== description) {
              helper.description = description;
              h.emit();
            }
          } else if (id && remove(info, id)) h.emit();
        }
      }
      return false;
    case 'Stop': {
      // Whatever isn't still running in the background by now is done, whether or not its stop was heard.
      const running = new Set((Array.isArray(payload?.background_tasks) ? payload.background_tasks : []).filter((t: any) => t?.status === 'running').map((t: any) => String(t.id)));
      pending.delete(info);
      const stale = info.helpers?.filter((x) => !running.has(x.id)) ?? [];
      if (stale.length) {
        for (const x of stale) remove(info, x.id);
        h.emit();
      }
      return false;
    }
  }
  return false;
}
