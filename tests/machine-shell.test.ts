// A shell and files inside a worker's own machine: the office's ssh words for `ce-machines exec`,
// `put` and `get` (server/machines/shell.ts), the /office/machine endpoint the `machine` command
// calls (hooks/office-machine.ts: whose token, and only its own machine), the command itself
// (bin/office-machine.js), and the host's side of it (deploy/machines/bin: what the SSH wrapper lets
// an office run, and how exec reads its arguments), where Python is there to run it.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostCommand } from '../src/server/machines/ssh.ts';
import { MachineShell, execWords, fileWords, type BinRunner, type ExecOptions } from '../src/server/machines/shell.ts';
import { handleMachine, type MachineDeps } from '../src/server/hooks/office-machine.ts';
import { claudeMachineArgs, MACHINE_NOTE } from '../src/server/machines/mcp.ts';
import { buildRequest, main, parseArgs, remotePath } from '../bin/office-machine.js';
import type { WorkerInfo } from '../src/shared/protocol.ts';

const root = path.join(import.meta.dirname, '..');
const t = { user: 'root', host: 'machines.example.com', port: 22 };
const b64 = (s: string) => Buffer.from(s).toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

test('exec, put and get go to the host as checked words, the command line and paths in base64', () => {
  const words = execWords('acme-app-w1', "cd ~/app && npm run dev > dev.log 2>&1 & echo 'started' $(id -un)", { root: true, timeout: 30, cwd: '/config/my app' });
  assert.ok(Array.isArray(words));
  const w = words as string[];
  assert.deepEqual(w.slice(0, 5), ['exec', 'acme-app-w1', '--root', '--timeout', '30']);
  assert.equal(unb64(w[w.indexOf('--cwd-b64') + 1]), '/config/my app');
  assert.equal(unb64(w[w.indexOf('--command-b64') + 1]), "cd ~/app && npm run dev > dev.log 2>&1 & echo 'started' $(id -un)");
  // Every word passes the office's own check, so nothing the agent wrote reaches ssh or shlex as it is.
  const args = hostCommand('/data', t, w);
  assert.deepEqual(args.slice(args.indexOf('--'), args.indexOf('--') + 4), ['--', 'machines.example.com', 'ce-machines', 'exec']);
  assert.ok(!args.some((a) => a.includes(' ') || a.includes('$')));
  assert.deepEqual(execWords('acme-app-w1', 'ls').slice(0, 4), ['exec', 'acme-app-w1', '--timeout', '600']);
  for (const [cmd, o, why] of [
    ['', {}, /say what to run/],
    ['ls', { timeout: 0 }, /timeout/],
    ['ls', { timeout: 3601 }, /timeout/],
    ['ls', { cwd: 'relative' }, /cwd: give an absolute path/],
    ['ls', { cwd: '/a\nb' }, /control characters/],
    ['a\0b', {}, /NUL/],
    ['x'.repeat(70_000), {}, /longer than/],
  ] as [string, ExecOptions, RegExp][]) {
    assert.match(String(execWords('acme-app-w1', cmd, o)), why, JSON.stringify(o));
  }
  assert.equal(execWords('Bad Id', 'ls'), 'bad machine id');
  const put = fileWords('put', 'acme-app-w1', '/config/a b/c.txt', true) as string[];
  assert.deepEqual([put[0], put[1], put[2], unb64(put[3]), put[4]], ['put', 'acme-app-w1', '--path-b64', '/config/a b/c.txt', '--root']);
  assert.ok(hostCommand('/data', t, put).includes('put'));
  assert.match(String(fileWords('get', 'acme-app-w1', 'etc/passwd')), /absolute path/);
});

test('the machine shell reads the host’s answers, and its refusals as errors', async () => {
  const calls: { args: readonly string[]; timeout: number; stdin?: Buffer }[] = [];
  let answer: { code: number | null; stdout: Buffer; stderr: string } = { code: 0, stdout: Buffer.from('{"exitCode": 3, "stdout": "hi\\n", "stderr": "", "truncated": false, "timedOut": false}\n'), stderr: '' };
  const run: BinRunner = async (file, args, timeout, stdin) => {
    assert.equal(file, 'ssh');
    calls.push({ args, timeout, stdin });
    return answer;
  };
  const shell = new MachineShell('/data', run);
  assert.deepEqual(await shell.exec(t, 'app-1', 'exit 3', { timeout: 10 }), { exitCode: 3, stdout: 'hi\n', stderr: '', truncated: false, timedOut: false });
  assert.equal(calls[0].timeout, 100_000, 'ssh waits for the command and a minute and a half more');
  answer = { code: 1, stdout: Buffer.from('{"error": "machine id app-2 is in use by another office"}\n'), stderr: '' };
  await assert.rejects(shell.exec(t, 'app-2', 'id'), /another office/);
  await assert.rejects(shell.exec(t, 'app-1', ''), /say what to run/);
  answer = { code: 0, stdout: Buffer.from('{"id": "app-1", "path": "/config/x", "bytes": 5}\n'), stderr: '' };
  assert.equal(await shell.put(t, 'app-1', '/config/x', Buffer.from('hello')), 5);
  assert.equal(calls.at(-1)?.stdin?.toString(), 'hello', 'the file goes on ssh’s stdin');
  answer = { code: 0, stdout: Buffer.from([0, 1, 2, 255]), stderr: '' };
  assert.deepEqual([...(await shell.get(t, 'app-1', '/config/bin'))], [0, 1, 2, 255]);
  answer = { code: 1, stdout: Buffer.from('{"error": "/config is not a file (directory)"}\n'), stderr: '' };
  await assert.rejects(shell.get(t, 'app-1', '/config'), /not a file/);
  answer = { code: 255, stdout: Buffer.alloc(0), stderr: 'ssh: connect to host h port 22: Connection refused\n' };
  await assert.rejects(shell.get(t, 'app-1', '/config/x'), /Connection refused/);
});

/** The endpoint on a real loopback server, with a fake host shell that says what it was asked. */
async function endpoint(workers: Record<string, { token: string; info: Partial<WorkerInfo> }>) {
  const asked: { verb: string; id: string; what: unknown; opts?: unknown; data?: string }[] = [];
  const deps: MachineDeps = {
    authenticate: (id, token) => (workers[id] && workers[id].token === token ? (workers[id].info as WorkerInfo) : undefined),
    shell: {
      exec: async (_t, id, command, opts) => (asked.push({ verb: 'exec', id, what: command, opts }), { exitCode: 0, stdout: `ran in ${id}\n`, stderr: '', truncated: false, timedOut: false }),
      put: async (_t, id, p, data) => (asked.push({ verb: 'put', id, what: p, data: data.toString() }), data.length),
      get: async (_t, id, p) => (asked.push({ verb: 'get', id, what: p }), Buffer.from('file bytes')),
    },
    probe: async () => ({ desktop: true, browser: 'Chrome/140' }),
  };
  const server = http.createServer((req, res) => void handleMachine(deps, req, res, new URL(req.url ?? '/', 'http://127.0.0.1')));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { asked, base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('the office runs commands only in the asking worker’s own machine, on its own token', async (tt) => {
  const mine = { host: 'root@machines.example.com', id: 'acme-app-w1', cdpLocalPort: 41001, desktopLocalPort: 41000 };
  const other = { host: 'root@machines.example.com', id: 'acme-app-w2', cdpLocalPort: 41003, desktopLocalPort: 41002 };
  const e = await endpoint({ w1: { token: 'tok1', info: { id: 'w1', machine: mine } }, w2: { token: 'tok2', info: { id: 'w2', machine: other } }, w3: { token: 'tok3', info: { id: 'w3' } } });
  tt.after(e.close);
  const post = (q: string, token: string, body: unknown) => fetch(`${e.base}/office/machine/run?${q}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

  // Someone else's token, or none, gets nothing.
  assert.equal((await post('worker=w2', 'tok1', { command: 'id' })).status, 401);
  assert.equal((await post('worker=w1', '', { command: 'id' })).status, 401);
  // Its own: its own machine, whatever else it names.
  const ran = await post('worker=w1&machine=acme-app-w2', 'tok1', { command: 'go version', machine: 'acme-app-w2', id: 'acme-app-w2', root: true, timeout: 20, cwd: '/tmp' });
  assert.equal(ran.status, 200);
  assert.equal((await ran.json()).stdout, 'ran in acme-app-w1\n');
  assert.deepEqual(e.asked.at(-1), { verb: 'exec', id: 'acme-app-w1', what: 'go version', opts: { root: true, timeout: 20, cwd: '/tmp' } });
  // A worker without a machine is told so.
  const none = await post('worker=w3', 'tok3', { command: 'id' });
  assert.equal(none.status, 409);
  assert.match((await none.json()).error, /don't have a machine/);
  assert.deepEqual(await (await fetch(`${e.base}/office/machine?worker=w3&quick=1`, { headers: { authorization: 'Bearer tok3' } })).json(), { machine: null });
  assert.deepEqual(await (await fetch(`${e.base}/office/machine?worker=w1&quick=1`, { headers: { authorization: 'Bearer tok1' } })).json(), { machine: { id: 'acme-app-w1' } });
  assert.equal((await post('worker=w1', 'tok1', { root: true })).status, 400);

  const put = await fetch(`${e.base}/office/machine/put?worker=w2&path=/config/in.txt`, { method: 'POST', headers: { authorization: 'Bearer tok2' }, body: 'payload' });
  assert.deepEqual(await put.json(), { path: '/config/in.txt', bytes: 7 });
  assert.deepEqual(e.asked.at(-1), { verb: 'put', id: 'acme-app-w2', what: '/config/in.txt', data: 'payload' });
  const got = await fetch(`${e.base}/office/machine/get?worker=w2&path=/config/out.bin`, { headers: { authorization: 'Bearer tok2' } });
  assert.equal(got.headers.get('content-type'), 'application/octet-stream');
  assert.equal(await got.text(), 'file bytes');
  const info = await (await fetch(`${e.base}/office/machine?worker=w1`, { headers: { authorization: 'Bearer tok1' } })).json();
  assert.equal(info.machine.id, 'acme-app-w1');
  assert.equal(info.browser, 'Chrome/140');
});

test('the machine command: its arguments, its requests, and the exit code of what it ran', async () => {
  assert.deepEqual(parseArgs(['run', '--root', '--timeout', '30', '--cwd', 'app', '--', 'sudo', 'apt-get', 'install', '-y', 'golang-go']), {
    cmd: 'run',
    root: true,
    timeout: 30,
    cwd: '/config/app',
    command: 'sudo apt-get install -y golang-go',
  });
  assert.deepEqual(parseArgs(['put', 'dist.tgz', '~/app/dist.tgz']), { cmd: 'put', local: 'dist.tgz', remote: '/config/app/dist.tgz', root: false });
  assert.deepEqual(parseArgs(['get', '/etc/hosts', 'hosts', '--root']), { cmd: 'get', remote: '/etc/hosts', local: 'hosts', root: true });
  assert.equal(remotePath('~'), '/config');
  assert.throws(() => parseArgs(['run', 'ls']), /after --/);
  assert.throws(() => parseArgs(['run', '--timeout', '9999', '--', 'ls']), /--timeout/);
  assert.throws(() => parseArgs(['put', 'one']), /put takes/);
  const office = { url: 'http://127.0.0.1:4455', worker: 'w1', token: 'tok' };
  const run = buildRequest('run', office, { body: { command: 'ls' }, timeout: 3600 });
  assert.equal(run.url, 'http://127.0.0.1:4455/office/machine/run?worker=w1');
  assert.equal(run.timeout, 3720_000, 'it waits as long as the command may run, and more');
  assert.equal(buildRequest('get', office, { path: '/config/a b', root: true }).url, 'http://127.0.0.1:4455/office/machine/get?worker=w1&path=%2Fconfig%2Fa+b&root=1');

  const dir = mkdtempSync(path.join(os.tmpdir(), 'machine-cmd-'));
  try {
    const env = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:4455', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 'tok' };
    const sent: { url: string; body?: Buffer }[] = [];
    let out = '';
    let err = '';
    const io = (status: number, data: Buffer | string) => ({
      env,
      out: (s: string) => void (out += s),
      err: (s: string) => void (err += s),
      send: async (req: { url: string; body?: Buffer }) => (sent.push(req), { status, type: '', data: Buffer.from(data) }),
    });
    assert.equal(await main(['run', '--', 'exit', '7'], io(200, JSON.stringify({ exitCode: 7, stdout: 'out\n', stderr: 'err', truncated: false, timedOut: false }))), 7);
    assert.equal(out, 'out\n');
    assert.equal(err, 'err\n');
    assert.deepEqual(JSON.parse(String(sent[0].body)), { command: 'exit 7', root: false });
    writeFileSync(path.join(dir, 'a.txt'), 'local bytes');
    assert.equal(await main(['put', path.join(dir, 'a.txt'), 'a.txt'], io(200, '{"path":"/config/a.txt","bytes":11}')), 0);
    assert.equal(String(sent[1].body), 'local bytes');
    assert.equal(await main(['get', 'b.bin', path.join(dir, 'b.bin')], io(200, Buffer.from([9, 8, 7]))), 0);
    assert.deepEqual([...readFileSync(path.join(dir, 'b.bin'))], [9, 8, 7]);
    err = '';
    assert.equal(await main(['run', '--', 'id'], io(409, '{"error":"You don\'t have a machine of your own."}')), 1);
    assert.match(err, /don't have a machine/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a worker with a machine is told about its shell, and may run commands there without asking', () => {
  assert.match(MACHINE_NOTE, /machine run -- /);
  assert.match(MACHINE_NOTE, /sudo apt-get install/);
  assert.match(MACHINE_NOTE, /machine put/);
  const args = claudeMachineArgs({ kind: 'agent', machine: { host: 'root@h', id: 'app-1', cdpLocalPort: 41001, desktopLocalPort: 41000 } }).append;
  const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--append-system-prompt'));
  assert.deepEqual(allowed, ['mcp__computer', 'Bash(machine run:*)', 'Bash(machine info)', 'mcp__agent-office__machine_run']);
});

// --- The host's side (Python 3, standard library) ---------------------------------------------------

const python = spawnSync('python3', ['--version']).status === 0;
const hostBin = path.join(root, 'deploy', 'machines', 'bin');

test('the SSH wrapper lets an office exec, put and get, and never name another office', { skip: !python && 'no python3' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ce-ssh-'));
  try {
    // A stand-in for ce-machines that says what it was asked.
    const fake = path.join(dir, 'ce-machines');
    writeFileSync(fake, 'import json, sys\ndef main(argv, office=None):\n    sys.stdout.write(json.dumps({"argv": argv, "office": office}))\n');
    const wrap = (command: string) => {
      const r = spawnSync('python3', [path.join(hostBin, 'ce-machines-ssh'), 'acme'], { env: { ...process.env, CE_MACHINES_BIN: fake, SSH_ORIGINAL_COMMAND: command }, encoding: 'utf8' });
      return JSON.parse(r.stdout.trim().split('\n').pop()!);
    };
    assert.deepEqual(wrap('ce-machines exec acme-w1 --timeout 30 --command-b64 ' + b64('id')), { argv: ['exec', 'acme-w1', '--timeout', '30', '--command-b64', b64('id')], office: 'acme' });
    assert.deepEqual(wrap('ce-machines put acme-w1 --path-b64 ' + b64('/config/x')).office, 'acme');
    assert.deepEqual(wrap('ce-machines get acme-w1 /config/x').argv, ['get', 'acme-w1', '/config/x']);
    assert.deepEqual(wrap('ce-machines exec acme-w1 --office other -- id'), { error: '--office is set by the server' });
    assert.deepEqual(wrap('ce-machines exec acme-w1 -- echo --office').argv, ['exec', 'acme-w1', '--', 'echo', '--office'], 'after -- it is the command line');
    assert.deepEqual(wrap('ce-machines authorize x acme'), { error: 'command not allowed' });
    assert.deepEqual(wrap('ce-machines list ' + 'x'.repeat(2000)), { error: 'command rejected' });
    assert.equal(wrap('ce-machines exec acme-w1 --command-b64 ' + 'A'.repeat(60_000)).office, 'acme', 'exec has room for a long command line');
    assert.deepEqual(wrap('ce-machines exec acme-w1 -- a\nb'), { error: 'command rejected' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ce-machines exec reads its arguments, and builds docker exec as an argument vector', { skip: !python && 'no python3' }, () => {
  const script = `
import importlib.machinery, importlib.util, json, sys
loader = importlib.machinery.SourceFileLoader("ce", sys.argv[1])
spec = importlib.util.spec_from_loader("ce", loader)
ce = importlib.util.module_from_spec(spec)
loader.exec_module(ce)
cfg = dict(ce.DEFAULTS)
out = []
for args in json.loads(sys.argv[2]):
    try:
        mid, command, opts = ce.parse_exec(cfg, args)
        out.append({"argv": ce.exec_argv("ce-" + mid, command, opts)})
    except ce.Fail as e:
        out.append({"error": str(e)})
print(json.dumps(out))
`;
  const cases = [
    ['m1', '--', 'echo', 'hi', '&&', 'id'],
    ['m1', '--root', '--timeout', '5', '--cwd-b64', b64('/srv/my app'), '--command-b64', b64("echo 'a b' $HOME")],
    ['m1', '--timeout', '3601', '--', 'id'],
    ['m1', '--cwd', 'relative', '--', 'id'],
    ['m1', '--command-b64', '!!!'],
    ['m1'],
    ['Bad', '--', 'id'],
  ];
  const res = JSON.parse(execFileSync('python3', ['-c', script, path.join(hostBin, 'ce-machines'), JSON.stringify(cases)], { encoding: 'utf8' }));
  assert.deepEqual(res[0].argv, ['exec', '-u', 'abc', '-w', '/config', '-e', 'DISPLAY=:1', 'ce-m1', 'timeout', '-k', '10', '600', 'bash', '-lc', 'echo hi && id']);
  assert.deepEqual(res[1].argv, ['exec', '-u', 'root', '-w', '/srv/my app', '-e', 'DISPLAY=:1', 'ce-m1', 'timeout', '-k', '10', '5', 'bash', '-lc', "echo 'a b' $HOME"]);
  assert.match(res[2].error, /--timeout must be 1 to 3600/);
  assert.match(res[3].error, /absolute path/);
  assert.match(res[4].error, /not base64/);
  assert.match(res[5].error, /usage: exec/);
  assert.match(res[6].error, /invalid id/);
});
