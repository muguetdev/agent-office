// The 🗄️ Database tab (server/dbview/): what the page may ask for, and the script that runs in the
// machine, run here for real against an SQLite file, read-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dbCommand, dbRequest, readDb, readServerDb } from '../src/server/dbview/index.ts';
import { logWrite, writeTarget } from '../src/server/dbview/audit.ts';
import { readFileSync } from 'node:fs';
import type { DbRequest } from '../src/shared/dbview.ts';
import type { WorkerInfo } from '../src/shared/protocol.ts';

let python = true;
try {
  execFileSync('python3', ['-c', 'import sqlite3'], { stdio: 'ignore' });
} catch {
  python = false;
}

/** Runs the command line the machine would, here. */
const runHere = (req: DbRequest) => JSON.parse(execFileSync('bash', ['-c', dbCommand(req)], { encoding: 'utf8' }).trim());

test('only well-formed reads get through', () => {
  assert.deepEqual(dbRequest({ op: 'scan' }), { op: 'scan' });
  assert.equal(typeof dbRequest({ op: 'tables', engine: 'oracle', db: 'x' }), 'string');
  assert.equal(typeof dbRequest({ op: 'tables', engine: 'postgres' }), 'string');
  assert.equal(typeof dbRequest({ op: 'rows', engine: 'postgres', db: 'shop' }), 'string');
  assert.equal(typeof dbRequest({ op: 'query', engine: 'postgres', db: 'shop', text: '  ' }), 'string');
  assert.equal(typeof dbRequest({ op: 'drop', engine: 'postgres', db: 'shop' }), 'string');
  assert.deepEqual(dbRequest({ op: 'rows', engine: 'mysql', db: 'blog', table: 'posts', offset: -5, limit: 9999 }), { op: 'rows', engine: 'mysql', db: 'blog', table: 'posts', offset: 0, limit: 200 });
  // A database in a Docker container: named as Docker names them, nothing a shell would read as more.
  assert.deepEqual(dbRequest({ op: 'tables', engine: 'postgres', db: 'crivo', container: 'crivo-postgres-1' }), { op: 'tables', engine: 'postgres', db: 'crivo', container: 'crivo-postgres-1' });
  assert.equal(typeof dbRequest({ op: 'tables', engine: 'postgres', db: 'crivo', container: 'x; rm -rf /' }), 'string');
  assert.equal(typeof dbRequest({ op: 'tables', engine: 'postgres', db: 'crivo', container: 7 }), 'string');
  // An app's URL, by its id only: the URL itself stays on the server.
  assert.deepEqual(dbRequest({ op: 'tables', engine: 'postgres', db: 'meta', link: '20dcba518f93' }), { op: 'tables', engine: 'postgres', db: 'meta', link: '20dcba518f93' });
  assert.equal(typeof dbRequest({ op: 'tables', engine: 'postgres', db: 'meta', link: 'postgres://u:p@h/db' }), 'string');
  assert.equal(typeof dbRequest({ op: 'tables', engine: 'postgres', db: 'meta', link: '20dcba518f93', container: 'pg' }), 'string');
});

test('the command line carries the script and the request as base64 only', () => {
  const cmd = dbCommand({ op: 'query', engine: 'sqlite', db: "/x/it's.db", text: "select '$(rm -rf /)'", limit: 5 });
  assert.match(cmd, /^python3 -c "\$\(printf %s '[A-Za-z0-9+/=]+' \| base64 -d\)" '[A-Za-z0-9+/=]+'$/);
  // On a server: as root by sudo, when it isn't root and may.
  const server = dbCommand({ op: 'scan' }, true);
  assert.ok(server.endsWith(`$S ${dbCommand({ op: 'scan' })}`));
  assert.match(server, /sudo -n true/);
});

test("a server's floor's databases are read over its ssh, and a run with no answer says why", async () => {
  const ran: { script: string; timeout: number }[] = [];
  const answer = await readServerDb(async (script, timeout) => (ran.push({ script, timeout }), 'motd\n{"engines": [{"engine": "postgres", "container": "crivo-postgres-1", "dbs": ["crivo"]}]}\n'), { op: 'scan' });
  assert.deepEqual(answer, { engines: [{ engine: 'postgres', container: 'crivo-postgres-1', dbs: ['crivo'] }] });
  assert.match(ran[0].script, /sudo -n/);
  assert.ok(ran[0].timeout >= 60_000);
  assert.match(String((await readServerDb(async () => 'bash: python3: command not found\n', { op: 'scan' }) as { error: string }).error), /python3/);
});

test('an SQLite file: its tables, a page of rows, a query, and no writing', { skip: !python && 'no python3 here' }, (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-dbview-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = path.join(dir, 'app.db');
  execFileSync('python3', ['-c', `import sqlite3; c = sqlite3.connect(${JSON.stringify(db)}); c.execute("create table users(id integer primary key, name text, bio text)"); c.executemany("insert into users(name, bio) values (?, ?)", [("ana", "x" * 900), ("bob", None), ("cy", "hi")]); c.commit()`]);

  assert.deepEqual(runHere({ op: 'tables', engine: 'sqlite', db }), [{ name: 'users', kind: 'r', rows: 3 }]);

  const page = runHere({ op: 'rows', engine: 'sqlite', db, table: 'users', offset: 1, limit: 1 });
  assert.deepEqual(page, { columns: ['id', 'name', 'bio'], rows: [[2, 'bob', null]], total: 3 });

  const first = runHere({ op: 'rows', engine: 'sqlite', db, table: 'users', offset: 0, limit: 1 });
  assert.equal(first.rows[0][2].length, 401, 'a long value is cut short');
  assert.ok(first.rows[0][2].endsWith('…'));

  const q = runHere({ op: 'query', engine: 'sqlite', db, text: 'select name from users where bio is not null order by id;', limit: 1 });
  assert.deepEqual(q, { columns: ['name'], rows: [['ana']], total: null, more: true });

  assert.match(runHere({ op: 'query', engine: 'sqlite', db, text: 'delete from users', limit: 5 }).error, /readonly/);
  assert.match(runHere({ op: 'query', engine: 'sqlite', db, text: 'select 1; delete from users', limit: 5 }).error, /one statement/);
  assert.match(runHere({ op: 'tables', engine: 'sqlite', db: path.join(dir, 'nope.db') }).error, /not an SQLite file/);
  assert.equal(runHere({ op: 'rows', engine: 'sqlite', db, table: 'users', offset: 0, limit: 5 }).total, 3, 'still all there');

  // ✍️ Writing: as written, and it stays written.
  assert.deepEqual(runHere({ op: 'write', engine: 'sqlite', db, text: "update users set name = 'bea' where id = 1", limit: 5 }), { columns: ['result'], rows: [['1 row(s) changed']], changed: true });
  assert.deepEqual(runHere({ op: 'write', engine: 'sqlite', db, text: "insert into users(name) values ('dee') returning id, name", limit: 5 }).rows, [[4, 'dee']]);
  assert.deepEqual(runHere({ op: 'query', engine: 'sqlite', db, text: 'select name from users order by id', limit: 10 }).rows, [['bea'], ['bob'], ['cy'], ['dee']]);
});

test('a write is for one statement, and each one is logged with who, where and what', (t) => {
  assert.deepEqual(dbRequest({ op: 'write', engine: 'postgres', db: 'crivo', text: 'delete from jobs', container: 'crivo-postgres-1' }), { op: 'write', engine: 'postgres', db: 'crivo', text: 'delete from jobs', limit: 50, container: 'crivo-postgres-1' });
  assert.equal(typeof dbRequest({ op: 'write', engine: 'postgres', db: 'crivo', text: ' ' }), 'string');
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-dbview-log-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const req = { op: 'write' as const, engine: 'postgres' as const, db: 'crivo', text: 'delete from jobs', limit: 50, container: 'crivo-postgres-1' };
  assert.equal(writeTarget({ source: 'server', req }), 'postgres (🐳 crivo-postgres-1) › crivo');
  logWrite(dir, { by: 'ana', source: 'server', req }, new Date('2026-10-29T00:00:00Z'));
  logWrite(dir, { by: 'bo', source: 'machine', req: { ...req, container: undefined, link: '0123456789ab' }, error: 'nope' });
  const lines = readFileSync(path.join(dir, 'dbview-writes.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], { at: '2026-10-29T00:00:00.000Z', by: 'ana', source: 'server', engine: 'postgres', db: 'crivo', container: 'crivo-postgres-1', text: 'delete from jobs', ok: true });
  assert.equal(lines[1].ok, false);
  assert.equal(lines[1].link, '0123456789ab');
});

test("an app's database URL is found in its .env, and only its label and id come out", { skip: !python && 'no python3 here' }, (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'ao-dbview-env-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = path.join(home, 'app', '.env');
  execFileSync('bash', ['-c', `mkdir -p ${JSON.stringify(path.dirname(env))} && printf 'DATABASE_URL="postgresql://shop:hunter2@db.internal:6543/shop?sslmode=require"\\nOTHER=1\\n' > ${JSON.stringify(env)}`]);
  // The script looks in the usual folders: this one is put first among them.
  const cmd = dbCommand({ op: 'scan' }).replace(/^python3 -c "\$\(printf %s '([^']+)' \| base64 -d\)"/, (_m, b64: string) => {
    const script = Buffer.from(b64, 'base64').toString('utf8').replace("SQLITE_ROOTS = ('/config',", `SQLITE_ROOTS = (${JSON.stringify(home)}, '/config',`);
    return `python3 -c "$(printf %s '${Buffer.from(script).toString('base64')}' | base64 -d)"`;
  });
  const out = execFileSync('bash', ['-c', cmd], { encoding: 'utf8' });
  assert.ok(!out.includes('hunter2'), 'the password never comes out');
  const scan = JSON.parse(out.trim().split('\n').pop() as string) as { engines: { engine: string; link?: string; label?: string; where?: string }[] };
  const link = scan.engines.find((e) => e.link);
  assert.ok(link, JSON.stringify(scan));
  assert.equal(link.engine, 'postgres');
  assert.equal(link.label, 'shop@db.internal:6543/shop');
  assert.equal(link.where, env);
  assert.match(link.link as string, /^[0-9a-f]{12}$/);
});

test('it reads in the worker’s own machine, as root, and passes on what the script said', async () => {
  const calls: unknown[][] = [];
  const shell = {
    exec: async (...args: unknown[]) => {
      calls.push(args);
      return { exitCode: 0, stdout: 'noise\n{"engines": []}\n', stderr: '', truncated: false, timedOut: false };
    },
  };
  const w = { id: 'w1', machine: { id: 'ce-office-abc', host: 'root@10.0.0.1' } } as unknown as WorkerInfo;
  assert.deepEqual(await readDb(shell, w, { op: 'scan' }), { engines: [] });
  assert.equal(calls[0][1], 'ce-office-abc');
  assert.deepEqual(calls[0][3], { root: true, timeout: 60 });
  assert.deepEqual(await readDb(shell, { id: 'w2' } as WorkerInfo, { op: 'scan' }), { error: 'no machine' });
  shell.exec = async () => ({ exitCode: 0, stdout: '{"columns": [', stderr: '', truncated: true, timedOut: false });
  assert.match(String((await readDb(shell, w, { op: 'scan' }) as { error: string }).error), /fewer rows/);
});
