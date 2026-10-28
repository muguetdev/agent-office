import type { MachinesState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The machines host as the office has it set up (see server/machines/); null until the office says. */
    machines: MachinesState | null;
    /** What the host said when an admin last pressed Test (see 'machines.test'). */
    machinesTested: { ok: boolean; text: string } | null;
  }
  interface Topics {
    machines: true;
  }
}

export const machines: Slice = {
  init(s) {
    s.machines = null;
    s.machinesTested = null;
  },
  on: {
    machines(s, m) {
      s.machines = m.state;
      return ['machines'];
    },
    'machines.tested'(s, m) {
      s.machinesTested = { ok: m.ok, text: m.text };
      return ['machines'];
    },
  },
};
