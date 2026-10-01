// The code editor beside a worker's terminal (its "Code" tab, see termtabs.ts): the files in the
// folder it works in down the side, and Monaco (VS Code's editor) for the one you open. Ctrl+S
// saves, Ctrl+P finds a file by name. While you have a file open it keeps an eye on it: if the
// worker (or someone else) changes it and you haven't touched it, it reloads by itself; if you have,
// it says so and lets you pick, so nobody's work is lost. Loaded only when the tab's first opened.
import './code-editor.css';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/basic-languages/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { h, toast } from './dom';
import { L } from '../i18n';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: () => new EditorWorker() };
monaco.editor.defineTheme('office', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#1e1f2e', 'editorGutter.background': '#1e1f2e', 'minimap.background': '#1e1f2e' },
});

/** How often an open file is checked for changes made elsewhere. */
const WATCH_MS = 2000;
/** What you've set the editor to, kept in this browser: the window full screen, how wide the files are, the text size, wrapping. */
interface Prefs {
  full: boolean;
  side: number;
  font: number;
  wrap: boolean;
}
const PREFS_KEY = 'agent-office.code';
const FONT = { min: 10, max: 24 };
const SIDE = { min: 160, max: 600 };
function loadPrefs(): Prefs {
  const p: Prefs = { full: false, side: 250, font: 14, wrap: false };
  try {
    Object.assign(p, JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'));
  } catch {
    // storage blocked
  }
  p.font = Math.min(FONT.max, Math.max(FONT.min, Number(p.font) || 14));
  p.side = Math.min(SIDE.max, Math.max(SIDE.min, Number(p.side) || 250));
  return p;
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // storage blocked
  }
}

/** How many matches finding a file by name lists. */
const MAX_MATCHES = 200;
/** What you'd changed and not saved when the window closed, by worker and file, and the version it was made from. */
const drafts = new Map<string, { version: string; text: string }>();

interface Open {
  path: string;
  model: monaco.editor.ITextModel;
  /** The file's version on disk when it was last read or saved (see server/code.ts). */
  version: string;
  /** What was last read or saved, to tell whether you've changed it since. */
  saved: number;
}

/** The language Monaco knows a file by, from its name. */
function languageOf(file: string): string {
  const name = file.split('/').pop()!.toLowerCase();
  const ext = name.includes('.') ? `.${name.split('.').pop()}` : '';
  const lang = monaco.languages.getLanguages().find((l) => l.filenames?.map((f) => f.toLowerCase()).includes(name) || (ext && l.extensions?.includes(ext)));
  return lang?.id ?? 'plaintext';
}

/** Whether `name` has the letters of `query` in order (not necessarily side by side), and how tightly. */
function fuzzy(name: string, query: string): number | null {
  let at = -1;
  let gaps = 0;
  for (const ch of query) {
    const next = name.indexOf(ch, at + 1);
    if (next < 0) return null;
    gaps += next - at - 1;
    at = next;
  }
  return gaps;
}

/** Puts the editor in `host` for `workerId`'s folder on `floor`. */
export function mountCode(host: HTMLElement, workerId: string, floor: string) {
  const q = (params: Record<string, string>) => new URLSearchParams({ floor, worker: workerId, ...params }).toString();
  const filter = h('input.code-filter', { type: 'text', placeholder: L.code.find, 'aria-label': L.code.find, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const list = h('div.code-tree', { role: 'tree' });
  const side = h('aside.code-side', {}, filter, list);
  const pathEl = h('span.code-path', {}, L.code.pick);
  const state = h('span.code-state');
  const saveBtn = h('button.btn.code-save', { type: 'button', disabled: true, title: 'Ctrl+S' }, L.code.save) as HTMLButtonElement;
  const prefs = loadPrefs();
  const smaller = h('button.code-tool', { type: 'button', title: L.code.smaller }, 'A−');
  const bigger = h('button.code-tool', { type: 'button', title: L.code.bigger }, 'A+');
  const wrapBtn = h('button.code-tool', { type: 'button', title: L.code.wrap }, '↵');
  const fullBtn = h('button.code-tool', { type: 'button', title: L.code.full }, '⛶');
  const split = h('div.code-split', { title: L.code.resize });
  const banner = h('div.code-banner.hidden');
  // Esc is the editor's while you're in it (its suggestions, its find box): see openModal.
  const surface = h('div.code-surface', { 'data-own-esc': '' });
  const main = h('div.code-main', {}, h('div.code-bar', {}, pathEl, state, smaller, bigger, wrapBtn, fullBtn, saveBtn), banner, surface);
  host.replaceChildren(side, split, main);

  const editor = monaco.editor.create(surface, {
    theme: 'office',
    automaticLayout: true,
    fontSize: prefs.font,
    wordWrap: prefs.wrap ? 'on' : 'off',
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    tabSize: 2,
    model: null,
  });
  let files: string[] = [];
  let open: Open | null = null;
  /** Folders you've opened in the tree. */
  const expanded = new Set<string>();

  const dirty = () => !!open && open.model.getAlternativeVersionId() !== open.saved;
  const paintState = () => {
    saveBtn.disabled = !dirty();
    state.textContent = !open ? '' : dirty() ? L.code.unsaved : L.code.savedState;
    state.classList.toggle('dirty', dirty());
  };

  async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; status: number; body: { error?: string; version?: string } }> {
    const r = await fetch(url, { cache: 'no-store', ...init });
    const body = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, body: body as T } : { ok: false, status: r.status, body };
  }

  /** What went wrong, in words, from what the office answered. */
  const why = (status: number, error?: string) =>
    status === 413 ? L.code.tooBig : status === 415 ? L.code.notText : status === 409 ? L.code.changed : status === 404 ? L.code.notFound : (error ?? L.code.failed);

  // ---- The tree: folders you open and close, or, while you're typing in the box, the files that match.
  function renderTree() {
    const query = filter.value.trim().toLowerCase();
    if (query) {
      const hits = files
        .map((f) => ({ f, score: fuzzy(f.toLowerCase(), query) }))
        .filter((x) => x.score !== null)
        .sort((a, b) => a.score! - b.score! || a.f.length - b.f.length)
        .slice(0, MAX_MATCHES);
      list.replaceChildren(...hits.map(({ f }) => fileRow(f, f, 0)));
      return;
    }
    const rows: HTMLElement[] = [];
    const walk = (prefix: string, depth: number) => {
      const here = files.filter((f) => f.startsWith(prefix));
      const dirs = new Set<string>();
      const leaves: string[] = [];
      for (const f of here) {
        const rest = f.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash >= 0) dirs.add(rest.slice(0, slash));
        else leaves.push(f);
      }
      for (const d of [...dirs].sort()) {
        const full = `${prefix}${d}/`;
        const on = expanded.has(full);
        rows.push(
          h(
            'button.code-row.dir',
            {
              type: 'button',
              style: `padding-left:${8 + depth * 14}px`,
              onclick: () => {
                if (on) expanded.delete(full);
                else expanded.add(full);
                renderTree();
              },
            },
            `${on ? '▾' : '▸'} ${d}`,
          ),
        );
        if (on) walk(full, depth + 1);
      }
      for (const f of leaves) rows.push(fileRow(f, f.slice(prefix.length), depth));
    };
    walk('', 0);
    list.replaceChildren(...rows);
  }
  function fileRow(file: string, label: string, depth: number): HTMLElement {
    return h('button.code-row', { type: 'button', class: open?.path === file ? 'on' : '', style: `padding-left:${8 + depth * 14 + 12}px`, title: file, onclick: () => void openFile(file) }, label);
  }

  async function loadTree() {
    const r = await getJson<{ files: string[]; truncated: boolean }>(`/api/code/tree?${q({})}`);
    if (!r.ok) return void list.replaceChildren(h('p.code-empty', {}, why(r.status, r.body.error)));
    files = r.body.files;
    renderTree();
  }

  // ---- A file: opening it, saving it, and keeping it in step with the disk.
  async function openFile(file: string) {
    if (open?.path === file) return editor.focus();
    if (dirty() && !confirm(L.code.leaveUnsaved(open!.path))) return;
    const r = await getJson<{ text: string; version: string }>(`/api/code/file?${q({ path: file })}`);
    if (!r.ok) return void toast(why(r.status, r.body.error), 'warn');
    open?.model.dispose();
    const model = monaco.editor.createModel(r.body.text, languageOf(file));
    open = { path: file, model, version: r.body.version, saved: model.getAlternativeVersionId() };
    // Changes you hadn't saved when the window closed, if nobody's touched the file since.
    const draft = drafts.get(`${workerId}:${file}`);
    drafts.delete(`${workerId}:${file}`);
    if (draft && draft.version === r.body.version) model.setValue(draft.text);
    editor.setModel(model);
    model.onDidChangeContent(paintState);
    pathEl.textContent = file;
    hideBanner();
    paintState();
    renderTree();
    editor.focus();
  }

  async function save(force = false) {
    if (!open || (!dirty() && !force)) return;
    const o = open;
    const text = o.model.getValue();
    const at = o.model.getAlternativeVersionId();
    const r = await getJson<{ version: string }>(`/api/code/file?${q({ path: o.path, base: o.version })}`, { method: 'PUT', body: text, headers: { 'content-type': 'text/plain;charset=utf-8' } });
    if (open !== o) return;
    if (r.ok) {
      o.version = r.body.version;
      o.saved = at;
      hideBanner();
      paintState();
      return;
    }
    if (r.status === 409) return showConflict(r.body.version);
    toast(why(r.status, r.body.error), 'warn');
  }

  function hideBanner() {
    banner.classList.add('hidden');
    banner.replaceChildren();
  }
  /** The file changed on disk while you were changing it too: theirs, or yours over it. */
  function showConflict(theirs?: string) {
    if (!open) return;
    const o = open;
    banner.replaceChildren(
      h('span', {}, L.code.changedUnder),
      h('button.btn', { type: 'button', onclick: () => void reload(o) }, L.code.takeTheirs),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onclick: () => {
            if (theirs) o.version = theirs;
            void save(true);
          },
        },
        L.code.keepMine,
      ),
    );
    banner.classList.remove('hidden');
  }
  /** Reads the file again from disk, where the cursor was. */
  async function reload(o: Open) {
    const r = await getJson<{ text: string; version: string }>(`/api/code/file?${q({ path: o.path })}`);
    if (!r.ok || open !== o) return;
    const at = editor.saveViewState();
    o.model.setValue(r.body.text);
    o.version = r.body.version;
    o.saved = o.model.getAlternativeVersionId();
    if (at) editor.restoreViewState(at);
    hideBanner();
    paintState();
  }

  const watch = setInterval(async () => {
    if (!host.isConnected) {
      // The window's closed: keep what you hadn't saved for next time.
      if (open && dirty()) drafts.set(`${workerId}:${open.path}`, { version: open.version, text: open.model.getValue() });
      open?.model.dispose();
      editor.dispose();
      return clearInterval(watch);
    }
    if (!open || host.offsetParent === null) return;
    const o = open;
    const r = await getJson<{ version: string }>(`/api/code/version?${q({ path: o.path })}`);
    if (!r.ok || open !== o || r.body.version === o.version) return;
    if (dirty()) showConflict(r.body.version);
    else await reload(o);
  }, WATCH_MS);

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void save());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => filter.focus());
  saveBtn.addEventListener('click', () => void save());

  // ---- Sizes: the window full screen, how wide the files are, the text, wrapping long lines.
  const modal = host.closest<HTMLElement>('.modal.term');
  const apply = () => {
    modal?.classList.toggle('full', prefs.full);
    fullBtn.classList.toggle('on', prefs.full);
    wrapBtn.classList.toggle('on', prefs.wrap);
    side.style.width = `${prefs.side}px`;
    editor.updateOptions({ fontSize: prefs.font, wordWrap: prefs.wrap ? 'on' : 'off' });
    savePrefs(prefs);
  };
  const zoom = (by: number) => {
    prefs.font = Math.min(FONT.max, Math.max(FONT.min, prefs.font + by));
    apply();
  };
  smaller.addEventListener('click', () => zoom(-1));
  bigger.addEventListener('click', () => zoom(1));
  wrapBtn.addEventListener('click', () => {
    prefs.wrap = !prefs.wrap;
    apply();
  });
  fullBtn.addEventListener('click', () => {
    prefs.full = !prefs.full;
    apply();
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => zoom(1));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => zoom(-1));
  editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () => {
    prefs.wrap = !prefs.wrap;
    apply();
  });
  // Dragging the line between the files and the editor.
  split.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    split.setPointerCapture(e.pointerId);
    const from = e.clientX - prefs.side;
    const move = (m: PointerEvent) => {
      prefs.side = Math.min(SIDE.max, Math.max(SIDE.min, m.clientX - from));
      side.style.width = `${prefs.side}px`;
    };
    const up = () => {
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
      apply();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
  });
  apply();
  filter.addEventListener('input', renderTree);
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = list.querySelector<HTMLButtonElement>('.code-row:not(.dir)');
      first?.click();
    }
  });
  // Keys typed here are for the editor, not the office (walking, the desk's keys). An Esc the editor
  // had no use for takes you out of it, so the next one closes the window.
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && surface.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    e.stopPropagation();
  });
  void loadTree();
}
