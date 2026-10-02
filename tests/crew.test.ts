import test from 'node:test';
import assert from 'node:assert/strict';
import { crewOf } from '../src/shared/crew';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol';

function worker(id: string, status: WorkerStatus, more: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id, kind: 'agent', deskId: `desk-${id}`, name: id, color: '#fff', status, acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 24, viewers: [], ...more };
}

test("a floor's crew is its agents in brief, what each is on clipped", () => {
  const crew = crewOf([
    worker('Byte', 'needs_input', { activity: 'Wants permission: Bash: npm test', waitingSince: 5 }),
    worker('Nova', 'done', { acked: true, task: { name: 't', summary: 'Fixed the login page' } as WorkerInfo['task'] }),
    worker('Shell', 'working', { kind: 'shell' }),
    worker('Echo', 'working', { activity: 'x'.repeat(300) }),
  ]);
  assert.deepEqual(
    crew.map((c) => c.id),
    ['Byte', 'Nova', 'Echo'],
    'the shell is left out',
  );
  assert.deepEqual(crew[0], { id: 'Byte', name: 'Byte', color: '#fff', kind: 'agent', status: 'needs_input', activity: 'Wants permission: Bash: npm test', waitingSince: 5 });
  assert.equal(crew[1].activity, 'Fixed the login page', 'with no activity, its task says what it was on');
  assert.equal(crew[1].acked, true);
  assert.ok(crew[2].activity!.length <= 140 && crew[2].activity!.endsWith('…'), 'a long activity is clipped');
  // Nothing private goes out: no prompt, no terminal, no token.
  assert.ok(crew.every((c) => !('prompt' in c) && !('token' in c)));
});
