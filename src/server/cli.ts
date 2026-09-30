import os from 'node:os';
import path from 'node:path';
import { loadConfig, ensureSelfSigned } from './config.js';
import { startServer } from './server.js';
import { tildify } from './building.js';
import { L } from './i18n.js';

const argv = process.argv.slice(2);
if (argv[0] === 'prune') {
  const { prune } = await import('./prune.js');
  process.exit(await prune(argv.slice(1)));
}
if (argv[0] === 'accounts') {
  const { accountsCommand } = await import('./accounts.js');
  process.exit(accountsCommand(argv.slice(1)));
}
if (argv[0] === 'setup') {
  const { setupCommand } = await import('./setup.js');
  process.exit(await setupCommand(argv.slice(1)));
}

const cfg = loadConfig(argv);
await ensureSelfSigned(cfg);
// A new office started in a terminal: where projects go, GitHub, and the first floor, before it opens.
if (!cfg.project) {
  const { interactive, welcome } = await import('./setup.js');
  if (interactive()) await welcome(cfg);
}

let office: Awaited<ReturnType<typeof startServer>>;
try {
  office = await startServer(cfg);
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') console.error(`agent-office: ${L.cli.portInUse(cfg.port)}`);
  else console.error(`agent-office: ${e.message}`);
  process.exit(1);
}

const scheme = cfg.tls ? 'https' : 'http';
const urls = new Set<string>([`${scheme}://localhost:${cfg.port}`]);
if (cfg.host === '0.0.0.0' || cfg.host === '::') {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) urls.add(`${scheme}://${ni.address}:${cfg.port}`);
  }
} else urls.add(`${scheme}://${cfg.host}:${cfg.port}`);

const agent = office.resolvedAgent;
function floorsLine() {
  const floors = office.floors();
  const where = L.cli.clonedInto(tildify(office.projectsDir()));
  if (!floors.length) return L.cli.noFloors(where);
  return L.cli.floors(floors.map((f) => f.def.name), where);
}

function passwordLine() {
  if (!office.accounts.sharedPassword) return L.cli.passwordOff;
  if (!cfg.passwordGenerated) return L.cli.passwordGiven;
  if (cfg.claimToken && !cfg.claimed) return L.cli.passwordClaim;
  if (cfg.claimed || !cfg.password) return L.cli.passwordClaimed;
  return cfg.password;
}
// Started in a project that's still one of the floors (it can be taken off like any other).
const local = cfg.project && office.floors().some((f) => path.resolve(f.def.dir) === cfg.project);
console.log(`
  🏢  ${L.cli.open(local ? cfg.project : undefined)}

  ${floorsLine()}

  ${[...urls].join('\n  ')}

  ${L.cli.password}: ${passwordLine()}
  ${L.cli.defaultAgent}: ${[agent ?? L.cli.viaLoginShell(cfg.agentCmd), ...cfg.agentArgs].join(' ')}
  ${L.cli.chooseProvider}
${cfg.tls ? '' : `\n  ${L.cli.tip}\n`}`);

let closing = false;
// SIGTERM is a restart (tsx watch reloading, a plain `kill`, systemd): workers keep running in their
// terminal host and the next office picks them back up. Ctrl+C closes the office and stops them.
// (Under systemd that needs KillMode=process, or stopping the service stops the host with it; see
// deploy/provision.sh. Workers cut off that way are resumed and carry on.)
const stop = (signal: NodeJS.Signals) => {
  if (closing) process.exit(1);
  closing = true;
  const keep = signal === 'SIGTERM';
  console.log(`\n  ${keep ? L.cli.closingKeep : L.cli.closing}`);
  office.shutdown(keep);
  setTimeout(() => process.exit(0), 300);
};
// Last line of defense: one bad request must never take down every running worker.
process.on('unhandledRejection', (err) => console.error('agent-office: unhandled rejection', err));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
