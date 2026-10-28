// Reviewing the worker's edits in the Code tab, as in Cursor (see server/codelive/review.ts): the
// open file is shown against its baseline (what it was at the last accept), its added and changed
// lines green, the lines it took away in red above them, with ✓ Accept and ✕ Reject on each hunk;
// the side lists every changed file with its counts, and ✓ Accept all / ✕ Reject all. Accepting moves
// the baseline; rejecting writes the baseline's lines back into the file (only over the version you
// saw: otherwise it says so and shows you the file as it is now).
import * as monaco from 'monaco-editor/editor/editor.api';
import { acceptHunk, diffTexts, rejectHunk, type Hunk } from '../../../shared/linediff';
import { h, toast } from '../dom';
import { L } from '../../i18n';
import { call, post, type ReviewFile } from './api';
import { reviewList } from './review-list';

/** Review on or off, per worker, as you last left it. */
const reviewOn = new Map<string, boolean>();
/** Most removed lines shown in one hunk, and most hunks drawn in a file. */
const MAX_SHOWN = 40;
const MAX_HUNKS = 200;

export interface ReviewDeps {
  workerId: string;
  editor: monaco.editor.IStandaloneCodeEditor;
  q(params: Record<string, string>): string;
  openPath(): string | undefined;
  dirty(): boolean;
  /** Puts `text` in the open file and saves it over the version it was read at. */
  writeOpen(text: string): Promise<'ok' | 'conflict' | 'failed'>;
  /** Opens a file. */
  go(path: string): void;
}

export class Review {
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  private files: ReviewFile[] = [];
  private baseline: { path: string; text: string | null; base: string } | null = null;
  private decos: monaco.editor.IEditorDecorationsCollection;
  private zones: string[] = [];
  private timer = 0;
  private redrawTimer = 0;
  private list: ReturnType<typeof reviewList>;
  private busy = false;

  constructor(private deps: ReviewDeps) {
    this.button = h('button.code-tool.cl-review-btn', { type: 'button', title: L.codeLive.reviewTip }, L.codeLive.review(0)) as HTMLButtonElement;
    this.decos = deps.editor.createDecorationsCollection();
    this.list = reviewList({
      go: deps.go,
      acceptFile: (f) => void this.fileAction('accept', f),
      rejectFile: (f) => void this.fileAction('reject', f),
      acceptAll: () => void this.acceptAll(),
      rejectAll: () => void this.rejectAll(),
    });
    this.panel = this.list.el;
    this.button.addEventListener('click', () => {
      reviewOn.set(deps.workerId, !this.on);
      this.paint();
      void this.refresh();
    });
    // Your own typing moves the lines about: drawn again once you pause.
    deps.editor.onDidChangeModelContent(() => {
      clearTimeout(this.redrawTimer);
      this.redrawTimer = window.setTimeout(() => this.redraw(), 250);
    });
    this.paint();
  }

  get on(): boolean {
    return reviewOn.get(this.deps.workerId) ?? true;
  }

  private paint() {
    this.button.classList.toggle('on', this.on);
    this.button.setAttribute('aria-pressed', String(this.on));
    this.button.textContent = L.codeLive.review(this.files.length);
    this.panel.classList.toggle('hidden', !this.on);
    this.list.render(this.files, this.deps.openPath());
  }

  /** Looks again soon (changes come in bursts). */
  refreshSoon() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.refresh(), 400);
  }

  /** The changed files, and the open file's baseline, from the office. */
  async refresh() {
    if (!this.on) {
      this.clear();
      return this.paint();
    }
    const r = await call<{ files: ReviewFile[] }>(`/api/code-review/files?${this.deps.q({})}`);
    if (r.ok) this.files = r.body.files;
    const path = this.deps.openPath();
    if (path) {
      const b = await call<{ text: string | null; base: string }>(`/api/code-review/baseline?${this.deps.q({ path })}`);
      this.baseline = b.ok && this.deps.openPath() === path ? { path, ...b.body } : null;
    } else this.baseline = null;
    this.paint();
    this.redraw();
  }

  /** The open file's hunks against its baseline (none while review is off or there's no baseline). */
  hunks(): Hunk[] {
    const model = this.deps.editor.getModel();
    const path = this.deps.openPath();
    if (!this.on || !model || !this.baseline || this.baseline.path !== path) return [];
    return diffTexts(this.baseline.text ?? '', model.getValue()).slice(0, MAX_HUNKS);
  }

  private clear() {
    this.decos.clear();
    const old = this.zones;
    this.zones = [];
    if (old.length) this.deps.editor.changeViewZones((a) => old.forEach((id) => a.removeZone(id)));
  }

  /** Draws the open file's hunks: green lines, red removed ones above them, and each one's buttons. */
  redraw() {
    this.clear();
    const { editor } = this.deps;
    const model = editor.getModel();
    const hunks = this.hunks();
    if (!model || !hunks.length || !this.baseline) return;
    const old = (this.baseline.text ?? '').split('\n');
    const lines = model.getLineCount();
    const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    this.decos.set(
      hunks
        .filter((x) => x.bLen > 0)
        .map((x) => ({
          range: new monaco.Range(x.bStart + 1, 1, Math.min(lines, x.bStart + x.bLen), 1),
          options: { isWholeLine: true, className: 'cl-rev-add', linesDecorationsClassName: 'cl-rev-add-gutter' },
        })),
    );
    editor.changeViewZones((a) => {
      for (const hunk of hunks) {
        const gone = old.slice(hunk.aStart, hunk.aStart + Math.min(hunk.aLen, MAX_SHOWN));
        const more = hunk.aLen - gone.length;
        const btn = (cls: string, label: string, tip: string, fn: () => void) =>
          h(`button.${cls}`, {
            type: 'button',
            title: tip,
            // Monaco takes the mouse in its own area: the press is kept from it, so the click lands here.
            onmousedown: (e: Event) => (e.stopPropagation(), e.preventDefault()),
            onclick: (e: Event) => (e.stopPropagation(), fn()),
          }, label);
        const dom = h(
          'div.cl-zone',
          { style: `font-family:${font.fontFamily};font-size:${font.fontSize}px;line-height:${lineHeight}px` },
          h('div.cl-zone-actions', {}, btn('cl-accept', L.codeLive.accept, L.codeLive.acceptTip, () => void this.hunkAction('accept', hunk)), btn('cl-reject', L.codeLive.reject, L.codeLive.rejectTip, () => void this.hunkAction('reject', hunk))),
          ...gone.map((l) => h('div.cl-zone-del', {}, l || ' ')),
          more > 0 ? h('div.cl-zone-del.more', {}, `… +${more}`) : null,
        );
        const rows = gone.length + (more > 0 ? 1 : 0);
        this.zones.push(a.addZone({ afterLineNumber: hunk.bStart, heightInPx: rows * lineHeight + 26, domNode: dom, marginDomNode: h('div.cl-zone-margin', {}, h('div.cl-zone-margin-del', { style: `top:26px;height:${rows * lineHeight}px` })) }));
      }
    });
  }

  private async hunkAction(what: 'accept' | 'reject', hunk: Hunk) {
    const model = this.deps.editor.getModel();
    const b = this.baseline;
    const path = this.deps.openPath();
    if (!model || !b || b.path !== path || this.busy) return;
    if (this.deps.dirty()) return void toast(L.codeLive.saveFirst, 'warn');
    this.busy = true;
    try {
      const cur = model.getValue();
      if (what === 'accept') {
        const r = await post(`/api/code-review/accept?${this.deps.q({})}`, { path, base: b.base, text: acceptHunk(b.text ?? '', cur, hunk) });
        if (!r.ok) toast(r.status === 409 ? L.codeLive.moved : (r.error ?? L.code.failed), 'warn');
      } else {
        const next = rejectHunk(b.text ?? '', cur, hunk);
        // The only hunk of a file the worker made: the file goes, not just its text.
        const listed = this.files.find((f) => f.path === path);
        if (b.text === null && !next && listed) await this.fileAction('reject', listed);
        else {
          const r = await this.deps.writeOpen(next);
          if (r === 'conflict') toast(L.codeLive.moved, 'warn');
        }
      }
    } finally {
      this.busy = false;
    }
    await this.refresh();
  }

  private async fileAction(what: 'accept' | 'reject', f: ReviewFile): Promise<boolean> {
    if (f.path === this.deps.openPath() && this.deps.dirty()) {
      toast(L.codeLive.saveFirst, 'warn');
      return false;
    }
    const r = await post(`/api/code-review/${what}?${this.deps.q({})}`, what === 'accept' ? { path: f.path, base: f.base, sig: f.sig } : { path: f.path, sig: f.sig });
    if (!r.ok && r.status === 409) toast(L.codeLive.moved, 'warn');
    else if (!r.ok) toast(r.error ?? L.code.failed, 'warn');
    this.refreshSoon();
    return r.ok;
  }

  private async acceptAll() {
    const r = await post(`/api/code-review/accept?${this.deps.q({})}`, { all: true });
    if (!r.ok) toast(r.error ?? L.code.failed, 'warn');
    await this.refresh();
  }

  private async rejectAll() {
    const files = [...this.files];
    if (!files.length || !confirm(L.codeLive.rejectAllAsk(files.length))) return;
    let stayed = 0;
    for (const f of files) {
      if (f.path === this.deps.openPath() && this.deps.dirty()) {
        stayed++;
        continue;
      }
      const r = await post(`/api/code-review/reject?${this.deps.q({})}`, { path: f.path, sig: f.sig });
      if (!r.ok) stayed++;
    }
    if (stayed) toast(L.codeLive.rejectedSome(stayed), 'warn');
    await this.refresh();
  }
}
