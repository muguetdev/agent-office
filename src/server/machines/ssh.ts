// Talking to the machines host: `ce-machines <subcommand>` over SSH with the office's own key, which
// the host runs as a forced command (see deploy/machines/), and the JSON it answers with. Every
// command is an argument vector handed to ssh as it is, never a line for a shell, and every word
// sent to the host is checked first: the host splits what it gets on spaces.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { MACHINE_CPUS_MAX, MACHINE_CPUS_MIN, MACHINE_MEM_RE, isMachineId, type MachinesTarget } from '../../shared/machines.js';

/** Where the office keeps its key for the host, the host's key and the rest (see keys.ts). */
export const machinesDir = (dataDir: string) => path.join(dataDir, 'machines');
export const keyPath = (dataDir: string) => path.join(machinesDir(dataDir), 'office_key');
export const knownHostsPath = (dataDir: string) => path.join(machinesDir(dataDir), 'known_hosts');

/** What a run of ssh gave back. */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
/** Runs a program with these arguments (no shell), for at most `timeoutMs`. Tests put a fake one in. */
export type Runner = (file: string, args: readonly string[], timeoutMs: number) => Promise<RunResult>;

export const execRunner: Runner = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(file, [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && code === null ? err.message : '') });
    });
  });

/**
 * A word the host may be sent: nothing a shell or shlex would split, quote or expand. The options
 * create, exec, put and get take, and base64 (how a command line or a path goes, see shell.ts).
 */
const WORD_RE = /^(?:--(?:mem|cpus|root|timeout|cwd-b64|command-b64|path-b64)|[A-Za-z0-9][A-Za-z0-9._-]{0,63}|[A-Za-z0-9+/]{1,160000}={0,2})$/;
const SUBCOMMANDS = new Set(['ping', 'status', 'list', 'create', 'delete', 'exec', 'put', 'get']);

/**
 * ssh's options for the host: the office's key and nobody else's (not the agent's, not the user's
 * config), the host key it saw the first time and no other, and no questions asked.
 */
export function sshOptions(dataDir: string, t: MachinesTarget): string[] {
  return [
    '-F', process.platform === 'win32' ? 'NUL' : '/dev/null',
    '-i', keyPath(dataDir),
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHostsPath(dataDir)}`,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-p', String(t.port),
    '-l', t.user,
  ];
}

/** The arguments for `ssh … ce-machines <words>`, or throws when a word isn't one the host may be sent. */
export function hostCommand(dataDir: string, t: MachinesTarget, words: readonly string[]): string[] {
  if (!SUBCOMMANDS.has(words[0] ?? '')) throw new Error(`not a ce-machines command: ${words[0]}`);
  for (const w of words) if (!WORD_RE.test(w)) throw new Error(`not a word the machines host takes: ${JSON.stringify(w)}`);
  // `--` ends ssh's own options: the host and the command after it are never read as one.
  return [...sshOptions(dataDir, t), '--', t.host.replace(/^\[|\]$/g, ''), 'ce-machines', ...words];
}

/** One port of the host's 127.0.0.1 forwarded to one of the office's 127.0.0.1. */
export interface Forward {
  local: number;
  remote: number;
}

const isPort = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 65536;

/** The arguments for an `ssh -N` that only forwards ports (no command, so no shell on the host either). */
export function forwardArgs(dataDir: string, t: MachinesTarget, forwards: readonly Forward[]): string[] {
  const args = [...sshOptions(dataDir, t), '-N', '-T', '-o', 'ExitOnForwardFailure=yes'];
  for (const f of forwards) {
    if (!isPort(f.local) || !isPort(f.remote)) throw new Error('bad port');
    args.push('-L', `127.0.0.1:${f.local}:127.0.0.1:${f.remote}`);
  }
  return [...args, '--', t.host.replace(/^\[|\]$/g, '')];
}

/** A machine on the host, as `create` and `list` say. */
export interface HostMachine {
  id: string;
  state?: string;
  desktopPort: number;
  cdpPort: number;
  created?: string;
  memUsage?: string;
}

/** How the host is, as `status` says. */
export interface HostStatus {
  cpus?: number;
  memTotal?: number;
  memAvailable?: number;
  machines: number;
  maxMachines: number;
  canCreate?: boolean;
}

const machineOf = (v: unknown): HostMachine | undefined => {
  const m = v as Partial<HostMachine> | null;
  if (!m || typeof m !== 'object' || !isMachineId(m.id) || !isPort(m.desktopPort) || !isPort(m.cdpPort)) return undefined;
  return { id: m.id, desktopPort: m.desktopPort, cdpPort: m.cdpPort, state: typeof m.state === 'string' ? m.state : undefined, created: typeof m.created === 'string' ? m.created : undefined, memUsage: typeof m.memUsage === 'string' ? m.memUsage : undefined };
};

/** The JSON a ce-machines run printed: its last line that parses. */
function lastJson(stdout: string): unknown {
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // not this one
    }
  }
  return undefined;
}

/** `ce-machines` on one host, over SSH. Each method resolves with what the host said, or rejects with why not. */
export class MachinesHost {
  constructor(
    private dataDir: string,
    private run: Runner = execRunner,
  ) {}

  async call(t: MachinesTarget, words: readonly string[], timeoutMs = 30_000): Promise<unknown> {
    const r = await this.run('ssh', hostCommand(this.dataDir, t, words), timeoutMs);
    const out = lastJson(r.stdout);
    const error = out && typeof out === 'object' && typeof (out as { error?: unknown }).error === 'string' ? (out as { error: string }).error : undefined;
    if (r.code !== 0 || error !== undefined) throw new Error((error ?? r.stderr.trim().split('\n').pop()) || `ssh exited with ${r.code}`);
    if (out === undefined) throw new Error('the machines host answered with no JSON');
    return out;
  }

  async ping(t: MachinesTarget): Promise<string> {
    const r = (await this.call(t, ['ping'], 20_000)) as { ok?: unknown; version?: unknown };
    if (r?.ok !== true) throw new Error('the machines host didn’t say ok');
    return String(r.version ?? '?');
  }

  async status(t: MachinesTarget): Promise<HostStatus> {
    const r = (await this.call(t, ['status'], 20_000)) as Partial<HostStatus>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return { cpus: n(r?.cpus), memTotal: n(r?.memTotal), memAvailable: n(r?.memAvailable), machines: n(r?.machines) ?? 0, maxMachines: n(r?.maxMachines) ?? 0, canCreate: typeof r?.canCreate === 'boolean' ? r.canCreate : undefined };
  }

  async list(t: MachinesTarget): Promise<HostMachine[]> {
    const r = await this.call(t, ['list'], 30_000);
    return Array.isArray(r) ? r.map(machineOf).filter((m): m is HostMachine => !!m) : [];
  }

  /** Makes the machine (or finds it, when it's there already) and waits until it's up. */
  async create(t: MachinesTarget, id: string, mem: string, cpus: number): Promise<HostMachine> {
    if (!isMachineId(id)) throw new Error('bad machine id');
    const words = ['create', id];
    if (MACHINE_MEM_RE.test(mem)) words.push('--mem', mem);
    if (Number.isFinite(cpus) && cpus >= MACHINE_CPUS_MIN && cpus <= MACHINE_CPUS_MAX) words.push('--cpus', String(Math.round(cpus * 100) / 100));
    const m = machineOf(await this.call(t, words, 150_000));
    if (!m) throw new Error('the machines host didn’t say where the machine is');
    return m;
  }

  async delete(t: MachinesTarget, id: string): Promise<void> {
    if (!isMachineId(id)) throw new Error('bad machine id');
    await this.call(t, ['delete', id], 60_000);
  }
}
