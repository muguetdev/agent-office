// Web Push (server/push/): a message encrypted for a browser (RFC 8291) comes back out with that
// browser's private key, and nobody else's; the VAPID key is made once, kept 0600, and signs an
// ES256 JWT for the push service's origin; and a worker that starts waiting on someone sends one
// notification per change, to the subscriptions that may go to its floor and want that kind, in
// their language, not again within the debounce, and a subscription the push service says is gone
// is forgotten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decrypt, encrypt, MAX_PAYLOAD, RECORD_SIZE } from '../src/server/push/encrypt.ts';
import { Vapid } from '../src/server/push/vapid.ts';
import { Notifier, DEBOUNCE_MS, type PushPayload } from '../src/server/push/notifier.ts';
import { parseSubscription, type PushSub } from '../src/server/push/store.ts';
import type { WorkerInfo } from '../src/shared/protocol.ts';

function receiver() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { priv: ecdh.getPrivateKey(), p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

test('a message encrypted for a browser decrypts with its key, in one aes128gcm record', () => {
  const ua = receiver();
  const text = JSON.stringify({ title: '🙋 Ana precisa de você', body: 'ção ✓'.repeat(50) });
  const msg = encrypt(text, ua.p256dh, ua.auth);
  assert.equal(msg.readUInt32BE(16), RECORD_SIZE);
  assert.equal(msg[20], 65);
  assert.equal(msg[21], 4);
  assert.equal(decrypt(msg, ua.priv, ua.p256dh, ua.auth).toString('utf8'), text);
  // Fresh salt and key each time.
  assert.notDeepEqual(encrypt(text, ua.p256dh, ua.auth), msg);
  // Another browser, or the wrong auth secret, can't read it.
  const other = receiver();
  assert.throws(() => decrypt(msg, other.priv, ua.p256dh, ua.auth));
  assert.throws(() => decrypt(msg, ua.priv, ua.p256dh, other.auth));
  // The biggest payload still fits one record; one byte more doesn't go.
  assert.equal(decrypt(encrypt(Buffer.alloc(MAX_PAYLOAD, 0x61), ua.p256dh, ua.auth), ua.priv, ua.p256dh, ua.auth).length, MAX_PAYLOAD);
  assert.throws(() => encrypt(Buffer.alloc(MAX_PAYLOAD + 1), ua.p256dh, ua.auth));
});

test("RFC 8291's own example comes out byte for byte", () => {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
  const msg = encrypt('When I grow up, I want to be a watermelon', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', {
    ecdh,
    salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
  });
  assert.equal(msg.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('the VAPID key is made once, kept for the office only, and signs a JWT for the push origin', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'push-'));
  try {
    const file = path.join(dir, 'push-vapid.json');
    const v = new Vapid(file);
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(new Vapid(file).publicKey, v.publicKey);
    const raw = Buffer.from(v.publicKey, 'base64url');
    assert.equal(raw.length, 65);
    const header = v.authorization('https://fcm.googleapis.com/fcm/send/abc', 'https://office.example', 1_000_000);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    assert.ok(m);
    assert.equal(m[2], v.publicKey);
    const [h, c, s] = m[1].split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    assert.equal(claims.sub, 'https://office.example');
    assert.equal(claims.exp, 1000 + 12 * 3600);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only push services on https and real subscription keys are taken', () => {
  const ua = receiver();
  const ok = { endpoint: 'https://web.push.apple.com/QGx', keys: { p256dh: ua.p256dh, auth: ua.auth } };
  assert.deepEqual(parseSubscription(ok), ok);
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x', 'https://router.local/x', 'nope']) assert.equal(parseSubscription({ ...ok, endpoint }), undefined, endpoint);
  assert.equal(parseSubscription({ ...ok, keys: { p256dh: 'short', auth: ua.auth } }), undefined);
});

function setup() {
  let now = 1_000_000;
  const ua = receiver();
  const sent: { endpoint: string; headers: Record<string, string>; payload: PushPayload }[] = [];
  const dropped: string[] = [];
  const sub = (endpoint: string, more: Partial<PushSub> = {}): PushSub => ({ endpoint, keys: { p256dh: ua.p256dh, auth: ua.auth }, lang: 'pt-BR', createdAt: 0, kinds: { needsInput: true, done: true, chat: true }, ...more });
  const subs = [sub('https://push.example/a'), sub('https://push.example/b', { lang: 'en', accountId: 'member' }), sub('https://push.example/gone', { kinds: { needsInput: true, done: false, chat: true } })];
  const statuses: Record<string, number> = { 'https://push.example/gone': 410 };
  const n = new Notifier({
    subs: () => subs,
    may: (s, floor) => s.accountId !== 'member' || floor === 'f1',
    drop: (e) => {
      dropped.push(e);
      subs.splice(subs.findIndex((s) => s.endpoint === e), 1);
    },
    authorization: () => 'vapid t=x, k=y',
    waiting: (s) => (s.accountId ? 1 : 3),
    post: async (endpoint, headers, body) => {
      sent.push({ endpoint, headers, payload: JSON.parse(decrypt(body, ua.priv, ua.p256dh, ua.auth).toString()) });
      return statuses[endpoint] ?? 201;
    },
    now: () => now,
  });
  const w = (status: WorkerInfo['status'], more: Partial<WorkerInfo> = {}) => ({ id: 'w1', name: 'Ana', kind: 'agent', status, acked: false, task: { name: 'Corrigir login', summary: 'Pronto' }, activity: 'Posso apagar a pasta?', ...more }) as WorkerInfo;
  const flush = () => new Promise((r) => setImmediate(r));
  return { n, w, sent, dropped, flush, tick: (ms: number) => (now += ms) };
}

test('a worker that starts waiting sends one push per change, to who may see it, in their language', async () => {
  const { n, w, sent, dropped, flush, tick } = setup();
  // First seen already waiting (the office restarting): not news.
  n.workerChanged('f2', w('needs_input'));
  await flush();
  assert.equal(sent.length, 0);
  n.workerChanged('f2', w('working'));
  n.workerChanged('f2', w('needs_input'));
  n.workerChanged('f2', w('needs_input'));
  await flush();
  // Floor f2: not the member's; the other two get it.
  assert.deepEqual(sent.map((s) => s.endpoint).sort(), ['https://push.example/a', 'https://push.example/gone']);
  const p = sent.find((s) => s.endpoint.endsWith('/a'))!;
  assert.deepEqual(p.payload, { title: '🙋 Ana precisa de você', body: 'Corrigir login\nPosso apagar a pasta?', tag: 'worker-w1', url: '/lite?floor=f2&worker=w1', workerId: 'w1', floor: 'f2', requireInteraction: true, kind: 'needs_input', waiting: 3 });
  assert.equal(p.headers['content-encoding'], 'aes128gcm');
  assert.equal(p.headers.urgency, 'high');
  assert.equal(p.headers.ttl, '86400');
  assert.equal(p.headers.topic, 'worker-w1');
  // The push service said that one's gone.
  assert.deepEqual(dropped, ['https://push.example/gone']);

  // Back to work and waiting again at once: debounced.
  sent.length = 0;
  n.workerChanged('f2', w('working'));
  n.workerChanged('f2', w('needs_input'));
  await flush();
  assert.equal(sent.length, 0);
  // Done is a different status; later, it can come again.
  n.workerChanged('f1', w('done', { task: { name: 'Corrigir login', summary: 'Pronto' } }));
  await flush();
  assert.deepEqual(sent.map((s) => [s.endpoint, s.payload.title, s.payload.kind]).sort(), [
    ['https://push.example/a', '✅ Ana terminou', 'done'],
    ['https://push.example/b', '✅ Ana is done', 'done'],
  ]);
  assert.equal(sent[0].payload.requireInteraction, undefined);
  // Someone looked (acked): no longer waiting; done again after the debounce is news again.
  sent.length = 0;
  n.workerChanged('f1', w('done', { acked: true }));
  tick(DEBOUNCE_MS);
  n.workerChanged('f1', w('done'));
  await flush();
  assert.equal(sent.length, 2);
  // Gone, then back: first seen again, so not news.
  sent.length = 0;
  n.workerChanged('f1', 'w1');
  n.workerChanged('f1', w('needs_input'));
  await flush();
  assert.equal(sent.length, 0);
});
