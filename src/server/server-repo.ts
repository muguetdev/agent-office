// A server's floor's linked repository (FloorDef.repo on a floor that's a server, see servers.ts): its
// code, cloned into a folder named after it inside the floor's folder (`<floor>/crivo` for
// muguetdev/crivo), for the floor's workers to read, edit, commit and push. The floor's folder itself
// stays the office's (its AGENTS.md, CLAUDE.md and .agent-office), and the workers keep working from
// there, so `ssh <floor id>` and the rest of the floor's bin go on working as they did. The clone is
// the same `gh repo clone` the office adds floors with (clone.ts); unlinking the repository leaves it.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkoutAt, type FloorDef } from './building.js';
import { CloneRun, dropLog, whyCloneFailed, type CloneRunOptions } from './clone.js';
import { gh } from './github.js';
import { L } from './i18n.js';
import { repoFolder } from './servers.js';

/** Where a server's floor's repository is cloned, or undefined when it isn't a server's floor with one. */
export function repoDir(def: Pick<FloorDef, 'dir' | 'repo' | 'ssh'>): string | undefined {
  return def.ssh && def.repo ? path.join(def.dir, repoFolder(def.repo)) : undefined;
}

const BRANCH_TTL_MS = 5 * 60_000;
const branches = new Map<string, { at: number; branch: string | null }>();

/** The branch a clone's origin is on (what `gh repo clone` checked out), asked of git now and then. */
function defaultBranch(dir: string): string | null {
  const known = branches.get(dir);
  if (known && Date.now() - known.at < BRANCH_TTL_MS) return known.branch;
  let branch: string | null = null;
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    branch = ref.replace(/^origin\//, '') || null;
  } catch {
    // no origin/HEAD: diffs are taken against what isn't pushed yet
  }
  branches.set(dir, { at: Date.now(), branch });
  return branch;
}

/**
 * The checkout a server's floor's workers work on, once it's cloned: what the Changes window diffs
 * and the 📝 Code tab shows for a worker there (the floor's folder itself isn't a git checkout).
 * `rel` is its folder in the floor's, `baseBranch` the branch diffs are taken against and PRs target.
 */
export function serverCheckout(def: Pick<FloorDef, 'dir' | 'repo' | 'ssh'>): { cwd: string; rel: string; baseBranch: string | null } | undefined {
  const dir = repoDir(def);
  if (!dir || !existsSync(path.join(dir, '.git'))) return undefined;
  return { cwd: dir, rel: path.basename(dir), baseBranch: defaultBranch(dir) };
}

/** How getting the repository's code into the floor's folder went. */
export type RepoResult = { ok: true; cloned: boolean; dir: string } | { ok: false; error: string };

export interface RepoOptions {
  /** Hears that a clone is starting (not when the code's there already). */
  started?: () => void;
  /** Fetches origin into a clone that's there already (on by default; tests turn it off). */
  fetch?: boolean;
  clone?: Pick<CloneRunOptions, 'stallMs' | 'tickMs'>;
}

/** Clones under way, by the folder they go in: linking twice doesn't clone twice. */
const running = new Map<string, Promise<RepoResult>>();

/** A clone under way, as the floor's .agent-office/repo-clone.json keeps it for the next office (a restart mid-clone). */
interface SavedClone {
  pid: number;
  log: string;
  dest: string;
  empty: boolean;
}

/**
 * Makes sure a server's floor has its repository's code in its folder: clones it when it isn't
 * there, leaves (and fetches) a clone of it that is, and says why when something else is in the way.
 * Undefined when the floor isn't a server's with a repository.
 */
export function ensureServerRepo(def: Pick<FloorDef, 'dir' | 'repo' | 'ssh'>, opts: RepoOptions = {}): Promise<RepoResult> | undefined {
  const dest = repoDir(def);
  if (!dest || !def.repo) return undefined;
  const busy = running.get(dest);
  if (busy) return busy;
  const p = ensure(def.repo, dest, path.join(def.dir, '.agent-office'), opts).finally(() => running.delete(dest));
  running.set(dest, p);
  return p;
}

async function ensure(repo: string, dest: string, dataDir: string, opts: RepoOptions): Promise<RepoResult> {
  const savedFile = path.join(dataDir, 'repo-clone.json');
  const cloneOpts = { ...opts.clone };
  // One an office before this one started (it restarted mid-clone), still going: wait for it.
  const before = readSaved(savedFile);
  if (before?.dest === dest) {
    const run = CloneRun.adopt(before.pid, before.log, cloneOpts);
    if (run) {
      opts.started?.();
      return settle(repo, dest, before.empty, run, savedFile);
    }
  }
  if (before) {
    dropLog(before.log);
    rmSync(savedFile, { force: true });
  }
  if (checkoutAt(dest, repo, false) === 'ok') {
    if (opts.fetch !== false) fetchOrigin(dest);
    return { ok: true, cloned: false, dir: dest };
  }
  // Asking GitHub first says whether the office's login can see it, and whether it has any commits yet.
  let empty = false;
  try {
    const view = JSON.parse(await gh(['repo', 'view', repo, '--json', 'nameWithOwner,isEmpty'], dataDir, 30_000)) as { isEmpty?: boolean };
    empty = view.isEmpty === true;
  } catch (err) {
    return { ok: false, error: L.srvBuilding.notFound(repo, (err as Error).message) };
  }
  const there = checkoutAt(dest, repo, empty);
  if (there === 'ok') return { ok: true, cloned: false, dir: dest };
  if (there !== 'none') return { ok: false, error: there };
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return { ok: false, error: L.clone.couldntMake(dataDir, (err as Error).message) };
  }
  opts.started?.();
  const log = path.join(dataDir, 'repo-clone.log');
  const run = await CloneRun.start(repo, dest, log, cloneOpts);
  if (typeof run === 'string') return { ok: false, error: run };
  try {
    writeFileSync(savedFile, JSON.stringify({ pid: run.pid, log, dest, empty } satisfies SavedClone), { mode: 0o600 });
  } catch {
    // only for picking it up after a restart
  }
  return settle(repo, dest, empty, run, savedFile);
}

async function settle(repo: string, dest: string, empty: boolean, run: CloneRun, savedFile: string): Promise<RepoResult> {
  const end = await run.done;
  dropLog(run.log);
  rmSync(savedFile, { force: true });
  if (end.stopped) return { ok: false, error: end.stopped };
  // Its exit code isn't the word on it (an adopted clone has none): the checkout is.
  if (checkoutAt(dest, repo, empty) === 'ok') return { ok: true, cloned: true, dir: dest };
  return { ok: false, error: L.clone.failed(repo, whyCloneFailed(end.output)) };
}

function readSaved(file: string): SavedClone | undefined {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')) as Partial<SavedClone>;
    if (Number.isInteger(s.pid) && (s.pid as number) > 0 && typeof s.log === 'string' && path.dirname(s.log) === path.dirname(file) && typeof s.dest === 'string') {
      return { pid: s.pid as number, log: s.log, dest: s.dest, empty: s.empty === true };
    }
  } catch {
    // none
  }
  return undefined;
}

/** Brings the clone's origin branches up to date, in the background (never asking for a password). */
function fetchOrigin(dir: string) {
  try {
    const child = spawn('git', ['fetch', '--quiet', 'origin'], { cwd: dir, stdio: 'ignore', timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no git: the clone is there as it is
  }
}
