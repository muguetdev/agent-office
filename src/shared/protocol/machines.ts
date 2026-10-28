// Agent machines: a desktop computer of its own for a worker, on a machines host an admin set up (see
// server/machines/ and shared/machines.ts), with its desktop on the 🖥️ Screen tab and its Chrome
// driven by the worker through an MCP server.

/** A worker's own machine: where it is, and the office's ports that reach it (127.0.0.1 only). */
export interface WorkerMachine {
  /** The host it's on, `user@host[:port]`. */
  host: string;
  /** Its id there. */
  id: string;
  /** Its Chrome's DevTools, forwarded to the office's machine. */
  cdpLocalPort: number;
  /** Its desktop's web page, forwarded to the office's machine (the office proxies it, see desktopPath). */
  desktopLocalPort: number;
}

/** What's happening to a worker's machine, while something is. */
export type MachineBusy = 'giving' | 'taking' | 'soon-give' | 'soon-take';

declare module './workers.js' {
  interface WorkerInfo {
    /** Its own computer (see WorkerMachine). Kept in workers.json. */
    machine?: WorkerMachine;
    /** Being given or taken away now, or once it finishes what it's on. */
    machineBusy?: MachineBusy;
    /** Its machine isn't answering: it works on without it until it does. */
    machineDown?: boolean;
  }
}

/** The machines host as the office has it set up. */
export interface MachinesState {
  /** A host is set up: workers can be given machines. */
  on: boolean;
  /** Members (not guests) may give a worker on their floor a machine, not only admins. */
  members: boolean;
  /** You may give and take machines (an admin, or a member when `members`). */
  may: boolean;
  /** Admins only: the setting itself. */
  admin?: MachinesSettings & {
    /** The office's public key, for the host's `ce-machines authorize`. */
    publicKey?: string;
  };
}

export interface MachinesSettings {
  /** `user@host[:port]`; empty when none is set up. */
  host: string;
  /** What the host calls this office (a slug). */
  office: string;
  /** Each machine's memory ("4g") and CPUs. */
  mem: string;
  cpus: number;
  /** The most machines one floor may have at once. */
  perFloor: number;
  members: boolean;
}

export type MachinesClientMsg =
  /** What the machines setting is; answered with `machines`. */
  | { t: 'machines.get' }
  /** Admins: sets the host up (or changes it). */
  | ({ t: 'machines.set' } & MachinesSettings)
  /** Admins: no machines host any more (the workers that have machines keep them until they're sent home). */
  | { t: 'machines.remove' }
  /** Admins: asks the host how it is; answered with `machines.tested`. */
  | { t: 'machines.test' }
  /** Gives a worker its own machine (`on`), or takes it away; `later`: once it finishes what it's on. */
  | { t: 'machine.give'; workerId: string; on: boolean; later?: boolean }
  /**
   * The worker about to be hired at `deskId` gets a machine of its own, and `prompt` waits for it:
   * sent just ahead of the `worker.spawn` (without its prompt) that hires it.
   */
  | { t: 'machine.want'; deskId: string; prompt?: string };

export type MachinesServerMsg =
  | { t: 'machines'; state: MachinesState }
  | { t: 'machines.tested'; ok: boolean; text: string };
