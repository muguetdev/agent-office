// A worker's helpers: the subagents its Claude Code runs (the Agent tool), kept in WorkerInfo.helpers
// for the office to show at desks of their own while they work. Claude Code's hooks say it all: the
// Agent call (what it's for), SubagentStart (its id), the tool calls it makes (marked with its id),
// SubagentStop, and on Stop the background agents still running. Nothing is saved: a new run of the
// worker starts with none.
import type { WorkerHelper, WorkerInfo } from '../../shared/protocol.js';
import type { WorkerHandle } from './types.js';
import { truncate } from './util.js';

/** The most helpers one worker shows at once. */
export const MAX_HELPERS = 12;
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Agent calls made and not started yet, oldest first: SubagentStart pairs each with its id. */
const pending = new WeakMap<WorkerInfo, { description: string; type: string }[]>();

const text = (v: unknown, max: number) => (typeof v === 'string' ? truncate(v.replace(/\s+/g, ' ').trim(), max) : '');

function remove(info: WorkerInfo, id: string): boolean {
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
        if (info.helpers) {
          delete info.helpers;
          h.emit();
        }
      }
      return false;
    case 'SubagentStart': {
      if (!agentId) return true;
      const queue = pending.get(info) ?? [];
      const asked = queue.shift();
      const type = text(payload?.agent_type, 40) || asked?.type || 'agent';
      if (!info.helpers?.some((x) => x.id === agentId) && (info.helpers?.length ?? 0) < MAX_HELPERS) {
        const helper: WorkerHelper = { id: agentId, type, description: asked?.description || type, since: now };
        info.helpers = [...(info.helpers ?? []), helper];
        h.emit();
      }
      return true;
    }
    case 'SubagentStop':
      if (agentId && remove(info, agentId)) h.emit();
      return true;
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (agentId) {
        // One of its helpers at work: what it's doing goes on its card, not the worker's.
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
          // Its answer names the helper it started (one in the background): the sure pairing.
          const id = payload?.tool_response?.agentId;
          const helper = typeof id === 'string' ? info.helpers?.find((x) => x.id === id) : undefined;
          if (helper && description && helper.description !== description) {
            helper.description = description;
            h.emit();
          }
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
