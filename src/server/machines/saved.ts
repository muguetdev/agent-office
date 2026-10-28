// A worker's machine as workers.json keeps it (see workers/persist.ts), checked on the way back in.
import { isMachineId, parseMachinesHost } from '../../shared/machines.js';
import type { WorkerMachine } from '../../shared/protocol.js';

const isPort = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 65536;

/** The machine saved for a worker, or undefined when there's none or it isn't one. */
export function validMachine(v: unknown): WorkerMachine | undefined {
  const m = v as Partial<WorkerMachine> | null | undefined;
  if (!m || typeof m !== 'object' || typeof m.host !== 'string' || !parseMachinesHost(m.host) || !isMachineId(m.id)) return undefined;
  if (!isPort(m.cdpLocalPort) || !isPort(m.desktopLocalPort)) return undefined;
  return { host: m.host, id: m.id, cdpLocalPort: m.cdpLocalPort, desktopLocalPort: m.desktopLocalPort };
}
