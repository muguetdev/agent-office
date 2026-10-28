// The live Code tab's office side: a watcher on a worker's folder (watch.ts) for as long as anyone
// has its Code tab open, and what it sees pushed to them ('code.changed'), with the file the
// worker's agent is editing now ('code.editing', from its hooks). Everything goes only to people who
// asked for it and may still see that worker's floor: that's looked at again on every event, so
// someone taken off the floor stops hearing at once.
import type { CodeChange, CodeEditing, CodeServerMsg } from '../../shared/protocol/code.js';
import { FolderWatcher, type WatchOptions } from './watch.js';
import { editedPath } from './edits.js';

/** Most workers' folders watched at once across the office. */
export const MAX_WATCHED = 24;

/** Someone with a Code tab open: a connection, by id. */
export interface Viewer {
  id: string;
}

export interface CodeLiveDeps<V extends Viewer> {
  /** The folder a worker works in, or undefined when there's no such worker. */
  dirOf(workerId: string): string | undefined;
  /** The worker's files now (the Code tab's tree), to tell new files from changed ones. */
  files(workerId: string): Promise<string[] | undefined>;
  /** Whether `v` may still see this worker (signed in, not a guest, allowed on its floor, still connected). */
  allowed(v: V, workerId: string): boolean;
  send(v: V, msg: CodeServerMsg): void;
  /** Of these new paths in the worker's folder, the ones git ignores. */
  gitIgnored?(workerId: string, paths: string[]): Promise<Set<string>>;
  watch?: Omit<WatchOptions, 'gitIgnored'>;
}

interface Watched<V> {
  viewers: Map<string, V>;
  watcher?: FolderWatcher;
  dir: string;
}

export class CodeLive<V extends Viewer = Viewer> {
  private watched = new Map<string, Watched<V>>();
  /** What each worker's agent is editing, by worker. */
  private editing = new Map<string, CodeEditing>();

  constructor(private deps: CodeLiveDeps<V>) {}

  /** `v` opened `workerId`'s Code tab. Says why not, if it can't be watched. */
  async watch(v: V, workerId: string): Promise<string | undefined> {
    const dir = this.deps.dirOf(workerId);
    if (!dir || !this.deps.allowed(v, workerId)) return 'no such worker';
    let w = this.watched.get(workerId);
    if (!w) {
      if (this.watched.size >= MAX_WATCHED) return 'too many';
      w = { viewers: new Map(), dir };
      this.watched.set(workerId, w);
      w.viewers.set(v.id, v);
      const files = (await this.deps.files(workerId)) ?? [];
      // Everyone may have left while the files were being listed.
      if (this.watched.get(workerId) !== w || !w.viewers.size) return undefined;
      const gitIgnored = this.deps.gitIgnored;
      w.watcher = new FolderWatcher(dir, files, (changes, more) => this.changed(workerId, changes, more), {
        ...this.deps.watch,
        ...(gitIgnored ? { gitIgnored: (paths: string[]) => gitIgnored(workerId, paths) } : {}),
      });
      await w.watcher.start();
    } else w.viewers.set(v.id, v);
    const editing = this.editing.get(workerId);
    if (editing) this.deps.send(v, { t: 'code.editing', workerId, editing });
    return undefined;
  }

  unwatch(viewerId: string, workerId: string) {
    const w = this.watched.get(workerId);
    if (!w) return;
    w.viewers.delete(viewerId);
    if (!w.viewers.size) this.stop(workerId);
  }

  /** `viewerId` left the office: every Code tab of theirs is closed. */
  unwatchAll(viewerId: string) {
    for (const workerId of [...this.watched.keys()]) this.unwatch(viewerId, workerId);
  }

  /** Who's watching a worker's folder, and how many folders are watched (for tests). */
  viewers(workerId: string): string[] {
    return [...(this.watched.get(workerId)?.viewers.keys() ?? [])];
  }
  get size() {
    return this.watched.size;
  }

  close() {
    for (const workerId of [...this.watched.keys()]) this.stop(workerId);
  }

  /**
   * A hook event from a worker's agent (already checked to be its own): a tool call that edits a
   * file is the one it's editing now; its turn ending, nothing.
   */
  hook(workerId: string, event: string, payload: unknown) {
    if (event === 'Stop' || event === 'SessionStart') {
      if (this.editing.delete(workerId)) this.toViewers(workerId, { t: 'code.editing', workerId });
      return;
    }
    if (event !== 'PreToolUse') return;
    const dir = this.deps.dirOf(workerId);
    const hit = dir ? editedPath(payload, dir) : undefined;
    if (!hit) return;
    const editing = { ...hit, at: Date.now() };
    this.editing.set(workerId, editing);
    this.toViewers(workerId, { t: 'code.editing', workerId, editing });
  }

  /** The worker went home: nothing more to watch or follow. */
  forget(workerId: string) {
    this.editing.delete(workerId);
    this.stop(workerId);
  }

  /** Tells everyone watching a worker's folder `msg` (only those who may still see it). */
  toViewers(workerId: string, msg: CodeServerMsg) {
    const w = this.watched.get(workerId);
    if (!w) return;
    for (const [id, v] of [...w.viewers]) {
      if (this.deps.allowed(v, workerId)) this.deps.send(v, msg);
      else w.viewers.delete(id);
    }
    if (!w.viewers.size) this.stop(workerId);
  }

  private changed(workerId: string, changes: CodeChange[], more: boolean) {
    if (!this.deps.dirOf(workerId)) return this.forget(workerId);
    this.toViewers(workerId, { t: 'code.changed', workerId, changes, ...(more ? { more: true as const } : {}) });
  }

  private stop(workerId: string) {
    this.watched.get(workerId)?.watcher?.close();
    this.watched.delete(workerId);
  }
}
