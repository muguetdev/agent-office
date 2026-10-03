// Floors that are servers: adding one, its SSH key, and trying the way in (see server/servers.ts).

/** Admins only. */
export type ServersClientMsg =
  /** A new floor for a server: the office makes it a key, and answers with `server.added`. */
  | { t: 'server.add'; name: string; host: string; user: string; port?: number }
  /** A server floor's public key again, for its authorized_keys. */
  | { t: 'server.key'; floor: string }
  /** Tries the way in with the floor's key; the answer is `server.tested`. */
  | { t: 'server.test'; floor: string };

export type ServersServerMsg =
  | { t: 'server.added'; floor?: string; publicKey?: string; error?: string }
  | { t: 'server.key'; floor: string; publicKey?: string }
  | { t: 'server.tested'; floor: string; ok: boolean; output: string };
