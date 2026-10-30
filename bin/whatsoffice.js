#!/usr/bin/env node
// whatsoffice: the workers' messages to each other, from a worker's terminal. Each pair of workers
// has one conversation, on whatever floors they are; a message waits there until the other reads it,
// and the office only tells that worker, in a line, that something's waiting. The office puts it on
// every worker's PATH (as office-phone too, for workers that knew it as the phone) with the worker's
// address and token in AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID and AGENT_OFFICE_HOOK_TOKEN;
// this talks to the /office/chat endpoint with them (src/server/hooks/office-chat.ts). The same calls
// are MCP tools (list_contacts, send_message, read_messages) in the office's MCP server
// (bin/office-workers.js mcp). Plain Node, no build step, no dependencies.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { send, UsageError } from './office-machine.js';

const USAGE = `Usage:
  whatsoffice contacts [--json]         who you can message: every agent on the floors you may
                                        reach, with its floor, project, what it's on, and unread
  whatsoffice send <name@floor> <<'EOF'
  …your message…                        message a worker (or --message "…"); its answer waits
  EOF                                   for you, and the office tells you when it comes
  whatsoffice read [name@floor]         read what's waiting for you (marks it read); with a
                                        worker, your conversation with it`;

const ENV = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'];
/** How long each call may take: the office answers straight away (the other side reads later). */
const TIMEOUT_MS = 15_000;

/** The office's address and this worker's id and token. */
function officeEnv(env) {
  const missing = ENV.filter((k) => !env[k]);
  if (missing.length) throw new Error(`${missing.join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} set. WhatsOffice only works inside Agent Office, from a worker's terminal.`);
  return { url: env.AGENT_OFFICE_HOOK_URL.replace(/\/+$/, ''), worker: env.AGENT_OFFICE_WORKER_ID, token: env.AGENT_OFFICE_HOOK_TOKEN };
}

/** Makes one call to the office; resolves to its JSON, or throws with why it said no. */
export async function chatCall(what, body, io) {
  const office = officeEnv(io.env);
  const url = new URL(`${office.url}/office/chat/${what}`);
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
  if (res.status === 404 && !answer.error) throw new Error("The office doesn't know WhatsOffice (404): it's running an older Agent Office. Restart or upgrade it.");
  if (res.status < 200 || res.status >= 300) throw new Error(answer.error || `The office said no (${res.status}).`);
  return answer;
}

/** The contacts, one per line. */
export function formatContacts(list) {
  const others = (list ?? []).filter((c) => !c.you);
  if (!others.length) return 'Nobody else is in the office.';
  return others.map((c) => `${c.address}  ·  ${c.floorName}${c.project ? ` (${c.project})` : ''}  ·  ${c.status}${c.task ? `  ·  ${c.task}` : ''}${c.unread ? `  ·  📬 ${c.unread} unread` : ''}`).join('\n');
}

/** What read gave back, as text for the agent. */
export function formatRead(r) {
  const convs = r.conversations ?? [];
  if (!convs.length) return 'Nothing new.';
  return convs
    .map((c) => [`── ${c.with} (reply with send_message to ${c.address}) ──`, ...c.messages.map((m) => `[${m.at.slice(0, 16).replace('T', ' ')}] ${m.from}: ${m.text}`)].join('\n'))
    .join('\n\n');
}

const sent = (r) => `Sent to ${r.to?.name ?? '?'} (${r.to?.floor ?? '?'}). Their answer waits for you; the office tells you when it comes, so carry on with what you can meanwhile.`;

// --- MCP tools, served by bin/office-workers.js mcp ---------------------------------------------

export const CHAT_TOOLS = [
  {
    name: 'list_contacts',
    title: 'Who you can message',
    description:
      "Every agent in the office you can message on WhatsOffice, on every floor: name@floor to reach it by, its floor and that floor's project (a repository, or a server), what it is doing now, and how many of its messages you haven't read. Each knows its own project well.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'send_message',
    title: 'Message a worker',
    description:
      "Sends a message to another worker in the office (on any floor), in your conversation with it: a question about how something in its project works, what you need from it for an integration, or your answer to what it asked. It reads it when it's free; its answer waits for you, and the office tells you when it comes (📬 …), so carry on with what you can meanwhile.",
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Who: name@floor from list_contacts (or its id, or just the name when only one is called that).' },
        message: { type: 'string', description: 'What to say: what you are working on and exactly what you need to know, or your answer.' },
      },
      required: ['to', 'message'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'read_messages',
    title: 'Read your messages',
    description: "Reads what's waiting for you on WhatsOffice (and marks it read); with `from`, your conversation with that worker, read or not.",
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'A worker (name@floor) to read your conversation with, instead of everything unread.' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

/** What the MCP server's instructions say about WhatsOffice, so an agent thinks of messaging on its own. */
export const CHAT_INSTRUCTIONS =
  "WhatsOffice, the office's messages: when your work touches another project or system in the office (another floor's repository, a server a floor manages, an API or service a colleague owns) " +
  "and you need to know how something there works, message the worker on that floor with send_message instead of guessing or reading code you don't have; list_contacts shows who is where. " +
  'Answers come later: the office tells you when something is waiting (📬 …), and read_messages shows it, so carry on with what you can meanwhile. When someone messages you, ' +
  'read it with read_messages, look into your own project as needed, and answer with send_message.';

/** Runs a WhatsOffice tool; resolves to its text. */
export async function runChatTool(name, args, io) {
  const a = args && typeof args === 'object' ? args : {};
  if (name === 'list_contacts') return { text: formatContacts((await chatCall('contacts', undefined, io)).contacts) };
  if (name === 'send_message') return { text: sent(await chatCall('send', { to: a.to, message: a.message }, io)) };
  if (name === 'read_messages') return { text: formatRead(await chatCall('read', a.from ? { from: a.from } : {}, io)) };
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
    let message;
    const i = rest.findIndex((a) => a === '--message' || a.startsWith('--message='));
    if (i >= 0) message = rest[i].includes('=') ? rest.splice(i, 1)[0].slice('--message='.length) : rest.splice(i, 2)[1];
    const json = rest.includes('--json');
    const words = rest.filter((a) => a !== '--json');
    officeEnv(env);
    if (cmd === 'contacts') {
      const r = await chatCall('contacts', undefined, ctx);
      out(json ? JSON.stringify(r.contacts, null, 2) : formatContacts(r.contacts));
      return 0;
    }
    if (cmd === 'read' || cmd === 'inbox') {
      const r = await chatCall('read', words[0] ? { from: words[0] } : {}, ctx);
      out(json ? JSON.stringify(r, null, 2) : formatRead(r));
      return 0;
    }
    // The phone's words still work: a call or a reply is a message.
    if (cmd === 'send' || cmd === 'call' || cmd === 'reply') {
      const to = words[0];
      if (!to) throw new UsageError('Say who: name@floor (whatsoffice contacts lists them)');
      if (message === undefined) {
        if (stdin.isTTY) throw new UsageError(`Give the message on stdin (whatsoffice send ${to} <<'EOF' … EOF) or with --message "…"`);
        message = await readStdin(stdin);
      }
      err(sent(await chatCall('send', { to, message: String(message) }, ctx)));
      return 0;
    }
    if (cmd === 'hangup' || cmd === 'hang-up') return 0;
    throw new UsageError(`Unknown command: ${cmd}`);
  } catch (e) {
    err(`whatsoffice: ${e.message}`);
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
