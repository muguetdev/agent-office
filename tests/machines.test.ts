// Agent machines (server/machines/): the ids and the host's address, the ssh command lines (argument
// vectors only, nothing a shell or the host could read as more than a word), the desktop proxy's
// checks, workers.json keeping a worker's machine, and a worker sent home taking its machine with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorizeLine, machineIdFor, MACHINE_ID_RE, parseMachinesHost, slug } from '../src/shared/machines.ts';
import { forwardArgs, hostCommand, MachinesHost, type Runner } from '../src/server/machines/ssh.ts';
import { desktopTarget, parseDesktopPath } from '../src/server/machines/proxy.ts';
import { Machines, type MachineFloor } from '../src/server/machines/service.ts';
import { claudeMachineArgs, codexMachineArgs } from '../src/server/machines/mcp.ts';
import { validMachine } from '../src/server/machines/saved.ts';
import { restoreWorkers, saveWorkers } from '../src/server/workers/persist.ts';
import { newWorker } from '../src/server/workers/worker.ts';
import { restoreTracker } from '../src/server/usage.ts';
import { claude } from '../src/server/providers/claude.ts';
import type { WorkerInfo } from '../src/shared/protocol.ts';
import type { Worker } from '../src/server/workers/types.ts';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'machines-test-'));

test('slugs and machine ids are what the host takes, and unique per worker', () => {
  assert.equal(slug('Acme App — São Paulo!'), 'acme-app-sao-paulo');
  assert.equal(slug('---'), '');
  assert.equal(slug('a'.repeat(80)).length, 40);
  const id = machineIdFor('acme', 'My Very Long Floor Name That Goes On And On', 'a1b2c3d4e5f6');
  assert.ok(id.startsWith('acme-my-very'), id);
  assert.match(id, MACHINE_ID_RE);
  assert.ok(id.endsWith('-a1b2c3d4e5f6'), id);
  assert.ok(id.length <= 40);
  assert.notEqual(machineIdFor('acme', 'app', 'a1b2c3d4e5f6'), machineIdFor('acme', 'app', 'a1b2c3d4e5f7'));
  assert.notEqual(machineIdFor('acme', 'app', 'a1b2c3d4e5f6'), machineIdFor('other', 'app', 'a1b2c3d4e5f6'), 'ids are the whole host’s: the office is in them');
  assert.match(machineIdFor('', '', '000000000000'), MACHINE_ID_RE);
  assert.match(machineIdFor('x', '🚀🚀', 'abc'), MACHINE_ID_RE);
});

test('the host is user@host[:port], and nothing that could pass for an ssh option', () => {
  assert.deepEqual(parseMachinesHost('root@108.165.230.167'), { user: 'root', host: '108.165.230.167', port: 22 });
  assert.deepEqual(parseMachinesHost('ops@machines.example.com:2222'), { user: 'ops', host: 'machines.example.com', port: 2222 });
  assert.deepEqual(parseMachinesHost('machines.example.com'), { user: 'root', host: 'machines.example.com', port: 22 });
  assert.deepEqual(parseMachinesHost('root@[2001:db8::1]:2200'), { user: 'root', host: '[2001:db8::1]', port: 2200 });
  for (const bad of ['', '-oProxyCommand=sh', 'root@-oProxyCommand=x', 'root@host;rm -rf /', 'root@host:99999', 'ro ot@host', 'root@host name', '$(id)@host', 'root@ho`st', 42, undefined]) {
    assert.equal(parseMachinesHost(bad), undefined, String(bad));
  }
  assert.equal(authorizeLine('ssh-ed25519 AAAA "x" $HOME', 'acme'), 'ce-machines authorize "ssh-ed25519 AAAA x HOME" acme');
});

test('the ssh command lines are argument vectors, every word checked, and the host after --', () => {
  const t = { user: 'root', host: 'machines.example.com', port: 2222 };
  const args = hostCommand('/data', t, ['create', 'acme-app-a1b2c3d4e5f6', '--mem', '2g', '--cpus', '2']);
  const dash = args.indexOf('--');
  assert.ok(dash > 0);
  assert.deepEqual(args.slice(dash), ['--', 'machines.example.com', 'ce-machines', 'create', 'acme-app-a1b2c3d4e5f6', '--mem', '2g', '--cpus', '2']);
  assert.ok(args.includes('IdentitiesOnly=yes'));
  assert.ok(args.includes('StrictHostKeyChecking=accept-new'));
  assert.ok(args.includes(`UserKnownHostsFile=${path.join('/data', 'machines', 'known_hosts')}`));
  assert.deepEqual(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2), ['-i', path.join('/data', 'machines', 'office_key')]);
  assert.deepEqual(args.slice(args.indexOf('-p'), args.indexOf('-p') + 2), ['-p', '2222']);
  for (const word of ['x; rm -rf /', '$(id)', 'a b', "it's", '`id`', 'a|b', '', '-', '../x']) {
    assert.throws(() => hostCommand('/data', t, ['delete', word]), /not a word/, word);
  }
  assert.throws(() => hostCommand('/data', t, ['authorize', 'x']), /not a ce-machines command/);
  assert.throws(() => hostCommand('/data', t, ['revoke']), /not a ce-machines command/);
  const fwd = forwardArgs('/data', t, [{ local: 40001, remote: 32768 }, { local: 40002, remote: 32769 }]);
  assert.ok(fwd.includes('-N') && fwd.includes('ExitOnForwardFailure=yes'));
  assert.ok(fwd.includes('127.0.0.1:40001:127.0.0.1:32768'));
  assert.deepEqual(fwd.slice(-2), ['--', 'machines.example.com']);
  assert.throws(() => forwardArgs('/data', t, [{ local: 0, remote: 22 }]));
});

test('the host’s answers are read as JSON, and its errors as errors', async () => {
  const calls: string[][] = [];
  let answer = { code: 0, stdout: '{"id":"app-1","state":"running","desktopPort":32768,"cdpPort":32769,"created":"now"}\n', stderr: '' };
  const run: Runner = async (file, args) => {
    assert.equal(file, 'ssh');
    calls.push([...args]);
    return answer;
  };
  const host = new MachinesHost('/data', run);
  const t = { user: 'root', host: 'h', port: 22 };
  assert.deepEqual(await host.create(t, 'app-1', '2g', 2), { id: 'app-1', state: 'running', desktopPort: 32768, cdpPort: 32769, created: 'now', memUsage: undefined });
  answer = { code: 1, stdout: '{"error":"host is full"}\n', stderr: '' };
  await assert.rejects(host.create(t, 'app-2', '2g', 2), /host is full/);
  answer = { code: 255, stdout: '', stderr: 'ssh: connect to host h port 22: Connection refused\n' };
  await assert.rejects(host.ping(t), /Connection refused/);
  await assert.rejects(host.delete(t, 'Bad Id'), /bad machine id/);
  assert.equal(calls.length, 3, 'a bad id never reaches ssh');
});

test('the desktop proxy: only desktop paths, only for someone allowed on the worker’s floor, never a guest', () => {
  assert.deepEqual(parseDesktopPath('/api/machines/a1b2c3d4e5f6/desktop/'), { id: 'a1b2c3d4e5f6', rest: '/' });
  assert.deepEqual(parseDesktopPath('/api/machines/a1b2c3d4e5f6/desktop/websocket'), { id: 'a1b2c3d4e5f6', rest: '/websocket' });
  for (const bad of ['/api/machines/', '/api/machines/x/other/', '/api/machines/X/desktop/', '/api/machines/a/desktop/../../ws', '/api/machines/a/desktop/%2e%2e/x', '/api/machines/a/desktop/a%2fb', '/api/machines/a/desktopx', '/api/machines/a/desktop/..']) {
    assert.equal(parseDesktopPath(bad), undefined, bad);
  }
  const find = (id: string) => (id === 'w1' || id === 'app-w1' ? { floor: 'app', port: 41000, machineId: 'app-w1' } : undefined);
  const may = (who: { accountId?: string }, floor: string) => who.accountId !== 'outsider' && floor === 'app';
  assert.deepEqual(desktopTarget('/api/machines/w1/desktop/index.html', '?x=1', { accountId: 'member' }, find, may), { status: 200, port: 41000, path: '/api/machines/app-w1/desktop/index.html?x=1' });
  assert.deepEqual(desktopTarget('/api/machines/app-w1/desktop/', '', { accountId: 'member' }, find, may), { status: 200, port: 41000, path: '/api/machines/app-w1/desktop/' });
  assert.deepEqual(desktopTarget('/api/machines/w1/desktop', '?a', {}, find, may), { status: 301, location: '/api/machines/w1/desktop/?a' });
  assert.equal(desktopTarget('/api/machines/w1/desktop/', '', { accountId: 'outsider' }, find, may).status, 403);
  assert.equal(desktopTarget('/api/machines/w1/desktop/', '', { guest: true }, find, may).status, 403);
  assert.equal(desktopTarget('/api/machines/w1/desktop/', '', undefined, find, may).status, 403);
  assert.equal(desktopTarget('/api/machines/w2/desktop/', '', { accountId: 'member' }, find, may).status, 404);
  assert.equal(desktopTarget('/api/machines/w1/other', '', { accountId: 'member' }, find, may).status, 404);
});

const info = (over: Partial<WorkerInfo> = {}): WorkerInfo => ({
  id: 'a1b2c3d4e5f6',
  kind: 'agent',
  provider: 'claude',
  deskId: 'desk-1',
  name: 'Ada',
  color: '#fff',
  status: 'idle',
  acked: true,
  createdBy: 'sam',
  createdAt: Date.now(),
  cols: 100,
  rows: 30,
  viewers: [],
  viewerIds: [],
  ...over,
});

test('workers.json keeps a worker’s machine, and drops one that isn’t', () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'workers.json');
    const machine = { host: 'root@108.165.230.167', id: 'acme-app-a1b2c3d4e5f6', cdpLocalPort: 41001, desktopLocalPort: 41000 };
    saveWorkers(file, [newWorker(info({ machine }), restoreTracker({})), newWorker(info({ id: 'b00000000000', deskId: 'desk-2' }), restoreTracker({}))], true);
    const back = new Map<string, Worker>();
    restoreWorkers(file, back, 'claude', () => false);
    assert.deepEqual(back.get('a1b2c3d4e5f6')?.info.machine, machine);
    assert.equal(back.get('b00000000000')?.info.machine, undefined);
    assert.equal(validMachine({ ...machine, host: '-oProxyCommand=x' }), undefined);
    assert.equal(validMachine({ ...machine, id: 'Bad Id' }), undefined);
    assert.equal(validMachine({ ...machine, cdpLocalPort: 70000 }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a worker with a machine starts with the browser MCP and is told about it', () => {
  const machine = { host: 'root@h', id: 'app-1', cdpLocalPort: 41001, desktopLocalPort: 41000 };
  const plan = claude.launch({ h: { info: info({ machine }) } as never, args: [], cwd: '/x', setup: { settings: '/s.json', mcp: '/office-mcp.json' } });
  const at = plan.args.indexOf('--mcp-config');
  assert.equal(plan.args[at + 1], '/office-mcp.json');
  const mcp = JSON.parse(plan.args[at + 2]);
  assert.deepEqual(mcp.mcpServers.computer.args.slice(-2), ['--browserUrl', 'http://127.0.0.1:41001']);
  assert.ok(plan.args[at + 3] === '--settings', '--settings ends the list');
  assert.match(plan.args[plan.args.indexOf('--append-system-prompt') + 1], /your own computer/);
  const without = claude.launch({ h: { info: info() } as never, args: [], cwd: '/x', setup: { settings: '/s.json', mcp: '/office-mcp.json' } });
  assert.equal(without.args.filter((a) => a === '/office-mcp.json').length, 1);
  assert.ok(!without.args.includes('--append-system-prompt'));
  assert.deepEqual(claudeMachineArgs(info({ kind: 'shell', machine })), { append: [] });
  assert.ok(codexMachineArgs(info({ machine })).some((a) => a.includes('mcp_servers.computer.args')));
});

/** A floor of workers as the machines see one, with what was done to them. */
function fakeFloor(workers: WorkerInfo[]) {
  const map = new Map(workers.map((w) => [w.id, w]));
  const relaunched: [string, boolean][] = [];
  const prompted: string[] = [];
  const floor: MachineFloor = {
    id: 'app',
    workers: {
      get: (id) => map.get(id),
      list: () => [...map.values()],
      relaunch: (id, restart = true) => void relaunched.push([id, restart]),
      prompt: (id, text) => void prompted.push(`${id}:${text}`),
    },
  };
  return { floor, map, relaunched, prompted };
}

/** A machines host that answers like ce-machines does, and remembers what it was asked. */
function fakeHost() {
  const asked: string[][] = [];
  const run: Runner = async (_file, args) => {
    const words = args.slice(args.indexOf('ce-machines') + 1);
    asked.push(words);
    if (words[0] === 'create') return { code: 0, stdout: JSON.stringify({ id: words[1], state: 'running', desktopPort: 32768, cdpPort: 32769, created: 'now' }), stderr: '' };
    if (words[0] === 'delete') return { code: 0, stdout: JSON.stringify({ id: words[1], deleted: true }), stderr: '' };
    if (words[0] === 'list') return { code: 0, stdout: '[]', stderr: '' };
    return { code: 0, stdout: '{"ok":true,"version":"1"}', stderr: '' };
  };
  const spawned: string[][] = [];
  const spawner = (_file: string, args: readonly string[]) => {
    spawned.push([...args]);
    const p = new EventEmitter() as EventEmitter & { kill(): boolean };
    p.kill = () => true;
    return p as never;
  };
  return { run, asked, spawned, spawner };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

test('giving a worker a machine starts it again with it; sending it home deletes the machine', async (t) => {
  const dir = tmp();
  const host = fakeHost();
  const f = fakeFloor([info()]);
  const toasts: string[] = [];
  const m = new Machines({ dataDir: dir, officeName: () => 'Acme', floors: () => [f.floor], floor: () => f.floor, toast: (_f, text) => void toasts.push(text), changed: () => {} }, host.run, host.spawner);
  t.after(() => (m.stop(), rmSync(dir, { recursive: true, force: true })));
  m.config.save({ ...m.config.settings, host: 'root@machines.example.com' });

  assert.equal(m.give(f.floor, 'a1b2c3d4e5f6', 'sam'), undefined);
  await settle();
  const w = f.map.get('a1b2c3d4e5f6')!;
  assert.equal(w.machine?.id, 'acme-app-a1b2c3d4e5f6');
  assert.equal(w.machine?.host, 'root@machines.example.com');
  assert.deepEqual(host.asked[0], ['create', 'acme-app-a1b2c3d4e5f6', '--mem', '4g', '--cpus', '4']);
  assert.deepEqual(f.relaunched.at(-1), ['a1b2c3d4e5f6', true], 'started again, with its browser');
  assert.ok(host.spawned[0].includes(`127.0.0.1:${w.machine!.desktopLocalPort}:127.0.0.1:32768`));
  assert.equal(m.desktopOf('a1b2c3d4e5f6')?.port, w.machine!.desktopLocalPort);
  m.workerChanged(f.floor, { ...w });

  // Sent home (any path ends in the floor's workers telling the office it's gone).
  f.map.delete('a1b2c3d4e5f6');
  m.workerChanged(f.floor, 'a1b2c3d4e5f6');
  await settle();
  assert.deepEqual(host.asked.at(-1), ['delete', 'acme-app-a1b2c3d4e5f6']);
  assert.equal(m.desktopOf('a1b2c3d4e5f6'), undefined, 'its desktop is gone from the proxy');
});

test('a busy worker gets its machine once it finishes; taking it away deletes it; a shell gets none', async (t) => {
  const dir = tmp();
  const host = fakeHost();
  const f = fakeFloor([info({ status: 'working' }), info({ id: 'shell0000000', kind: 'shell', deskId: 'desk-2' })]);
  const m = new Machines({ dataDir: dir, officeName: () => 'Acme', floors: () => [f.floor], floor: () => f.floor, toast: () => {}, changed: () => {} }, host.run, host.spawner);
  t.after(() => (m.stop(), rmSync(dir, { recursive: true, force: true })));
  assert.match(m.give(f.floor, 'a1b2c3d4e5f6', 'sam') ?? '', /No machines host/);
  m.config.save({ ...m.config.settings, host: 'root@machines.example.com', perFloor: 1 });
  assert.match(m.give(f.floor, 'shell0000000', 'sam') ?? '', /not shells/);

  const w = f.map.get('a1b2c3d4e5f6')!;
  assert.equal(m.give(f.floor, w.id, 'sam', true), undefined);
  assert.equal(w.machineBusy, 'soon-give');
  assert.equal(host.asked.length, 0, 'nothing yet: it’s working');
  w.status = 'done';
  m.workerChanged(f.floor, { ...w });
  await settle();
  await settle();
  assert.equal(w.machine?.id, 'acme-app-a1b2c3d4e5f6');
  assert.equal(w.machineBusy, undefined);

  assert.equal(m.take(f.floor, w.id, 'sam'), undefined);
  assert.equal(w.machine, undefined);
  await settle();
  assert.deepEqual(host.asked.at(-1), ['delete', 'acme-app-a1b2c3d4e5f6']);
});

test('a worker hired with a machine gets its first prompt once it has it', async (t) => {
  const dir = tmp();
  const host = fakeHost();
  const f = fakeFloor([]);
  const m = new Machines({ dataDir: dir, officeName: () => 'Acme', floors: () => [f.floor], floor: () => f.floor, toast: () => {}, changed: () => {} }, host.run, host.spawner);
  t.after(() => (m.stop(), rmSync(dir, { recursive: true, force: true })));
  m.config.save({ ...m.config.settings, host: 'root@machines.example.com' });
  assert.equal(m.want(f.floor, 'desk-1', 'sam', 'open example.com'), undefined);
  const w = info({ status: 'starting' });
  f.map.set(w.id, w);
  m.workerChanged(f.floor, { ...w });
  await settle();
  assert.equal(w.machine?.id, 'acme-app-a1b2c3d4e5f6');
  w.status = 'idle';
  await new Promise((r) => setTimeout(r, 5_500));
  assert.deepEqual(f.prompted, ['a1b2c3d4e5f6:open example.com']);
});

test('a floor taken off the building deletes its workers’ machines', async (t) => {
  const dir = tmp();
  const host = fakeHost();
  const machine = { host: 'root@machines.example.com', id: 'acme-app-a1b2c3d4e5f6', cdpLocalPort: 41001, desktopLocalPort: 41000 };
  const f = fakeFloor([info({ machine })]);
  const m = new Machines({ dataDir: dir, officeName: () => 'Acme', floors: () => [f.floor], floor: () => f.floor, toast: () => {}, changed: () => {} }, host.run, host.spawner);
  t.after(() => (m.stop(), rmSync(dir, { recursive: true, force: true })));
  m.config.save({ ...m.config.settings, host: 'root@machines.example.com' });
  m.workerChanged(f.floor, { ...f.map.get('a1b2c3d4e5f6')! });
  m.floorClosed(f.floor);
  await settle();
  assert.deepEqual(host.asked.at(-1), ['delete', 'acme-app-a1b2c3d4e5f6']);
});
