import path from 'node:path';
import { isAgentEffort, isClaudeModel, type AgentProvider } from '../shared/protocol.js';
import { L } from './i18n.js';

export const OPEN_CODE_MODEL_MAX = 256;

/**
 * Finds the provider represented by the configured executable.  Keep this deliberately based on
 * the final path component: --agent may be an absolute path, and Windows paths can be supplied
 * while the office itself is running under a POSIX shell.
 */
export function configuredProvider(command: string): AgentProvider {
  const base = path.basename(command.replaceAll('\\', '/')).toLowerCase().replace(/\.exe$/, '');
  if (base === 'claude') return 'claude';
  if (base === 'opencode') return 'opencode';
  if (base === 'codex') return 'codex';
  return 'custom';
}

/** The providers an office started with `configured` can hire: the three it knows, and a custom --agent only when that's what it was started with. */
export function agentProviders(configured: AgentProvider): AgentProvider[] {
  return configured === 'custom' ? ['claude', 'opencode', 'codex', 'custom'] : ['claude', 'opencode', 'codex'];
}

/** OpenCode model ids are argv values, so reject anything that could be ambiguous or unsafe. */
export function isValidOpenCodeModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > OPEN_CODE_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  const parts = value.split('/');
  return parts.length >= 2 && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(parts[0]) && parts.slice(1).every((part) => part.length > 0);
}

export function validateWorkerModel(kind: 'agent' | 'shell', provider: AgentProvider | undefined, model: unknown): string | undefined {
  if (model === undefined) return undefined;
  if (kind === 'shell') return L.srvAgents.shellNoModel;
  if (provider === 'claude') return isClaudeModel(model) ? undefined : L.srvAgents.badClaudeModel;
  if (provider !== 'opencode') return L.srvAgents.modelsOnly;
  if (!isValidOpenCodeModel(model)) return L.srvAgents.badOpenCodeModel;
  return undefined;
}

/** Claude Code's own `--effort` flag; no other provider this office launches supports one yet. */
export function validateWorkerEffort(kind: 'agent' | 'shell', provider: AgentProvider | undefined, effort: unknown): string | undefined {
  if (effort === undefined) return undefined;
  if (kind === 'shell') return L.srvAgents.shellNoEffort;
  if (provider !== 'claude') return L.srvAgents.effortOnly;
  return isAgentEffort(effort) ? undefined : L.srvAgents.badEffort;
}
