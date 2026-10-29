// A floor that's a server instead of a repository: a folder of its own on the office's machine, where
// its workers run as on any floor, and an SSH key the office made for it alone, whose public half goes
// in the server's authorized_keys. Every worker on the floor reaches the server as `ssh <floor id>`
// (an ssh, scp and sftp of the floor's own, in its bin, that know the way in), and a 🐚 shell at one
// of its desks opens on the server itself.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SshTarget } from '../shared/protocol.js';
import { L } from './i18n.js';

export const SSH_PORT = 22;
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/;
const USER_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/;

/** A server to reach, as someone typed it in, or what's wrong with it. */
export function sshTarget(host: unknown, user: unknown, port: unknown): SshTarget | string {
  const h = typeof host === 'string' ? host.trim() : '';
  const u = typeof user === 'string' ? user.trim() : '';
  const p = port === undefined || port === '' ? SSH_PORT : Number(port);
  if (!HOST_RE.test(h)) return L.servers.badHost;
  if (!USER_RE.test(u)) return L.servers.badUser;
  if (!Number.isInteger(p) || p < 1 || p > 65535) return L.servers.badPort;
  return { host: h, user: u, port: p };
}

export const isSshTarget = (v: unknown): v is SshTarget => {
  const t = v as Partial<SshTarget> | null;
  return !!t && typeof t === 'object' && typeof sshTarget(t.host, t.user, t.port) === 'object';
};

/** Where the office keeps its servers' keys, their config and the host keys it has seen. */
const keysDir = (dataDir: string) => path.join(dataDir, 'ssh');
const keyFile = (dataDir: string, id: string) => path.join(keysDir(dataDir), id);
export const configFile = (dataDir: string, id: string) => path.join(keysDir(dataDir), `${id}.config`);

/** The floor's key: made the first time, kept after. Returns its public half (one line, for authorized_keys). */
export function makeKey(dataDir: string, id: string): string {
  const file = keyFile(dataDir, id);
  mkdirSync(keysDir(dataDir), { recursive: true, mode: 0o700 });
  if (!existsSync(file)) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `agent-office-${id}`, '-f', file], { stdio: 'ignore' });
  return publicKey(dataDir, id)!;
}

export function publicKey(dataDir: string, id: string): string | undefined {
  try {
    return readFileSync(`${keyFile(dataDir, id)}.pub`, 'utf8').trim();
  } catch {
    return undefined;
  }
}

/** The floor's server, under its id as the host's name, with its key and nobody else's; the rest of ssh as usual. */
function writeConfig(dataDir: string, id: string, t: SshTarget): string {
  const file = configFile(dataDir, id);
  const lines = [
    `Host ${id}`,
    `  HostName ${t.host}`,
    `  User ${t.user}`,
    `  Port ${t.port}`,
    `  IdentityFile ${keyFile(dataDir, id)}`,
    '  IdentitiesOnly yes',
    // The first time, its host key is taken and kept; a different one after that is refused.
    '  StrictHostKeyChecking accept-new',
    `  UserKnownHostsFile ${path.join(keysDir(dataDir), 'known_hosts')}`,
    '  ServerAliveInterval 30',
    '',
    'Host *',
    '  Include ~/.ssh/config',
    '',
  ];
  writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  return file;
}

const which = (cmd: string) => {
  try {
    return execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
};

/** What's the office's in a server's floor's folder: a repository named like one of these goes in `<name>-code`. */
const RESERVED = new Set(['.agent-office', '.git', 'agents.md', 'claude.md']);

/** The folder in a server's floor's folder its linked repository is cloned into (see server-repo.ts): the repository's name. */
export function repoFolder(repo: string): string {
  const name = repo.split('/').pop() || repo;
  return RESERVED.has(name.toLowerCase()) ? `${name}-code` : name;
}

/** Where the project's code is, for the note, when the floor has a repository linked. */
const codeNote = (id: string, repo: string) => {
  const dir = `./${repoFolder(repo)}`;
  return `
## The project's code

The code of ${repo}, the project this server runs, is cloned at \`${dir}\` in this folder (if it isn't
there yet, the office is still cloning it). Read, edit, commit and push there: git and gh work as usual.
The server itself is reached with \`ssh ${id}\`. To deploy, follow the project's own deploy docs (look in
\`${dir}\`) or ask. Never edit the code directly on the server unless you're asked to.
`;
};

/**
 * What the agents on a server's floor read first (AGENTS.md, and CLAUDE.md for Claude Code): a prompt,
 * so it's in English whatever the office speaks. With `repo`, where its code is cloned too.
 */
export const agentNote = (id: string, at: string, repo?: string) => `# This floor is a server

Everything here is about the server ${at}. You run on the office's machine, in this folder; the server
is reached with \`ssh ${id}\` (it already has its address, user and key):

- \`ssh ${id} '<command>'\` runs a command there
- \`scp\`, \`sftp\` and \`rsync -e ssh\` copy files to and from \`${id}:<path>\`

It's a live server: say what you're going to change before you change it, keep a backup of a file you
edit (\`cp file file.bak\`), and don't restart services or reboot it without being asked.

## Where to build

The office's machine is shared by every worker on every floor and short on memory: don't compile,
install toolchains or packages, or run test suites or Docker here. Do that on the server, in a folder of
its own away from what's deployed (\`~/build/<name>\`): copy the code over with
\`rsync -az --exclude .git ./<dir>/ ${id}:build/<dir>/\`, then \`ssh ${id} 'cd ~/build/<dir> && <build or test>'\`.
Read, edit, commit and push here; build and test there.
${repo ? codeNote(id, repo) : ''}`;

/** Writes the note in the floor's folder, again whenever its repository is linked or unlinked. */
export function writeAgentNote(folder: string, id: string, t: SshTarget, repo?: string) {
  const note = agentNote(id, `${t.user}@${t.host}${t.port === SSH_PORT ? '' : `:${t.port}`}`, repo);
  for (const file of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(path.join(folder, file), note);
}

const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * Gets a server floor ready, each time it opens: its key, its config, the ssh, scp and sftp in its
 * bin (`bin`, on its workers' PATH), and a note in its folder for the agents (with where `repo`'s
 * code is, when it has one). Returns what a 🐚 shell at one of its desks runs: ssh to the server,
 * and a shell here once that's over.
 */
export function prepareServer(dataDir: string, id: string, t: SshTarget, folder: string, bin: string, repo?: string): string[] {
  makeKey(dataDir, id);
  const config = writeConfig(dataDir, id, t);
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  for (const cmd of ['ssh', 'scp', 'sftp']) {
    const real = which(cmd);
    if (real) writeFileSync(path.join(bin, cmd), `#!/bin/sh\n# ${cmd} that knows this floor's server (see server/servers.ts).\nexec ${shq(real)} -F ${shq(config)} "$@"\n`, { mode: 0o700 });
  }
  mkdirSync(folder, { recursive: true });
  writeAgentNote(folder, id, t, repo);
  return ['-l', '-c', `${shq(path.join(bin, 'ssh'))} ${id}; exec "\${SHELL:-/bin/sh}" -l`];
}

/** Whether the office gets in with its key: what the server said, or why it didn't. */
export function testServer(dataDir: string, id: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile('ssh', ['-F', configFile(dataDir, id), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', id, 'echo "$(whoami)@$(hostname)"; uname -sr'], { timeout: 15_000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, output: (err ? stderr || err.message : stdout).trim().slice(0, 2000) }),
    );
  });
}

/** The floor's taken off the building: its key and config go with it. */
export function forgetServer(dataDir: string, id: string) {
  for (const file of [keyFile(dataDir, id), `${keyFile(dataDir, id)}.pub`, configFile(dataDir, id)]) rmSync(file, { force: true });
}
