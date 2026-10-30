// WhatsOffice, for the workers (see whatsoffice/ and bin/whatsoffice.js, the whatsoffice command and
// the MCP tools that call it): GET /office/chat/contacts lists who they may message, POST /send sends
// one a message, POST /read gives back what's waiting (or one conversation). The worker's own hook
// token says who's asking. /office/phone is the same for workers started when it was a phone call:
// call and reply send, and hanging up just says done.
import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';
import { whatsOfficeOf } from '../whatsoffice/index.js';
import { MAX_TEXT } from '../whatsoffice/store.js';

export async function officeChat(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const wo = whatsOfficeOf(ctx);
  const self = { floor: floor.id, id: me.id };
  const legacy = url.pathname.startsWith('/office/phone');
  const action = url.pathname.slice(legacy ? '/office/phone'.length : '/office/chat'.length);
  if (req.method === 'GET' && (action === '/contacts' || action === '')) return send(res, 200, { contacts: wo.contacts(self) });
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
  let b: { to?: unknown; message?: unknown; from?: unknown; call?: unknown } = {};
  try {
    const raw = await readBody(req, MAX_TEXT * 4 + 4096);
    b = raw ? JSON.parse(raw) : {};
  } catch {
    return send(res, 400, { error: 'Send JSON' });
  }
  const answer = (r: object | string) => (typeof r === 'string' ? send(res, 400, { error: r }) : send(res, 200, { ok: true, ...r }));
  const message = typeof b.message === 'string' ? b.message : '';
  if (action === '/send') return answer(wo.send(self, str(b.to, 200), message));
  if (action === '/read') return answer(wo.read(self, str(b.from, 200) || undefined));
  // The phone's calls, as messages: a call or a reply is a message to whoever it's with.
  if (legacy && action === '/call') {
    const r = wo.send(self, str(b.to, 200), message);
    return typeof r === 'string' ? answer(r) : answer({ id: r.thread, to: { name: r.to.name, floorName: r.to.floor } });
  }
  // A reply goes to whoever it last talked to; hanging up has nothing left to do.
  if (legacy && action === '/reply') {
    const latest = wo.conversationsOf(self)[0];
    if (!latest) return answer("You haven't talked to anyone yet: send_message (`whatsoffice send <name@floor>`)");
    const other = latest.members[latest.me === 0 ? 1 : 0];
    const r = wo.send(self, `${other.name}@${other.floor}`, message);
    return typeof r === 'string' ? answer(r) : answer({ id: r.thread, to: r.to.name });
  }
  if (legacy && action === '/hangup') return answer({ id: str(b.call, 32) || 'done' });
  return send(res, 404, { error: 'Not found' });
}
