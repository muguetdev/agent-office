import { execFile } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { insideCheckout } from './changes.js';

// The code editor beside a worker's terminal (the client's ui/code.ts): the files in the folder the
// worker works in, to read and edit. Only what's inside that folder (no `..` out of it, no links out
// of it), only its project's files (git's list: tracked, or new and not ignored), never .git, and only
// text. A save says which version of the file it was made from: if the file's changed since (the
// worker edited it, or someone else saved it), it doesn't go through, so nobody's work is lost.

/** At most this many files in the tree, and this big a file to open. */
const MAX_FILES = 20_000;
export const MAX_CODE_BYTES = 1024 * 1024;
/** Folders the walk (without git) doesn't go into, besides hidden ones. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '__pycache__', 'venv']);

export type CodeError = { status: number; error: string };

/** A file's version: when it last changed and how big it is, which a save has to match. */
const versionOf = (s: { mtimeMs: number; size: number }) => `${Math.floor(s.mtimeMs)}-${s.size}`;

/** The paths git lists in `dir`, or undefined when it isn't a git checkout. */
function gitFiles(dir: string): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => {
        if (err) return resolve(undefined);
        resolve([...new Set(stdout.split('\0').filter(Boolean))]);
      },
    );
  });
}

/** Without git: the files under `dir`, not following links or going into hidden or build folders. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [''];
  while (queue.length && out.length < MAX_FILES) {
    const rel = queue.shift()!;
    let entries;
    try {
      entries = await readdir(path.join(dir, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) queue.push(p);
      } else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

/** Whether a path is somewhere the editor stays out of: git's own folder. */
const forbidden = (rel: string) => rel.split(/[\\/]/).includes('.git');

export class CodeFiles {
  constructor(
    /** The folder `workerId` works in, or undefined when there's no such worker. */
    private dirOf: (workerId: string) => string | undefined,
  ) {}

  /** The worker's files, sorted, and whether there were more than the tree shows. */
  async tree(workerId: string): Promise<{ files: string[]; truncated: boolean } | CodeError> {
    const dir = this.dirOf(workerId);
    if (!dir) return { status: 404, error: 'No such worker' };
    const all = ((await gitFiles(dir)) ?? (await walk(dir))).filter((f) => !forbidden(f)).sort();
    return { files: all.slice(0, MAX_FILES), truncated: all.length > MAX_FILES };
  }

  /** Where `file` is, if it's a file of the worker's own (inside its folder, not under .git). */
  private async locate(workerId: string, file: string): Promise<string | CodeError> {
    const dir = this.dirOf(workerId);
    if (!dir) return { status: 404, error: 'No such worker' };
    if (!file || forbidden(file)) return { status: 404, error: 'Not a file in this worker’s folder' };
    const abs = await insideCheckout(dir, file);
    if (!abs) return { status: 404, error: 'Not a file in this worker’s folder' };
    return abs;
  }

  /** A file's text and version, if it's text and not too big to edit. */
  async read(workerId: string, file: string): Promise<{ text: string; version: string } | CodeError> {
    const abs = await this.locate(workerId, file);
    if (typeof abs !== 'string') return abs;
    const s = await stat(abs).catch(() => undefined);
    if (!s?.isFile()) return { status: 404, error: 'Not a file' };
    if (s.size > MAX_CODE_BYTES) return { status: 413, error: `Too big to edit here (over ${MAX_CODE_BYTES / 1024 / 1024} MB)` };
    const body = await readFile(abs);
    if (body.includes(0)) return { status: 415, error: 'Not a text file' };
    return { text: body.toString('utf8'), version: versionOf(s) };
  }

  /** A file's version now, to see whether it changed under you. */
  async version(workerId: string, file: string): Promise<{ version: string } | CodeError> {
    const abs = await this.locate(workerId, file);
    if (typeof abs !== 'string') return abs;
    const s = await stat(abs).catch(() => undefined);
    return s?.isFile() ? { version: versionOf(s) } : { status: 404, error: 'Not a file' };
  }

  /** Saves `text` over the file, if it's still at version `base` (409 with what it's at now if not). */
  async write(workerId: string, file: string, text: string, base: string): Promise<{ version: string } | (CodeError & { version?: string })> {
    const abs = await this.locate(workerId, file);
    if (typeof abs !== 'string') return abs;
    const s = await stat(abs).catch(() => undefined);
    if (!s?.isFile()) return { status: 404, error: 'Not a file' };
    if (versionOf(s) !== base) return { status: 409, error: 'The file changed since you opened it', version: versionOf(s) };
    await writeFile(abs, text, 'utf8');
    return { version: versionOf(await stat(abs)) };
  }
}
