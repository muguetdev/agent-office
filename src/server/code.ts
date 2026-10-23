import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { insideCheckout } from './changes.js';
import { UPLOAD_MAX_BYTES } from '../shared/uploads.js';

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

/** Whether `abs` is `root` or inside it. */
const within = (root: string, abs: string) => {
  const rel = path.relative(root, abs);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

/**
 * The parts of a path an upload may go to, or undefined: relative, no `.`, `..` or empty parts, no
 * NULs, and nowhere under git's own folder or the office's (.agent-office), whatever their case
 * (a Mac's disk doesn't tell .GIT from .git).
 */
export function uploadParts(rel: string): string[] | undefined {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) return undefined;
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => !p || p === '.' || p === '..' || p.length > 255)) return undefined;
  if (parts.some((p) => ['.git', '.agent-office'].includes(p.toLowerCase()))) return undefined;
  return parts;
}

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

  /**
   * Puts `bytes` (any file, text or not) at `file` in the worker's folder, making the folders on the
   * way. Never over a file that's there unless `replace` (409 with `exists` if it's there). Each
   * folder is made or checked one at a time, so a link on the way out of the folder is caught before
   * anything's made past it; the file goes in under a name of its own and is renamed into place, so
   * a link at its name is replaced, never written through.
   */
  async upload(workerId: string, file: string, bytes: Buffer, replace: boolean): Promise<{ path: string; version: string } | (CodeError & { exists?: true })> {
    const dir = this.dirOf(workerId);
    if (!dir) return { status: 404, error: 'No such worker' };
    if (bytes.length > UPLOAD_MAX_BYTES) return { status: 413, error: 'Too big to upload' };
    const parts = uploadParts(file);
    if (!parts) return { status: 403, error: 'Not somewhere in this worker’s folder you can upload to' };
    try {
      const root = await realpath(dir);
      let at = root;
      for (const part of parts.slice(0, -1)) {
        const next = path.join(at, part);
        const s = await lstat(next).catch(() => undefined);
        if (!s) await mkdir(next);
        const real = await realpath(next);
        if (!within(root, real)) return { status: 403, error: 'That folder leads out of this worker’s folder' };
        if (!(await stat(real)).isDirectory()) return { status: 409, error: 'There’s a file where that folder would go' };
        at = real;
      }
      const abs = path.join(at, parts[parts.length - 1]);
      const there = await lstat(abs).catch(() => undefined);
      if (there?.isDirectory()) return { status: 409, error: 'There’s a folder by that name' };
      if (there && !replace) return { status: 409, error: 'A file by that name is already there', exists: true };
      const tmp = path.join(at, `.upload-${randomBytes(8).toString('hex')}`);
      try {
        await writeFile(tmp, bytes, { flag: 'wx' });
        // Not replacing: something that turned up there meanwhile still isn't overwritten.
        if (!replace && (await lstat(abs).catch(() => undefined))) return { status: 409, error: 'A file by that name is already there', exists: true };
        await rename(tmp, abs);
      } finally {
        await rm(tmp, { force: true });
      }
      return { path: parts.join('/'), version: versionOf(await stat(abs)) };
    } catch (err) {
      return { status: 500, error: (err as Error).message };
    }
  }
}
