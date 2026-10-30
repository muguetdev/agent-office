#!/usr/bin/env node
// office-phone: the office phone, from a worker's terminal. A worker calls another on any floor (to
// ask how something in that one's project works, or to work out an integration together), and what
// each says reaches the other's session as a message from the office, once it's free to read it.
// The office puts it on every worker's PATH with the worker's address and token in
// AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID and AGENT_OFFICE_HOOK_TOKEN; this talks to the
// /office/phone endpoint with them (src/server/hooks/office-phone.ts). The same calls are MCP tools
// (list_contacts, call_worker, reply_call, hang_up) in the office's MCP server (bin/office-workers.js
// mcp). Plain Node, no build step, no dependencies.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { send, UsageError } from './office-machine.js';

const ENV = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'];

/** The office's address and this worker's id and token. */
function officeEnv(env) {
  const missing = ENV.filter((k) => !env[k]);
  if (missing.length) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} set. The office phone only works inside Agent Office, from a worker's terminal.`);
  return { url: env.AGENT_OFFICE_HOOK_URL.replace(/\/+$/, ''), worker: env.AGENT_OFFICE_WORKER_ID, token: env.AGENT_OFFICE_HOOK_TOKEN };
}

const USAGE = `Usage:
  office-phone contacts [--json]          who you can call: every agent on the floors you may reach,
                                          with its floor, project and what it's on now
  office-phone call <name@floor|id> <<'EOF'
  …what you want to ask or tell…          call a worker (or --message "…"); its answer reaches you
  EOF                                     later, as a message from the office
  office-phone reply <call-id> <<'EOF'    say something on a call (or --message "…")
  office-phone hangup [call-id]           end a call (your only one, without an id)`;

/** How long each call may take: the office answers straight away (the other side hears later). */
const TIMEOUT_MS = 15_000;

/** Makes one call to the office; resolves to its JSON, or throws with why it said no. */
export async function phoneCall(what, body, io) {
  const office = officeEnv(io.env);
  const url = new URL(`${office.url}/office/phone/${what}`);
  url.searchParams.set('worker', office.worker);
  const headers = { authorization: `Bearer ${office.token}` };
  const req =
    what === 'contacts'
      ? { method: 'GET', url: url.href, headers, timeout: TIMEOUT_MS }
      : { method: 'POST', url: url.href, headers: { ...headers, 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body ?? {})), timeout: TIMEOUT_MS };
  const res = await (io.send ?? send)(req);
  let answer;
  try {
    answer = JSON.parse(res.data.toString('utf8') || '{}');
  } catch {
    answer = { error: res.data.toString('utf8').slice(0, 300) };
  }
  if (res.status === 401) throw new Error(`The office didn't accept this worker's token (401)${answer.error ? `: ${answer.error}` : ''}.`);
  if (res.status === 404 && !answer.error) throw new Error("The office doesn't know the phone (404): it's running an older Agent Office. Restart or upgrade it.");
  if (res.status < 200 || res.status >= 300) throw new Error(answer.error || `The office said no (${res.status}).`);
  return answer;
}

/** The contacts, one per line. */
export function formatContacts(list) {
  if (!list?.length) return 'Nobody else is in the office.';
  return list
    .filter((c) => !c.you)
    .map((c) => `${c.address}  ·  ${c.floorName}${c.project ? ` (${c.project})` : ''}  ·  ${c.status}${c.task ? `  ·  ${c.task}` : ''}`)
    .join('\n');
}

const called = (r) => `Called ${r.to?.name ?? '?'} on ${r.to?.floorName ?? '?'} (call ${r.id}). Their answer will reach you as a message from the office: carry on with what you can meanwhile.`;

// --- MCP tools, served by bin/office-workers.js mcp ---------------------------------------------

export const PHONE_TOOLS = [
  {
    name: 'list_contacts',
    title: 'Who you can call',
    description:
      'Every agent in the office you can call on the office phone, on every floor: name@floor to call it by, its floor and that floor\'s project (a repository, or a server), and what it is doing now. Each knows its own project well.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'call_worker',
    title: 'Call a worker',
    description:
      "Calls another worker in the office (on any floor) with a message: a question about how something in its project works, or what you need from it for an integration. The message reaches its session once it's free; its answer reaches you later as a message from the office (📞 …), so carry on with what you can meanwhile. Reply on the call with reply_call; hang_up when done.",
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Who: name@floor from list_contacts (or its id, or just the name when only one is called that).' },
        message: { type: 'string', description: 'What to ask or tell them: say what you are working on and exactly what you need to know.' },
      },
      required: ['to', 'message'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'reply_call',
    title: 'Say something on a call',
    description: 'Says something on an office phone call you are on (answering a question, or following up): it reaches the other worker\'s session.',
    inputSchema: {
      type: 'object',
      properties: {
        call_id: { type: 'string', description: 'The call, as its message said (call 1a2b3c). Not needed when you are on just one.' },
        message: { type: 'string', description: 'What to say.' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'hang_up',
    title: 'End a call',
    description: 'Ends an office phone call once you have what you needed (or answered what they asked).',
    inputSchema: {
      type: 'object',
      properties: { call_id: { type: 'string', description: 'The call. Not needed when you are on just one.' } },
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

/** What the MCP server's instructions say about the phone, so an agent thinks of calling on its own. */
export const PHONE_INSTRUCTIONS =
  'The office phone: when your work touches another project or system in the office (another floor\'s repository, a server a floor manages, an API or service a colleague owns) ' +
  "and you need to know how something there works, call the worker on that floor with call_worker instead of guessing or reading code you don't have; list_contacts shows who is where. " +
  'Calls are answered asynchronously: the answer reaches you later as a message from the office (📞 …), so carry on with what you can meanwhile. When a call reaches you, answer it with reply_call ' +
  'after looking into your own project as needed, and hang_up when you are both done.';

/** Runs a phone tool; resolves to its text. */
export async function runPhoneTool(name, args, io) {
  const a = args && typeof args === 'object' ? args : {};
  if (name === 'list_contacts') return { text: formatContacts((await phoneCall('contacts', undefined, io)).contacts) };
  if (name === 'call_worker') return { text: called(await phoneCall('call', { to: a.to, message: a.message }, io)) };
  if (name === 'reply_call') {
    const r = await phoneCall('reply', { call: a.call_id, message: a.message }, io);
    return { text: `Said on call ${r.id}; it reaches ${r.to} once they're free.` };
  }
  if (name === 'hang_up') return { text: `Hung up call ${(await phoneCall('hangup', { call: a.call_id }, io)).id}.` };
  throw new Error(`Unknown tool: ${name}`);
}

function readStdin(stdin) {
  return new Promise((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (c) => (data += c));
    stdin.on('end', () => resolve(data));
    stdin.on('error', reject);
  });
}

/**
 * Runs the command; resolves to its exit code.
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, stdin?: any, send?: typeof send, out?: (s: string) => void, err?: (s: string) => void }} [io]
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdin = io.stdin ?? process.stdin;
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'));
  const err = io.err ?? ((s) => process.stderr.write(s + '\n'));
  const ctx = { env, send: io.send };
  try {
    const [cmd, ...rest] = argv;
    if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
      out(USAGE);
      return 0;
    }
    const flag = (name) => {
      const i = rest.findIndex((a) => a === name || a.startsWith(`${name}=`));
      if (i < 0) return undefined;
      const a = rest.splice(i, rest[i].includes('=') ? 1 : 2);
      return a[0].includes('=') ? a[0].slice(a[0].indexOf('=') + 1) : a[1];
    };
    const json = rest.includes('--json');
    const words = () => rest.filter((a) => a !== '--json');
    const message = async () => {
      const m = flag('--message');
      if (m !== undefined) return String(m);
      if (stdin.isTTY) throw new UsageError(`Give the message on stdin (office-phone ${cmd} … <<'EOF' … EOF) or with --message "…"`);
      return readStdin(stdin);
    };
    officeEnv(env);
    if (cmd === 'contacts') {
      const r = await phoneCall('contacts', undefined, ctx);
      out(json ? JSON.stringify(r.contacts, null, 2) : formatContacts(r.contacts));
      return 0;
    }
    if (cmd === 'call') {
      const text = await message();
      const [to] = words();
      if (!to) throw new UsageError('Say who to call: name@floor (office-phone contacts lists them)');
      err(called(await phoneCall('call', { to, message: text }, ctx)));
      return 0;
    }
    if (cmd === 'reply') {
      const text = await message();
      const [id] = words();
      const r = await phoneCall('reply', { call: id, message: text }, ctx);
      err(`Said on call ${r.id}; it reaches ${r.to} once they're free.`);
      return 0;
    }
    if (cmd === 'hangup' || cmd === 'hang-up') {
      const [id] = words();
      err(`Hung up call ${(await phoneCall('hangup', { call: id }, ctx)).id}.`);
      return 0;
    }
    throw new UsageError(`Unknown command: ${cmd}`);
  } catch (e) {
    err(`office-phone: ${e.message}`);
    if (e instanceof UsageError) err(`\n${USAGE}`);
    return e instanceof UsageError ? 2 : 1;
  }
}

const invoked = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invoked) process.exitCode = await main(process.argv.slice(2));
