// Watching a worker's folder for the live Code tab (see hub.ts): which files were added, changed or
// taken away, gathered for a moment (agents write in bursts) and handed over together. On a Mac or
// Windows one recursive watcher does it (the system's own); elsewhere (Linux) it's a watcher per
// folder, made as folders appear, with the build output, dependencies, git's and the office's own
// folders left out and a cap on how many, so a big checkout can't use up the system's watches.
import { watch, type FSWatcher } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CODE_CHANGES_MAX, type CodeChange } from '../../shared/protocol/code.js';

/** Folders never watched or reported: git's, the office's, dependencies and build output. */
export const IGNORED_DIRS = new Set(['.git', '.agent-office', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '__pycache__', 'venv', '.venv', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', '.svelte-kit']);

/** Whether a path in the folder is somewhere the live view stays out of, or a file nobody reads (an editor's swap file, an upload on its way in). */
export function ignoredPath(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => IGNORED_DIRS.has(p) || IGNORED_DIRS.has(p.toLowerCase()))) return true;
  const name = parts[parts.length - 1];
  return name.startsWith('.upload-') || name.endsWith('~') || /^\.#|\.sw[px]$|^\.DS_Store$|\.tmp\.\d+$/.test(name);
}

export interface WatchOptions {
  /** How long to wait for a burst of changes to settle before handing them over. */
  debounceMs?: number;
  /** Most folders watched one by one (where there's no recursive watching). */
  maxDirs?: number;
  /** Watch folder by folder even where recursive watching works (for tests). */
  perDir?: boolean;
  /** Of these new paths, the ones git ignores (so they don't show), when the folder's a git checkout. */
  gitIgnored?(paths: string[]): Promise<Set<string>>;
}

/** Recursive watching is the system's own (cheap) on these. */
const RECURSIVE = process.platform === 'darwin' || process.platform === 'win32';

export class FolderWatcher {
  private watchers = new Map<string, FSWatcher>();
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  /** The files there now, as far as it knows: to tell an added file from a changed one, and what went with a folder. */
  private known: Set<string>;
  private readonly debounceMs: number;
  private readonly maxDirs: number;

  constructor(
    private dir: string,
    files: readonly string[],
    private onChanges: (changes: CodeChange[], more: boolean) => void,
    private opts: WatchOptions = {},
  ) {
    this.known = new Set(files.filter((f) => !ignoredPath(f)));
    this.debounceMs = opts.debounceMs ?? 150;
    this.maxDirs = opts.maxDirs ?? 4000;
  }

  /** How many system watchers it holds. */
  get size() {
    return this.watchers.size;
  }

  async start(): Promise<void> {
    if (RECURSIVE && !this.opts.perDir) {
      this.add('', true);
      return;
    }
    // Folder by folder, breadth first, up to the cap.
    const queue = [''];
    while (queue.length && this.watchers.size < this.maxDirs && !this.closed) {
      const rel = queue.shift()!;
      if (!this.add(rel, false)) continue;
      for (const e of await readdir(path.join(this.dir, rel), { withFileTypes: true }).catch(() => [])) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory() && !ignoredPath(p)) queue.push(p);
      }
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  /** Watches folder `rel`; says whether it could. */
  private add(rel: string, recursive: boolean): boolean {
    if (this.closed || this.watchers.has(rel) || this.watchers.size >= this.maxDirs) return false;
    try {
      const w = watch(path.join(this.dir, rel), { recursive, persistent: false }, (_ev, name) => {
        if (name) this.saw(rel ? `${rel}/${String(name)}` : String(name));
      });
      w.on('error', () => this.drop(rel));
      this.watchers.set(rel, w);
      return true;
    } catch {
      return false;
    }
  }

  private drop(rel: string) {
    this.watchers.get(rel)?.close();
    this.watchers.delete(rel);
  }

  /** Something happened at `rel`: look at it once things settle. */
  saw(rel: string) {
    rel = rel.split(path.sep).join('/');
    if (this.closed || ignoredPath(rel)) return;
    this.pending.add(rel);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  private async flush() {
    const paths = [...this.pending];
    this.pending.clear();
    const out = new Map<string, CodeChange['kind']>();
    const fresh: string[] = [];
    for (const rel of paths) {
      if (out.size > CODE_CHANGES_MAX) break;
      const s = await lstat(path.join(this.dir, rel)).catch(() => undefined);
      if (s?.isFile()) {
        if (this.known.has(rel)) out.set(rel, 'changed');
        else fresh.push(rel);
      } else if (s?.isDirectory()) {
        // A folder turned up (made, or renamed into place): what's in it is new, and on Linux it needs a watcher.
        if (!RECURSIVE || this.opts.perDir) await this.watchTree(rel);
        for (const f of await this.filesUnder(rel)) if (!this.known.has(f)) fresh.push(f);
      } else if (!s) {
        // Gone: the file, or everything that was in the folder.
        if (this.known.delete(rel)) out.set(rel, 'removed');
        const prefix = `${rel}/`;
        for (const f of this.known) if (f.startsWith(prefix) && this.known.delete(f)) out.set(f, 'removed');
        if (this.watchers.has(rel)) this.drop(rel);
      }
    }
    const skip = fresh.length && this.opts.gitIgnored ? await this.opts.gitIgnored(fresh).catch(() => new Set<string>()) : new Set<string>();
    for (const f of fresh) {
      if (skip.has(f)) continue;
      this.known.add(f);
      out.set(f, 'added');
    }
    if (this.closed || !out.size) return;
    const changes = [...out].map(([p, kind]) => ({ path: p, kind }));
    this.onChanges(changes.slice(0, CODE_CHANGES_MAX), changes.length > CODE_CHANGES_MAX);
  }

  /** Watchers for a new folder and the folders in it. */
  private async watchTree(rel: string) {
    const queue = [rel];
    while (queue.length && this.watchers.size < this.maxDirs) {
      const r = queue.shift()!;
      if (!this.add(r, false) && !this.watchers.has(r)) continue;
      for (const e of await readdir(path.join(this.dir, r), { withFileTypes: true }).catch(() => [])) {
        const p = `${r}/${e.name}`;
        if (e.isDirectory() && !ignoredPath(p)) queue.push(p);
      }
    }
  }

  /** The files in a folder that just turned up, a few hundred at most. */
  private async filesUnder(rel: string): Promise<string[]> {
    const out: string[] = [];
    const queue = [rel];
    while (queue.length && out.length < CODE_CHANGES_MAX) {
      const r = queue.shift()!;
      for (const e of await readdir(path.join(this.dir, r), { withFileTypes: true }).catch(() => [])) {
        const p = `${r}/${e.name}`;
        if (ignoredPath(p)) continue;
        if (e.isDirectory()) queue.push(p);
        else if (e.isFile()) out.push(p);
      }
    }
    return out;
  }
}
