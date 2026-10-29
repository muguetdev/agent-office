// The 🗄️ Database tab (server/dbview/): what the page may ask for, and the script that runs in the
// machine, run here for real against an SQLite file, read-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dbCommand, dbRequest, readDb } from '../src/server/dbview/index.ts';
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
});

test('the command line carries the script and the request as base64 only', () => {
  const cmd = dbCommand({ op: 'query', engine: 'sqlite', db: "/x/it's.db", text: "select '$(rm -rf /)'", limit: 5 });
  assert.match(cmd, /^python3 -c "\$\(printf %s '[A-Za-z0-9+/=]+' \| base64 -d\)" '[A-Za-z0-9+/=]+'$/);
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
