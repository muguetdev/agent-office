import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whipHandlers } from '../src/server/ws/handlers/whip.js';
import { handlers } from '../src/server/ws/handlers/index.js';
import { maySend } from '../src/server/office/access.js';
import { newClient } from '../src/server/office/client.js';
import type { ServerMsg } from '../src/shared/protocol.js';

/** Just enough of the office for the handler: two floors, a worker on each, and what goes out. */
function office() {
  const sent: { floor: string; msg: ServerMsg }[] = [];
  const worker = (id: string) => ({ get: (w: string) => (w === id ? { id, name: id } : undefined) });
  const f1 = { id: 'f1', workers: worker('rex') };
  const f2 = { id: 'f2', workers: worker('max') };
  const ctx = {
    accounts: { get: () => undefined },
    floorOf: () => f1,
    workerFloor: (id: string) => (id === 'rex' ? f1 : id === 'max' ? f2 : undefined),
    toFloor: (floor: { id: string }, msg: ServerMsg) => sent.push({ floor: floor.id, msg }),
    warn: () => {},
  };
  return { ctx: ctx as never, sent };
}

const client = (guest = false) => newClient('c1', {} as never, { accountId: undefined, admin: false, guest }, { id: 'c1', name: 'Ada' } as never);

test('a crack at a worker on your floor is only passed on to that floor, for the flinch', () => {
  const { ctx, sent } = office();
  const c = client();
  whipHandlers['worker.whip'](ctx, c, { t: 'worker.whip', workerId: 'rex' });
  assert.deepEqual(sent, [{ floor: 'f1', msg: { t: 'worker.whipped', workerId: 'rex', by: 'c1', name: 'Ada' } }]);
  assert.equal(handlers['worker.whip'], whipHandlers['worker.whip']);
});

test('a worker on another floor, or none, is ignored, and cracks too close together are dropped', () => {
  const { ctx, sent } = office();
  const c = client();
  whipHandlers['worker.whip'](ctx, c, { t: 'worker.whip', workerId: 'max' });
  whipHandlers['worker.whip'](ctx, c, { t: 'worker.whip', workerId: 'nobody' });
  assert.equal(sent.length, 0);
  whipHandlers['worker.whip'](ctx, c, { t: 'worker.whip', workerId: 'rex' });
  whipHandlers['worker.whip'](ctx, c, { t: 'worker.whip', workerId: 'rex' });
  assert.equal(sent.length, 1);
});

test("a guest from the rooftop bar can't crack it", () => {
  assert.equal(maySend(client(true), 'worker.whip'), false);
  assert.equal(maySend(client(), 'worker.whip'), true);
});
