// 👀 Follow the worker (see index.ts): opens the file the worker's agent is editing now (from its
// hooks: Claude Code says which file each Edit or Write is on) or, for agents that don't say, the
// file that changed last, and a bar over the editor says so ("✍️ Ada is editing src/app.ts").
import type { CodeEditing } from '../../../shared/protocol';
import { h } from '../dom';
import { L } from '../../i18n';
import { store } from '../../state';

/** Follow, per worker, as you last left it (until the page reloads). */
const followOn = new Map<string, boolean>();
/** What the agent said it's editing counts for this long; after that, the last change does. */
const EDITING_FRESH_MS = 60_000;

export interface FollowDeps {
  workerId: string;
  openPath(): string | undefined;
  /** Opens a file (if it's in the folder and you've nothing unsaved). */
  go(path: string): void;
}

export class Follow {
  readonly button: HTMLButtonElement;
  readonly bar: HTMLElement;
  private text: HTMLElement;
  private editing: CodeEditing | undefined;
  private lastChanged: string | undefined;
  /** A file it's writing that isn't there yet: opened once it turns up. */
  private waitingFor: string | undefined;

  constructor(private deps: FollowDeps) {
    this.button = h('button.code-tool.cl-follow-btn', { type: 'button', title: L.codeLive.followTip }, L.codeLive.follow) as HTMLButtonElement;
    this.text = h('span.cl-follow-text');
    const goBtn = h('button.btn.cl-follow-go', { type: 'button', onclick: () => this.target() && deps.go(this.target()!) }, L.codeLive.goThere);
    this.bar = h('div.cl-follow.hidden', { role: 'status' }, this.text, goBtn);
    this.button.addEventListener('click', () => {
      followOn.set(deps.workerId, !this.on);
      this.paint();
      const t = this.target();
      if (this.on && t) deps.go(t);
    });
    this.paint();
  }

  /** Turns it on (you asked the worker something: see it come in). */
  turnOn() {
    followOn.set(this.deps.workerId, true);
    this.paint();
  }

  /** On, unless you turned it off; at first, on while the worker's working. */
  get on(): boolean {
    return followOn.get(this.deps.workerId) ?? store.workers.get(this.deps.workerId)?.status === 'working';
  }

  private fresh(): CodeEditing | undefined {
    return this.editing && Date.now() - this.editing.at < EDITING_FRESH_MS ? this.editing : undefined;
  }

  /** The file to follow: the one being edited, else the one changed last. */
  target(): string | undefined {
    return this.fresh()?.path ?? this.lastChanged;
  }

  paint() {
    this.button.classList.toggle('on', this.on);
    this.button.setAttribute('aria-pressed', String(this.on));
    const name = store.workers.get(this.deps.workerId)?.name ?? '';
    const e = this.fresh();
    const t = this.target();
    this.text.textContent = e ? L.codeLive.editing(name, e.path) : t ? L.codeLive.changedFile(name, t) : '';
    this.bar.classList.toggle('hidden', !t);
    this.bar.classList.toggle('live', !!e);
    this.bar.classList.toggle('here', !!t && t === this.deps.openPath());
  }

  /** The agent said which file it's editing now (or that it stopped). */
  editingNow(e: CodeEditing | undefined, files: readonly string[]) {
    // Timed by this browser's clock, not the office's.
    this.editing = e && { ...e, at: Date.now() };
    this.paint();
    if (!e || !this.on || e.path === this.deps.openPath()) return;
    if (files.includes(e.path)) this.deps.go(e.path);
    else this.waitingFor = e.path;
  }

  /** Files changed: the last one is followed when the agent doesn't say what it's editing. */
  changed(paths: readonly string[]) {
    if (!paths.length) return;
    this.lastChanged = paths[paths.length - 1];
    const wanted = this.waitingFor && paths.includes(this.waitingFor) ? this.waitingFor : undefined;
    if (wanted) this.waitingFor = undefined;
    this.paint();
    if (!this.on) return;
    const go = wanted ?? (this.fresh() ? undefined : this.lastChanged);
    if (go && go !== this.deps.openPath()) this.deps.go(go);
  }
}
