// Uploading into a worker's folder from its Code tab (code-editor.ts), as in VS Code's explorer:
// files or whole folders dragged in from the desktop go into the folder under the pointer (a folder
// row: that folder; a file row: the folder it's in; anywhere else in the list: the top; the editor:
// the open file's folder), and ⬆️ Upload picks files for the open file's folder. A file that's
// already there is never overwritten without asking: a bar asks whether to replace it, keep both
// (the new one as "name copy.ext") or skip it, once for all of them.
import { h, toast } from './dom';
import { L } from '../i18n';
import { pickFiles } from './pickfiles';
import { UPLOAD_MAX_BYTES, copyName } from '../../shared/uploads';

export interface UploadOptions {
  /** The whole Code tab: drops anywhere in it are caught here, before Monaco or the terminal get them. */
  host: HTMLElement;
  /** The file list, and the editor's side of the tab. */
  list: HTMLElement;
  main: HTMLElement;
  /** ⬆️ Upload, which shows how far along it is. */
  button: HTMLButtonElement;
  /** Where the bar asking about files that are already there goes. */
  ask: HTMLElement;
  /** The query string for a request about this worker. */
  q(params: Record<string, string>): string;
  /** The files in the list now, and the one open, if any. */
  files(): string[];
  openPath(): string | undefined;
  /** After an upload: show the new files (`paths`), and open `open` if it's the one text file uploaded. */
  uploaded(paths: string[], open?: string): Promise<void>;
}

/** A file to upload, with its path under the folder it's going into. */
interface Item {
  rel: string;
  file: File;
}

type Choice = 'replace' | 'keep' | 'skip';

/** The folder a path is in, with its trailing slash ('' for the top). */
const folderOf = (file: string) => file.slice(0, file.lastIndexOf('/') + 1);
/** Somewhere the office won't take an upload (server/code.ts), so it isn't sent. */
const refusedPath = (rel: string) => rel.split('/').some((p) => ['.git', '.agent-office'].includes(p.toLowerCase()));

/** Everything in a dropped folder, however deep, and how many entries couldn't be read. */
async function walkEntries(entries: FileSystemEntry[]): Promise<{ items: Item[]; unreadable: number }> {
  const items: Item[] = [];
  let unreadable = 0;
  const readDir = (dir: FileSystemDirectoryEntry) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const reader = dir.createReader();
      const out: FileSystemEntry[] = [];
      // readEntries hands them over a batch at a time, until an empty one.
      const next = () => reader.readEntries((batch) => (batch.length ? (out.push(...batch), next()) : resolve(out)), reject);
      next();
    });
  const visit = async (e: FileSystemEntry): Promise<void> => {
    try {
      if (e.isFile) items.push({ rel: e.fullPath.replace(/^\/+/, ''), file: await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)) });
      else if (e.isDirectory) for (const child of await readDir(e as FileSystemDirectoryEntry)) await visit(child);
    } catch {
      unreadable++;
    }
  };
  for (const e of entries) await visit(e);
  return { items, unreadable };
}

/** Whether a file opens in the editor: small and with no NUL bytes near the start. */
async function textLike(f: File): Promise<boolean> {
  if (f.size > 1024 * 1024) return false;
  return !new Uint8Array(await f.slice(0, 8000).arrayBuffer()).includes(0);
}

export function codeUploads(o: UploadOptions) {
  const label = o.button.textContent ?? '';
  let busy = false;

  /** Asks once what to do with the files that are already there. */
  const ask = (count: number) =>
    new Promise<Choice>((resolve) => {
      const pick = (c: Choice) => () => {
        o.ask.classList.add('hidden');
        o.ask.replaceChildren();
        resolve(c);
      };
      const keep = h('button.btn.primary', { type: 'button', onclick: pick('keep') }, L.code.keepBoth);
      o.ask.replaceChildren(
        h('span', {}, L.code.alreadyThere(count)),
        h('button.btn', { type: 'button', onclick: pick('replace') }, L.code.replace),
        keep,
        h('button.btn', { type: 'button', onclick: pick('skip') }, L.code.skip),
      );
      o.ask.classList.remove('hidden');
      keep.focus();
    });

  const send = async (path: string, file: File, replace: boolean) => {
    try {
      const r = await fetch(`/api/code/upload?${o.q({ path, replace: replace ? '1' : '0' })}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
      const body = (await r.json().catch(() => ({}))) as { path?: string; error?: string; exists?: boolean };
      return { status: r.status, ...body };
    } catch (err) {
      return { status: 0, error: (err as Error).message };
    }
  };

  /** Uploads `items` into `dir` ('' for the top, else with a trailing slash), and says how it went. */
  async function upload(dir: string, items: Item[], unreadable = 0) {
    if (busy) return void toast(L.code.uploadBusy, 'warn');
    busy = true;
    o.button.disabled = true;
    const done: { path: string; file: File }[] = [];
    const conflicts: Item[] = [];
    let refused = 0;
    let tooBig = 0;
    let failed = 0;
    let skipped = 0;
    let lastError = '';
    const tally = (r: { status: number; path?: string; error?: string }, file: File) => {
      if (r.status === 200 && r.path) done.push({ path: r.path, file });
      else if (r.status === 403) refused++;
      else if (r.status === 413) tooBig++;
      else {
        failed++;
        lastError = r.error ?? '';
      }
    };
    try {
      let n = 0;
      for (const it of items) {
        o.button.textContent = L.code.uploading(++n, items.length);
        if (refusedPath(it.rel)) refused++;
        else if (it.file.size > UPLOAD_MAX_BYTES) tooBig++;
        else {
          const r = await send(dir + it.rel, it.file, false);
          if (r.status === 409 && r.exists) conflicts.push(it);
          else tally(r, it.file);
        }
      }
      // Not counting while it waits on you.
      o.button.textContent = label;
      const choice = conflicts.length ? await ask(conflicts.length) : 'skip';
      if (choice === 'skip') skipped = conflicts.length;
      const taken = new Set(o.files());
      n = 0;
      for (const it of choice === 'skip' ? [] : conflicts) {
        o.button.textContent = L.code.uploading(++n, conflicts.length);
        if (choice === 'replace') {
          tally(await send(dir + it.rel, it.file, true), it.file);
          continue;
        }
        // Keep both: the new one under the first free "name copy.ext", "name copy 2.ext"…
        const at = dir + folderOf(it.rel);
        const name = it.rel.slice(folderOf(it.rel).length);
        for (let i = 1; i <= 100; i++) {
          const path = at + copyName(name, i);
          if (taken.has(path)) continue;
          const r = await send(path, it.file, false);
          if (r.status === 409 && r.exists && i < 100) continue;
          tally(r, it.file);
          break;
        }
      }
    } finally {
      busy = false;
      o.button.disabled = false;
      o.button.textContent = label;
    }
    const where = dir.replace(/\/$/, '') || L.code.topFolder;
    if (done.length) toast(L.code.uploaded(done.length, where));
    const trouble = [
      skipped && L.code.uploadSkipped(skipped),
      refused && L.code.uploadRefused(refused),
      tooBig && L.code.uploadTooBig(tooBig, UPLOAD_MAX_BYTES / 1024 / 1024),
      unreadable && L.code.uploadUnreadable(unreadable),
      failed && L.code.uploadFailed(failed, lastError),
    ].filter(Boolean);
    if (trouble.length) toast(trouble.join(' · '), 'warn');
    if (!done.length) return;
    const one = done.length === 1 && (await textLike(done[0].file)) ? done[0].path : undefined;
    await o.uploaded(
      done.map((d) => d.path),
      one,
    );
  }

  /** The folder open in the editor: the open file's, or the top. */
  const here = () => folderOf(o.openPath() ?? '');
  o.button.addEventListener('click', () => pickFiles((files) => void upload(here(), files.map((file) => ({ rel: file.name, file })))));

  // ---- Dragging in: which folder it'd go into, lit up as VS Code does, and dropping it there.
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  const targetOf = (e: Event): string => {
    const el = e.target instanceof Element ? e.target : null;
    if (el && o.main.contains(el)) return here();
    const dir = el?.closest<HTMLElement>('[data-dir]');
    if (dir) return dir.dataset.dir!;
    const file = el?.closest<HTMLElement>('[data-file]');
    return file ? folderOf(file.dataset.file!) : '';
  };
  let lit: string | null = null;
  let litMain = false;
  let fade = 0;
  const paint = (target: string | null, inMain = false) => {
    if (target === lit && inMain === litMain) return;
    lit = target;
    litMain = inMain;
    o.main.classList.toggle('drop-in', target !== null && inMain);
    o.list.classList.toggle('drop-in', target === '' && !inMain);
    for (const row of o.list.querySelectorAll<HTMLElement>('[data-dir], [data-file]')) {
      const p = row.dataset.dir ?? row.dataset.file!;
      row.classList.toggle('drop-in', !!target && p.startsWith(target));
    }
  };
  const over = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'copy';
    paint(targetOf(e), e.target instanceof Node && o.main.contains(e.target));
    // Some browsers don't say when a drag leaves: it's over once the drag stops coming by.
    clearTimeout(fade);
    fade = window.setTimeout(() => paint(null), 300);
  };
  o.host.addEventListener('dragenter', over, true);
  o.host.addEventListener('dragover', over, true);
  o.host.addEventListener(
    'dragleave',
    (e) => {
      if (!hasFiles(e)) return;
      e.stopPropagation();
      if (!(e.relatedTarget instanceof Node) || !o.host.contains(e.relatedTarget)) paint(null);
    },
    true,
  );
  o.host.addEventListener(
    'drop',
    (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = targetOf(e);
      paint(null);
      // The entries have to be taken while the drop is happening; reading them can wait.
      const entries: FileSystemEntry[] = [];
      const loose: Item[] = [];
      for (const item of e.dataTransfer!.items) {
        if (item.kind !== 'file') continue;
        const entry = item.webkitGetAsEntry?.();
        const file = entry ? null : item.getAsFile();
        if (entry) entries.push(entry);
        else if (file) loose.push({ rel: file.name, file });
      }
      void walkEntries(entries).then(({ items, unreadable }) => {
        const all = [...loose, ...items];
        if (all.length || unreadable) void upload(dir, all, unreadable);
        else toast(L.code.nothingToUpload, 'warn');
      });
    },
    true,
  );
}
