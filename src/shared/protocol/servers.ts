// Floors that are servers: adding one, its SSH key, trying the way in, the repository it runs, and how
// it's doing (see server/servers.ts and server/server-watch.ts).

/** A Docker container on the server. */
export interface ServerContainer {
  name: string;
  image: string;
  /** Docker's: running, exited, restarting… */
  state: string;
  /** "Up 3 hours", "Exited (1) 2 minutes ago". */
  status: string;
}

/** A service of systemd's on the server: the failed ones, and the running ones that aren't the system's own. */
export interface ServerService {
  name: string;
  state: 'running' | 'failed';
  status: string;
}

/** A container or a service, to restart. */
export interface ServerUnit {
  kind: 'container' | 'service';
  name: string;
}

/** How the server's doing, as last read over SSH. */
export interface ServerState {
  /** When it was read (the office's clock). */
  at: number;
  /** It answered; when it didn't, `error` says why, and the rest is the last answer. */
  ok: boolean;
  error?: string;
  host?: string;
  /** The load averages over 1, 5 and 15 minutes, and its CPUs. */
  load: [number, number, number];
  cpus: number;
  /** Bytes. */
  memTotal: number;
  memUsed: number;
  diskTotal: number;
  diskUsed: number;
  /** Seconds since it booted. */
  uptime: number;
  containers: ServerContainer[];
  services: ServerService[];
  /** The last few readings, oldest first: [load as % of its CPUs, memory %]. */
  history: [number, number][];
}

/** Admins only. */
export type ServersClientMsg =
  /** A new floor for a server: the office makes it a key, and answers with `server.added`. */
  | { t: 'server.add'; name: string; host: string; user: string; port?: number }
  /** A server floor's public key again, for its authorized_keys. */
  | { t: 'server.key'; floor: string }
  /** Tries the way in with the floor's key; the answer is `server.tested`. */
  | { t: 'server.test'; floor: string }
  /** The GitHub repository the server runs (owner/name), for the floor's issues and PR boards; empty for none. */
  | { t: 'server.repo'; floor: string; repo: string }
  /** Restarts a container or a service the server was last seen running. */
  | ({ t: 'server.restart'; floor: string } & ServerUnit);

export type ServersServerMsg =
  | { t: 'server.added'; floor?: string; publicKey?: string; error?: string }
  | { t: 'server.key'; floor: string; publicKey?: string }
  | { t: 'server.tested'; floor: string; ok: boolean; output: string }
  /** To everyone on the floor, whenever the server's looked at. */
  | { t: 'server.state'; state: ServerState };
