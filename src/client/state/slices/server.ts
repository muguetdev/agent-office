import type { ServerState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** On a server's floor, how its server's doing (see server/server-watch.ts); null elsewhere, or before the first look. */
    server: ServerState | null;
  }
  interface Topics {
    server: true;
  }
}

export const server: Slice = {
  init(s) {
    s.server = null;
  },
  on: {
    'server.state'(s, m) {
      s.server = m.state;
      return ['server'];
    },
  },
  enter(s, v) {
    s.server = v.server;
    return ['server'];
  },
};
