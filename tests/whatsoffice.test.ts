// WhatsOffice (server/whatsoffice/store.ts): a message waits in the pair's conversation, the other
// worker is told in one line once it's free (woken if asleep), reads it with read, and answers the
// same way; conversations survive a restart; people see a worker's conversations without marking
// anything read; and telling a worker never loops back into telling it again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsOffice, parseAddress, type WoData, type WoFloor } from '../src/server/whatsoffice/store.ts';
import type { WorkerInfo } from '../src/shared/protocol.ts';

function office(opts: { may?: (owner: string | undefined, floor: string) => boolean; saved?: WoData; echo?: boolean } = {}) {
  const typed: Record<string, string[]> = {};
  let saved: WoData | undefined;
  let wo: WhatsOffice;
  const mk = (id: string, name: string, project: string, people: [string, string][], owner?: string): WoFloor & { infos: Map<string, WorkerInfo> } => {
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
          (typed[wid] ??= []).push(text);
          // Like the manager: typing it in tells the office the worker changed, straight away.
          if (opts.echo) wo.workerChanged(id, w);
          return undefined;
        },
        resume: (wid, text) => {
          (typed[wid] ??= []).push(`(woken) ${text}`);
          infos.get(wid)!.status = 'starting';
          return undefined;
        },
        relaunch: (wid) => {
          if (opts.echo) wo.workerChanged(id, infos.get(wid)!);
          return undefined;
        },
      },
    };
  };
  const meta = mk('meta-system', 'meta-system', 'muguetdev/meta-system', [['n1', 'Nova']], 'acc1');
  const crivo = mk('crivo', 'Crivo', 'muguetdev/crivo', [['p1', 'Pixel'], ['p2', 'Pixel']]);
  const floors = [meta, crivo];
  let now = 1_000_000;
  wo = new WhatsOffice({ floors: () => floors, floor: (id) => floors.find((f) => f.id === id), may: opts.may ?? (() => true), save: (d) => void (saved = JSON.parse(JSON.stringify(d))), now: () => now }, opts.saved);
  return { wo, meta, crivo, typed, saved: () => saved, tick: (ms: number) => (now += ms) };
}

const nova = { floor: 'meta-system', id: 'n1' };
const pixel = { floor: 'crivo', id: 'p1' };

test('an address is name@floor, or a name or id alone', () => {
  assert.deepEqual(parseAddress('Pixel@crivo'), { who: 'Pixel', floor: 'crivo' });
  assert.deepEqual(parseAddress(' p1 '), { who: 'p1' });
});

test('a message waits; the other is told in a line, reads it, and its answer comes back the same way', () => {
  const { wo, crivo, meta, typed } = office();
  const r = wo.send(nova, 'p1', 'How does the payment webhook work?');
  assert.ok(typeof r !== 'string', String(r));
  assert.deepEqual(r.to, { name: 'Pixel', floor: 'Crivo' });
  // Told in one line, not given the message: it reads it when it's ready.
  assert.equal(typed.p1.length, 1);
  assert.match(typed.p1[0], /^📬 WhatsOffice: 1 message from Nova \(meta-system\)\. Read them with the read_messages tool/);
  assert.doesNotMatch(typed.p1[0], /payment webhook/);
  assert.deepEqual(crivo.infos.get('p1')!.inbox, { unread: 1, last: { name: 'Nova', floor: 'meta-system', at: 1_000_000 } });
  // A second message before it reads doesn't tell it again until… it's told of what's new.
  wo.send(nova, 'p1', 'And the retries?');
  assert.equal(typed.p1.length, 2);
  const read = wo.read(pixel);
  assert.ok(typeof read !== 'string');
  assert.deepEqual(read.conversations.map((c) => [c.with, c.address, c.messages.map((m) => `${m.from}: ${m.text}`)]), [['Nova (meta-system)', 'Nova@meta-system', ['Nova: How does the payment webhook work?', 'Nova: And the retries?']]]);
  assert.equal(crivo.infos.get('p1')!.inbox!.unread, 0);
  assert.deepEqual(wo.read(pixel), { conversations: [] }, 'nothing new now');

  // Nova is at work: Pixel's answer waits for its turn to end.
  meta.infos.get('n1')!.status = 'working';
  wo.send(pixel, 'Nova@meta-system', 'POST /webhooks/gw with an HMAC header; 3 retries.');
  assert.equal(typed.n1, undefined);
  meta.infos.get('n1')!.status = 'done';
  wo.workerChanged('meta-system', meta.infos.get('n1')!);
  assert.match(typed.n1[0], /1 message from Pixel \(Crivo\)/);
  const back = wo.read(nova, 'p1');
  assert.ok(typeof back !== 'string');
  assert.deepEqual(back.conversations[0].messages.map((m) => m.from), ['you', 'you', 'Pixel']);
});

test('one conversation per pair, shown to people as the worker sees it, without marking anything read', () => {
  const { wo } = office();
  wo.send(nova, 'p1', 'hi');
  wo.send(pixel, 'n1', 'hello');
  const list = wo.conversationsOf(pixel);
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 2);
  assert.equal(list[0].members[list[0].me].name, 'Pixel');
  const t = wo.messagesOf(pixel, list[0].id)!;
  assert.deepEqual(t.messages.map((m) => [m.from === t.thread.me ? 'me' : 'them', m.text]), [['them', 'hi'], ['me', 'hello']]);
  assert.equal(wo.messagesOf({ floor: 'crivo', id: 'p2' }, list[0].id), undefined, "not another worker's");
  assert.equal(wo.conversationsOf(nova)[0].unread, 1, 'Nova has not read the answer, and looking changed nothing');
});

test('telling a worker tells the office it changed, which never tells it again', () => {
  const { wo, typed } = office({ echo: true });
  assert.ok(typeof wo.send(nova, 'p1', 'hi') !== 'string');
  assert.equal(typed.p1.length, 1);
});

test('an asleep worker wakes up to hear of it; conversations survive a restart', () => {
  const first = office();
  first.crivo.infos.get('p1')!.status = 'exited';
  first.wo.send(nova, 'p1', 'hi');
  assert.match(first.typed.p1[0], /^\(woken\) 📬/);
  const again = office({ saved: first.saved() });
  const r = again.wo.read(pixel);
  assert.ok(typeof r !== 'string');
  assert.equal(r.conversations[0].messages[0].text, 'hi');
});

test('only floors your owner may reach; names that clash need the floor; never yourself', () => {
  const { wo } = office({ may: (owner, floor) => !(owner === 'acc1' && floor === 'crivo') });
  assert.match(String(wo.send(nova, 'p1', 'hi')), /Nobody called p1/);
  assert.deepEqual(wo.contacts(nova).map((c) => c.address), ['Nova@meta-system']);
  const open = office();
  assert.match(String(open.wo.send(nova, 'Pixel', 'hi')), /More than one worker is called Pixel/);
  assert.equal(open.wo.send(nova, 'n1', 'hi'), "That's you");
  assert.match(String(open.wo.send(nova, 'p2', '  ')), /Say what/);
});
