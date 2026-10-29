// What was written with the 🗄️ Database tab (see index.ts): a line per write in the floor's
// .agent-office/dbview-writes.log (JSON), who, when, where and what, and how it went.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DbRequest } from '../../shared/dbview.js';

export interface DbWrite {
  by: string;
  source: string;
  req: Extract<DbRequest, { op: 'write' }>;
  error?: string;
}

/** Where a write went, for people: the engine, its container or connection, and the database. */
export function writeTarget(w: Pick<DbWrite, 'source' | 'req'>): string {
  const via = w.req.container ? ` (🐳 ${w.req.container})` : w.req.link ? ' (🔗)' : '';
  return `${w.req.engine}${via} › ${w.req.db}`;
}

export function logWrite(dataDir: string, w: DbWrite, at = new Date()) {
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const line = { at: at.toISOString(), by: w.by, source: w.source, engine: w.req.engine, db: w.req.db, ...(w.req.container ? { container: w.req.container } : {}), ...(w.req.link ? { link: w.req.link } : {}), text: w.req.text, ok: !w.error, ...(w.error ? { error: w.error } : {}) };
    appendFileSync(path.join(dataDir, 'dbview-writes.log'), `${JSON.stringify(line)}\n`, { mode: 0o600 });
  } catch (err) {
    console.error(`agent-office: dbview: couldn't log a write: ${(err as Error).message}`);
  }
}
