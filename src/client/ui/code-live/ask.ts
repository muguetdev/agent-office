// Ctrl+K (⌘K) in the Code tab, as in Cursor: pick some lines (or just put the cursor on one), say
// what you want, and the worker is asked to do it (see server/codelive/ask.ts). Also on the editor's
// right-click menu. Its edit then arrives live and shows up to review.
import * as monaco from 'monaco-editor/editor/editor.api';
import { h } from '../dom';
import { L } from '../../i18n';
import { store } from '../../state';
import { askCode } from './link';

export interface AskDeps {
  workerId: string;
  editor: monaco.editor.IStandaloneCodeEditor;
  openPath(): string | undefined;
  /** It was asked: follow the worker, to see the edit come in. */
  asked(): void;
}

export function installAsk(deps: AskDeps) {
  const { editor } = deps;
  const name = () => store.workers.get(deps.workerId)?.name ?? '';
  let widget: (monaco.editor.IContentWidget & { input: HTMLInputElement }) | null = null;

  const close = () => {
    if (!widget) return;
    editor.removeContentWidget(widget);
    widget = null;
    editor.focus();
  };

  const open = () => {
    const model = editor.getModel();
    const path = deps.openPath();
    const sel = editor.getSelection();
    if (!model || !path || !sel) return;
    close();
    const from = sel.startLineNumber;
    // A selection ending at the very start of a line doesn't take that line.
    const to = Math.max(from, sel.endColumn === 1 && sel.endLineNumber > from ? sel.endLineNumber - 1 : sel.endLineNumber);
    const text = model.getValueInRange(new monaco.Range(from, 1, to, model.getLineMaxColumn(to)));
    const input = h('input.cl-ask-input', { type: 'text', placeholder: L.codeLive.askPlaceholder(name()), 'aria-label': L.codeLive.askMenu(name()), spellcheck: 'false', autocomplete: 'off', maxlength: '4000' }) as HTMLInputElement;
    const send = () => {
      const instruction = input.value.trim();
      if (!instruction) return;
      askCode({ workerId: deps.workerId, path, from, to, text, instruction });
      deps.asked();
      close();
    };
    const sendBtn = h('button.btn.primary.cl-ask-send', { type: 'button', onclick: send }, L.codeLive.askSend);
    const closeBtn = h('button.cl-ask-close', { type: 'button', 'aria-label': L.hints.cancel, title: L.hints.cancel, onclick: close }, '✕');
    // Monaco sets the widget's own display, so the row is a box inside it.
    const dom = h('div.cl-ask-widget', {}, h('div.cl-ask', {}, h('span.cl-ask-lines', {}, from === to ? `${from}` : `${from}–${to}`), input, sendBtn, closeBtn));
    // Keys typed here are for the box, not the editor or the office; Esc closes only the box.
    dom.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    dom.addEventListener('mousedown', (e) => e.stopPropagation());
    widget = {
      input,
      allowEditorOverflow: true,
      getId: () => 'office.code.ask',
      getDomNode: () => dom,
      getPosition: () => ({ position: { lineNumber: from, column: 1 }, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW] }),
    };
    editor.addContentWidget(widget);
    editor.revealLineInCenterIfOutsideViewport(from);
    setTimeout(() => input.focus(), 0);
  };

  editor.addAction({
    id: 'office.code.ask',
    label: L.codeLive.askMenu(name()),
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 0,
    run: open,
  });
  return { open, close };
}
