// Who may go where (server/office/access.ts), against the real office: a building of two floors, an
// admin who goes everywhere, a member let onto one floor, a member let onto none, and a guest who
// came in by the rooftop bar's open link. Nobody sees into a floor that isn't theirs.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { Accounts } from '../src/server/accounts.js';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import { ROOF } from '../src/shared/rooftop.js';
import type { ServerMsg } from '../src/shared/protocol.js';

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

let tmp = '';
let office: Awaited<ReturnType<typeof startServer>>;
let base = '';
const cookies: Record<'admin' | 'member' | 'nobody' | 'guest', string> = { admin: '', member: '', nobody: '', guest: '' };
const PW = 'access-test-pw';
/** The floor the office was started in (the member's), and the other one. */
let mine = '';
const OTHER = 'beta';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

class Browser {
  inbox: ServerMsg[] = [];
  private wake: (() => void) | undefined;
  closed = false;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      this.inbox.push(JSON.parse(raw.toString()));
      this.wake?.();
    });
    ws.on('close', () => (this.closed = true));
  }
  static open(who: keyof typeof cookies, query = ''): Promise<Browser> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws${query}`, { headers: { cookie: cookies[who], origin: base } });
      const b = new Browser(ws);
      ws.once('open', () => resolve(b));
      ws.once('error', reject);
    });
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  async take<T extends ServerMsg['t']>(t: T, ok: (m: Msg<T>) => boolean = () => true, ms = 4000): Promise<Msg<T>> {
    const until = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t && ok(m as Msg<T>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Msg<T>;
      const left = until - Date.now();
      if (left <= 0) throw new Error(`no ${t} within ${ms}ms; got ${this.inbox.map((m) => m.t).join(', ') || 'nothing'}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wake = () => (clearTimeout(timer), resolve());
      });
      this.wake = undefined;
    }
  }
  async settle(ms = 400) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

const get = (p: string, who: keyof typeof cookies) => fetch(base + p, { headers: { cookie: cookies[who] }, redirect: 'manual' });
const post = (p: string, body: unknown, cookie = '') => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body), redirect: 'manual' });
const signIn = async (name: string) => (await post('/api/login', { name, password: PW })).headers.get('set-cookie')!.split(';')[0];

const gitRepo = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'README.md'), `# ${path.basename(dir)}\n`);
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: dir });
};

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'agent-office-access-'));
  const home = path.join(tmp, 'home');
  const project = path.join(tmp, 'project');
  const other = path.join(tmp, 'other');
  const publicDir = path.join(tmp, 'public');
  const bin = path.join(tmp, 'bin');
  for (const d of [home, publicDir, bin, path.join(tmp, 'projects')]) mkdirSync(d, { recursive: true });
  gitRepo(project);
  gitRepo(other);
  for (const page of ['index', 'login', 'claim', 'join', 'lite']) writeFileSync(path.join(publicDir, `${page}.html`), `<!doctype html><title>${page}</title>`);
  const claude = path.join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\nexit 0\n');
  chmodSync(claude, 0o755);

  // The second floor, and the people, there before the office starts.
  const dataDir = path.join(project, '.agent-office');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, 'floors.json'), JSON.stringify([{ id: OTHER, name: 'Beta Corp', dir: other, palette: 1, addedBy: 'test', addedAt: 1 }]));
  const accounts = new Accounts(dataDir);
  const make = async (name: string, role: 'admin' | 'member') => {
    const v = accounts.invite('test', role, name);
    if (typeof v === 'string') throw new Error(v);
    const a = await accounts.join(v.token, name, PW);
    if (typeof a === 'string') throw new Error(a);
    return a;
  };
  await make('Boss', 'admin');
  const member = await make('Mia', 'member');
  await make('Nobody', 'member');
  accounts.setSharedPassword(false);

  for (const k of Object.keys(process.env)) if (k.startsWith('AGENT_OFFICE_')) delete process.env[k];
  const port = await freePort();
  const cfg = loadConfig([project, '--home', home, '--projects', path.join(tmp, 'projects'), '--port', String(port), '--password', 'unused-shared-pw', '--no-open', '--weather', 'clear', '--agent', claude]);
  office = await startServer(cfg, { publicDir });
  base = `http://127.0.0.1:${port}`;
  mine = office.floors().find((f) => f.id !== OTHER)!.id;
  office.accounts.setFloors(member.id, [mine]);
  cookies.admin = await signIn('Boss');
  cookies.member = await signIn('Mia');
  cookies.nobody = await signIn('Nobody');
});

after(() => {
  office?.shutdown();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("a member sees the other floor's name and nothing of it, and the elevator won't take them there", async () => {
  const mia = await Browser.open('member', `?floor=${OTHER}`);
  const welcome = await mia.take('welcome');
  // Asked for the other floor: arrives on their own.
  assert.equal(welcome.floor, mine);
  const other = welcome.floors.find((f) => f.id === OTHER)!;
  assert.deepEqual(
    { name: other.name, locked: other.locked, dir: other.dir, workers: other.workers, people: other.people, crew: other.crew },
    { name: 'Beta Corp', locked: true, dir: '', workers: 0, people: 0, crew: undefined },
  );
  assert.equal(welcome.floors.find((f) => f.id === mine)!.locked, undefined);

  mia.send({ t: 'floor.go', floor: OTHER });
  assert.match((await mia.take('toast', (m) => m.level === 'warn')).text, /Beta Corp isn't one of your floors/);
  // Up to the bar instead, which is everyone's.
  assert.equal((await mia.take('floor.enter')).floor, ROOF);
  mia.send({ t: 'floor.go', floor: mine });
  assert.equal((await mia.take('floor.enter')).floor, mine);
  await mia.close();
});

test("a floor's files, boards and search answer only those who may go there", async () => {
  assert.equal((await get(`/api/docs?floor=${OTHER}`, 'member')).status, 404);
  assert.equal((await get(`/api/docs?floor=${mine}`, 'member')).status, 200);
  assert.equal((await get(`/api/docs?floor=${OTHER}`, 'admin')).status, 200);
  assert.equal((await get(`/api/gh/labels?floor=${OTHER}`, 'member')).status, 404);
});

test('a member with no floors yet arrives up at the bar', async () => {
  const b = await Browser.open('nobody', `?floor=${mine}`);
  const welcome = await b.take('welcome');
  assert.equal(welcome.floor, ROOF);
  assert.ok(welcome.floors.every((f) => f.locked));
  await b.close();
});

test('each place has its own chat, and nobody sees people on a floor that isn’t theirs', async () => {
  const boss = await Browser.open('admin', `?floor=${OTHER}`);
  const bossIn = await boss.take('welcome');
  assert.equal(bossIn.floor, OTHER);
  const mia = await Browser.open('member', `?floor=${mine}`);
  const welcome = await mia.take('welcome');
  // The admin's on the other floor: not among the people the member sees.
  assert.deepEqual(welcome.peers.map((p) => p.name), ['Mia']);
  // …and the admin sees the member arrive, since they go everywhere.
  assert.equal((await boss.take('peer.join')).peer.name, 'Mia');

  boss.send({ t: 'chat', text: 'beta secret' });
  assert.equal((await boss.take('chat')).text, 'beta secret');
  mia.send({ t: 'chat', text: 'on my floor' });
  await mia.take('chat', (m) => m.text === 'on my floor');
  await boss.settle();
  assert.ok(!mia.inbox.some((m) => m.t === 'chat' && m.text === 'beta secret'));
  assert.ok(!boss.inbox.some((m) => m.t === 'chat' && m.text === 'on my floor'));
  // Its search doesn't find what was said there either.
  const found = (await (await get('/api/search?q=secret', 'member')).json()) as { chat: unknown[] };
  assert.equal(found.chat.length, 0);
  assert.equal(((await (await get('/api/search?q=secret', 'admin')).json()) as { chat: unknown[] }).chat.length, 1);

  // Up at the bar together: they see each other, and the bar's chat is the bar's.
  boss.send({ t: 'floor.go', floor: ROOF });
  const up = await boss.take('floor.enter');
  assert.ok(!up.chat?.some((l) => l.text === 'beta secret'));
  assert.equal((await mia.take('peer.update', (m) => m.peer.name === 'Boss')).peer.floor, ROOF);
  // Back down on the other floor: the member sees them go.
  boss.send({ t: 'floor.go', floor: OTHER });
  assert.ok((await boss.take('floor.enter')).chat?.some((l) => l.text === 'beta secret'));
  await mia.take('peer.leave');
  // Voice doesn't reach across: the member can't call someone they can't see.
  mia.send({ t: 'rtc', to: bossIn.you, data: { hello: 1 } });
  await boss.settle();
  assert.ok(!boss.inbox.some((m) => m.t === 'rtc'));
  await mia.close();
  await boss.close();
});

test("the bar's open link lets anyone up to the bar as a guest, and nowhere else", async () => {
  assert.equal((await post('/api/bar', { key: 'nope' })).status, 410);
  const boss = await Browser.open('admin');
  await boss.take('welcome');
  boss.send({ t: 'accounts.bar', on: true });
  const key = (await boss.take('accounts', (m) => !!m.state.bar)).state.bar!.key;
  const res = await post('/api/bar', { key });
  assert.equal(res.status, 200);
  cookies.guest = res.headers.get('set-cookie')!.split(';')[0];

  assert.deepEqual(await (await get('/api/whoami', 'guest')).json(), { ok: true, me: { admin: false, guest: true } });
  assert.equal((await get('/', 'guest')).status, 200);
  for (const p of ['/lite', `/api/docs?floor=${mine}`, '/api/search?q=secret', '/api/services']) assert.equal((await get(p, 'guest')).status, 403, p);

  const guest = await Browser.open('guest', `?floor=${mine}&name=Visitor`);
  const welcome = await guest.take('welcome');
  assert.equal(welcome.floor, ROOF);
  assert.equal(welcome.me.guest, true);
  assert.ok(welcome.floors.every((f) => f.locked && f.name === 'Private floor'));
  assert.deepEqual(welcome.prompts, { custom: {} });
  assert.equal(welcome.projectsDir.dir, '');
  // The office's things aren't theirs to touch: dropped without a word.
  guest.send({ t: 'worker.spawn', deskId: 'd1', kind: 'shell' });
  guest.send({ t: 'accounts.get' });
  guest.send({ t: 'floor.go', floor: mine });
  assert.equal((await guest.take('floor.enter')).floor, ROOF);
  // Everything up at the bar is.
  guest.send({ t: 'chat', text: 'cheers' });
  assert.equal((await guest.take('chat')).text, 'cheers');
  guest.send({ t: 'act', drink: 'beer' });
  await guest.settle();
  assert.ok(!guest.inbox.some((m) => m.t === 'accounts' || m.t === 'worker.update'));

  // A new link: whoever came in by the old one is out.
  boss.send({ t: 'accounts.bar', on: true });
  await boss.take('accounts', (m) => !!m.state.bar && m.state.bar.key !== key);
  await guest.settle();
  assert.equal(guest.closed, true);
  assert.equal((await get('/api/whoami', 'guest')).status, 401);
  await boss.close();
});

test("an admin changing a member's floors sends them round again, onto what's theirs now", async () => {
  const boss = await Browser.open('admin');
  const accountsList = (await (async () => (boss.send({ t: 'accounts.get' }), await boss.take('accounts')))()).state.accounts;
  const mia = accountsList.find((a) => a.name === 'Mia')!;
  const member = await Browser.open('member', `?floor=${mine}`);
  assert.equal((await member.take('welcome')).floor, mine);
  boss.send({ t: 'accounts.floors', accountId: mia.id, floors: [OTHER, 'not-a-floor'] });
  const now = await boss.take('accounts', (m) => m.state.accounts.some((a) => a.name === 'Mia' && a.floors?.[0] === OTHER));
  assert.deepEqual(now.state.accounts.find((a) => a.name === 'Mia')!.floors, [OTHER]);
  await member.settle();
  assert.equal(member.closed, true);
  const again = await Browser.open('member', `?floor=${mine}`);
  assert.equal((await again.take('welcome')).floor, OTHER);
  await again.close();
  await boss.close();
});
