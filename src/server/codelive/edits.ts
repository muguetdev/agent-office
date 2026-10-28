// Which file an agent is editing, from its hook events, for the Code tab's 👀 Follow (see hub.ts).
// Only Claude Code's hooks (and a custom agent that speaks them) say which file a tool call is on:
// Codex, Grok and Muse report the tool's name alone, and OpenCode its status, so for those the Code
// tab follows the file that changed last instead.
import path from 'node:path';

/** Tools that write a file, by the names agents give them. */
const EDIT_TOOLS = /^(?:Edit|MultiEdit|Write|NotebookEdit|str_replace_based_edit_tool|str_replace_editor|create_file|edit_file|write_file|apply_patch)$/;

/**
 * The file a PreToolUse event's tool call is editing, relative to the worker's folder `cwd`, or
 * undefined: not an edit, no path given, or a path outside the folder.
 */
export function editedPath(payload: unknown, cwd: string): { path: string; tool: string } | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as { tool_name?: unknown; tool_input?: unknown; cwd?: unknown };
  const tool = typeof p.tool_name === 'string' ? p.tool_name : '';
  if (!EDIT_TOOLS.test(tool) || !p.tool_input || typeof p.tool_input !== 'object') return undefined;
  const input = p.tool_input as Record<string, unknown>;
  const raw = [input.file_path, input.path, input.notebook_path, input.filename].find((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 4096);
  if (!raw || raw.includes('\0')) return undefined;
  const base = typeof p.cwd === 'string' && path.isAbsolute(p.cwd) ? p.cwd : cwd;
  const abs = path.resolve(base, raw);
  const rel = path.relative(cwd, abs);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return undefined;
  const parts = rel.split(path.sep);
  if (parts.some((x) => x === '.git' || x === '.agent-office')) return undefined;
  return { path: parts.join('/'), tool };
}
