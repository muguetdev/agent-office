// The browser of a worker that has a machine of its own: Chrome DevTools MCP (chrome-devtools-mcp)
// pointed at its machine's Chrome, through the office's forward to it (see tunnels.ts), and a line in
// its instructions saying so. Each provider takes them its own way (see providers/*.ts).
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo } from '../../shared/protocol.js';

/** What the MCP server is called in the agent's tool list. */
export const MACHINE_MCP_NAME = 'computer';

/** The package and the version range it runs. */
export const MACHINE_MCP_PACKAGE = 'chrome-devtools-mcp@latest';

/** What the worker is told (a prompt, so in English whatever the office speaks). */
export const MACHINE_NOTE =
  `You have your own computer: a Linux desktop with Google Chrome, which you control with the "${MACHINE_MCP_NAME}" MCP tools ` +
  '(chrome-devtools: open pages, click, type, take screenshots). A person may be watching its screen live. ' +
  'Never type passwords or other credentials into it that you were not given for the task.';

/** npx beside the node the office runs on, else whichever is on the PATH. */
function npx(): string {
  const beside = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npx.cmd' : 'npx');
  return existsSync(beside) ? beside : 'npx';
}

export interface MachineMcp {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The MCP server for a worker's machine, or undefined for one without a machine. One whose machine isn't answering still gets it: its tools just fail until it is. */
export function machineMcp(info: Pick<WorkerInfo, 'machine' | 'kind'>): MachineMcp | undefined {
  const port = info.machine?.cdpLocalPort;
  if (info.kind !== 'agent' || !port || !Number.isInteger(port)) return undefined;
  return {
    command: npx(),
    args: ['-y', MACHINE_MCP_PACKAGE, '--browserUrl', `http://127.0.0.1:${port}`],
    env: { CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1' },
  };
}

/** Claude Code: an --mcp-config of its own (a JSON string), its tools allowed, and an --append-system-prompt. */
export function claudeMachineArgs(info: Pick<WorkerInfo, 'machine' | 'kind'>): { mcp?: string; append: string[] } {
  const m = machineMcp(info);
  if (!m) return { append: [] };
  return {
    mcp: JSON.stringify({ mcpServers: { [MACHINE_MCP_NAME]: { type: 'stdio', command: m.command, args: m.args, env: m.env } } }),
    // Its own browser, on its own computer, without asking each time (anyone on its floor can watch it).
    append: ['--allowedTools', `mcp__${MACHINE_MCP_NAME}`, '--append-system-prompt', MACHINE_NOTE],
  };
}

/** Codex: -c overrides for the MCP server and its developer instructions (TOML strings and arrays read JSON's). */
export function codexMachineArgs(info: Pick<WorkerInfo, 'machine' | 'kind'>): string[] {
  const m = machineMcp(info);
  if (!m) return [];
  const key = `mcp_servers.${MACHINE_MCP_NAME}`;
  return ['-c', `${key}.command=${JSON.stringify(m.command)}`, '-c', `${key}.args=${JSON.stringify(m.args)}`, '-c', `${key}.env=${tomlTable(m.env)}`, '-c', `developer_instructions=${JSON.stringify(MACHINE_NOTE)}`];
}

const tomlTable = (o: Record<string, string>) => `{ ${Object.entries(o).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }`;

/** OpenCode: its `mcp` config entry (its instructions are files, so it gets the tools without the note). */
export function openCodeMachineMcp(info: Pick<WorkerInfo, 'machine' | 'kind'>): Record<string, unknown> | undefined {
  const m = machineMcp(info);
  return m ? { [MACHINE_MCP_NAME]: { type: 'local', command: [m.command, ...m.args], environment: m.env, enabled: true } } : undefined;
}
