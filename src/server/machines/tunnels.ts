// The ways from the office to its workers' machines: for each machine, one `ssh -N` that forwards
// its desktop's and its Chrome's ports (on the host's 127.0.0.1) to ports on the office's 127.0.0.1.
// One process per machine, started again whenever it drops, so a machine that's gone or a host
// that's down only ever takes its own forwards with it.
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import type { MachinesTarget } from '../../shared/machines.js';
import { forwardArgs, type Forward } from './ssh.js';

/** Starts a process (no shell). Tests put a fake one in. */
export type Spawner = (file: string, args: readonly string[]) => Pick<ChildProcess, 'on' | 'kill'>;
const realSpawn: Spawner = (file, args) => spawn(file, [...args], { stdio: 'ignore', windowsHide: true });

/** A port on the office's 127.0.0.1 nobody listens on: `want` when it's free, else any. */
export function freePort(want?: number): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number | undefined>((resolve) => {
      const srv = net.createServer();
      srv.unref();
      srv.once('error', () => resolve(undefined));
      srv.listen(port, '127.0.0.1', () => {
        const got = (srv.address() as net.AddressInfo).port;
        srv.close(() => resolve(got));
      });
    });
  return (async () => (want ? await tryPort(want) : undefined) ?? (await tryPort(0)) ?? Promise.reject(new Error('no free port')))();
}

/** How long it waits before starting a dropped forward again: longer each time it drops quickly, up to a minute. */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;
/** Up this long, and it counts as having worked: the next drop starts the wait over. */
const STEADY_MS = 15_000;

interface Tunnel {
  target: MachinesTarget;
  forwards: Forward[];
  proc?: Pick<ChildProcess, 'on' | 'kill'>;
  startedAt: number;
  wait: number;
  timer?: NodeJS.Timeout;
  closed: boolean;
}

export class Tunnels {
  private tunnels = new Map<string, Tunnel>();

  constructor(
    private dataDir: string,
    /** A machine's forwards stopped working (`up` false) or work again. */
    private onState: (key: string, up: boolean) => void = () => {},
    private spawner: Spawner = realSpawn,
  ) {}

  /** Opens (or opens again, with these ports) the forwards for `key` (a worker's id). */
  open(key: string, target: MachinesTarget, forwards: Forward[]) {
    this.close(key);
    const t: Tunnel = { target, forwards, startedAt: 0, wait: RETRY_MIN_MS, closed: false };
    this.tunnels.set(key, t);
    this.start(key, t);
  }

  has(key: string): boolean {
    return this.tunnels.has(key);
  }

  close(key: string) {
    const t = this.tunnels.get(key);
    if (!t) return;
    t.closed = true;
    clearTimeout(t.timer);
    try {
      t.proc?.kill();
    } catch {
      // already gone
    }
    this.tunnels.delete(key);
  }

  closeAll() {
    for (const key of [...this.tunnels.keys()]) this.close(key);
  }

  private start(key: string, t: Tunnel) {
    if (t.closed) return;
    t.startedAt = Date.now();
    let proc: Pick<ChildProcess, 'on' | 'kill'>;
    try {
      proc = this.spawner('ssh', forwardArgs(this.dataDir, t.target, t.forwards));
    } catch {
      return this.again(key, t);
    }
    t.proc = proc;
    const steady = setTimeout(() => {
      if (t.proc === proc && !t.closed) this.onState(key, true);
    }, STEADY_MS);
    steady.unref?.();
    let over = false;
    const done = () => {
      if (over) return;
      over = true;
      clearTimeout(steady);
      if (t.proc !== proc || t.closed) return;
      t.proc = undefined;
      this.again(key, t);
    };
    proc.on('exit', done);
    proc.on('error', done);
  }

  private again(key: string, t: Tunnel) {
    if (t.closed) return;
    // It had been up a while: a blip, try again soon. Dropping straight away: wait longer each time.
    if (Date.now() - t.startedAt >= STEADY_MS) t.wait = RETRY_MIN_MS;
    else {
      this.onState(key, false);
      t.wait = Math.min(RETRY_MAX_MS, t.wait * 2);
    }
    t.timer = setTimeout(() => this.start(key, t), t.wait);
    t.timer.unref?.();
  }
}
