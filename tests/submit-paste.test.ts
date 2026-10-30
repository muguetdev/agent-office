// Sending a prompt into an agent's terminal (workers/util.ts submitPaste): Enter waits for a long
// paste to land, and a second Enter only goes if the agent hasn't started, never into what it asks next.
import test from 'node:test';
import assert from 'node:assert/strict';
import { submitPaste } from '../src/server/workers/util.ts';
import type { WorkerStatus } from '../src/shared/protocol.ts';

function run(text: string, statusAfterFirst: WorkerStatus) {
  const timers: { ms: number; fn: () => void }[] = [];
  const typed: number[] = [];
  let status: WorkerStatus = 'done';
  let t = 0;
  submitPaste(() => void typed.push(t), () => status, text, ((fn: () => void, ms: number) => void timers.push({ fn, ms })) as never);
  for (const x of timers.sort((a, b) => a.ms - b.ms)) {
    t = x.ms;
    x.fn();
    if (typed.length === 1) status = statusAfterFirst;
  }
  return typed;
}

test('a short prompt is sent at once; a long one once its paste has landed', () => {
  assert.equal(run('hi', 'working')[0], 121);
  const long = run('x'.repeat(6000), 'working');
  assert.ok(long[0] >= 1000 && long[0] <= 2500, String(long[0]));
});

test('Enter again only while the agent still sits there, never into a question it asks', () => {
  assert.equal(run('x'.repeat(3000), 'working').length, 1);
  assert.equal(run('x'.repeat(3000), 'needs_input').length, 1);
  assert.equal(run('x'.repeat(3000), 'done').length, 2);
});
