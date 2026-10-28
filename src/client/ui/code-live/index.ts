// The Code tab, live (see link.ts for the socket, server/codelive/ for the office's side): what the
// worker changes shows up as it happens. The open file takes the change by its changed lines alone,
// lit up for a moment and, with ⌨️ on, typed in (apply.ts); with unsaved edits of yours it asks
// instead, as before. The file list follows files coming and going, with a dot on the ones just
// changed. 👀 Follow opens what the worker is editing (follow.ts), 🔍 Review shows its edits against
// the last accept with ✓ / ✕ on each (review.ts), and Ctrl+K asks it about the lines you picked (ask.ts).
import './live.css';
import type * as monaco from 'monaco-editor/editor/editor.api';
import type { CodeServerMsg } from '../../../shared/protocol';
import { h } from '../dom';
import { L } from '../../i18n';
import { call } from './api';
import { applyExternal, flashHunks, typeHunks } from './apply';
import { Follow } from './follow';
import { Review } from './review';
import { installAsk } from './ask';
import { codeLiveLinked, watchCode } from './link';

/** The file open in the editor (see code-editor.ts). */
export interface OpenFile {
  path: string;
  model: monaco.editor.ITextModel;
  version: string;
}

/** What the editor lets the live view do. */
export interface LiveEditor {
  workerId: string;
  editor: monaco.editor.IStandaloneCodeEditor;
  q(params: Record<string, string>): string;
  /** The toolbar, the space over the editor, and the side under the files, for its own pieces. */
  tools: HTMLElement;
  above: HTMLElement;
  side: HTMLElement;
  open(): OpenFile | null;
  dirty(): boolean;
  files(): string[];
  /** Shows the files again (with these, when given). */
  setFiles(files?: string[]): void;
  reloadTree(): Promise<void>;
  openFile(path: string): Promise<void>;
  /** The file changed under unsaved edits of yours: theirs or yours? */
  showConflict(version?: string): void;
  /** The open file was deleted. */
  showDeleted(): void;
  /** The open file now matches the disk at `version`. */
  synced(o: OpenFile, version: string): void;
}

/** How long a changed file keeps its dot in the list. */
const TOUCHED_MS = 8000;
const TYPING_KEY = 'agent-office.code.typing';

function typingPref(): boolean {
  try {
    return localStorage.getItem(TYPING_KEY) !== '0';
  } catch {
    return true;
  }
}

export function attachLive(ed: LiveEditor) {
  const { editor } = ed;
  const touched = new Map<string, number>();
  let typing = typingPref();
  let revealNext = false;

  const typingBtn = h('button.code-tool.cl-typing-btn', { type: 'button', title: L.codeLive.typingTip }, L.codeLive.typing) as HTMLButtonElement;
  const paintTyping = () => {
    typingBtn.classList.toggle('on', typing);
    typingBtn.setAttribute('aria-pressed', String(typing));
  };
  typingBtn.addEventListener('click', () => {
    typing = !typing;
    paintTyping();
    try {
      localStorage.setItem(TYPING_KEY, typing ? '1' : '0');
    } catch {
      // storage blocked
    }
  });
  paintTyping();

  /** Opens a file for 👀 Follow: never over unsaved edits of yours. */
  const go = (path: string) => {
    if (ed.open()?.path === path || ed.dirty()) return;
    revealNext = true;
    void ed.openFile(path);
  };
  const follow = new Follow({ workerId: ed.workerId, openPath: () => ed.open()?.path, go });
  const review = new Review({
    workerId: ed.workerId,
    editor,
    q: ed.q,
    openPath: () => ed.open()?.path,
    dirty: ed.dirty,
    writeOpen,
    go: (path) => void ed.openFile(path),
  });
  installAsk({ workerId: ed.workerId, editor, openPath: () => ed.open()?.path, asked: () => follow.turnOn() });

  ed.tools.prepend(follow.button, typingBtn, review.button);
  ed.above.append(follow.bar);
  ed.side.append(review.panel);

  /** Reads the open file from disk and takes it in, if it changed. */
  async function syncOpen() {
    const o = ed.open();
    if (!o) return;
    const r = await call<{ text: string; version: string }>(`/api/code/file?${ed.q({ path: o.path })}`);
    if (!r.ok || ed.open() !== o || r.body.version === o.version) return;
    if (ed.dirty()) return ed.showConflict(r.body.version);
    const hunks = applyExternal(editor, o.model, r.body.text);
    ed.synced(o, r.body.version);
    if (!hunks.length) return;
    flashHunks(editor, hunks);
    if (typing) typeHunks(editor, hunks);
    if (follow.on) editor.revealLineInCenterIfOutsideViewport(hunks[0].bStart + 1);
  }

  /** Puts `text` in the open file and saves it over the version it was read at (rejecting a hunk). */
  async function writeOpen(text: string): Promise<'ok' | 'conflict' | 'failed'> {
    const o = ed.open();
    if (!o) return 'failed';
    const r = await call<{ version: string }>(`/api/code/file?${ed.q({ path: o.path, base: o.version })}`, { method: 'PUT', body: text, headers: { 'content-type': 'text/plain;charset=utf-8' } });
    if (ed.open() !== o) return 'failed';
    if (r.ok) {
      applyExternal(editor, o.model, text);
      ed.synced(o, r.body.version);
      return 'ok';
    }
    if (r.status === 409) await syncOpen();
    return r.status === 409 ? 'conflict' : 'failed';
  }

  function changed(msg: Extract<CodeServerMsg, { t: 'code.changed' }>) {
    if (msg.more) void ed.reloadTree();
    const files = new Set(ed.files());
    let tree = false;
    const now = Date.now();
    const live: string[] = [];
    for (const c of msg.changes) {
      if (c.kind === 'removed') tree = files.delete(c.path) || tree;
      else {
        if (!files.has(c.path)) {
          files.add(c.path);
          tree = true;
        }
        touched.set(c.path, now + TOUCHED_MS);
        live.push(c.path);
      }
    }
    ed.setFiles(tree ? [...files].sort() : undefined);
    setTimeout(() => ed.setFiles(), TOUCHED_MS + 100);
    const open = ed.open();
    const hit = open && msg.changes.find((c) => c.path === open.path);
    if (hit?.kind === 'removed') ed.showDeleted();
    else if (hit) void syncOpen().then(() => review.refreshSoon());
    follow.changed(live);
    review.refreshSoon();
  }

  const off = watchCode(ed.workerId, (msg) => {
    if (msg.t === 'code.changed') changed(msg);
    else if (msg.t === 'code.editing') follow.editingNow(msg.editing, ed.files());
    else review.refreshSoon();
  });
  void review.refresh();

  return {
    /** Changes come pushed, so the editor's own check can rest. */
    live: codeLiveLinked,
    /** A file was opened: its review, and its first change shown if 👀 Follow opened it. */
    async opened() {
      follow.paint();
      await review.refresh();
      if (!revealNext) return;
      revealNext = false;
      const first = review.hunks()[0];
      if (first) editor.revealLineInCenter(first.bStart + 1);
    },
    /** A class for a file's row in the list: a dot while it's just been changed. */
    rowClass(path: string): string {
      const until = touched.get(path);
      if (until === undefined) return '';
      if (until > Date.now()) return 'cl-touched';
      touched.delete(path);
      return '';
    },
    syncOpen,
    dispose: off,
  };
}

export type LiveHandle = ReturnType<typeof attachLive>;
