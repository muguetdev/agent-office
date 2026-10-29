// The 🗄️ Database tab of a worker with a machine of its own, or on a server's floor: what the page asks
// the office for (POST /api/dbview, see server/dbview/) and what comes back. Everything is read-only.

export const DB_ENGINES = ['postgres', 'mysql', 'mongo', 'redis', 'sqlite'] as const;
export type DbEngine = (typeof DB_ENGINES)[number];

export const isDbEngine = (v: unknown): v is DbEngine => typeof v === 'string' && (DB_ENGINES as readonly string[]).includes(v);

/** How each engine is shown, and what its query box takes. */
export const DB_ENGINE_META: Record<DbEngine, { label: string; icon: string; query: 'sql' | 'filter' | 'pattern' }> = {
  postgres: { label: 'PostgreSQL', icon: '🐘', query: 'sql' },
  mysql: { label: 'MySQL / MariaDB', icon: '🐬', query: 'sql' },
  mongo: { label: 'MongoDB', icon: '🍃', query: 'filter' },
  redis: { label: 'Redis', icon: '🟥', query: 'pattern' },
  sqlite: { label: 'SQLite', icon: '🪶', query: 'sql' },
};

/** The most rows a page or a query brings back. */
export const DB_PAGE_MAX = 200;

/** Where the databases are read: the worker's own machine, or its floor's server. */
export const DB_SOURCES = ['machine', 'server'] as const;
export type DbSource = (typeof DB_SOURCES)[number];
export const isDbSource = (v: unknown): v is DbSource => typeof v === 'string' && (DB_SOURCES as readonly string[]).includes(v);

/** A Docker container's name, as Docker has it. */
export const CONTAINER_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** A database URL's id: the URL itself never leaves the machine it was found on. */
export const LINK_RE = /^[0-9a-f]{12}$/;

/** Which one of an engine's: in that Docker container, or reached by that URL an app uses (both as the scan found them); else the one installed there. */
export interface DbVia {
  container?: string;
  link?: string;
}

export type DbRequest =
  | { op: 'scan' }
  | ({ op: 'tables'; engine: DbEngine; db: string } & DbVia)
  | ({ op: 'rows'; engine: DbEngine; db: string; table: string; offset: number; limit: number; text?: string } & DbVia)
  | ({ op: 'query'; engine: DbEngine; db: string; table?: string; text: string; limit: number } & DbVia);

/**
 * An engine found: its databases (SQLite: its files), or why it couldn't be read. For one reached by
 * an app's URL, `label` is that URL without its password (user@host:port/db) and `where` where it was
 * found (a .env file, or `pm2 <app>`).
 */
export interface DbFound extends DbVia {
  engine: DbEngine;
  dbs: string[];
  label?: string;
  where?: string;
  error?: string;
  code?: string;
}

/** A table, view or collection; `rows` is a count or an estimate, when there is one. kind: r table, v view, m materialized view, c collection, k Redis keys. */
export interface DbTable {
  name: string;
  kind: string;
  rows?: number | null;
}

/** Rows as a grid: values are as they came, long ones cut short (…). `total` counts up to 100 000 (100 001: more). */
export interface DbRows {
  columns: string[];
  rows: unknown[][];
  total?: number | null;
  more?: boolean;
}

/** `code`: one of the script's own refusals (see the tab's errors in the dictionaries), which the page says in your language. */
export type DbAnswer<T> = T | { error: string; code?: string };
