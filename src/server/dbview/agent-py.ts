// The script the 🗄️ Database tab runs in a worker's machine or on its floor's server (see index.ts),
// with python3, as root where it can: it finds the databases there (PostgreSQL, MySQL or MariaDB,
// MongoDB and Redis installed and listening on their usual ports, the same in Docker containers, and
// SQLite files in the usual folders, and the database URLs in the apps' .env files and PM2's
// environment) and reads them through their own command-line clients (psql,
// mysql, mongosh; inside the container for one in Docker) or directly (SQLite, Redis), read-only, and
// prints one line of JSON. Kept as Python so neither needs anything it doesn't already have.
//
// The request comes in as base64 in argv[1]. It's in two parts (this file: the request, helpers,
// Docker and the apps' URLs; agent-py-engines.ts: each engine and the scan), one script once joined.
// No backtick or dollar-brace may go in either: they're template literals.
import { ENGINES_PY } from './agent-py-engines.js';

const BASE_PY = String.raw`import base64, hashlib, json, os, pwd, re, shlex, socket, sqlite3, subprocess, sys, shutil
from urllib.parse import unquote, urlsplit, parse_qs

REQ = json.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))
CELL = 400
LIMIT_MAX = 200
SQLITE_EXT = ('.sqlite', '.sqlite3', '.db', '.db3', '.s3db', '.sl3')
SQLITE_ROOTS = ('/config', '/root', '/home', '/srv', '/opt', '/var/www', '/data', '/app', '/workspace')
SKIP_DIRS = {'node_modules', 'proc', 'sys', 'dev', 'venv', '__pycache__', 'site-packages', 'dist-packages', 'snap', 'chrome', 'chromium', 'google-chrome', 'BraveSoftware', 'Code', 'GPUCache', 'docker', 'containerd'}


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


# ---- Docker containers ------------------------------------------------------------------------------
# A database in a container is read with the client inside it (docker exec), as the user its image
# made from its own environment (POSTGRES_USER, MYSQL_ROOT_PASSWORD, MONGO_INITDB_ROOT_*), which only
# the shell in the container reads: no password is ever on a command line out here.

KINDS = (
    ('postgres', re.compile(r'(postgres|pgvector|postgis|timescale)')),
    ('mysql', re.compile(r'(mysql|mariadb|percona)')),
    ('mongo', re.compile(r'(^|/)mongo(db)?([-:/]|$)')),
    ('redis', re.compile(r'(redis|valkey|keydb|dragonfly)')),
)
NOT_DB = re.compile(r'(exporter|express|commander|insight|admin|-ui\b|backup|proxy)')
_inspect = {}


def containers():
    if not shutil.which('docker'):
        return []
    try:
        out = run(['docker', 'ps', '--format', '{{.Names}}\t{{.Image}}'], timeout=15)
    except Fail:
        return []
    found = []
    for line in out.splitlines():
        name, _, image = line.partition('\t')
        img = image.lower()
        if not name or NOT_DB.search(img):
            continue
        for kind, rx in KINDS:
            if rx.search(img):
                found.append((kind, name))
                break
    return found


def inspect(ctr):
    if ctr not in _inspect:
        _inspect[ctr] = json.loads(run(['docker', 'inspect', ctr], timeout=15))[0]
    return _inspect[ctr]


def cenv(ctr):
    return dict(e.split('=', 1) for e in (inspect(ctr).get('Config') or {}).get('Env') or [] if '=' in e)


def in_ctr(ctr, script, args, env=None):
    cmd = ['docker', 'exec']
    for k, v in (env or {}).items():
        cmd += ['-e', '%s=%s' % (k, v)]
    return run(cmd + [ctr, 'sh', '-c', script, 'sh'] + list(args))


# ---- Connection URLs the apps use ----------------------------------------------------------------------
# DATABASE_URL, MONGODB_URI, REDIS_URL…: found in the .env files in the usual folders and in the
# environment of the apps PM2 runs. A URL never leaves this machine: the page gets a label without the
# password (user@host:port/db) and an id, by which the next request finds the URL here again. Its
# password goes to the client in its environment, never on a command line.

SCHEMES = (('postgres', re.compile(r'^postgres(ql)?://')), ('mysql', re.compile(r'^(mysql|mariadb)://')), ('mongo', re.compile(r'^mongodb(\+srv)?://')), ('redis', re.compile(r'^rediss?://')))
ENV_NAMES = re.compile(r'^\.env(\.[A-Za-z0-9_-]+)?$')
NOT_ENV = re.compile(r'(example|sample|template|dist|test)', re.I)
_links = None


def scheme_of(url):
    for kind, rx in SCHEMES:
        if rx.match(url):
            return kind
    return None


def env_files():
    found, seen = [], 0
    for root in SQLITE_ROOTS:
        if not os.path.isdir(root):
            continue
        base = root.rstrip('/').count('/')
        for d, dirs, files in os.walk(root):
            seen += 1
            if seen > 20000 or len(found) >= 200:
                return found
            dirs[:] = [x for x in dirs if not x.startswith('.') and x not in SKIP_DIRS] if d.count('/') - base < 4 else []
            for f in files:
                if ENV_NAMES.match(f) and not NOT_ENV.search(f):
                    found.append(os.path.join(d, f))
    return found


def env_values(path):
    out = []
    try:
        with open(path, encoding='utf-8', errors='replace') as fh:
            for line in fh:
                line = line.strip()
                if line.startswith('export '):
                    line = line[7:]
                k, eq, v = line.partition('=')
                if eq and not k.startswith('#'):
                    out.append((k.strip(), v.strip().strip('"\'')))
    except OSError:
        pass
    return out


def pm2_values():
    if not shutil.which('pm2'):
        return []
    try:
        apps = json.loads(run(['pm2', 'jlist'], timeout=15) or '[]')
    except (Fail, ValueError):
        return []
    out = []
    for a in apps:
        env = dict((a.get('pm2_env') or {}).get('env') or {})
        env.update({k: v for k, v in (a.get('pm2_env') or {}).items() if isinstance(v, str)})
        out.extend(('pm2 ' + str(a.get('name')), k, v) for k, v in env.items() if isinstance(v, str))
    return out


def links():
    """Every database URL found here: id → (engine, url, where it was found)."""
    global _links
    if _links is None:
        _links = {}
        values = [(p, k, v) for p in env_files() for k, v in env_values(p)] + pm2_values()
        for where, _, v in values:
            kind = scheme_of(v)
            if not kind or ('$' + '{') in v or len(v) > 2000:
                continue
            lid = hashlib.sha1(v.encode()).hexdigest()[:12]
            if lid not in _links:
                _links[lid] = (kind, v, where)
    return _links


def link_label(url):
    u = urlsplit(url)
    host = u.hostname or '?'
    port = ':%d' % u.port if u.port else ''
    user = (unquote(u.username) + '@') if u.username else ''
    path = u.path.lstrip('/')
    return '%s%s%s%s' % (user, host, port, ('/' + path) if path else '')


def link_url():
    lid = REQ.get('link')
    if not lid:
        return None
    hit = links().get(lid)
    if not hit:
        raise Fail('that connection is not there any more', 'noLink')
    return hit[1]


def pg_link_env(url, db=None):
    u = urlsplit(url)
    q = parse_qs(u.query)
    env = dict(PG_ENV)
    env.update({'PGHOST': u.hostname or 'localhost', 'PGPORT': str(u.port or 5432), 'PGUSER': unquote(u.username or ''), 'PGPASSWORD': unquote(u.password or ''), 'PGDATABASE': db or u.path.lstrip('/') or 'postgres'})
    if q.get('sslmode'):
        env['PGSSLMODE'] = q['sslmode'][0]
    return env


`;

export const DBVIEW_PY = BASE_PY + ENGINES_PY;
