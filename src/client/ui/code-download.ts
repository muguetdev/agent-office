// Downloading from the code editor (see code-editor.ts): the file open (⬇️ in its bar), any file or
// folder from the list (right-click it, or drag it out onto the desktop: a folder comes as a .zip of
// the project's files in it), the whole project (right-click the list's empty space), and, on a floor
// with a server (a server's floor, or a project's floor linked to one), any file or folder there by
// its path (🖥️⬇️, admins only: a folder comes as a .tar.gz). The office serves them all (/api/code/raw,
// /api/code/zip, /api/serverfile).
import { h, openModal, toast } from './dom';
import { store } from '../state';
import { L } from '../i18n';

export interface CodeDownloadOptions {
  /** The file list, whose rows carry data-file (a file) or data-dir (a folder, ending in /). */
  list: HTMLElement;
  /** The editor's tool its ⬇️ (and 🖥️⬇️) go just before. */
  before: HTMLElement;
  /** The query string for the office's code routes, with these params too. */
  q: (params: Record<string, string>) => string;
  /** The file open, if one is. */
  openPath: () => string | undefined;
  /** Whether what's open has changes not saved yet (the download is what's on disk). */
  dirty: () => boolean;
}

/** Downloads `url` as `name` once the office says `url + check=1` is fine; else says why not. */
async function fetchThenSave(url: string, name: string) {
  try {
    const r = await fetch(`${url}&check=1`, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return toast(body.error ?? L.code.downloadFailed, 'warn');
    }
    const ok = (await r.json().catch(() => ({}))) as { folder?: boolean };
    save(url, ok.folder ? `${name}.tar.gz` : name);
  } catch {
    toast(L.code.downloadFailed, 'warn');
  }
}

/** Downloads `url` as `name`, the way a link with download does. */
function save(url: string, name: string) {
  const a = h('a', { href: url, download: name, style: 'display:none' }) as HTMLAnchorElement;
  document.body.append(a);
  a.click();
  a.remove();
}

const baseName = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

export function codeDownloads(o: CodeDownloadOptions) {
  const fileUrl = (file: string) => `/api/code/raw?${o.q({ path: file, download: '1' })}`;
  const zipUrl = (folder: string) => `/api/code/zip?${o.q({ path: folder.replace(/\/+$/, '') })}`;
  const getFile = (file: string) => save(fileUrl(file), baseName(file));
  const getFolder = (folder: string) => void fetchThenSave(zipUrl(folder), `${baseName(folder) || store.currentFloor()?.name || 'project'}.zip`);

  // ⬇️ in the bar: the file open, as it is on disk.
  const btn = h('button.code-tool', { type: 'button', title: L.code.downloadTip }, '⬇️');
  btn.addEventListener('click', () => {
    const file = o.openPath();
    if (!file) return toast(L.code.downloadPick, 'warn');
    if (o.dirty()) toast(L.code.downloadSaved, 'info');
    getFile(file);
  });
  o.before.before(btn);

  // 🖥️⬇️ on a floor with a server, for admins: a path there.
  const floor = store.currentFloor();
  if (floor?.ssh && store.me.admin) {
    const remote = h('button.code-tool', { type: 'button', title: L.code.serverDownloadTip }, '🖥️⬇️');
    remote.addEventListener('click', () => askServerPath(floor.id, floor.name));
    o.before.before(remote);
  }

  // Right-click: the row's file, or folder as a zip; the empty space below, the whole project.
  let menu: HTMLElement | null = null;
  const closeMenu = () => {
    menu?.remove();
    menu = null;
  };
  o.list.addEventListener('contextmenu', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.code-row');
    const file = row?.dataset.file;
    const dir = row?.dataset.dir;
    e.preventDefault();
    closeMenu();
    const item = (label: string, run: () => void) =>
      h('button.code-menu-item', { type: 'button', onclick: () => (closeMenu(), run()) }, label);
    menu = h(
      'div.code-menu',
      { role: 'menu', style: `left:${e.clientX}px;top:${e.clientY}px` },
      file ? item(L.code.downloadFile, () => getFile(file)) : dir ? item(L.code.downloadFolder, () => getFolder(dir)) : item(L.code.downloadProject, () => getFolder('')),
    );
    document.body.append(menu);
  });
  document.addEventListener('mousedown', (e) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (menu && e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  }, true);

  // Dragged out of the list onto the desktop (Chrome and Edge): it downloads there.
  o.list.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.code-row');
    const file = row?.dataset.file;
    const dir = row?.dataset.dir;
    if (!e.dataTransfer || (!file && !dir)) return;
    const url = new URL(file ? fileUrl(file) : zipUrl(dir!), location.href).href;
    const name = file ? baseName(file) : `${baseName(dir!)}.zip`;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('DownloadURL', `${file ? 'application/octet-stream' : 'application/zip'}:${name}:${url}`);
    e.dataTransfer.setData('text/uri-list', url);
  });
}

/** Asks for a path on the floor's server, and downloads it (a folder as a .tar.gz). */
function askServerPath(floorId: string, floorName: string) {
  const input = h('input', { type: 'text', placeholder: '/var/log/app.log  ·  ~/app/.env  ·  /opt/app/logs/', spellcheck: 'false', autocomplete: 'off', style: 'width:100%;font:inherit;padding:8px 10px;border:3px solid var(--ink);border-radius:10px' }) as HTMLInputElement;
  const go = h('button.btn.primary', { type: 'submit' }, L.code.serverDownloadGo);
  const form = h(
    'form.modal',
    { role: 'dialog', 'aria-label': L.code.serverDownloadTitle(floorName), style: 'width:min(560px,100%)' },
    h('header', {}, h('h2', {}, `🖥️⬇️ ${L.code.serverDownloadTitle(floorName)}`)),
    h('div.body', {}, h('p', { style: 'margin:0 0 10px' }, L.code.serverDownloadNote), input),
    h('footer', {}, go),
  ) as HTMLFormElement;
  // Its ✕ and Esc come from openModal, and closing it hands the mouse straight back.
  const modal = openModal(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const path = input.value.trim();
    if (!path) return input.focus();
    void fetchThenSave(`/api/serverfile?${new URLSearchParams({ floor: floorId, path })}`, baseName(path));
    modal.close();
  });
  setTimeout(() => input.focus(), 30);
}
