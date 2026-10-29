// The 🗄️ Database tab of a worker with a machine of its own: what the page asks the office for
// (POST /api/dbview, see server/dbview/) and what comes back. Everything is read-only.

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

export type DbRequest =
  | { op: 'scan' }
  | { op: 'tables'; engine: DbEngine; db: string }
  | { op: 'rows'; engine: DbEngine; db: string; table: string; offset: number; limit: number; text?: string }
  | { op: 'query'; engine: DbEngine; db: string; table?: string; text: string; limit: number };

/** An engine found in the machine: its databases (SQLite: its files), or why it couldn't be read. */
export interface DbFound {
  engine: DbEngine;
  dbs: string[];
  error?: string;
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
