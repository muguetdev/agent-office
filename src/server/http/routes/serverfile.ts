// Downloading from a floor's server (a server's floor, or a project's floor linked to one, see
// servers.ts): GET /api/serverfile?floor=&path= streams that file over the floor's ssh, or a folder as
// a .tar.gz. Admins only, like everything that reaches into a server, and on a floor they may go to.
import { spawn } from 'node:child_process';
import type { Route } from '../router.js';
import { str } from '../../office/input.js';
import { floorParam } from './files.js';
import { send } from '../util.js';
import { configFile } from '../../servers.js';
import { L } from '../../i18n.js';

const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** A path on the server, as someone typed it: absolute, or under its home (~/…). */
export function remotePath(raw: string): string | undefined {
  const p = raw.trim();
  if (!p || p.length > 1024 || /[\0\n\r]/.test(p)) return undefined;
  if (p === '~' || p.startsWith('~/')) return `"$HOME"${p === '~' ? '' : `/${shq(p.slice(2))}`}`;
  return p.startsWith('/') ? shq(p) : undefined;
}

export const serverFileRoutes = {
  get: {
    method: 'GET',
    path: '/api/serverfile',
    auth: 'session',
    async handle(ctx, { res, url, session }) {
      if (!ctx.meOf(session.account?.id, session.guest).admin) return send(res, 403, { error: L.servers.adminsOnly });
      const floor = floorParam(ctx, url, session);
      if (!floor?.def.ssh) return send(res, 404, { error: L.srv.noSuchFloor });
      const raw = str(url.searchParams.get('path'), 1024);
      const p = remotePath(raw);
      if (!p) return send(res, 400, { error: L.serverFloor.badPath });
      // What it is first: a file comes as it is, a folder as a .tar.gz of what's in it. With check=1, only
      // that (the page asks before it downloads, so a mistake shows as one, not as a file).
      const check = url.searchParams.get('check') === '1';
      const script = check
        ? `if [ -d ${p} ]; then echo D; elif [ -f ${p} ]; then echo F; else echo N; fi`
        : `if [ -d ${p} ]; then echo D; tar -czf - -C ${p} .; elif [ -f ${p} ]; then echo F; cat -- ${p}; else echo N; fi`;
      const child = spawn('ssh', ['-F', configFile(ctx.cfg.dataDir, floor.id), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', floor.id, script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      let started = false;
      let head = Buffer.alloc(0);
      const base = raw.replace(/\/+$/, '').split('/').pop() || 'download';
      child.stdout.on('data', (chunk: Buffer) => {
        if (started) return void res.write(chunk);
        head = Buffer.concat([head, chunk]);
        const nl = head.indexOf(10);
        if (nl < 0) return;
        const kind = head.subarray(0, nl).toString();
        const rest = head.subarray(nl + 1);
        if (kind === 'N') return void send(res, 404, { error: L.serverFloor.notThere(raw) });
        if (check) return void send(res, 200, { folder: kind === 'D' });
        started = true;
        const name = encodeURIComponent(kind === 'D' ? `${base}.tar.gz` : base);
        res.writeHead(200, { 'content-type': kind === 'D' ? 'application/gzip' : 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${name}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        if (rest.length) res.write(rest);
      });
      child.on('close', (code) => {
        if (started) return void res.end();
        if (!res.headersSent && !res.writableEnded) send(res, 502, { error: L.dbview.serverSaid(err.trim().split('\n').pop() || `ssh exited ${code}`) });
      });
      child.on('error', (e) => !res.headersSent && send(res, 502, { error: e.message }));
      res.on('close', () => child.kill());
    },
  },
} satisfies Record<string, Route>;
