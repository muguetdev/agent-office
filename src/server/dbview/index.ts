// The 🗄️ Database tab (client: ui/machines/db.ts): reads the databases inside a worker's own machine,
// by running agent-py.ts there as root through the machines host (see machines/shell.ts), or on its
// server's floor's server, over the floor's SSH (as root, or with sudo when it may). Only reading: SQL
// runs in a read-only transaction (SQLite opens the file read-only), MySQL takes only SELECT, SHOW,
// DESCRIBE and EXPLAIN, MongoDB a find filter and Redis a key pattern.
import type { WorkerInfo } from '../../shared/protocol.js';
import { parseMachinesHost } from '../../shared/machines.js';
import { CONTAINER_RE, DB_PAGE_MAX, LINK_RE, isDbEngine, type DbRequest } from '../../shared/dbview.js';
import type { MachineShell } from '../machines/shell.js';
import { DBVIEW_PY } from './agent-py.js';

/** How long one read may take in the machine (seconds); the script's own clients stop sooner. */
const TIMEOUT = 60;

const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max && !v.includes('\0') ? v : undefined);
const whole = (v: unknown, min: number, max: number, dflt: number) => (typeof v === 'number' && Number.isInteger(v) ? Math.max(min, Math.min(max, v)) : dflt);

/** What the page asked for, checked, or what's wrong with it. */
export function dbRequest(body: unknown): DbRequest | string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (b.op === 'scan') return { op: 'scan' };
  if (!isDbEngine(b.engine)) return 'which database engine?';
  const db = text(b.db, 4096);
  if (!db) return 'which database?';
  if (b.container !== undefined && !(typeof b.container === 'string' && CONTAINER_RE.test(b.container))) return 'which container?';
  if (b.link !== undefined && !(typeof b.link === 'string' && LINK_RE.test(b.link))) return 'which connection?';
  if (b.container && b.link) return 'a container or a connection, not both';
  const container = { ...(b.container ? { container: b.container as string } : {}), ...(b.link ? { link: b.link as string } : {}) };
  if (b.op === 'tables') return { op: 'tables', engine: b.engine, db, ...container };
  const limit = whole(b.limit, 1, DB_PAGE_MAX, 50);
  const table = text(b.table, 1024);
  const q = text(b.text, 20_000);
  if (b.op === 'rows') {
    if (!table) return 'which table?';
    return { op: 'rows', engine: b.engine, db, table, offset: whole(b.offset, 0, 1e9, 0), limit, ...(q ? { text: q } : {}), ...container };
  }
  if (b.op === 'query') {
    if (!q?.trim()) return 'write a query';
    return { op: 'query', engine: b.engine, db, text: q, limit, ...(table ? { table } : {}), ...container };
  }
  return 'what to do?';
}

/**
 * The command line that runs the script with `req` (both as base64, so the shell reads neither).
 * `sudo`: as root by sudo when it isn't root and may (a server's floor's user), to reach the
 * databases' own users and Docker.
 */
export function dbCommand(req: DbRequest, sudo = false): string {
  const script = Buffer.from(DBVIEW_PY, 'utf8').toString('base64');
  const arg = Buffer.from(JSON.stringify(req), 'utf8').toString('base64');
  const run = `python3 -c "$(printf %s '${script}' | base64 -d)" '${arg}'`;
  return sudo ? `S=; if [ "$(id -u)" != 0 ] && sudo -n true 2>/dev/null; then S='sudo -n'; fi; $S ${run}` : run;
}

/** What the script printed last, as JSON, or why there's none. */
function answer(stdout: string, why: () => string): unknown {
  const last = stdout.trim().split('\n').pop() ?? '';
  try {
    return JSON.parse(last);
  } catch {
    return { error: why() };
  }
}

/** Runs `req` on a server's floor's server (`run`: the floor's ssh with a script on its stdin). */
export async function readServerDb(run: (script: string, timeout: number) => Promise<string>, req: DbRequest): Promise<unknown> {
  return answer(await run(dbCommand(req, true), (TIMEOUT + 15) * 1000), () => 'the server answered with no result (is python3 there?)');
}

/** Runs `req` in `w`'s machine: the script's answer, or `{ error }`. */
export async function readDb(shell: Pick<MachineShell, 'exec'>, w: WorkerInfo, req: DbRequest): Promise<unknown> {
  const m = w.machine;
  const t = m && parseMachinesHost(m.host);
  if (!m || !t) return { error: 'no machine' };
  const r = await shell.exec(t, m.id, dbCommand(req), { root: true, timeout: TIMEOUT });
  return answer(r.stdout, () => {
    if (r.truncated) return 'too much came back: show fewer rows';
    if (r.timedOut) return 'it took too long';
    return (r.stderr.trim().split('\n').pop() || `exited with ${r.exitCode}`).slice(0, 500);
  });
}
