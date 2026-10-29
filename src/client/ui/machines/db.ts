// The 🗄️ Database tab beside a worker's terminal (see termtabs.ts), for a worker with a machine of its
// own: the databases running in that machine (PostgreSQL, MySQL or MariaDB, MongoDB, Redis) and the
// SQLite files in its folders, read through the office (POST /api/dbview, see server/dbview/). On
// the left, each engine's databases and their tables; on the right, a table's rows a page at a time,
// and a box for a query of your own. All of it read-only.
import './db.css';
import { DB_ENGINE_META, type DbEngine, type DbFound, type DbRequest, type DbRows, type DbTable } from '../../../shared/dbview';
import { h } from '../dom';
import { store } from '../../state';
import { L } from '../../i18n';

const PAGE = 50;

/** Like the 🖥️ Screen tab (screen.ts), whose changes termtabs.ts follows for both. */
export interface DbTab {
  el: HTMLElement;
  shows(): boolean;
  show(on: boolean): void;
}

/** Where you are: an engine's database, and a table in it (or a query of your own). */
interface Place {
  engine: DbEngine;
  db: string;
  table?: string;
  offset: number;
}

async function ask<T>(workerId: string, req: DbRequest): Promise<T> {
  const r = await fetch(`/api/dbview?floor=${encodeURIComponent(store.floor ?? '')}&worker=${encodeURIComponent(workerId)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  let body: unknown;
  try {
    body = await r.json();
  } catch {
    throw new Error(`HTTP ${r.status}`);
  }
  if (body && typeof body === 'object' && 'error' in body) {
    const { error, code } = body as { error: unknown; code?: unknown };
    // The script's own refusals, in your language; the databases' own errors as they said them.
    const said = typeof code === 'string' && Object.hasOwn(L.dbview.errors, code) ? L.dbview.errors[code as keyof typeof L.dbview.errors] : undefined;
    throw new Error(said ?? String(error));
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return body as T;
}

/** A value as the grid shows it: null greyed out, the rest as text. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function dbTab(workerId: string): DbTab {
  const rescan = h('button.btn', { type: 'button', title: L.dbview.rescanTip }, L.dbview.rescan);
  const side = h('nav.db-side', { 'aria-label': L.dbview.title });
  const where = h('div.db-where');
  const prev = h('button.btn.db-page', { type: 'button', 'aria-label': L.dbview.prev }, '◀');
  const next = h('button.btn.db-page', { type: 'button', 'aria-label': L.dbview.next }, '▶');
  const count = h('span.db-count');
  const query = h('textarea.db-query', { rows: '2', spellcheck: 'false', autocomplete: 'off' }) as HTMLTextAreaElement;
  const run = h('button.btn.primary', { type: 'button', title: L.dbview.runTip }, L.dbview.run);
  const hint = h('div.db-hint');
  const grid = h('div.db-grid');
  const detail = h('pre.db-detail.hidden');
  const main = h(
    'section.db-main',
    {},
    h('div.db-head', {}, where, h('span.grow'), count, prev, next),
    h('div.db-ask', {}, query, run),
    hint,
    grid,
    detail,
  );
  const el = h('div.db-pane.hidden', {}, h('div.machine-bar', {}, h('span.machine-note', {}, L.dbview.title), h('span.db-ro', {}, L.dbview.readOnly), h('span.grow'), rescan), h('div.db-body', {}, side, main));

  let found: DbFound[] | undefined;
  let scanning = false;
  const tables = new Map<string, DbTable[] | string>();
  const open = new Set<string>();
  let place: Place | undefined;
  /** Bumped by each read, so an answer that comes after a newer question is dropped. */
  let asked = 0;

  const key = (engine: DbEngine, db: string) => `${engine}\u0000${db}`;
  const say = (text: string, cls = 'db-empty') => grid.replaceChildren(h(`div.${cls}`, {}, text));

  /** A database's tables in the side list, or why there are none to show. */
  const tableItems = (engine: DbEngine, db: string, list: DbTable[] | string | undefined): HTMLElement[] => {
    if (list === undefined) return [h('div.db-empty', {}, L.dbview.loading)];
    if (typeof list === 'string') return [h('div.db-error', {}, list)];
    if (!list.length) return [h('div.db-empty', {}, L.dbview.noTables)];
    return list.map((t) =>
      h(
        'button.db-item.db-table',
        { type: 'button', class: place?.engine === engine && place.db === db && place.table === t.name ? 'on' : '', onclick: () => pick(engine, db, t.name) },
        h('span.db-tname', {}, `${t.kind === 'v' || t.kind === 'm' ? '👁 ' : ''}${t.name}`),
        t.rows === null || t.rows === undefined ? null : h('span.db-tcount', {}, t.rows.toLocaleString()),
      ),
    );
  };

  const paintSide = () => {
    if (!found) return void side.replaceChildren(h('div.db-empty', {}, scanning ? L.dbview.scanning : ''));
    if (!found.length) return void side.replaceChildren(h('div.db-empty', {}, L.dbview.none));
    side.replaceChildren(
      ...found.map((f) => {
        const meta = DB_ENGINE_META[f.engine];
        return h(
          'div.db-engine',
          {},
          h('div.db-engine-name', {}, `${meta.icon} ${meta.label}`),
          f.error ? h('div.db-error', {}, f.error) : null,
          ...f.dbs.map((db) => {
            const k = key(f.engine, db);
            const isOpen = open.has(k);
            const list = tables.get(k);
            const label = f.engine === 'sqlite' ? db.split('/').pop() || db : db;
            return h(
              'div.db-db',
              {},
              h('button.db-item.db-dbname', { type: 'button', title: db, 'aria-expanded': String(isOpen), onclick: () => toggleDb(f.engine, db) }, `${isOpen ? '▾' : '▸'} ${label}`),
              isOpen ? h('div.db-tables', {}, ...tableItems(f.engine, db, list)) : null,
            );
          }),
        );
      }),
    );
  };

  const paintPlace = () => {
    if (!place) {
      where.textContent = '';
      count.textContent = '';
      prev.classList.add('hidden');
      next.classList.add('hidden');
      query.disabled = run.disabled = true;
      hint.textContent = '';
      return;
    }
    const meta = DB_ENGINE_META[place.engine];
    const dbName = place.engine === 'sqlite' ? place.db.split('/').pop() || place.db : place.db;
    where.textContent = [`${meta.icon} ${dbName}`, place.table].filter(Boolean).join(' › ');
    query.disabled = run.disabled = meta.query !== 'sql' && !place.table;
    query.placeholder = meta.query === 'sql' ? (place.table ? `SELECT * FROM ${place.table} WHERE …` : 'SELECT …') : meta.query === 'filter' ? '{"status": "active"}' : 'user:*';
    hint.textContent = meta.query === 'sql' ? L.dbview.sqlHint : meta.query === 'filter' ? L.dbview.filterHint : L.dbview.patternHint;
  };

  const showRows = (r: DbRows, from: number) => {
    detail.classList.add('hidden');
    const total = typeof r.total === 'number' ? r.total : undefined;
    const to = from + r.rows.length;
    count.textContent = r.rows.length ? L.dbview.rows(from + 1, to, total === undefined ? undefined : total > 100_000 ? '100 000+' : total.toLocaleString()) + (r.more ? ` ${L.dbview.more}` : '') : '';
    const paged = !!place?.table && total !== undefined;
    prev.classList.toggle('hidden', !paged);
    next.classList.toggle('hidden', !paged);
    prev.toggleAttribute('disabled', from === 0);
    next.toggleAttribute('disabled', total === undefined || to >= total);
    if (!r.columns.length && !r.rows.length) return say(L.dbview.noRows);
    const head = h('tr', {}, h('th.db-n', {}, '#'), ...r.columns.map((c) => h('th', { title: c }, c)));
    const body = r.rows.map((row, i) =>
      h(
        'tr',
        {},
        h('td.db-n', {}, String(from + i + 1)),
        ...row.map((v) => {
          const text = cellText(v);
          return h('td', { class: v === null || v === undefined ? 'db-null' : '', title: text.length > 60 ? L.dbview.cellTip : '', onclick: () => showCell(text) }, text.length > 120 ? `${text.slice(0, 120)}…` : text);
        }),
      ),
    );
    grid.replaceChildren(h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
    if (!r.rows.length) grid.append(h('div.db-empty', {}, L.dbview.noRows));
  };

  const showCell = (text: string) => {
    let pretty = text;
    try {
      if (/^[[{]/.test(text)) pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // not JSON: as it is
    }
    detail.textContent = pretty;
    detail.classList.remove('hidden');
  };

  const read = async (req: DbRequest, from: number) => {
    const mine = ++asked;
    say(L.dbview.loading);
    try {
      const r = await ask<DbRows>(workerId, req);
      if (mine === asked) showRows(r, from);
    } catch (err) {
      if (mine === asked) say(L.dbview.failed((err as Error).message), 'db-error');
    }
  };

  const loadPage = () => {
    if (!place?.table) return;
    const filter = DB_ENGINE_META[place.engine].query !== 'sql' ? query.value.trim() : '';
    void read({ op: 'rows', engine: place.engine, db: place.db, table: place.table, offset: place.offset, limit: PAGE, ...(filter ? { text: filter } : {}) }, place.offset);
  };

  const pick = (engine: DbEngine, db: string, table: string) => {
    const same = place?.engine === engine && place.db === db;
    place = { engine, db, table, offset: 0 };
    if (!same || DB_ENGINE_META[engine].query !== 'sql') query.value = '';
    paintPlace();
    paintSide();
    loadPage();
  };

  const toggleDb = (engine: DbEngine, db: string) => {
    const k = key(engine, db);
    if (open.has(k)) open.delete(k);
    else {
      open.add(k);
      if (!place || place.engine !== engine || place.db !== db) {
        place = { engine, db, offset: 0 };
        query.value = '';
        paintPlace();
        say(L.dbview.pick);
        count.textContent = '';
      }
      if (!tables.has(k) || typeof tables.get(k) === 'string') {
        tables.delete(k);
        ask<DbTable[]>(workerId, { op: 'tables', engine, db }).then(
          (list) => tables.set(k, list),
          (err: Error) => tables.set(k, err.message),
        ).finally(paintSide);
      }
    }
    paintSide();
  };

  const runQuery = () => {
    if (!place || run.disabled) return;
    const text = query.value.trim();
    const meta = DB_ENGINE_META[place.engine];
    if (meta.query !== 'sql') {
      place.offset = 0;
      return loadPage();
    }
    if (!text) return;
    void read({ op: 'query', engine: place.engine, db: place.db, text, limit: 200, ...(place.table ? { table: place.table } : {}) }, 0);
    prev.classList.add('hidden');
    next.classList.add('hidden');
  };

  const scan = () => {
    if (scanning) return;
    scanning = true;
    found = undefined;
    tables.clear();
    open.clear();
    place = undefined;
    paintPlace();
    paintSide();
    say(L.dbview.scanning);
    ask<{ engines: DbFound[] }>(workerId, { op: 'scan' }).then(
      (r) => {
        found = r.engines;
        say(found.length ? L.dbview.pickDb : L.dbview.none);
        // Just one database: opened for you.
        const only = found.length === 1 && found[0].dbs.length === 1 ? found[0] : undefined;
        if (only) toggleDb(only.engine, only.dbs[0]);
      },
      (err: Error) => {
        found = [];
        say(L.dbview.failed(err.message), 'db-error');
      },
    ).finally(() => {
      scanning = false;
      paintSide();
    });
  };

  rescan.addEventListener('click', scan);
  run.addEventListener('click', runQuery);
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runQuery();
    }
  });
  prev.addEventListener('click', () => {
    if (!place) return;
    place.offset = Math.max(0, place.offset - PAGE);
    loadPage();
  });
  next.addEventListener('click', () => {
    if (!place) return;
    place.offset += PAGE;
    loadPage();
  });
  detail.addEventListener('click', () => detail.classList.add('hidden'));
  paintPlace();

  const has = () => !!store.workers.get(workerId)?.machine;
  return {
    el,
    shows: has,
    show(on) {
      el.classList.toggle('hidden', !on);
      // Looked for the first time it's opened, not before: it runs in the machine.
      if (on && !found && !scanning && has()) scan();
    },
  };
}
