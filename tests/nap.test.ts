// Naps (server/workers/nap.ts): a quiet agent nobody is watching goes to sleep after the set time,
// and anything it does, anyone watching it or a turn under way starts that time over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { mayNap, napAfterMs, startNaps } from '../src/server/workers/nap.js';

const HOUR = 3_600_000;

function agent(over: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id: 'w1', kind: 'agent', deskId: 'd', name: 'Ada', color: '#fff', status: 'done', acked: true, createdBy: 'me', createdAt: 0, sessionId: 's', cols: 80, rows: 24, viewers: [], viewerIds: [], ...over } as WorkerInfo;
}

test('the nap time: 2 hours unless AGENT_OFFICE_NAP_HOURS says otherwise, 0 never', () => {
  assert.equal(napAfterMs(undefined), 2 * HOUR);
  assert.equal(napAfterMs('0.5'), HOUR / 2);
  assert.equal(napAfterMs('0'), 0);
  assert.equal(napAfterMs('nope'), 0);
});

test('only an agent with a session, done or ready, unwatched, may nap', () => {
  assert.ok(mayNap(agent()));
  assert.ok(mayNap(agent({ status: 'idle' })));
  assert.ok(!mayNap(agent({ status: 'working' })));
  assert.ok(!mayNap(agent({ status: 'needs_input' })));
  assert.ok(!mayNap(agent({ kind: 'shell' })));
  assert.ok(!mayNap(agent({ sessionId: undefined })));
  assert.ok(!mayNap(agent({ viewers: ['Bob'] })));
});

test('it naps once it has been quiet for the whole time, and any change starts that over', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0;
  let w = agent();
  const napped: string[] = [];
  const stop = startNaps({ list: () => [w], nap: (id) => (napped.push(id), true) }, 2 * HOUR, () => now);
  now = HOUR;
  w = agent({ activity: 'something new' });
  t.mock.timers.tick(10 * 60_000);
  now = 2.5 * HOUR;
  t.mock.timers.tick(10 * 60_000);
  assert.deepEqual(napped, [], 'quiet only since 1h');
  now = 3 * HOUR;
  t.mock.timers.tick(10 * 60_000);
  assert.deepEqual(napped, ['w1']);
  stop();
});
