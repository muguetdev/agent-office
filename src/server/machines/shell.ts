// A shell and files inside a worker's own machine: `ce-machines exec`, `put` and `get` on the
// machines host, over the office's SSH key (see ssh.ts and deploy/machines/). The command line and
// the paths travel as base64, so neither ssh nor the host's shlex ever reads them; bash reads the
// command line inside the machine, which is the point. Each method resolves with what the host
// said, or rejects with why not.
import { spawn } from 'node:child_process';
import { isMachineId, type MachinesTarget } from '../../shared/machines.js';
import { hostCommand } from './ssh.js';

/** How long a command runs unless asked otherwise, and the most it may (seconds); the host holds it to the same. */
export const EXEC_TIMEOUT_DEFAULT = 600;
export const EXEC_TIMEOUT_MAX = 3600;
/** The longest command line (bytes, before base64), within what the host takes over SSH. */
export const EXEC_COMMAND_MAX = 64 * 1024;
/** The largest file `put` or `get` moves, as the host's own cap. */
export const FILE_MAX = 100 * 1024 * 1024;

/** What a command in a machine gave back, as `ce-machines exec` says. */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** stdout or stderr was longer than the host keeps (1 MB each): what's here is its end. */
  truncated: boolean;
  timedOut: boolean;
}

export interface ExecOptions {
  root?: boolean;
  /** Seconds, 1 to EXEC_TIMEOUT_MAX. */
  timeout?: number;
  /** An absolute path inside the machine (default: abc's home, /config). */
  cwd?: string;
}

/** A run of ssh with bytes in and out. Tests put a fake one in. */
export type BinRunner = (file: string, args: readonly string[], timeoutMs: number, stdin?: Buffer) => Promise<{ code: number | null; stdout: Buffer; stderr: string }>;

export const spawnRunner: BinRunner = (file, args, timeoutMs, stdin) =>
  new Promise((resolve) => {
    const p = spawn(file, [...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    let size = 0;
    let err = '';
    let over = false;
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (c: Buffer) => {
      size += c.length;
      // A file at the cap plus the JSON of an error is the most the host sends.
      if (size > FILE_MAX + 64 * 1024) {
        over = true;
        p.kill('SIGKILL');
      } else out.push(c);
    });
    p.stderr.on('data', (c: Buffer) => (err = (err + c.toString('utf8')).slice(-4000)));
    p.on('error', (e) => (err += e.message));
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: over ? null : code, stdout: Buffer.concat(out), stderr: over ? 'the machines host sent more than a file may be' : err });
    });
    p.stdin.on('error', () => undefined);
    p.stdin.end(stdin ?? Buffer.alloc(0));
  });

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Why `p` isn't a path inside a machine, or undefined when it is one. */
export function badPath(p: unknown): string | undefined {
  if (typeof p !== 'string' || !p.startsWith('/')) return 'give an absolute path inside the machine (e.g. /config/app/file.txt)';
  if (p.length > 4096) return 'that path is too long';
  if (/[\u0000-\u001f\u007f]/.test(p)) return 'that path has control characters';
  return undefined;
}

/** The words for `ce-machines exec`, or a string saying what's wrong with what was asked. */
export function execWords(id: string, command: unknown, o: ExecOptions = {}): string[] | string {
  if (!isMachineId(id)) return 'bad machine id';
  if (typeof command !== 'string' || !command.trim()) return 'say what to run: command';
  if (Buffer.byteLength(command) > EXEC_COMMAND_MAX) return `the command is longer than ${EXEC_COMMAND_MAX} bytes: put a script in the machine with put and run that`;
  if (command.includes('\0')) return 'the command has a NUL character';
  const timeout = o.timeout ?? EXEC_TIMEOUT_DEFAULT;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > EXEC_TIMEOUT_MAX) return `timeout is whole seconds from 1 to ${EXEC_TIMEOUT_MAX}`;
  const words = ['exec', id];
  if (o.root) words.push('--root');
  words.push('--timeout', String(timeout));
  if (o.cwd !== undefined) {
    const bad = badPath(o.cwd);
    if (bad) return `cwd: ${bad}`;
    words.push('--cwd-b64', b64(o.cwd));
  }
  words.push('--command-b64', b64(command));
  return words;
}

/** The words for `ce-machines put` or `get`, or what's wrong. */
export function fileWords(verb: 'put' | 'get', id: string, path: unknown, root?: boolean): string[] | string {
  if (!isMachineId(id)) return 'bad machine id';
  const bad = badPath(path);
  if (bad) return bad;
  return [verb, id, '--path-b64', b64(path as string), ...(root ? ['--root'] : [])];
}

/** The `{"error": …}` the host printed, if it printed one. */
function hostError(stdout: Buffer, stderr: string, code: number | null): Error {
  const text = stdout.subarray(-8192).toString('utf8').trim().split('\n').pop() ?? '';
  try {
    const e = (JSON.parse(text) as { error?: unknown }).error;
    if (typeof e === 'string') return new Error(e);
  } catch {
    // not JSON
  }
  return new Error(stderr.trim().split('\n').pop() || `ssh exited with ${code}`);
}

export class MachineShell {
  constructor(
    private dataDir: string,
    private run: BinRunner = spawnRunner,
  ) {}

  /** Runs one command line with bash inside the machine. Rejects only when it couldn't run it; a command that failed resolves with its exit code. */
  async exec(t: MachinesTarget, id: string, command: string, o: ExecOptions = {}): Promise<ExecResult> {
    const words = execWords(id, command, o);
    if (typeof words === 'string') throw new Error(words);
    const timeout = o.timeout ?? EXEC_TIMEOUT_DEFAULT;
    const r = await this.run('ssh', hostCommand(this.dataDir, t, words), (timeout + 90) * 1000);
    let res: Partial<ExecResult> & { error?: unknown };
    try {
      res = JSON.parse(r.stdout.toString('utf8').trim().split('\n').pop() ?? '');
    } catch {
      throw hostError(r.stdout, r.stderr, r.code);
    }
    if (typeof res.error === 'string') throw new Error(res.error);
    if (typeof res.exitCode !== 'number') throw new Error('the machines host answered without an exit code');
    return { exitCode: res.exitCode, stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? ''), truncated: res.truncated === true, timedOut: res.timedOut === true };
  }

  /** Writes `data` to `path` in the machine (its folders made as needed); resolves with how many bytes. */
  async put(t: MachinesTarget, id: string, path: string, data: Buffer, root = false): Promise<number> {
    if (data.length > FILE_MAX) throw new Error(`the file is larger than ${FILE_MAX} bytes`);
    const words = fileWords('put', id, path, root);
    if (typeof words === 'string') throw new Error(words);
    const r = await this.run('ssh', hostCommand(this.dataDir, t, words), 30 * 60_000, data);
    if (r.code !== 0) throw hostError(r.stdout, r.stderr, r.code);
    try {
      const said = JSON.parse(r.stdout.toString('utf8').trim()) as { bytes?: unknown };
      return typeof said.bytes === 'number' ? said.bytes : data.length;
    } catch {
      return data.length;
    }
  }

  /** The bytes of `path` in the machine. */
  async get(t: MachinesTarget, id: string, path: string, root = false): Promise<Buffer> {
    const words = fileWords('get', id, path, root);
    if (typeof words === 'string') throw new Error(words);
    const r = await this.run('ssh', hostCommand(this.dataDir, t, words), 30 * 60_000);
    if (r.code !== 0) throw hostError(r.stdout, r.stderr, r.code);
    return r.stdout;
  }
}
