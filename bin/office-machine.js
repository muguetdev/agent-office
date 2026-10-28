#!/usr/bin/env node
// machine: a shell and files inside the worker's own machine (its desktop computer on the machines
// host, see src/server/machines/), from the worker's terminal on the office. The office puts it on
// every worker's PATH as `machine`, with the worker's address and token in AGENT_OFFICE_HOOK_URL,
// AGENT_OFFICE_WORKER_ID and AGENT_OFFICE_HOOK_TOKEN; this talks to the /office/machine endpoint
// with them (src/server/hooks/office-machine.ts), which only ever acts on that worker's own machine.
// The same calls are MCP tools (machine_run, machine_put, machine_get) in the office's MCP server
// (bin/office-workers.js mcp), for a worker that has a machine. Plain Node, no build step, no
// dependencies.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage:
  machine run [--root] [--timeout <s>] [--cwd <dir>] -- <command…>
                          run a command line with bash in your machine (as user abc, in /config,
                          its home; --root as root; sudo works without a password too). Prints its
                          output and exits with its exit code. Timeout 600 s by default, 3600 at most.
                          Without -- the script is read from stdin.
  machine put <local-file> <remote-path> [--root]
                          copy a file from here into your machine (folders are made as needed)
  machine get <remote-path> <local-file> [--root]
                          copy a file from your machine to here
  machine info            your machine: its id, whether its desktop and Chrome answer, what's installed

Remote paths are absolute, or relative to /config (the home of the machine's user abc).
The desktop and Chrome you control with the computer MCP tools run in this same machine, so a
server you start there (machine run -- 'cd ~/app && nohup npm run dev > dev.log 2>&1 &') is at
localhost in that Chrome. Files up to 100 MB; output past 1 MB per stream keeps its end.`;

export class UsageError extends Error {}

const ENV = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'];
export const TIMEOUT_DEFAULT = 600;
export const TIMEOUT_MAX = 3600;
const HOME = '/config';

/** A path in the machine as given: absolute stays, ~/x and x are under /config. */
export function remotePath(p) {
  const s = String(p ?? '').trim();
  if (!s) throw new UsageError('Give a path in the machine');
  if (s.startsWith('/')) return s;
  if (s === '~') return HOME;
  return `${HOME}/${s.replace(/^~\//, '')}`;
}

/**
 * What the command line asks for.
 * @param {string[]} argv the arguments after the command's name
 */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const help = (a) => a === '-h' || a === '--help';
  if (cmd === undefined || cmd === 'help' || help(cmd)) return { cmd: 'help' };
  if (cmd === 'info') {
    if (rest.length) throw new UsageError('info takes no arguments');
    return { cmd: 'info' };
  }
  if (cmd === 'run' || cmd === 'exec') {
    const out = { cmd: 'run', root: false };
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--') {
        const words = rest.slice(i + 1);
        if (!words.length) throw new UsageError('Nothing to run after --');
        out.command = words.join(' ');
        break;
      }
      if (a === '--root') out.root = true;
      else if (a === '--timeout' || a.startsWith('--timeout=')) {
        const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : rest[++i];
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > TIMEOUT_MAX) throw new UsageError(`--timeout is whole seconds from 1 to ${TIMEOUT_MAX}`);
        out.timeout = n;
      } else if (a === '--cwd' || a.startsWith('--cwd=')) {
        const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : rest[++i];
        if (v === undefined) throw new UsageError('--cwd needs a directory');
        out.cwd = remotePath(v);
      } else if (help(a)) return { cmd: 'help' };
      else throw new UsageError(`Unexpected argument: ${a} (put the command after --, e.g. machine run -- ls -la)`);
    }
    return out;
  }
  if (cmd === 'put' || cmd === 'get') {
    const root = rest.includes('--root');
    const words = rest.filter((a) => a !== '--root');
    if (words.some((w) => w.startsWith('--'))) throw new UsageError(`Unknown option: ${words.find((w) => w.startsWith('--'))}`);
    if (words.length !== 2) throw new UsageError(cmd === 'put' ? 'put takes <local-file> <remote-path>' : 'get takes <remote-path> <local-file>');
    return cmd === 'put' ? { cmd, local: words[0], remote: remotePath(words[1]), root } : { cmd, remote: remotePath(words[0]), local: words[1], root };
  }
  throw new UsageError(`Unknown command: ${cmd}`);
}

/** The office's address and this worker's id and token. */
export function officeEnv(env) {
  const missing = ENV.filter((k) => !env[k]);
  if (missing.length) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} set. machine only works inside Agent Office, from a worker's terminal.`);
  return { url: env.AGENT_OFFICE_HOOK_URL.replace(/\/+$/, ''), worker: env.AGENT_OFFICE_WORKER_ID, token: env.AGENT_OFFICE_HOOK_TOKEN };
}

/**
 * The HTTP request for one call to the office.
 * @param {'info' | 'quick' | 'run' | 'put' | 'get'} what
 * @param {{ url: string, worker: string, token: string }} office
 * @param {{ body?: unknown, path?: string, root?: boolean, timeout?: number, data?: Buffer }} [ask]
 */
export function buildRequest(what, office, ask = {}) {
  const url = new URL(`${office.url}/office/machine${what === 'run' || what === 'put' || what === 'get' ? `/${what}` : ''}`);
  url.searchParams.set('worker', office.worker);
  if (what === 'quick') url.searchParams.set('quick', '1');
  if (what === 'put' || what === 'get') {
    url.searchParams.set('path', ask.path ?? '');
    if (ask.root) url.searchParams.set('root', '1');
  }
  const headers = { authorization: `Bearer ${office.token}` };
  // The office waits on the command as long as the machine does, and a minute and a half more.
  const timeout = what === 'quick' ? 4000 : what === 'info' ? 90_000 : what === 'run' ? ((ask.timeout ?? TIMEOUT_DEFAULT) + 120) * 1000 : 35 * 60_000;
  if (what === 'run') return { method: 'POST', url: url.href, headers: { ...headers, 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(ask.body ?? {})), timeout };
  if (what === 'put') return { method: 'POST', url: url.href, headers: { ...headers, 'content-type': 'application/octet-stream' }, body: ask.data ?? Buffer.alloc(0), timeout };
  return { method: 'GET', url: url.href, headers, timeout };
}

/** Sends a request with node:http (fetch would give up on a long command after five minutes). */
export function send(req) {
  return new Promise((resolve, reject) => {
    const r = http.request(req.url, { method: req.method, headers: { ...req.headers, ...(req.body ? { 'content-length': String(req.body.length) } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), data: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    r.setTimeout(req.timeout, () => r.destroy(new Error(`no answer from the office in ${Math.round(req.timeout / 1000)} s`)));
    r.on('error', (err) => reject(new Error(`Couldn't reach the office at ${new URL(req.url).origin} (${err.code ?? err.message}). Is it running?`)));
    r.end(req.body);
  });
}

/** Makes one call; resolves to its JSON (or its bytes, for get), or throws with why the office said no. */
export async function call(what, ask, io) {
  const res = await (io.send ?? send)(buildRequest(what, officeEnv(io.env), ask));
  if (what === 'get' && res.status === 200) return res.data;
  let body;
  try {
    body = JSON.parse(res.data.toString('utf8') || '{}');
  } catch {
    body = { error: res.data.toString('utf8').slice(0, 300) };
  }
  if (res.status === 401) throw new Error(`The office didn't accept this worker's token (401)${body.error ? `: ${body.error}` : ''}.`);
  if (res.status === 404) throw new Error("The office doesn't know the machine command (404): it's running an older Agent Office. Restart or upgrade it.");
  if (res.status < 200 || res.status >= 300) throw new Error(body.error || `The office said no (${res.status}).`);
  return body;
}

/** What `machine info` prints. */
export function formatInfo(i) {
  return [`machine ${i.machine?.id} on ${i.machine?.host}${i.machine?.down ? ' (the office lost its forward to it: it is reconnecting)' : ''}`, `desktop: ${i.desktop}`, `browser (computer MCP tools): ${i.browser}`, i.installed].filter(Boolean).join('\n');
}

// --- MCP tools, served by bin/office-workers.js mcp ---------------------------------------------

export const MACHINE_TOOLS = [
  {
    name: 'machine_run',
    title: 'Run a command in your machine',
    description:
      'Runs a command line with bash inside your own machine (the Linux desktop computer whose Chrome you drive with the computer MCP tools), as user abc in /config (its home) unless cwd says otherwise, or as root with root: true. ' +
      'sudo works without a password (sudo apt-get install -y …), and the machine is yours: install what the task needs. Returns its exit code, stdout and stderr (the last 1 MB of each). ' +
      "A server started there is at localhost in that machine's Chrome; start long-running ones in the background (cd ~/app && nohup npm run dev > dev.log 2>&1 &).",
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line, run with bash -lc.' },
        root: { type: 'boolean', description: 'Run as root instead of abc.' },
        timeout: { type: 'integer', minimum: 1, maximum: TIMEOUT_MAX, description: `Seconds before it is stopped (default ${TIMEOUT_DEFAULT}).` },
        cwd: { type: 'string', description: 'Directory to run in (absolute, or relative to /config).' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  {
    name: 'machine_put',
    title: 'Copy a file into your machine',
    description: 'Copies a file from your working directory on the office into your machine (up to 100 MB; folders are made as needed).',
    inputSchema: {
      type: 'object',
      properties: {
        local: { type: 'string', description: 'The file here (on the office).' },
        remote: { type: 'string', description: 'Where it goes in the machine (absolute, or relative to /config).' },
        root: { type: 'boolean', description: 'Write it as root.' },
      },
      required: ['local', 'remote'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'machine_get',
    title: 'Copy a file out of your machine',
    description: 'Copies a file from your machine to your working directory on the office (up to 100 MB), e.g. a build output or a screenshot a program saved there.',
    inputSchema: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'The file in the machine (absolute, or relative to /config).' },
        local: { type: 'string', description: 'Where to write it here (on the office).' },
        root: { type: 'boolean', description: 'Read it as root.' },
      },
      required: ['remote', 'local'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

/** The machine tools, for a worker that has a machine right now (it's started again when that changes); none otherwise. */
export async function machineTools(io) {
  try {
    const r = await call('quick', {}, io);
    return r.machine ? MACHINE_TOOLS : [];
  } catch {
    return [];
  }
}

/** A command's result, as text for the agent. */
export function formatRun(r) {
  const parts = [`exit code ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}${r.truncated ? ' (output cut to its end)' : ''}`];
  if (r.stdout) parts.push(`stdout:\n${r.stdout}`);
  if (r.stderr) parts.push(`stderr:\n${r.stderr}`);
  return parts.join('\n');
}

/** Runs a machine tool; resolves to its text and whether it failed. */
export async function runMachineTool(name, args, io) {
  const a = args && typeof args === 'object' ? args : {};
  if (name === 'machine_run') {
    if (typeof a.command !== 'string' || !a.command.trim()) throw new Error('Say what to run: command');
    const body = { command: a.command, root: a.root === true, ...(a.timeout !== undefined ? { timeout: a.timeout } : {}), ...(a.cwd ? { cwd: remotePath(a.cwd) } : {}) };
    const r = await call('run', { body, timeout: body.timeout }, io);
    return { text: formatRun(r), isError: r.exitCode !== 0 };
  }
  if (name === 'machine_put') {
    const r = await call('put', { path: remotePath(a.remote), root: a.root === true, data: readFileSync(String(a.local)) }, io);
    return { text: `Copied ${a.local} to ${r.path} in your machine (${r.bytes} bytes).` };
  }
  if (name === 'machine_get') {
    const data = await call('get', { path: remotePath(a.remote), root: a.root === true }, io);
    writeFileSync(String(a.local), data);
    return { text: `Copied ${remotePath(a.remote)} from your machine to ${a.local} (${data.length} bytes).` };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function readStdin(stdin) {
  return new Promise((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (c) => (data += c));
    stdin.on('end', () => resolve(data));
    stdin.on('error', reject);
  });
}

/**
 * Runs the command; resolves to its exit code.
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, stdin?: any, send?: typeof send, out?: (s: string) => void, err?: (s: string) => void }} [io]
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdin = io.stdin ?? process.stdin;
  const out = io.out ?? ((s) => process.stdout.write(s));
  const err = io.err ?? ((s) => process.stderr.write(s));
  const ctx = { env, send: io.send };
  try {
    const cmd = parseArgs(argv);
    if (cmd.cmd === 'help') {
      out(`${USAGE}\n`);
      return 0;
    }
    officeEnv(env);
    if (cmd.cmd === 'info') {
      out(`${formatInfo(await call('info', {}, ctx))}\n`);
      return 0;
    }
    if (cmd.cmd === 'run') {
      let command = cmd.command;
      if (command === undefined) {
        if (stdin.isTTY) throw new UsageError("Give the command after -- (machine run -- ls -la), or the script on stdin (machine run <<'EOF' … EOF)");
        command = await readStdin(stdin);
      }
      const body = { command, root: cmd.root, ...(cmd.timeout ? { timeout: cmd.timeout } : {}), ...(cmd.cwd ? { cwd: cmd.cwd } : {}) };
      const r = await call('run', { body, timeout: cmd.timeout }, ctx);
      if (r.stdout) out(r.stdout);
      if (r.stderr) err(r.stderr.endsWith('\n') ? r.stderr : `${r.stderr}\n`);
      return typeof r.exitCode === 'number' ? Math.min(255, Math.max(0, r.exitCode)) : 1;
    }
    if (cmd.cmd === 'put') {
      const r = await call('put', { path: cmd.remote, root: cmd.root, data: readFileSync(cmd.local) }, ctx);
      err(`Copied ${cmd.local} to ${r.path} in your machine (${r.bytes} bytes).\n`);
      return 0;
    }
    const data = await call('get', { path: cmd.remote, root: cmd.root }, ctx);
    writeFileSync(cmd.local, data);
    err(`Copied ${cmd.remote} to ${cmd.local} (${data.length} bytes).\n`);
    return 0;
  } catch (e) {
    err(`machine: ${e.message}\n`);
    if (e instanceof UsageError) err(`\n${USAGE}\n`);
    return e instanceof UsageError ? 2 : 1;
  }
}

const invoked = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invoked) process.exitCode = await main(process.argv.slice(2));
