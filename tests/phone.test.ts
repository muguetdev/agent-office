// The office phone (server/phone/calls.ts): a worker calls one on another floor, the message waits
// until that one's free, the answer goes back the same way, and a call ends when either hangs up or
// one of them leaves. Only floors the caller's owner may reach can be called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Phone, parseAddress, type PhoneFloor } from '../src/server/phone/calls.ts';
import type { WorkerInfo } from '../src/shared/protocol.ts';

function office(opts: { may?: (owner: string | undefined, floor: string) => boolean } = {}) {
  const got: Record<string, string[]> = {};
  const toasts: string[] = [];
  const mk = (id: string, name: string, project: string, people: [string, string][], owner?: string): PhoneFloor & { infos: Map<string, WorkerInfo> } => {
    const infos = new Map(people.map(([wid, wname]) => [wid, { id: wid, name: wname, kind: 'agent', status: 'idle' } as WorkerInfo]));
    return {
      id,
      name,
      project,
      infos,
      workers: {
        get: (wid) => infos.get(wid),
        list: () => [...infos.values()],
        ownerOf: () => owner,
        prompt: (wid, text) => {
          const w = infos.get(wid)!;
          if (w.status === 'exited') return 'not running';
          (got[wid] ??= []).push(text);
          w.status = 'working';
          return undefined;
        },
        resume: (wid, text) => {
          (got[wid] ??= []).push(`(woken) ${text}`);
          infos.get(wid)!.status = 'working';
          return undefined;
        },
        relaunch: () => undefined,
      },
    };
  };
  const meta = mk('meta-system', 'meta-system', 'muguetdev/meta-system', [['n1', 'Nova']], 'acc1');
  const crivo = mk('crivo', 'Crivo', 'muguetdev/crivo', [['p1', 'Pixel'], ['p2', 'Pixel']]);
  const floors = [meta, crivo];
  let now = 1_000_000;
  const phone = new Phone({
    floors: () => floors,
    floor: (id) => floors.find((f) => f.id === id),
    may: opts.may ?? (() => true),
    toast: (_f, t) => void toasts.push(t),
    now: () => now,
  });
  return { phone, meta, crivo, got, toasts, tick: (ms: number) => (now += ms) };
}

test('an address is name@floor, or a name or id alone', () => {
  assert.deepEqual(parseAddress('Pixel@crivo'), { who: 'Pixel', floor: 'crivo' });
  assert.deepEqual(parseAddress(' p1 '), { who: 'p1' });
});

test('a call reaches a free worker at once, its answer goes back, and either hangs up', () => {
  const { phone, crivo, meta, got, toasts } = office();
  const nova = { floor: 'meta-system', id: 'n1' };
  const call = phone.call(nova, 'p1', 'How does the payment gateway webhook work in crivo?');
  assert.ok(typeof call !== 'string', String(call));
  assert.equal(call.to.name, 'Pixel');
  assert.match(got.p1[0], /Phone call [0-9a-f]{6} from Nova, the worker on the "meta-system" floor \(muguetdev\/meta-system\)/);
  assert.match(got.p1[0], /payment gateway webhook/);
  assert.match(got.p1[0], /reply_call/);
  assert.deepEqual(crivo.infos.get('p1')!.phone!.calls, [{ id: call.id, with: 'Nova', floor: 'meta-system', dir: 'in' }]);
  assert.deepEqual(meta.infos.get('n1')!.phone!.calls, [{ id: call.id, with: 'Pixel', floor: 'Crivo', dir: 'out' }]);
  assert.equal(toasts.length, 2, 'both floors hear of it');

  // Nova is still at work: Pixel's answer waits for it to be free.
  meta.infos.get('n1')!.status = 'working';
  const r = phone.reply({ floor: 'crivo', id: 'p1' }, undefined, 'It posts to /webhooks/gw with an HMAC header.');
  assert.ok(typeof r !== 'string');
  assert.equal(got.n1, undefined);
  meta.infos.get('n1')!.status = 'done';
  phone.workerChanged('meta-system', meta.infos.get('n1')!);
  assert.match(got.n1[0], /Pixel \("Crivo" floor\) on call .*HMAC header/s);

  assert.ok(typeof phone.hangUp(nova, undefined) !== 'string');
  assert.equal(crivo.infos.get('p1')!.phone?.calls.length ?? 0, 0);
  assert.match(String(phone.reply(nova, undefined, 'one more thing')), /not on a call/);
});

test('names that clash need the floor; you cannot call yourself; nobody unknown', () => {
  const { phone } = office();
  const nova = { floor: 'meta-system', id: 'n1' };
  assert.match(String(phone.call(nova, 'Pixel', 'hi')), /More than one worker is called Pixel/);
  assert.ok(typeof phone.call(nova, 'p2', 'hi') !== 'string');
  assert.equal(phone.call(nova, 'n1', 'hi'), "That's you");
  assert.match(String(phone.call(nova, 'Ghost@crivo', 'hi')), /No worker here is called Ghost/);
  assert.match(String(phone.call(nova, 'p1', '   ')), /Say what/);
});

test('an asleep worker wakes up for its call; one that leaves ends it', () => {
  const { phone, crivo, got, meta } = office();
  crivo.infos.get('p1')!.status = 'exited';
  const call = phone.call({ floor: 'meta-system', id: 'n1' }, 'p1', 'hi');
  assert.ok(typeof call !== 'string');
  assert.match(got.p1[0], /^\(woken\) .*Phone call/s);
  phone.workerChanged('crivo', 'p1');
  assert.equal(meta.infos.get('n1')!.phone?.calls.length ?? 0, 0);
});

test('only floors your owner may reach, and a quiet call ends by itself', () => {
  const { phone } = office({ may: (owner, floor) => !(owner === 'acc1' && floor === 'crivo') });
  const nova = { floor: 'meta-system', id: 'n1' };
  assert.match(String(phone.call(nova, 'p1', 'hi')), /Nobody called p1/);
  assert.deepEqual(phone.contacts(nova).map((c) => c.address), ['Nova@meta-system']);
  const open = office();
  const call = open.phone.call(nova, 'p1', 'hi');
  assert.ok(typeof call !== 'string');
  open.tick(61 * 60_000);
  open.phone.tick();
  assert.equal(open.meta.infos.get('n1')!.phone?.calls.length ?? 0, 0);
});
