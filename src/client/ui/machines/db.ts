// The 🗄️ Database tab beside a worker's terminal (see termtabs.ts), for a worker with a machine of its
// own or on a server's floor: the databases running in that machine and on that server (PostgreSQL,
// MySQL or MariaDB, MongoDB, Redis, installed or in Docker containers) and the SQLite files in their
// folders, read through the office (POST /api/dbview, see server/dbview/). On the left, each one's
// databases and their tables; on the right, a table's rows a page at a time, and a box for a query of
// your own. All of it read-only.
import './db.css';
import { DB_ENGINE_META, type DbEngine, type DbFound, type DbRequest, type DbRows, type DbSource, type DbTable, type DbVia } from '../../../shared/dbview';
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

/** A database: where it's read (the machine or the server), its engine, its container if it's in Docker. */
interface Spot extends DbVia {
  source: DbSource;
  engine: DbEngine;
  db: string;
}

/** Where you are: a database, and a table in it (or a query of your own). */
interface Place extends Spot {
  table?: string;
  offset: number;
}

type Found = DbFound & { source: DbSource };

const spotKey = (s: Spot) => [s.source, s.engine, s.container ?? '', s.link ?? '', s.db].join('\u0000');
/** Which one of its engine's `f` is: its container or its app's URL. */
const via = (f: DbVia): DbVia => ({ ...(f.container ? { container: f.container } : {}), ...(f.link ? { link: f.link } : {}) });
/** What every read about `s` says of where it is. */
const at = (s: Spot) => ({ engine: s.engine, db: s.db, ...via(s) });

/** The script's own refusals in your language (by their code); the databases' own errors as they said them. */
const said = (error: unknown, code: unknown) => (typeof code === 'string' && Object.hasOwn(L.dbview.errors, code) ? L.dbview.errors[code as keyof typeof L.dbview.errors] : String(error));

async function ask<T>(workerId: string, source: DbSource, req: DbRequest): Promise<T> {
  const r = await fetch(`/api/dbview?floor=${encodeURIComponent(store.floor ?? '')}&worker=${encodeURIComponent(workerId)}&source=${source}`, {
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
    throw new Error(said(error, code));
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
  /** Where this worker's databases may be: its own machine (once it's there), its floor's server. */
  const sources = (): DbSource[] => {
    const w = store.workers.get(workerId);
    const out: DbSource[] = [];
    if (w?.machine && w.machineBusy !== 'giving' && w.machineBusy !== 'taking') out.push('machine');
    if (store.currentFloor()?.ssh) out.push('server');
    return out;
  };
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

  let found: Found[] | undefined;
  let scanning = false;
  /** Where the look itself failed (the machine or the server didn't answer), and why. */
  const lookFailed = new Map<DbSource, string>();
  const tables = new Map<string, DbTable[] | string>();
  const open = new Set<string>();
  let place: Place | undefined;
  /** Bumped by each read, so an answer that comes after a newer question is dropped. */
  let asked = 0;

  const say = (text: string, cls = 'db-empty') => grid.replaceChildren(h(`div.${cls}`, {}, text));

  /** A database's tables in the side list, or why there are none to show. */
  const tableItems = (spot: Spot, list: DbTable[] | string | undefined): HTMLElement[] => {
    if (list === undefined) return [h('div.db-empty', {}, L.dbview.loading)];
    if (typeof list === 'string') return [h('div.db-error', {}, list)];
    if (!list.length) return [h('div.db-empty', {}, L.dbview.noTables)];
    return list.map((t) =>
      h(
        'button.db-item.db-table',
        { type: 'button', class: place && spotKey(place) === spotKey(spot) && place.table === t.name ? 'on' : '', onclick: () => pick(spot, t.name) },
        h('span.db-tname', {}, `${t.kind === 'v' || t.kind === 'm' ? '👁 ' : ''}${t.name}`),
        t.rows === null || t.rows === undefined ? null : h('span.db-tcount', {}, t.rows.toLocaleString()),
      ),
    );
  };

  const paintSide = () => {
    if (!found) return void side.replaceChildren(h('div.db-empty', {}, scanning ? L.dbview.scanning : ''));
    if (!found.length && !lookFailed.size) return void side.replaceChildren(h('div.db-empty', {}, L.dbview.none));
    // With both a machine and a server, each says which it is.
    const both = sources().length > 1;
    const items: HTMLElement[] = [];
    const heading = (source: DbSource) => h('div.db-source', {}, source === 'machine' ? L.dbview.fromMachine : L.dbview.fromServer(store.currentFloor()?.name ?? ''));
    for (const [source, why] of lookFailed) items.push(heading(source), h('div.db-error', {}, why));
    let last: DbSource | undefined;
    for (const f of found) {
      if (both && f.source !== last) items.push(heading(f.source));
      last = f.source;
      const meta = DB_ENGINE_META[f.engine];
      items.push(
        h(
          'div.db-engine',
          {},
          h(
            'div.db-engine-name',
            { title: f.where ? L.dbview.via(f.where) : '' },
            `${meta.icon} ${meta.label}`,
            f.container ? h('span.db-ctr', { title: f.container }, L.dbview.inDocker(f.container)) : null,
            f.label ? h('span.db-ctr', {}, `🔗 ${f.label}`) : null,
          ),
          f.where ? h('div.db-via', {}, L.dbview.via(f.where)) : null,
          f.error ? h('div.db-error', {}, said(f.error, f.code)) : null,
          ...f.dbs.map((db) => {
            const spot: Spot = { source: f.source, engine: f.engine, db, ...via(f) };
            const k = spotKey(spot);
            const isOpen = open.has(k);
            const label = f.engine === 'sqlite' ? db.split('/').pop() || db : db;
            return h(
              'div.db-db',
              {},
              h('button.db-item.db-dbname', { type: 'button', title: db, 'aria-expanded': String(isOpen), onclick: () => toggleDb(spot) }, `${isOpen ? '▾' : '▸'} ${label}`),
              isOpen ? h('div.db-tables', {}, ...tableItems(spot, tables.get(k))) : null,
            );
          }),
        ),
      );
    }
    side.replaceChildren(...items);
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

  const read = async (source: DbSource, req: DbRequest, from: number) => {
    const mine = ++asked;
    say(L.dbview.loading);
    try {
      const r = await ask<DbRows>(workerId, source, req);
      if (mine === asked) showRows(r, from);
    } catch (err) {
      if (mine === asked) say(L.dbview.failed((err as Error).message), 'db-error');
    }
  };

  const loadPage = () => {
    if (!place?.table) return;
    const filter = DB_ENGINE_META[place.engine].query !== 'sql' ? query.value.trim() : '';
    void read(place.source, { op: 'rows', ...at(place), table: place.table, offset: place.offset, limit: PAGE, ...(filter ? { text: filter } : {}) }, place.offset);
  };

  const pick = (spot: Spot, table: string) => {
    const same = !!place && spotKey(place) === spotKey(spot);
    place = { ...spot, table, offset: 0 };
    if (!same || DB_ENGINE_META[spot.engine].query !== 'sql') query.value = '';
    paintPlace();
    paintSide();
    loadPage();
  };

  const toggleDb = (spot: Spot) => {
    const k = spotKey(spot);
    if (open.has(k)) open.delete(k);
    else {
      open.add(k);
      if (!place || spotKey(place) !== k) {
        place = { ...spot, offset: 0 };
        query.value = '';
        paintPlace();
        say(L.dbview.pick);
        count.textContent = '';
      }
      if (!tables.has(k) || typeof tables.get(k) === 'string') {
        tables.delete(k);
        ask<DbTable[]>(workerId, spot.source, { op: 'tables', ...at(spot) }).then(
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
    void read(place.source, { op: 'query', ...at(place), text, limit: 200, ...(place.table ? { table: place.table } : {}) }, 0);
    prev.classList.add('hidden');
    next.classList.add('hidden');
  };

  const scan = () => {
    if (scanning) return;
    scanning = true;
    found = undefined;
    tables.clear();
    open.clear();
    lookFailed.clear();
    place = undefined;
    paintPlace();
    paintSide();
    say(L.dbview.scanning);
    // Each place at once; one that fails says so in the list, the other still shows.
    const looks = sources().map((source) =>
      ask<{ engines: DbFound[] }>(workerId, source, { op: 'scan' }).then(
        (r): Found[] => r.engines.map((e) => ({ ...e, source })),
        (err: Error): Found[] => {
          lookFailed.set(source, L.dbview.failed(err.message));
          return [];
        },
      ),
    );
    void Promise.all(looks).then((all) => {
      found = all.flat();
      scanning = false;
      say(found.length ? L.dbview.pickDb : lookFailed.size ? '' : L.dbview.none);
      // Just one database: opened for you.
      const only = found.length === 1 && found[0].dbs.length === 1 ? found[0] : undefined;
      if (only) toggleDb({ source: only.source, engine: only.engine, db: only.dbs[0], ...via(only) });
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

  return {
    el,
    shows: () => sources().length > 0,
    show(on) {
      el.classList.toggle('hidden', !on);
      // Looked for the first time it's opened, not before: it runs in the machine and on the server.
      if (on && !found && !scanning && sources().length) scan();
    },
  };
}
