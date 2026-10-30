// A worker's helpers (server/workers/helpers.ts), from Claude Code's hooks in the order a real run
// sends them: the Agent call, SubagentStart, the helper's own tool calls, the Agent call's answer,
// Stop with it still running in the background, and SubagentStop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { helperHook, MAX_HELPERS } from '../src/server/workers/helpers.ts';
import type { WorkerHandle } from '../src/server/workers/types.ts';
import type { WorkerInfo } from '../src/shared/protocol.ts';

function handle() {
  const info = { id: 'w1', name: 'Pixel' } as WorkerInfo;
  let emits = 0;
  const h = { info, emit: () => void emits++ } as unknown as WorkerHandle;
  return { h, info, emits: () => emits };
}
const describe = (p: any) => `${p.tool_name}: ${p.tool_input?.pattern ?? ''}`;
const agentCall = { tool_name: 'Agent', tool_input: { description: 'Count files here', prompt: 'Use Glob…', subagent_type: 'general-purpose' }, tool_use_id: 'toolu_1' };

test('a helper comes in with what it was asked, works on its own card, and goes when it stops', () => {
  const { h, info, emits } = handle();
  assert.equal(helperHook(h, 'PreToolUse', agentCall, describe, 1000), false, "the Agent call is the worker's own activity");
  assert.equal(info.helpers, undefined);
  assert.equal(helperHook(h, 'SubagentStart', { agent_id: 'ad9e14a631ff6c6df', agent_type: 'general-purpose' }, describe, 2000), true);
  assert.deepEqual(info.helpers, [{ id: 'ad9e14a631ff6c6df', type: 'general-purpose', description: 'Count files here', since: 2000 }]);
  assert.equal(helperHook(h, 'PostToolUse', { ...agentCall, tool_response: { isAsync: true, status: 'async_launched', agentId: 'ad9e14a631ff6c6df', description: 'Count files here' } }, describe), false);
  // Its own tool calls: on its card, and not the worker's.
  assert.equal(helperHook(h, 'PreToolUse', { agent_id: 'ad9e14a631ff6c6df', agent_type: 'general-purpose', tool_name: 'Glob', tool_input: { pattern: '*' } }, describe), true);
  assert.equal(info.helpers?.[0].activity, 'Glob: *');
  assert.equal(helperHook(h, 'PostToolUse', { agent_id: 'ad9e14a631ff6c6df', tool_name: 'Glob', tool_input: { pattern: '*' } }, describe), true);
  // The worker stops for now; its helper is still running in the background.
  helperHook(h, 'Stop', { background_tasks: [{ id: 'ad9e14a631ff6c6df', type: 'subagent', status: 'running' }] }, describe);
  assert.equal(info.helpers?.length, 1);
  assert.equal(helperHook(h, 'SubagentStop', { agent_id: 'ad9e14a631ff6c6df', last_assistant_message: '20' }, describe), true);
  assert.equal(info.helpers, undefined);
  assert.ok(emits() >= 3);
});

test('a Stop with nothing left running sends off any helper whose stop went unheard, and a new run starts with none', () => {
  const { h, info } = handle();
  helperHook(h, 'PreToolUse', agentCall, describe);
  helperHook(h, 'SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }, describe);
  helperHook(h, 'PreToolUse', { ...agentCall, tool_input: { description: 'Second' } }, describe);
  helperHook(h, 'SubagentStart', { agent_id: 'a2', agent_type: 'Plan' }, describe);
  assert.deepEqual(info.helpers?.map((x) => [x.id, x.type, x.description]), [['a1', 'Explore', 'Count files here'], ['a2', 'Plan', 'Second']]);
  helperHook(h, 'Stop', { background_tasks: [{ id: 'a2', status: 'running' }] }, describe);
  assert.deepEqual(info.helpers?.map((x) => x.id), ['a2']);
  helperHook(h, 'SessionStart', { source: 'resume' }, describe);
  assert.equal(info.helpers, undefined);
});

test('at most a dozen at once, and nothing odd for an id', () => {
  const { h, info } = handle();
  for (let i = 0; i < MAX_HELPERS + 5; i++) helperHook(h, 'SubagentStart', { agent_id: `a${i}`, agent_type: 'general-purpose' }, describe);
  assert.equal(info.helpers?.length, MAX_HELPERS);
  helperHook(h, 'SubagentStart', { agent_id: 'x; rm -rf /', agent_type: 'x' }, describe);
  assert.ok(!info.helpers?.some((x) => x.id.includes(' ')));
});
