// The script the 🗄️ Database tab runs inside a worker's machine (see index.ts), with python3 as root:
// it finds the databases there (PostgreSQL, MySQL or MariaDB, MongoDB and Redis listening on their
// usual ports, SQLite files in the usual folders) and reads them through their own command-line
// clients (psql, mysql, mongosh) or directly (SQLite, Redis), read-only, and prints one line of
// JSON. Kept as Python so the machine needs nothing it doesn't already have.
//
// The request comes in as base64 in argv[1]. No backtick or dollar-brace may go in it: it's a
// template literal.
export const DBVIEW_PY = String.raw`import base64, json, os, socket, sqlite3, subprocess, sys, shutil

REQ = json.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))
CELL = 400
LIMIT_MAX = 200
SQLITE_EXT = ('.sqlite', '.sqlite3', '.db', '.db3', '.s3db', '.sl3')
SQLITE_ROOTS = ('/config', '/root', '/home', '/srv', '/opt', '/var/www', '/data', '/app', '/workspace')
SKIP_DIRS = {'node_modules', 'proc', 'sys', 'dev', 'venv', '__pycache__', 'site-packages', 'dist-packages', 'snap'}


class Fail(Exception):
    def __init__(self, msg, code=None):
        Exception.__init__(self, msg)
        self.code = code


def cell(v):
    if v is None or isinstance(v, (bool, int, float)):
        return v
    if isinstance(v, bytes):
        v = '0x' + v[:CELL // 2].hex() + ('…' if len(v) > CELL // 2 else '')
        return v
    if isinstance(v, dict) and len(v) == 1 and next(iter(v)) in ('$oid', '$date', '$numberDecimal', '$numberLong', '$uuid'):
        v = next(iter(v.values()))
        if isinstance(v, dict):
            v = json.dumps(v, ensure_ascii=False, default=str)
    if not isinstance(v, str):
        v = json.dumps(v, ensure_ascii=False, default=str)
    return v if len(v) <= CELL else v[:CELL] + '…'


def run(cmd, env=None, timeout=40):
    e = dict(os.environ)
    if env:
        e.update(env)
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, env=e)
    except FileNotFoundError:
        raise Fail(cmd[0] + ' is not installed', 'notInstalled')
    except subprocess.TimeoutExpired:
        raise Fail('it took too long (over %ds)' % timeout, 'tooSlow')
    out = p.stdout.decode('utf-8', 'replace')
    if p.returncode != 0:
        lines = [l.strip() for l in (p.stderr.decode('utf-8', 'replace').strip() or out.strip()).splitlines() if l.strip()]
        said = [l for l in lines if l.startswith(('ERROR', 'FATAL', 'psql:', 'MongoServerError', 'MongoNetworkError', 'Mongo', 'SyntaxError'))]
        raise Fail((said or lines or ['exited with %d' % p.returncode])[0][:500])
    return out


def limits():
    lim = int(REQ.get('limit') or 50)
    off = int(REQ.get('offset') or 0)
    return max(1, min(lim, LIMIT_MAX)), max(0, off)


def listening(port):
    s = socket.socket()
    s.settimeout(0.5)
    try:
        s.connect(('127.0.0.1', port))
        return True
    except OSError:
        return False
    finally:
        s.close()


# ---- PostgreSQL -------------------------------------------------------------------------------------

def pq_ident(s):
    return '"' + s.replace('"', '""') + '"'


def pq_lit(s):
    return "'" + s.replace("'", "''") + "'"


def psql(sql, db='postgres'):
    cmd = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql]
    if os.geteuid() == 0:
        cmd = ['runuser', '-u', 'postgres', '--'] + cmd
    env = {'PGOPTIONS': '-c default_transaction_read_only=on -c statement_timeout=20000', 'PGCONNECT_TIMEOUT': '5'}
    out = run(cmd, env).strip()
    return json.loads(out) if out else None


def pg_split(table):
    schema, _, name = table.partition('.')
    return (schema, name) if name else ('public', schema)


def pg_select(sql, db):
    lim, _ = limits()
    data = psql('select json_agg(t) from (select * from (%s) q limit %d) t' % (sql, lim), db) or []
    return rows_of(data)


def postgres(op):
    if op == 'dbs':
        return psql("select json_agg(datname order by datname) from pg_database where not datistemplate") or []
    db = REQ['db']
    if op == 'tables':
        return psql(
            "select json_agg(json_build_object('name', n.nspname || '.' || c.relname, 'kind', c.relkind, 'rows', case when c.reltuples < 0 then null else c.reltuples::bigint end) order by n.nspname, c.relname) "
            "from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','v','m','p','f') "
            "and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'", db) or []
    if op == 'rows':
        schema, name = pg_split(REQ['table'])
        lim, off = limits()
        q = '%s.%s' % (pq_ident(schema), pq_ident(name))
        data = psql('select json_agg(t) from (select * from %s limit %d offset %d) t' % (q, lim, off), db) or []
        cols = psql("select json_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = %s and table_name = %s" % (pq_lit(schema), pq_lit(name)), db) or []
        total = psql('select count(*) from (select 1 from %s limit 100001) t' % q, db)
        return dict(rows_of(data, cols), total=total)
    if op == 'query':
        return pg_select(sql_text(), db)


def sql_text():
    t = (REQ.get('text') or '').strip().rstrip(';').strip()
    if not t:
        raise Fail('write a query', 'writeQuery')
    if ';' in t:
        raise Fail('one statement at a time', 'oneStatement')
    return t


# ---- MySQL / MariaDB --------------------------------------------------------------------------------

def my_ident(s):
    q = chr(96)
    return q + s.replace(q, q + q) + q


def my_lit(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def my_unescape(v):
    if v == 'NULL':
        return None
    if '\\' not in v:
        return v
    out, i = [], 0
    while i < len(v):
        c = v[i]
        if c == '\\' and i + 1 < len(v):
            n = v[i + 1]
            out.append({'n': '\n', 't': '\t', 'r': '\r', '0': '\0', 'b': '\b', '\\': '\\'}.get(n, n))
            i += 2
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def mysql(sql, db=None):
    exe = shutil.which('mysql') or shutil.which('mariadb')
    if not exe:
        raise Fail('mysql is not installed')
    cmd = [exe, '--batch', '--connect-timeout=5', '-e', 'SET SESSION TRANSACTION READ ONLY; START TRANSACTION READ ONLY; ' + sql + '; ROLLBACK']
    if db:
        cmd[1:1] = ['-D', db]
    lines = run(cmd).split('\n')
    if lines and lines[-1] == '':
        lines.pop()
    if not lines:
        return [], []
    cols = lines[0].split('\t')
    return cols, [[my_unescape(x) for x in l.split('\t')] for l in lines[1:]]


def mysqldb(op):
    if op == 'dbs':
        _, rows = mysql('SHOW DATABASES')
        return [r[0] for r in rows if r[0] not in ('information_schema', 'performance_schema', 'sys')]
    db = REQ['db']
    if op == 'tables':
        _, rows = mysql('SELECT table_name, table_type, table_rows FROM information_schema.tables WHERE table_schema = %s ORDER BY table_name' % my_lit(db))
        return [{'name': r[0], 'kind': 'v' if r[1] == 'VIEW' else 'r', 'rows': int(r[2]) if r[2] not in (None, '') else None} for r in rows]
    lim, off = limits()
    if op == 'rows':
        t = my_ident(REQ['table'])
        cols, rows = mysql('SELECT * FROM %s LIMIT %d OFFSET %d' % (t, lim, off), db)
        if not cols:
            _, cr = mysql('SELECT column_name FROM information_schema.columns WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position' % (my_lit(db), my_lit(REQ['table'])))
            cols = [r[0] for r in cr]
        _, tot = mysql('SELECT COUNT(*) FROM (SELECT 1 FROM %s LIMIT 100001) t' % t, db)
        return {'columns': cols, 'rows': [[cell(x) for x in r] for r in rows], 'total': int(tot[0][0]) if tot else None}
    if op == 'query':
        t = sql_text()
        if t.split(None, 1)[0].lower() not in ('select', 'show', 'describe', 'desc', 'explain', 'with', 'table', 'values'):
            raise Fail('only reading here: SELECT, SHOW, DESCRIBE, EXPLAIN', 'readOnly')
        cols, rows = mysql(t, db)
        return {'columns': cols, 'rows': [[cell(x) for x in r] for r in rows[:lim]], 'more': len(rows) > lim}


# ---- MongoDB ----------------------------------------------------------------------------------------

MONGO_JS = r'''
const a = JSON.parse(process.env.DBV_ARG);
let out;
if (a.op === 'dbs') out = db.adminCommand({ listDatabases: 1, nameOnly: true }).databases.map(d => d.name).filter(n => !['admin', 'config', 'local'].includes(n)).sort();
else {
  const d = db.getSiblingDB(a.db);
  if (a.op === 'tables') out = d.getCollectionInfos({}, { nameOnly: true }).map(c => c.name).sort().map(n => ({ name: n, kind: 'c', rows: d.getCollection(n).estimatedDocumentCount() }));
  else {
    const c = d.getCollection(a.table);
    const filter = a.text ? EJSON.parse(a.text) : {};
    const docs = c.find(filter).skip(a.offset || 0).limit(a.limit).maxTimeMS(20000).toArray();
    out = { docs: docs.map(x => EJSON.serialize(x, { relaxed: true })), total: c.countDocuments(filter, { limit: 100001, maxTimeMS: 20000 }) };
  }
}
print(JSON.stringify(out));
'''


def mongo(op):
    exe = shutil.which('mongosh') or shutil.which('mongo')
    if not exe:
        raise Fail('mongosh is not installed')
    lim, off = limits()
    arg = dict(REQ, op=op, limit=lim, offset=off)
    if op == 'query' and not (REQ.get('table') or ''):
        raise Fail('pick a collection first; the query is its filter, like {"status": "active"}', 'pickCollection')
    out = run([exe, os.environ.get('DBV_MONGO_URL', 'mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=5000'), '--quiet', '--norc', '--eval', MONGO_JS], {'DBV_ARG': json.dumps(arg)})
    data = json.loads(out.strip().splitlines()[-1])
    if op in ('dbs', 'tables'):
        return data
    return dict(rows_of(data['docs']), total=data['total'])


# ---- SQLite -----------------------------------------------------------------------------------------

def is_sqlite(path):
    try:
        with open(path, 'rb') as f:
            return f.read(16) == b'SQLite format 3\x00'
    except OSError:
        return False


def sqlite_files():
    found, seen = [], 0
    for root in SQLITE_ROOTS:
        if not os.path.isdir(root):
            continue
        base = root.rstrip('/').count('/')
        for d, dirs, files in os.walk(root):
            seen += 1
            if seen > 20000 or len(found) >= 100:
                return found
            dirs[:] = [x for x in dirs if not x.startswith('.') and x not in SKIP_DIRS] if d.count('/') - base < 6 else []
            for f in files:
                p = os.path.join(d, f)
                if f.lower().endswith(SQLITE_EXT) and is_sqlite(p):
                    found.append(p)
    return sorted(set(found))


def sqlite(op):
    if op == 'dbs':
        return sqlite_files()
    path = REQ['db']
    if not is_sqlite(path):
        raise Fail('that is not an SQLite file', 'notSqlite')
    con = sqlite3.connect('file:%s?mode=ro' % path.replace('?', '%3f').replace('#', '%23'), uri=True, timeout=5)
    try:
        if op == 'tables':
            res = []
            for name, kind in con.execute("select name, type from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%' order by name"):
                try:
                    n = con.execute('select count(*) from "%s"' % name.replace('"', '""')).fetchone()[0]
                except sqlite3.Error:
                    n = None
                res.append({'name': name, 'kind': 'r' if kind == 'table' else 'v', 'rows': n})
            return res
        lim, off = limits()
        if op == 'rows':
            q = '"%s"' % REQ['table'].replace('"', '""')
            cur = con.execute('select * from %s limit %d offset %d' % (q, lim, off))
            total = con.execute('select count(*) from %s' % q).fetchone()[0]
        else:
            cur = con.execute(sql_text())
            total = None
        cols = [c[0] for c in cur.description or []]
        rows = cur.fetchmany(lim + 1)
        res = {'columns': cols, 'rows': [[cell(x) for x in r] for r in rows[:lim]], 'total': total}
        if total is None:
            res['more'] = len(rows) > lim
        return res
    finally:
        con.close()


# ---- Redis ------------------------------------------------------------------------------------------

class Redis:
    def __init__(self, n):
        self.s = socket.create_connection(('127.0.0.1', 6379), timeout=5)
        self.f = self.s.makefile('rb')
        if os.environ.get('DBV_REDIS_PASSWORD'):
            self.cmd('AUTH', os.environ['DBV_REDIS_PASSWORD'])
        if n:
            self.cmd('SELECT', str(n))

    def cmd(self, *args):
        out = b'*%d\r\n' % len(args)
        for a in args:
            a = a.encode() if isinstance(a, str) else a
            out += b'$%d\r\n%s\r\n' % (len(a), a)
        self.s.sendall(out)
        return self.read()

    def read(self):
        line = self.f.readline()
        if not line:
            raise Fail('redis closed the connection')
        t, rest = line[:1], line[1:-2]
        if t == b'+':
            return rest.decode()
        if t == b'-':
            raise Fail(rest.decode())
        if t == b':':
            return int(rest)
        if t == b'$':
            n = int(rest)
            if n < 0:
                return None
            data = self.f.read(n + 2)[:-2]
            return data.decode('utf-8', 'replace')
        if t == b'*':
            n = int(rest)
            return None if n < 0 else [self.read() for _ in range(n)]
        raise Fail('redis said something unexpected')


def redis(op):
    if op == 'dbs':
        info = Redis(0).cmd('INFO', 'keyspace') or ''
        dbs = [l.split(':')[0] for l in info.splitlines() if l.startswith('db')]
        return dbs or ['db0']
    r = Redis(int(str(REQ['db']).replace('db', '') or 0))
    if op == 'tables':
        return [{'name': 'keys', 'kind': 'k', 'rows': r.cmd('DBSIZE')}]
    lim, off = limits()
    pattern = (REQ.get('text') or '*').strip() or '*'
    keys, cursor = [], '0'
    while True:
        cursor, batch = r.cmd('SCAN', cursor, 'MATCH', pattern, 'COUNT', '1000')
        keys.extend(batch)
        if cursor == '0' or len(keys) >= 10000:
            break
    keys = sorted(set(keys))
    rows = []
    for k in keys[off:off + lim]:
        t = r.cmd('TYPE', k)
        if t == 'string':
            v = r.cmd('GET', k)
        elif t == 'hash':
            v = r.cmd('HGETALL', k)
            v = dict(zip(v[::2], v[1::2]))
        elif t == 'list':
            v = r.cmd('LRANGE', k, '0', '49')
        elif t == 'set':
            v = r.cmd('SRANDMEMBER', k, '50')
        elif t == 'zset':
            v = r.cmd('ZRANGE', k, '0', '49', 'WITHSCORES')
        else:
            v = None
        rows.append([k, t, r.cmd('TTL', k), cell(v)])
    return {'columns': ['key', 'type', 'ttl', 'value'], 'rows': rows, 'total': len(keys)}


# ---- Together ---------------------------------------------------------------------------------------

def rows_of(docs, cols=None):
    cols = list(cols or [])
    for d in docs:
        for k in d:
            if k not in cols:
                cols.append(k)
    return {'columns': cols, 'rows': [[cell(d.get(c)) for c in cols] for d in docs]}


ENGINES = {
    'postgres': (postgres, lambda: shutil.which('psql') and listening(5432)),
    'mysql': (mysqldb, lambda: (shutil.which('mysql') or shutil.which('mariadb')) and listening(3306)),
    'mongo': (mongo, lambda: (shutil.which('mongosh') or shutil.which('mongo')) and listening(27017)),
    'redis': (redis, lambda: listening(6379)),
    'sqlite': (sqlite, lambda: True),
}


def main():
    op = REQ.get('op')
    if op == 'scan':
        out = []
        for name, (fn, here) in ENGINES.items():
            try:
                if not here():
                    continue
                dbs = fn('dbs')
                if name == 'sqlite' and not dbs:
                    continue
                out.append({'engine': name, 'dbs': dbs})
            except Fail as e:
                out.append({'engine': name, 'dbs': [], 'error': str(e)})
            except Exception as e:
                out.append({'engine': name, 'dbs': [], 'error': '%s: %s' % (type(e).__name__, e)})
        return {'engines': out}
    eng = ENGINES.get(REQ.get('engine'))
    if not eng or op not in ('tables', 'rows', 'query'):
        raise Fail('bad request')
    if op == 'rows' and not REQ.get('table'):
        raise Fail('pick a table')
    return eng[0](op)


try:
    res = main()
except Fail as e:
    res = {'error': str(e), 'code': e.code} if e.code else {'error': str(e)}
except Exception as e:
    res = {'error': '%s: %s' % (type(e).__name__, e)}
print(json.dumps(res, ensure_ascii=False, default=str))
`;
