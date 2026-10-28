// A change the worker made, landing in the open file (see index.ts): only the lines that changed are
// edited in Monaco, so your cursor and scroll stay put; they flash green for a few seconds (a red mark
// where lines went); and, with the typing effect on, what was added is revealed as if typed, over a
// second or so. That's only for show: the whole new text is in the editor at once underneath.
import * as monaco from 'monaco-editor/editor/editor.api';
import { diffTexts, minimalEdits, type Hunk } from '../../../shared/linediff';

/** How long a change stays lit, and the most the typing takes. */
const FLASH_MS = 4000;
const TYPING_MAX_MS = 1200;
/** Past this many added lines it's all shown at once. */
const TYPING_MAX_LINES = 400;

/** Puts `text` in `model` by its changed lines alone; says which hunks (of the new text) changed. */
export function applyExternal(editor: monaco.editor.ICodeEditor, model: monaco.editor.ITextModel, text: string): Hunk[] {
  const old = model.getValue();
  if (old === text) return [];
  const hunks = diffTexts(old, text);
  const ops = minimalEdits(old, text, hunks).map((e) => ({
    range: monaco.Range.fromPositions(model.getPositionAt(e.start), model.getPositionAt(e.end)),
    text: e.text,
  }));
  model.pushStackElement();
  model.pushEditOperations(editor.getModel() === model ? editor.getSelections() : null, ops, () => null);
  model.pushStackElement();
  // Monaco's own end-of-line: if the file's line endings differ from what it guessed, set it exactly.
  if (model.getValue() !== text) model.setValue(text);
  return hunks;
}

/** Lights up the changed lines for a few seconds: green where lines were added or changed, a red mark where they went. */
export function flashHunks(editor: monaco.editor.ICodeEditor, hunks: readonly Hunk[]) {
  const model = editor.getModel();
  if (!model || !hunks.length) return;
  const lines = model.getLineCount();
  const decos: monaco.editor.IModelDeltaDecoration[] = [];
  for (const h of hunks.slice(0, 500)) {
    if (h.bLen) {
      decos.push({
        range: new monaco.Range(h.bStart + 1, 1, Math.min(lines, h.bStart + h.bLen), 1),
        options: { isWholeLine: true, className: 'cl-flash-line', linesDecorationsClassName: 'cl-flash-gutter' },
      });
    } else {
      // Gone from between two lines: a red line on top of the one after (or under the last).
      const below = h.bStart + 1 <= lines;
      const line = below ? h.bStart + 1 : Math.max(1, lines);
      decos.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: below ? 'cl-del-above' : 'cl-del-below', linesDecorationsClassName: 'cl-del-gutter' } });
    }
  }
  const lit = editor.createDecorationsCollection(decos);
  setTimeout(() => lit.clear(), FLASH_MS + 200);
}

/** A typing effect still running, stopped when anything else lands. */
let typing: { stop(): void } | null = null;

/** Reveals what the hunks added as if it were typed, a caret at the front; nothing for big changes or a hidden tab. */
export function typeHunks(editor: monaco.editor.ICodeEditor, hunks: readonly Hunk[]) {
  typing?.stop();
  const model = editor.getModel();
  const added = hunks.filter((h) => h.bLen > 0);
  if (!model || !added.length || document.hidden || added.reduce((n, h) => n + h.bLen, 0) > TYPING_MAX_LINES) return;
  const lines = model.getLineCount();
  // Each added run, by offset, so it can be revealed a character at a time.
  const runs = added.map((h) => {
    const last = Math.min(lines, h.bStart + h.bLen);
    const start = model.getOffsetAt({ lineNumber: h.bStart + 1, column: 1 });
    const end = model.getOffsetAt({ lineNumber: last, column: model.getLineMaxColumn(last) });
    return { start, end };
  });
  const chars = runs.reduce((n, r) => n + r.end - r.start, 0);
  if (!chars) return;
  const ms = Math.min(TYPING_MAX_MS, 250 + chars * 4);
  const decos = editor.createDecorationsCollection();
  const t0 = performance.now();
  let frame = 0;
  const changed = model.onDidChangeContent(() => stop());
  const stop = () => {
    cancelAnimationFrame(frame);
    changed.dispose();
    decos.clear();
    if (typing === handle) typing = null;
  };
  const handle = { stop };
  typing = handle;
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / ms);
    if (p >= 1 || editor.getModel() !== model) return stop();
    const next: monaco.editor.IModelDeltaDecoration[] = [];
    for (const r of runs) {
      const at = model.getPositionAt(r.start + Math.floor((r.end - r.start) * p));
      const end = model.getPositionAt(r.end);
      next.push({ range: monaco.Range.fromPositions(at, end), options: { inlineClassName: 'cl-unrevealed' } });
      next.push({ range: monaco.Range.fromPositions(at, at), options: { beforeContentClassName: 'cl-caret' } });
    }
    decos.set(next);
    frame = requestAnimationFrame(step);
  };
  step();
}
