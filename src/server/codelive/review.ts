// Reviewing a worker's edits in its Code tab, as in Cursor: each file is compared with a baseline,
// what it was the last time someone accepted it, and every hunk can be accepted (the baseline moves
// up to it) or rejected (the file goes back to the baseline there). The baseline starts as a
// snapshot taken the first time anyone opens the worker's Code tab (its commit, plus whatever it
// had changed and not committed yet), and ✓ Accept all takes a new one. It's kept per worker in the
// floor's .agent-office folder, never in the project. Rejecting writes through the same checked
// saves as the editor's (code.ts), and only over the file the person saw.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_CODE_BYTES, uploadParts, type CodeError, type CodeFiles } from '../code.js';
import { countHunks, diffTexts } from '../../shared/linediff.js';
import { ignoredPath } from './watch.js';

/** One file that differs from its baseline. */
export interface ReviewFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  added: number;
  removed: number;
  /** The baseline's hash and the file's now (see hashOf): what accepting or rejecting it is checked against. */
  base: string;
  sig: string;
}

/** What's kept per worker: the commit the baseline is at, and the files whose baseline isn't what that commit has (null: not there). */
interface ReviewState {
  commit: string | null;
  files: Record<string, string | null>;
}

/** Most files listed for review, kept in a snapshot, and bytes kept in one. */
export const MAX_REVIEW_FILES = 300;
const MAX_SNAPSHOT_FILES = 2000;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

/** A text's hash, or 'none' for a file that isn't there. */
export const hashOf = (text: string | null) => (text === null ? 'none' : createHash('sha1').update(text).digest('hex').slice(0, 16));

const conflict = (): CodeError => ({ status: 409, error: 'The file or its review changed since you looked' });

function git(args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) =>
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_CODE_BYTES * 4, timeout: 20_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, out) => resolve(err ? undefined : out)),
  );
}
const zList = (out: string | undefined) => (out ?? '').split('\0').filter(Boolean);

/** A path the review may read and write: inside the folder, not git's or the office's, not build output. */
const reviewable = (rel: string) => !!uploadParts(rel) && !ignoredPath(rel);

export class CodeReview {
  private states = new Map<string, ReviewState>();
  /** One change at a time per worker, so two accepts can't lose one another. */
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private code: CodeFiles,
    /** Where the floor keeps its own files (its .agent-office folder). */
    private dataDir: string,
  ) {}

  private file(workerId: string) {
    return path.join(this.dataDir, 'code-review', `${workerId.replace(/[^\w-]/g, '_')}.json`);
  }

  private serial<T>(workerId: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(workerId) ?? Promise.resolve()).then(fn, fn);
    this.queues.set(workerId, next.catch(() => undefined));
    return next;
  }

  private async state(workerId: string): Promise<ReviewState> {
    const had = this.states.get(workerId);
    if (had) return had;
    try {
      const st = JSON.parse(await readFile(this.file(workerId), 'utf8')) as ReviewState;
      if (st && typeof st.files === 'object') {
        this.states.set(workerId, st);
        return st;
      }
    } catch {
      // none yet: take one
    }
    return this.snapshotNow(workerId);
  }

  private async persist(workerId: string, st: ReviewState) {
    this.states.set(workerId, st);
    await mkdir(path.dirname(this.file(workerId)), { recursive: true, mode: 0o700 });
    await writeFile(this.file(workerId), JSON.stringify(st), { mode: 0o600 });
  }

  /** The file's text now: null when it isn't there, undefined when it can't be reviewed (binary, too big). */
  private async current(workerId: string, rel: string): Promise<{ text: string | null; version?: string } | undefined> {
    const r = await this.code.read(workerId, rel);
    if (!('error' in r)) return r;
    return r.status === 404 ? { text: null } : undefined;
  }

  /** The baseline of one file: what the snapshot or an accept kept, else what its commit has. */
  private async baseText(workerId: string, st: ReviewState, rel: string): Promise<string | null | undefined> {
    if (Object.hasOwn(st.files, rel)) return st.files[rel];
    const dir = this.code.dir(workerId);
    if (!dir || !st.commit) return null;
    const out = await git(['show', `${st.commit}:./${rel}`], dir);
    if (out === undefined) return null;
    return out.includes('\0') || out.length > MAX_CODE_BYTES ? undefined : out;
  }

  /** Takes the baseline afresh: everything as it is now. */
  private async snapshotNow(workerId: string): Promise<ReviewState> {
    const dir = this.code.dir(workerId);
    const commit = dir ? ((await git(['rev-parse', '--verify', '-q', 'HEAD'], dir))?.trim() || null) : null;
    const st: ReviewState = { commit, files: {} };
    let paths: string[] = [];
    if (dir && commit) {
      // What the commit doesn't have: changed, deleted and new files.
      paths = [...new Set([...zList(await git(['diff', '--name-only', '--relative', '-z', commit], dir)), ...zList(await git(['ls-files', '--others', '--exclude-standard', '-z'], dir))])];
    } else {
      const t = await this.code.tree(workerId);
      paths = 'error' in t ? [] : t.files;
    }
    let bytes = 0;
    for (const rel of paths.filter(reviewable).slice(0, MAX_SNAPSHOT_FILES)) {
      const cur = await this.current(workerId, rel);
      if (!cur || bytes > MAX_SNAPSHOT_BYTES) continue;
      st.files[rel] = cur.text;
      bytes += cur.text?.length ?? 0;
    }
    await this.persist(workerId, st);
    return st;
  }

  /** ✓ Accept all: everything as it is now is the new baseline. */
  acceptAll(workerId: string): Promise<{ ok: true } | CodeError> {
    if (!this.code.dir(workerId)) return Promise.resolve({ status: 404, error: 'No such worker' });
    return this.serial(workerId, async () => {
      await this.snapshotNow(workerId);
      return { ok: true as const };
    });
  }

  /** The baseline of one file, and its hash. */
  async baseline(workerId: string, rel: string): Promise<{ text: string | null; base: string } | CodeError> {
    if (!this.code.dir(workerId)) return { status: 404, error: 'No such worker' };
    if (!reviewable(rel)) return { status: 404, error: 'Not a file in this worker’s folder' };
    const text = await this.baseText(workerId, await this.state(workerId), rel);
    if (text === undefined) return { status: 415, error: 'Not a text file' };
    return { text, base: hashOf(text) };
  }

  /** The files that differ from their baseline, with how many lines were added and taken away. */
  async files(workerId: string): Promise<{ files: ReviewFile[]; truncated: boolean } | CodeError> {
    const dir = this.code.dir(workerId);
    if (!dir) return { status: 404, error: 'No such worker' };
    const st = await this.state(workerId);
    const candidates = new Set(Object.keys(st.files));
    if (st.commit) {
      for (const p of zList(await git(['diff', '--name-only', '--relative', '-z', st.commit], dir))) candidates.add(p);
      for (const p of zList(await git(['ls-files', '--others', '--exclude-standard', '-z'], dir))) candidates.add(p);
    } else {
      const t = await this.code.tree(workerId);
      if (!('error' in t)) for (const p of t.files) candidates.add(p);
    }
    const out: ReviewFile[] = [];
    let truncated = false;
    for (const rel of [...candidates].filter(reviewable).sort()) {
      if (out.length >= MAX_REVIEW_FILES) {
        truncated = true;
        break;
      }
      const [base, cur] = [await this.baseText(workerId, st, rel), await this.current(workerId, rel)];
      if (base === undefined || !cur || base === cur.text) continue;
      const { added, removed } = countHunks(diffTexts(base ?? '', cur.text ?? ''));
      const status = base === null ? 'added' : cur.text === null ? 'deleted' : 'modified';
      out.push({ path: rel, status, added: status === 'deleted' ? 0 : added, removed: status === 'added' ? 0 : removed, base: hashOf(base), sig: hashOf(cur.text) });
    }
    return { files: out, truncated };
  }

  /**
   * Accepts a file's changes: with `text`, a baseline the person's editor worked out (one hunk taken
   * in); without, the whole file as it is now, if it's still `sig`. Either way only while the
   * baseline is still `base`, the one they saw.
   */
  accept(workerId: string, rel: string, base: string, opts: { text?: string; sig?: string }): Promise<{ ok: true } | CodeError> {
    if (!this.code.dir(workerId)) return Promise.resolve({ status: 404, error: 'No such worker' });
    if (!reviewable(rel)) return Promise.resolve({ status: 404, error: 'Not a file in this worker’s folder' });
    if (opts.text !== undefined && opts.text.length > MAX_CODE_BYTES) return Promise.resolve({ status: 413, error: 'Too big' });
    return this.serial(workerId, async () => {
      const st = await this.state(workerId);
      if (hashOf((await this.baseText(workerId, st, rel)) ?? null) !== base) return conflict();
      let next: string | null;
      if (opts.text !== undefined) next = opts.text;
      else {
        const cur = await this.current(workerId, rel);
        if (!cur || (opts.sig !== undefined && hashOf(cur.text) !== opts.sig)) return conflict();
        next = cur.text;
      }
      await this.persist(workerId, { ...st, files: { ...st.files, [rel]: next } });
      return { ok: true as const };
    });
  }

  /** Rejects a file's changes: back to its baseline (made again, or deleted, as it was), if it's still `sig`. */
  reject(workerId: string, rel: string, sig: string): Promise<{ ok: true } | CodeError> {
    if (!this.code.dir(workerId)) return Promise.resolve({ status: 404, error: 'No such worker' });
    if (!reviewable(rel)) return Promise.resolve({ status: 403, error: 'Not somewhere in this worker’s folder you can change' });
    return this.serial(workerId, async () => {
      const st = await this.state(workerId);
      const [base, cur] = [await this.baseText(workerId, st, rel), await this.current(workerId, rel)];
      if (base === undefined || !cur || hashOf(cur.text) !== sig) return conflict();
      if (base === cur.text) return { ok: true as const };
      let r: object;
      if (base === null) r = await this.code.remove(workerId, rel, cur.version ?? '');
      else if (cur.text === null) r = await this.code.upload(workerId, rel, Buffer.from(base, 'utf8'), false);
      else r = await this.code.write(workerId, rel, base, cur.version ?? '');
      return 'error' in r ? (r as CodeError) : { ok: true as const };
    });
  }
}
