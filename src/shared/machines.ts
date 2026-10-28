// Agent machines (see server/machines/): what the office and the page both check about them. A
// machines host is a Linux server that gives each worker that has one a desktop computer of its own
// (see deploy/machines/). Pure code, no Node: the page uses it too.

/** A machine's id on its host, and the office's name there: what `ce-machines` takes. */
export const MACHINE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** The longest a machine id or office name may be. */
export const MACHINE_ID_MAX = 40;

/** The machines host's SSH port, unless its address says otherwise. */
export const MACHINES_SSH_PORT = 22;

/** How much memory a machine gets: a number and m or g, as `docker --memory` takes it ("4g"). A desktop with Chrome needs about 4 GB. */
export const MACHINE_MEM_RE = /^[1-9][0-9]{0,5}[mg]$/;
export const MACHINE_MEM_DEFAULT = '4g';
export const MACHINE_CPUS_DEFAULT = 4;
/** What the host lets a machine have: 1 to 4 CPUs (and 512m to 8g of memory). */
export const MACHINE_CPUS_MIN = 1;
export const MACHINE_CPUS_MAX = 4;
/** How many machines a floor may have at once, unless an admin says otherwise. */
export const MACHINES_PER_FLOOR_DEFAULT = 4;
export const MACHINES_PER_FLOOR_MAX = 100;

/**
 * `s` as a slug for the host: lower-case letters, digits and single dashes, cut to `max`, never
 * starting or ending with a dash. Empty when nothing of it is left.
 */
export function slug(s: string, max = MACHINE_ID_MAX): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

export const isMachineId = (v: unknown): v is string => typeof v === 'string' && MACHINE_ID_RE.test(v);

/**
 * The machine id for a worker. Ids are the whole host's, shared by every office on it, so it starts
 * with the office's name there; then its floor's slug and its own id, which is unique across the
 * building. The worker's id is kept whole; the office's and the floor's parts are cut to make room.
 */
export function machineIdFor(office: string, floorId: string, workerId: string): string {
  const own = slug(workerId) || 'worker';
  const room = MACHINE_ID_MAX - own.length - 1;
  const prefix = room > 0 ? slug(`${slug(office, 16)}-${floorId}`, room) : '';
  const id = prefix ? `${prefix}-${own}` : own.slice(0, MACHINE_ID_MAX);
  return MACHINE_ID_RE.test(id) ? id : `m-${own}`.slice(0, MACHINE_ID_MAX);
}

/** Where the machines host is: the user, the host and the port the office signs in to it with. */
export interface MachinesTarget {
  user: string;
  host: string;
  port: number;
}

const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*|\[[0-9A-Fa-f:.]+\])$/;
const USER_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/;

/**
 * The host as someone typed it, `user@host[:port]` (the user is root when left out; an IPv6 address
 * goes in brackets), or undefined when it isn't one. Nothing in it can start with a dash, so it's
 * never taken for one of ssh's options.
 */
export function parseMachinesHost(raw: unknown): MachinesTarget | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s || s.length > 300) return undefined;
  const at = s.lastIndexOf('@');
  const user = at >= 0 ? s.slice(0, at) : 'root';
  let rest = at >= 0 ? s.slice(at + 1) : s;
  let port = MACHINES_SSH_PORT;
  const m = /^(.*?):([0-9]{1,5})$/.exec(rest);
  if (m && !(rest.startsWith('[') && !rest.includes(']:'))) {
    rest = m[1];
    port = Number(m[2]);
  }
  if (!USER_RE.test(user) || !HOST_RE.test(rest) || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { user, host: rest, port };
}

/** `user@host` or `user@host:port`, as parseMachinesHost reads it back. */
export const machinesHostLabel = (t: MachinesTarget): string => `${t.user}@${t.host}${t.port === MACHINES_SSH_PORT ? '' : `:${t.port}`}`;

/** The line an admin runs on the host to let this office in with its key. */
export const authorizeLine = (publicKey: string, office: string): string => `ce-machines authorize "${publicKey.replace(/["\\$`]/g, '')}" ${office}`;

/** Where the office shows a worker's machine's desktop: its own reverse proxy (see server/machines/proxy.ts). */
export const desktopPath = (workerId: string): string => `/api/machines/${encodeURIComponent(workerId)}/desktop/`;
