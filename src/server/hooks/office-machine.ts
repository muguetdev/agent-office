import http from 'node:http';
import type { Ctx } from '../office/context.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import { parseMachinesHost, type MachinesTarget } from '../../shared/machines.js';
import { readBody, readBytes, send } from '../http/util.js';
import { FILE_MAX, MachineShell, type ExecResult } from '../machines/shell.js';

/** What the endpoint needs: who's asking, and the machines host's shell. Tests put fakes in. */
export interface MachineDeps {
  authenticate(workerId: string, token: string): WorkerInfo | undefined;
  shell: Pick<MachineShell, 'exec' | 'put' | 'get'>;
  /** Whether the machine's desktop and browser answer through the office's forwards. */
  probe(m: NonNullable<WorkerInfo['machine']>): Promise<{ desktop: boolean; browser?: string }>;
}

const NO_MACHINE =
  "You don't have a machine of your own. A person can give you one with the 🖥️ switch in your ⚙️ settings at your desk (when the office has a machines host set up).";

/** What `machine info` runs to say what's installed. */
const VERSIONS =
  '. /etc/os-release 2>/dev/null; echo "os: $PRETTY_NAME"; echo "user: $(id -un) (passwordless sudo: $(sudo -n true 2>/dev/null && echo yes || echo no)), home $HOME"; ' +
  'for c in node npm python3 rustc java gcc git google-chrome code; do v=$("$c" --version 2>/dev/null | head -n 1); [ -n "$v" ] && echo "$c: $v"; done; ' +
  'command -v go >/dev/null && echo "go: $(go version)"; ' +
  'echo "disk free: $(df -h "$HOME" | awk \'NR==2 {print $4}\')"';

/** `root=1` (or true, yes) in the query. */
const flag = (url: URL, name: string) => /^(1|true|yes)$/i.test(url.searchParams.get(name) ?? '');

/**
 * A worker's own machine (see machines/shell.ts and bin/office-machine.js, the `machine` command
 * and MCP tools that call it): GET is what it is and what's on it (?quick=1: only whether there is
 * one), POST /run runs a command line in it with bash, POST /put?path= writes the body to a file
 * in it, GET /get?path= answers with a file of it. The worker's own hook token says who's asking,
 * and only that worker's machine is ever touched: there's no way to name another.
 */
export async function handleMachine(deps: MachineDeps, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const me = deps.authenticate(url.searchParams.get('worker') ?? '', token);
  if (!me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const action = url.pathname.slice('/office/machine'.length);
  const m = me.machine;
  const t: MachinesTarget | undefined = m ? parseMachinesHost(m.host) : undefined;
  if (req.method === 'GET' && !action && flag(url, 'quick')) return send(res, 200, { machine: m ? { id: m.id } : null });
  if (!m || !t) return send(res, 409, { error: NO_MACHINE });
  if (me.machineBusy === 'giving' || me.machineBusy === 'taking') return send(res, 409, { error: 'Your machine is being set up or taken away right now: try again in a minute.' });
  const failed = (err: unknown) => send(res, 502, { error: `The machines host said: ${(err as Error).message}` });
  try {
    if (req.method === 'GET' && !action) {
      const [seen, versions] = await Promise.all([deps.probe(m), deps.shell.exec(t, m.id, VERSIONS, { timeout: 60 }).catch((err: Error) => ({ error: err.message }))]);
      return send(res, 200, {
        machine: { id: m.id, host: m.host, down: !!me.machineDown || undefined },
        desktop: seen.desktop ? 'up' : 'not answering',
        browser: seen.browser ?? 'not answering',
        installed: 'stdout' in versions ? (versions as ExecResult).stdout.trim() : `couldn't look: ${versions.error}`,
      });
    }
    if (req.method === 'POST' && action === '/run') {
      let body: { command?: unknown; root?: unknown; timeout?: unknown; cwd?: unknown };
      try {
        body = JSON.parse((await readBody(req, 256 * 1024)) || '{}');
      } catch {
        return send(res, 400, { error: 'Send JSON: {"command": "…", "root": false, "timeout": 600, "cwd": "/config"}' });
      }
      if (typeof body?.command !== 'string' || !body.command.trim()) return send(res, 400, { error: 'Say what to run: command' });
      if (body.timeout !== undefined && typeof body.timeout !== 'number') return send(res, 400, { error: 'timeout is a number of seconds' });
      if (body.cwd !== undefined && typeof body.cwd !== 'string') return send(res, 400, { error: 'cwd is a path inside the machine' });
      const opts = { root: body.root === true, timeout: body.timeout as number | undefined, cwd: body.cwd as string | undefined };
      // A command that can't be what the host takes is the worker's mistake, not the host's.
      try {
        return send(res, 200, await deps.shell.exec(t, m.id, body.command, opts));
      } catch (err) {
        return /^(say what|the command|timeout|cwd|bad machine)/.test((err as Error).message) ? send(res, 400, { error: (err as Error).message }) : failed(err);
      }
    }
    const path = url.searchParams.get('path') ?? '';
    if (req.method === 'POST' && action === '/put') {
      let data: Buffer;
      try {
        data = await readBytes(req, FILE_MAX);
      } catch {
        return send(res, 413, { error: `The file is larger than ${FILE_MAX} bytes` });
      }
      return send(res, 200, { path, bytes: await deps.shell.put(t, m.id, path, data, flag(url, 'root')) });
    }
    if (req.method === 'GET' && action === '/get') {
      const data = await deps.shell.get(t, m.id, path, flag(url, 'root'));
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(data.length), 'cache-control': 'no-store' });
      return res.end(data);
    }
  } catch (err) {
    return /^(give an absolute|that path)/.test((err as Error).message) ? send(res, 400, { error: (err as Error).message }) : failed(err);
  }
  send(res, 405, { error: 'GET /office/machine, POST /office/machine/run, POST /office/machine/put?path=, GET /office/machine/get?path=' });
}

/** Whether something answers 200 on the office's own 127.0.0.1 `port` at `path`; its JSON, when it's JSON. */
function local(port: number, path: string): Promise<{ ok: boolean; json?: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 4000 }, (r) => {
      let text = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (text = (text + c).slice(0, 65536)));
      r.on('end', () => {
        let json: Record<string, unknown> | undefined;
        try {
          json = JSON.parse(text);
        } catch {
          // a page, not JSON
        }
        resolve({ ok: r.statusCode === 200, json });
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ ok: false }));
  });
}

export function machineDeps(ctx: Ctx): MachineDeps {
  return {
    authenticate: (workerId, token) => ctx.workerFloor(workerId)?.workers.authenticate(workerId, token),
    shell: new MachineShell(ctx.cfg.dataDir),
    probe: async (m) => {
      const [desk, cdp] = await Promise.all([local(m.desktopLocalPort, `/api/machines/${m.id}/desktop/`), local(m.cdpLocalPort, '/json/version')]);
      return { desktop: desk.ok, browser: cdp.ok && typeof cdp.json?.Browser === 'string' ? cdp.json.Browser : undefined };
    },
  };
}

export const officeMachine = (ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) => handleMachine(machineDeps(ctx), req, res, url);
