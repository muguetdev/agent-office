// Agent machines, office side: giving a worker a computer of its own on the machines host and taking
// it away, the forwards to it, and keeping both in step with the worker. A worker sent home (by any
// path), or whose floor is taken off the building, has its machine deleted; after a restart, the
// forwards to every machine still in use open again. Nothing here ever holds a worker up: a host
// that's down only means it works on without its machine, and says so.
import { spawn } from 'node:child_process';
import type { MachinesState, WorkerInfo, WorkerMachine } from '../../shared/protocol.js';
import { isBusy } from '../../shared/status.js';
import { machineIdFor, machinesHostLabel, parseMachinesHost, type MachinesTarget } from '../../shared/machines.js';
import { L } from '../i18n.js';
import { MachinesConfig } from './config.js';
import { MACHINE_MCP_PACKAGE } from './mcp.js';
import { MachinesHost, type Runner } from './ssh.js';
import { Tunnels, freePort, type Spawner } from './tunnels.js';

/** What the machines need of a floor: its id and its workers (a Floor is one). */
export interface MachineFloor {
  id: string;
  workers: {
    get(id: string): WorkerInfo | undefined;
    list(): WorkerInfo[];
    /** Starts it again on what its info says now; `restart` false only saves it and tells everyone. */
    relaunch(id: string, restart?: boolean): string | undefined;
    prompt(id: string, text: string, by?: string): string | undefined;
  };
}

export interface MachinesDeps {
  dataDir: string;
  officeName(): string;
  floors(): Iterable<MachineFloor>;
  floor(id: string): MachineFloor | undefined;
  toast(floor: MachineFloor, text: string, level?: 'info' | 'warn'): void;
  /** The setting changed: everyone hears what it is now. */
  changed(): void;
}

/** How long a `machine.want` waits for its worker to be hired. */
const WANT_MS = 60_000;
/** A worker whose machine isn't answering is looked at again this often. */
const RETRY_MS = 60_000;
/** After starting again with its machine, the first prompt waits until it's at rest at least this long in. */
const SETTLE_MS = 4_000;
const READY_GIVE_UP_MS = 30 * 60_000;

/** A change to wait for until the worker finishes what it's on. */
type Pending = { on: boolean; by: string } | { restart: true };

export class Machines {
  readonly config: MachinesConfig;
  readonly host: MachinesHost;
  readonly tunnels: Tunnels;
  /** Each worker's machine as last seen, by worker id: one sent home still has it here to delete. */
  private known = new Map<string, { floor: string; machine: WorkerMachine }>();
  /** Desks a worker is about to be hired at with a machine of its own, by `floor\ndesk`. */
  private wants = new Map<string, { prompt?: string; by: string; at: number }>();
  private pending = new Map<string, Pending>();
  /** Workers being given a machine right now. */
  private giving = new Set<string>();
  private retries = new Map<string, NodeJS.Timeout>();
  private timers = new Set<NodeJS.Timeout>();
  private warmed = false;
  private stopped = false;

  constructor(
    private deps: MachinesDeps,
    runner?: Runner,
    spawner?: Spawner,
  ) {
    this.config = new MachinesConfig(deps.dataDir, deps.officeName());
    this.host = new MachinesHost(deps.dataDir, runner);
    this.tunnels = new Tunnels(deps.dataDir, (wid, up) => this.reachable(wid, up), spawner);
  }

  // ---- The setting --------------------------------------------------------------------------------

  state(admin: boolean, guest: boolean): MachinesState {
    const s = this.config.settings;
    const on = !!this.config.target;
    return {
      on,
      members: s.members,
      may: on && (admin || (s.members && !guest)),
      ...(admin ? { admin: { ...s, publicKey: this.config.publicKey() } } : {}),
    };
  }

  /** Whether someone may give and take machines: an admin, or anyone but a guest when admins let members. */
  may(admin: boolean, guest: boolean): boolean {
    return admin || (this.config.settings.members && !guest);
  }

  /** How the host is: whether the office gets in, and how full it is. */
  async test(): Promise<{ ok: boolean; text: string }> {
    const t = this.config.target;
    if (!t) return { ok: false, text: L.machines.notSetUp };
    try {
      const version = await this.host.ping(t);
      const s = await this.host.status(t);
      const gb = s.memAvailable !== undefined ? Math.round((s.memAvailable / 1024 ** 3) * 10) / 10 : undefined;
      return { ok: true, text: L.machines.tested(version, s.machines, s.maxMachines, gb) };
    } catch (err) {
      return { ok: false, text: L.machines.testFailed((err as Error).message) };
    }
  }

  // ---- Giving and taking -------------------------------------------------------------------------

  /** Gives a worker a machine; `later`, while it's busy: once it finishes. Says what's wrong, if anything. */
  give(floor: MachineFloor, wid: string, by: string, later = false): string | undefined {
    const t = this.config.target;
    if (!t) return L.machines.notSetUp;
    const info = floor.workers.get(wid);
    if (!info) return L.srv.noSuchWorker;
    if (info.kind !== 'agent') return L.machines.agentsOnly;
    if (info.machine || this.giving.has(wid)) return undefined;
    const full = this.full(floor);
    if (full) return full;
    if (later && isBusy(info.status)) {
      this.pending.set(wid, { on: true, by });
      info.machineBusy = 'soon-give';
      floor.workers.relaunch(wid, false);
      this.deps.toast(floor, L.machines.soonGive(info.name));
      return undefined;
    }
    void this.doGive(floor, wid, by, t);
    return undefined;
  }

  /** Takes a worker's machine away (and deletes it); `later`, while it's busy: once it finishes. */
  take(floor: MachineFloor, wid: string, by: string, later = false): string | undefined {
    const info = floor.workers.get(wid);
    if (!info) return L.srv.noSuchWorker;
    if (this.pending.has(wid) && !info.machine) {
      // Not given yet: it just won't be.
      this.pending.delete(wid);
      delete info.machineBusy;
      floor.workers.relaunch(wid, false);
      return undefined;
    }
    if (!info.machine) return undefined;
    if (later && isBusy(info.status)) {
      this.pending.set(wid, { on: false, by });
      info.machineBusy = 'soon-take';
      floor.workers.relaunch(wid, false);
      this.deps.toast(floor, L.machines.soonTake(info.name));
      return undefined;
    }
    const m = info.machine;
    delete info.machine;
    delete info.machineBusy;
    delete info.machineDown;
    this.pending.delete(wid);
    this.forget(wid);
    // Starts again without its browser (or, asleep, just saves that).
    floor.workers.relaunch(wid);
    this.deps.toast(floor, L.machines.took(by, info.name));
    void this.deleteRemote(m, floor);
    return undefined;
  }

  /** The worker about to be hired at `deskId` gets a machine, and `prompt` once it has it (see 'machine.want'). */
  want(floor: MachineFloor, deskId: string, by: string, prompt?: string): string | undefined {
    if (!this.config.target) return L.machines.notSetUp;
    const full = this.full(floor);
    if (full) return full;
    this.wants.set(`${floor.id}\n${deskId}`, { prompt: prompt?.trim() || undefined, by, at: Date.now() });
    return undefined;
  }

  /** A worker changed (`w`) or was sent home (its id). */
  workerChanged(floor: MachineFloor, w: WorkerInfo | string) {
    if (typeof w === 'string') return this.gone(w);
    if (w.machine) this.known.set(w.id, { floor: floor.id, machine: { ...w.machine } });
    const key = `${floor.id}\n${w.deskId}`;
    const want = this.wants.get(key);
    if (want) {
      if (Date.now() - want.at > WANT_MS) this.wants.delete(key);
      else if (!w.machine && w.createdAt >= want.at - 2_000 && !this.giving.has(w.id)) {
        this.wants.delete(key);
        const t = this.config.target;
        // Not straight away: this is the manager telling everyone about the worker it's hiring.
        if (t) this.later(() => void this.doGive(floor, w.id, want.by, t, want.prompt));
      }
    }
    const pending = this.pending.get(w.id);
    if (pending && !isBusy(w.status)) {
      this.pending.delete(w.id);
      this.later(() => {
        if ('restart' in pending) floor.workers.relaunch(w.id);
        else if (pending.on) {
          const info = floor.workers.get(w.id);
          if (info) delete info.machineBusy;
          const err = this.give(floor, w.id, pending.by);
          if (err) {
            floor.workers.relaunch(w.id, false);
            this.deps.toast(floor, err, 'warn');
          }
        } else this.take(floor, w.id, pending.by);
      });
    }
  }

  /** A floor was taken off the building: its workers' machines go with it. */
  floorClosed(floor: MachineFloor) {
    for (const [wid, k] of [...this.known]) {
      if (k.floor !== floor.id) continue;
      this.forget(wid);
      void this.deleteRemote(k.machine);
    }
  }

  /** The office's port that reaches a machine's desktop, and the worker it's for: by worker id, or by machine id. */
  desktopOf(id: string): { workerId: string; floor: string; port: number; machineId: string } | undefined {
    const byWorker = this.known.get(id);
    if (byWorker) return { workerId: id, floor: byWorker.floor, port: byWorker.machine.desktopLocalPort, machineId: byWorker.machine.id };
    for (const [wid, k] of this.known) if (k.machine.id === id) return { workerId: wid, floor: k.floor, port: k.machine.desktopLocalPort, machineId: k.machine.id };
    return undefined;
  }

  // ---- Starting and stopping -----------------------------------------------------------------------

  /** As the office starts: the forwards to every machine still in use open again, and machines nobody has any more go. */
  async start() {
    const reopened: Promise<void>[] = [];
    for (const floor of this.deps.floors()) {
      for (const w of floor.workers.list()) {
        if (!w.machine) continue;
        this.known.set(w.id, { floor: floor.id, machine: { ...w.machine } });
        reopened.push(this.reopen(floor, w.id));
      }
    }
    await Promise.all(reopened);
    await this.sweep();
  }

  stop() {
    this.stopped = true;
    this.tunnels.closeAll();
    for (const t of this.retries.values()) clearTimeout(t);
    for (const t of this.timers) clearTimeout(t);
    this.retries.clear();
    this.timers.clear();
  }

  // ---------------------------------------------------------------------------------------------------

  private full(floor: MachineFloor): string | undefined {
    const max = this.config.settings.perFloor;
    const n = floor.workers.list().filter((w) => w.machine || this.giving.has(w.id) || w.machineBusy === 'soon-give').length;
    return n >= max ? L.machines.floorFull(max) : undefined;
  }

  private later(fn: () => void, ms = 0) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.stopped) fn();
    }, ms);
    this.timers.add(t);
  }

  private async doGive(floor: MachineFloor, wid: string, by: string, t: MachinesTarget, prompt?: string) {
    const info = floor.workers.get(wid);
    if (!info || this.giving.has(wid)) return;
    this.giving.add(wid);
    info.machineBusy = 'giving';
    floor.workers.relaunch(wid, false);
    const { mem, cpus } = this.config.settings;
    const id = machineIdFor(this.config.settings.office, floor.id, wid);
    try {
      const m = await this.host.create(t, id, mem, cpus);
      const desktop = await freePort();
      let cdp = await freePort();
      while (cdp === desktop) cdp = await freePort();
      const live = floor.workers.get(wid);
      // Sent home while its machine was being made: it goes too.
      if (!live || this.stopped) {
        if (!live) void this.deleteRemote({ host: machinesHostLabel(t), id, cdpLocalPort: cdp, desktopLocalPort: desktop });
        return;
      }
      live.machine = { host: machinesHostLabel(t), id, cdpLocalPort: cdp, desktopLocalPort: desktop };
      delete live.machineBusy;
      delete live.machineDown;
      this.known.set(wid, { floor: floor.id, machine: { ...live.machine } });
      this.tunnels.open(wid, t, [
        { local: desktop, remote: m.desktopPort },
        { local: cdp, remote: m.cdpPort },
      ]);
      this.warm();
      // Starts again with its browser, carrying on its conversation.
      floor.workers.relaunch(wid);
      this.deps.toast(floor, L.machines.gave(by, live.name));
    } catch (err) {
      const live = floor.workers.get(wid);
      if (live) {
        delete live.machineBusy;
        floor.workers.relaunch(wid, false);
        this.deps.toast(floor, L.machines.couldntGive(live.name, (err as Error).message), 'warn');
      }
    } finally {
      this.giving.delete(wid);
      if (prompt) this.promptWhenReady(floor, wid, prompt, by);
    }
  }

  /** The first prompt of a worker hired with a machine, once it's started again with it and is at rest. */
  private promptWhenReady(floor: MachineFloor, wid: string, prompt: string, by: string) {
    const since = Date.now();
    const look = () => {
      const w = floor.workers.get(wid);
      if (!w) return;
      const atRest = w.status === 'idle' || w.status === 'done';
      const waited = Date.now() - since;
      // Never typed into a screen that's asking something else (a trust or sign-in screen): only at rest.
      if (atRest && waited >= SETTLE_MS) {
        const err = floor.workers.prompt(wid, prompt, by);
        if (err) this.deps.toast(floor, err, 'warn');
        return;
      }
      if (waited >= READY_GIVE_UP_MS) return this.deps.toast(floor, L.machines.promptDropped(w.name), 'warn');
      this.later(look, 1_000);
    };
    this.later(look, 1_000);
  }

  /** The forwards to a worker's machine, after a restart: the machine's found (made again if it's gone), on the same ports when they're free. */
  private async reopen(floor: MachineFloor, wid: string) {
    const info = floor.workers.get(wid);
    const m = info?.machine;
    const t = m && parseMachinesHost(m.host);
    if (!info || !m || !t) return;
    try {
      const got = await this.host.create(t, m.id, this.config.settings.mem, this.config.settings.cpus);
      // Its old forward lets go of its ports first, so they're free to take again.
      this.tunnels.close(wid);
      const desktop = await freePort(m.desktopLocalPort);
      let cdp = await freePort(m.cdpLocalPort);
      while (cdp === desktop) cdp = await freePort();
      const live = floor.workers.get(wid);
      if (!live?.machine || this.stopped) return;
      const moved = desktop !== m.desktopLocalPort || cdp !== m.cdpLocalPort;
      live.machine = { ...live.machine, desktopLocalPort: desktop, cdpLocalPort: cdp };
      this.known.set(wid, { floor: floor.id, machine: { ...live.machine } });
      this.tunnels.open(wid, t, [
        { local: desktop, remote: got.desktopPort },
        { local: cdp, remote: got.cdpPort },
      ]);
      const wasDown = live.machineDown;
      delete live.machineDown;
      if (wasDown) this.deps.toast(floor, L.machines.back(live.name));
      // Its browser was on another port: it starts again on this one (once it's done, when it's busy).
      if (moved && isBusy(live.status)) this.pending.set(wid, { restart: true });
      floor.workers.relaunch(wid, moved && !isBusy(live.status));
    } catch (err) {
      const live = floor.workers.get(wid);
      if (!live?.machine || this.stopped) return;
      if (!live.machineDown) {
        live.machineDown = true;
        floor.workers.relaunch(wid, false);
        this.deps.toast(floor, L.machines.down(live.name, (err as Error).message), 'warn');
      }
      clearTimeout(this.retries.get(wid));
      const timer = setTimeout(() => {
        this.retries.delete(wid);
        if (!this.stopped) void this.reopen(floor, wid);
      }, RETRY_MS);
      timer.unref?.();
      this.retries.set(wid, timer);
    }
  }

  /** The machines on the host that no worker here has any more (sent home while the office was down, say) are deleted. */
  private async sweep() {
    const t = this.config.target;
    if (!t) return;
    try {
      const mine = new Set([...this.known.values()].map((k) => k.machine.id));
      for (const m of await this.host.list(t)) {
        if (mine.has(m.id) || [...this.giving].some((wid) => m.id.endsWith(wid))) continue;
        await this.host.delete(t, m.id).catch(() => undefined);
      }
    } catch {
      // the host's down: next time
    }
  }

  /** A machine's forwards stopped working, or work again. */
  private reachable(wid: string, up: boolean) {
    const k = this.known.get(wid);
    const floor = k && this.deps.floor(k.floor);
    const info = floor?.workers.get(wid);
    if (!floor || !info?.machine) return;
    // Dropping straight away: the machine's ports may have changed (its container started again), or
    // the host lost it. Ask the host again (which starts it, or makes it afresh) and forward anew.
    if (!up && !this.retries.has(wid)) {
      const timer = setTimeout(() => {
        this.retries.delete(wid);
        if (!this.stopped) void this.reopen(floor, wid);
      }, 5_000);
      timer.unref?.();
      this.retries.set(wid, timer);
    }
    if (!!info.machineDown === !up) return;
    if (up) delete info.machineDown;
    else info.machineDown = true;
    floor.workers.relaunch(wid, false);
    this.deps.toast(floor, up ? L.machines.back(info.name) : L.machines.down(info.name, L.machines.noForward), up ? 'info' : 'warn');
  }

  private gone(wid: string) {
    this.pending.delete(wid);
    const k = this.known.get(wid);
    if (!k) return;
    this.forget(wid);
    void this.deleteRemote(k.machine, this.deps.floor(k.floor));
  }

  private forget(wid: string) {
    this.known.delete(wid);
    this.tunnels.close(wid);
    clearTimeout(this.retries.get(wid));
    this.retries.delete(wid);
  }

  private async deleteRemote(m: WorkerMachine, floor?: MachineFloor) {
    const t = parseMachinesHost(m.host);
    if (!t) return;
    try {
      await this.host.delete(t, m.id);
    } catch (err) {
      console.error(`agent-office: ${L.machines.couldntDelete(m.id, (err as Error).message)}`);
      if (floor) this.deps.toast(floor, L.machines.couldntDelete(m.id, (err as Error).message), 'warn');
    }
  }

  /** Fetches the browser's MCP server once, so a worker's first start with it doesn't wait on the download. */
  private warm() {
    if (this.warmed) return;
    this.warmed = true;
    try {
      const p = spawn('npx', ['-y', MACHINE_MCP_PACKAGE, '--version'], { stdio: 'ignore', windowsHide: true, shell: process.platform === 'win32' });
      p.on('error', () => undefined);
      p.unref();
    } catch {
      // it'll be fetched when the worker starts
    }
  }
}
