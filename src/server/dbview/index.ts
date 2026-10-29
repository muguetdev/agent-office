// The 🗄️ Database tab (client: ui/machines/db.ts): reads the databases inside a worker's own machine
// by running agent-py.ts there as root, through the machines host (see machines/shell.ts). Only
// reading: SQL runs in a read-only transaction (SQLite opens the file read-only), MySQL takes only
// SELECT, SHOW, DESCRIBE and EXPLAIN, MongoDB a find filter and Redis a key pattern.
import type { WorkerInfo } from '../../shared/protocol.js';
import { parseMachinesHost } from '../../shared/machines.js';
import { DB_PAGE_MAX, isDbEngine, type DbRequest } from '../../shared/dbview.js';
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
  if (b.op === 'tables') return { op: 'tables', engine: b.engine, db };
  const limit = whole(b.limit, 1, DB_PAGE_MAX, 50);
  const table = text(b.table, 1024);
  const q = text(b.text, 20_000);
  if (b.op === 'rows') {
    if (!table) return 'which table?';
    return { op: 'rows', engine: b.engine, db, table, offset: whole(b.offset, 0, 1e9, 0), limit, ...(q ? { text: q } : {}) };
  }
  if (b.op === 'query') {
    if (!q?.trim()) return 'write a query';
    return { op: 'query', engine: b.engine, db, text: q, limit, ...(table ? { table } : {}) };
  }
  return 'what to do?';
}

/** The command line that runs the script with `req` (both as base64, so bash reads neither). */
export function dbCommand(req: DbRequest): string {
  const script = Buffer.from(DBVIEW_PY, 'utf8').toString('base64');
  const arg = Buffer.from(JSON.stringify(req), 'utf8').toString('base64');
  return `python3 -c "$(printf %s '${script}' | base64 -d)" '${arg}'`;
}

/** Runs `req` in `w`'s machine: the script's answer, or `{ error }`. */
export async function readDb(shell: Pick<MachineShell, 'exec'>, w: WorkerInfo, req: DbRequest): Promise<unknown> {
  const m = w.machine;
  const t = m && parseMachinesHost(m.host);
  if (!m || !t) return { error: 'no machine' };
  const r = await shell.exec(t, m.id, dbCommand(req), { root: true, timeout: TIMEOUT });
  const last = r.stdout.trim().split('\n').pop() ?? '';
  try {
    return JSON.parse(last);
  } catch {
    if (r.truncated) return { error: 'too much came back: show fewer rows' };
    if (r.timedOut) return { error: 'it took too long' };
    return { error: (r.stderr.trim().split('\n').pop() || `exited with ${r.exitCode}`).slice(0, 500) };
  }
}
