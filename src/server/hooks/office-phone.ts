// The office phone, for the workers (see phone/ and bin/office-phone.js, the office-phone command and
// the MCP tools that call it): GET /office/phone/contacts lists who they may call, POST /call calls
// one, POST /reply says something on a call, POST /hangup ends one. The worker's own hook token says
// who's calling.
import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';
import { phoneOf } from '../phone/index.js';
import { MAX_TEXT } from '../phone/calls.js';

export async function officePhone(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const phone = phoneOf(ctx);
  const caller = { floor: floor.id, id: me.id };
  const action = url.pathname.slice('/office/phone'.length);
  if (req.method === 'GET' && (action === '/contacts' || action === '')) return send(res, 200, { contacts: phone.contacts(caller) });
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
  let b: { to?: unknown; message?: unknown; call?: unknown } = {};
  try {
    const raw = await readBody(req, MAX_TEXT * 4 + 4096);
    b = raw ? JSON.parse(raw) : {};
  } catch {
    return send(res, 400, { error: 'Send JSON' });
  }
  const answer = (r: object | string) => (typeof r === 'string' ? send(res, 400, { error: r }) : send(res, 200, { ok: true, ...r }));
  const message = typeof b.message === 'string' ? b.message : '';
  if (action === '/call') return answer(phone.call(caller, str(b.to, 200), message));
  if (action === '/reply') return answer(phone.reply(caller, str(b.call, 32) || undefined, message));
  if (action === '/hangup') return answer(phone.hangUp(caller, str(b.call, 32) || undefined));
  return send(res, 404, { error: 'Not found' });
}
