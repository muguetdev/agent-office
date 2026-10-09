import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DiscussionRoom, Discussions } from '../src/server/discussions.js';
import { discussionText } from '../src/shared/discussions.js';
import type { ChatLine, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'office-discussion-'));

test('discussion alternates, caps replies, and restores an undelivered handoff after restart', () => {
  const dir = tmp();
  try {
    let store = new Discussions(dir);
    const start = store.start('pixel', 'byte', 'Review the sync design', 4);
    assert.equal(store.pending()?.to, 'pixel');
    assert.equal(store.post(start.id, 'pixel', 'Too early'), 'Your turn has not been delivered yet');
    store.delivered();
    const first = store.post(start.id, 'pixel', 'Use a transaction; check concurrent writes');
    assert.equal(typeof first, 'object');
    assert.equal(store.pending()?.to, 'byte');
    store = new Discussions(dir);
    assert.equal(store.pending()?.to, 'byte');
    assert.equal(store.post(start.id, 'pixel', 'Wrong turn'), 'Wait for your turn');
    assert.equal(store.post(start.id, 'mallory', 'Let me in'), 'You are not part of this discussion');
    store.delivered();
    store.post(start.id, 'byte', 'Add a unique constraint');
    store.delivered();
    store.post(start.id, 'pixel', 'I added it and tested contention');
    store.delivered();
    const last = store.post(start.id, 'byte', 'Approved; monitor lock waits');
    assert.equal(typeof last, 'object');
    if (typeof last === 'string') return;
    assert.equal(last.finished, true);
    assert.equal(last.messages.length, 4);
    assert.equal(store.pending(), undefined);
    assert.equal(store.post(start.id, 'pixel', 'One more'), 'This discussion is complete');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a new discussion supersedes the previous one', () => {
  const dir = tmp();
  try {
    const store = new Discussions(dir);
    const first = store.start('pixel', 'byte', 'First', 6);
    const next = store.start('pixel', 'byte', 'Second', 6);
    assert.notEqual(first.id, next.id);
    assert.equal(store.post(first.id, 'pixel', 'stale'), 'No such discussion');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a damaged discussions.json is ignored', () => {
  const dir = tmp();
  try {
    writeFileSync(path.join(dir, 'discussions.json'), JSON.stringify({ id: 'x', messages: 'nope' }));
    assert.equal(new Discussions(dir).active(), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A floor's discussion room over a few fake workers, with what it typed in and said. */
function room(dir: string) {
  const worker = (id: string, name: string, extra: Partial<WorkerInfo> = {}) => ({ id, name, color: '#123456', kind: 'agent', status: 'done', deskId: 'desk-1', ...extra }) as WorkerInfo;
  const workers = new Map<string, WorkerInfo>([
    ['w1', worker('w1', 'Pixel')],
    ['w2', worker('w2', 'Byte', { status: 'working' })],
    ['sh', worker('sh', 'Shell', { kind: 'shell' })],
    ['m1', worker('m1', 'Chair', { meeting: 'm' })],
  ]);
  const prompts: { id: string; text: string }[] = [];
  const said: Omit<ChatLine, 'at' | 'place'>[] = [];
  const toasts: string[] = [];
  const r = new DiscussionRoom(dir, {
    get: (id) => workers.get(id),
    prompt: (id, text) => {
      prompts.push({ id, text });
      return undefined;
    },
    resume: () => undefined,
    say: (line) => said.push(line),
    toast: (text) => toasts.push(text),
  });
  const setStatus = (id: string, status: WorkerStatus) => {
    const w = workers.get(id)!;
    w.status = status;
    r.onWorker(w);
  };
  return { r, workers, prompts, said, toasts, setStatus };
}

const by = { from: 'c1', name: 'Ana', color: '#abcdef' };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('only two different agents free of meetings can be picked', () => {
  const dir = tmp();
  try {
    const { r, prompts } = room(dir);
    assert.ok(r.start('w1', 'sh', 'topic', by), 'a shell is refused');
    assert.ok(r.start('w1', 'm1', 'topic', by), 'a worker in a meeting is refused');
    assert.ok(r.start('w1', 'w1', 'topic', by), 'the same worker twice is refused');
    assert.ok(r.start('w1', 'nobody', 'topic', by), 'a worker not on the floor is refused');
    assert.ok(r.start('w1', 'w2', '', by), 'a topic is needed');
    assert.equal(prompts.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each turn waits for its worker to finish, and every message is a chat line', async () => {
  const dir = tmp();
  try {
    const { r, workers, prompts, said, setStatus } = room(dir);
    assert.equal(r.start('w1', 'w2', 'Pick a cache', by), undefined);
    const id = r.turns.active()!.id;
    // Pixel was done: its brief went straight in; the line is from whoever started it.
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].id, 'w1');
    assert.match(prompts[0].text, new RegExp(`office-workers discuss ${id}`));
    assert.equal(said[0].from, 'c1');
    assert.match(said[0].text, /Pick a cache/);

    const w1 = workers.get('w1')!;
    assert.deepEqual(r.reply(id, w1, 'LRU, 100 entries'), { finished: false, remaining: 5 });
    assert.equal(said[1].from, 'worker:w1');
    assert.equal(said[1].text, '→ Byte · LRU, 100 entries');
    // Byte is still working: its turn waits.
    assert.equal(prompts.length, 1);
    setStatus('w2', 'needs_input');
    await tick();
    assert.equal(prompts.length, 1);
    setStatus('w2', 'done');
    await tick();
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].id, 'w2');
    assert.match(prompts[1].text, /independent reviewer/);
    // Pixel can't jump in again before Byte answers.
    assert.equal(r.reply(id, w1, 'Also…'), 'Wait for your turn');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a discussion's text keeps its lines and loses the keys it could type", () => {
  assert.equal(discussionText('  one\r\ntwo\rthree\tfour\x1b[201~\x03rm -rf .\x7f  '), 'one\ntwo\nthree\tfour[201~rm -rf .');
});

test('a participant leaving the floor ends the discussion', () => {
  const dir = tmp();
  try {
    const { r, toasts } = room(dir);
    r.start('w1', 'w2', 'topic', by);
    r.onWorkerGone('w2');
    assert.equal(r.turns.active()?.finished, true);
    assert.ok(toasts.some((t) => /left the floor/.test(t)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
