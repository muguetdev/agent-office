// A worker's machine's desktop, through the office: /api/machines/<worker id>/desktop/… is passed to
// the forward to that machine's desktop (see tunnels.ts), as HTTP and as WebSocket, at the path the
// host serves it under (/api/machines/<machine id>/desktop/…). Only for someone signed in who may be
// on the worker's floor; never a guest. Nothing else under /api/machines/ is passed anywhere.
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { Session } from '../auth.js';
import { withoutOfficeCookies } from '../auth.js';
import type { Ctx } from '../office/context.js';
import { mayEnter, whoOf, type Who } from '../office/access.js';
import { sameOrigin, send } from '../http/util.js';
import { machinesOf } from './index.js';
import { L } from '../i18n.js';

export const MACHINES_PREFIX = '/api/machines/';
const DESKTOP_RE = /^\/api\/machines\/([a-z0-9][a-z0-9-]{0,39})\/desktop(\/[^?#]*)?$/;

/**
 * A desktop path as the browser sent it (not decoded), or undefined when it isn't one: the id it
 * names and the rest after /desktop. A path that climbs out (`..`, or one spelled with escapes)
 * isn't one.
 */
export function parseDesktopPath(raw: string): { id: string; rest: string } | undefined {
  const m = DESKTOP_RE.exec(raw);
  if (!m) return undefined;
  const rest = m[2] ?? '';
  if (/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(rest)) return undefined;
  return { id: m[1], rest };
}

/** Where a desktop request goes, or the status it's turned away with. */
export type DesktopTarget = { status: 200; port: number; path: string } | { status: 301; location: string } | { status: 403 | 404 };

/**
 * What the office does with a request for `raw` (its path) and `search` from `who`: `find` says which
 * worker's machine an id is (a worker's id, or its machine's), and `may` whether `who` may be on a floor.
 */
export function desktopTarget(
  raw: string,
  search: string,
  who: Who | undefined,
  find: (id: string) => { floor: string; port: number; machineId: string } | undefined,
  may: (who: Who, floor: string) => boolean,
): DesktopTarget {
  const parsed = parseDesktopPath(raw);
  if (!parsed) return { status: 404 };
  if (!who || who.guest) return { status: 403 };
  const found = find(parsed.id);
  if (!found) return { status: 404 };
  if (!may(who, found.floor)) return { status: 403 };
  if (!parsed.rest) return { status: 301, location: `${raw}/${search}` };
  return { status: 200, port: found.port, path: `/api/machines/${found.machineId}/desktop${parsed.rest}${search}` };
}

const targetFor = (ctx: Ctx, req: http.IncomingMessage, session: Session | undefined): DesktopTarget => {
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://x');
  } catch {
    return { status: 404 };
  }
  const m = machinesOf(ctx);
  return desktopTarget(url.pathname, url.search, session && whoOf(session), (id) => m.desktopOf(id), (who, floor) => mayEnter(ctx.accounts, who, floor));
};

/** What goes up to the desktop: the browser's headers, without the office's cookies, for its own host. */
function upstreamHeaders(req: http.IncomingMessage, port: number): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `127.0.0.1:${port}` };
  const cookie = withoutOfficeCookies(req.headers.cookie);
  if (cookie) headers.cookie = cookie;
  else delete headers.cookie;
  delete headers.authorization;
  return headers;
}

/** The desktop over HTTP (the 'session' route under /api/machines/, see http/routes/machines.ts). */
export function proxyDesktop(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, session: Session) {
  const t = targetFor(ctx, req, session);
  if (t.status === 301) return void res.writeHead(301, { location: t.location, 'cache-control': 'no-store' }).end();
  if (t.status !== 200) return send(res, t.status, { error: t.status === 403 ? L.machines.notYourDesktop : L.machines.noDesktop });
  // Anything that changes something comes from the office's own pages only.
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req, ctx.cfg)) return send(res, 403, { error: L.machines.notYourDesktop });
  const up = http.request({ host: '127.0.0.1', port: t.port, method: req.method, path: t.path, headers: upstreamHeaders(req, t.port) }, (ur) => {
    const headers = { ...ur.headers };
    // Shown in the office's own window, never framed by anyone else; and it sets no cookies on the office.
    delete headers['set-cookie'];
    headers['x-frame-options'] = 'SAMEORIGIN';
    headers['cache-control'] ??= 'no-store';
    res.writeHead(ur.statusCode ?? 502, ur.statusMessage, headers);
    ur.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) send(res, 502, { error: L.machines.desktopDown });
    else res.destroy();
  });
  res.on('close', () => up.destroy());
  req.pipe(up);
}

/**
 * A WebSocket under /api/machines/: the desktop's stream, from one of the office's own pages, spliced
 * through to it. Says whether it took the socket (anything under /api/machines/ is ours, allowed or not).
 */
export function proxyDesktopUpgrade(ctx: Ctx, req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
  if (!(req.url ?? '').startsWith(MACHINES_PREFIX)) return false;
  const session = sameOrigin(req, ctx.cfg) ? ctx.auth.fromRequest(req) : undefined;
  const t = targetFor(ctx, req, session);
  if (t.status !== 200) {
    socket.write(`HTTP/1.1 ${t.status === 403 || t.status === 301 ? '403 Forbidden' : '404 Not Found'}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    return true;
  }
  const up = net.connect(t.port, '127.0.0.1');
  const lines = [`${req.method} ${t.path} HTTP/1.1`];
  for (const [k, v] of Object.entries(upstreamHeaders(req, t.port))) {
    for (const one of Array.isArray(v) ? v : [v]) if (one !== undefined) lines.push(`${k}: ${one}`);
  }
  up.on('connect', () => {
    up.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const close = () => {
    up.destroy();
    socket.destroy();
  };
  up.on('error', close);
  socket.on('error', close);
  up.on('close', close);
  socket.on('close', close);
  return true;
}
