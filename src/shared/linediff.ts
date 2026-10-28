// Line diffs for the Code tab's live view and review (client: ui/code-live/, server: codelive/):
// which lines of a file changed between two versions, as hunks, and the smallest edits that turn
// one into the other. Pure, so both sides (and the tests) use the same one.

/**
 * A run of lines that differ: `aLen` lines of the old text from `aStart` were replaced by `bLen` lines
 * of the new one from `bStart` (0-based). A hunk with `aLen` 0 only adds lines, one with `bLen` 0
 * only takes them away.
 */
export interface Hunk {
  aStart: number;
  aLen: number;
  bStart: number;
  bLen: number;
}

/** An edit to the old text by character offsets: [start, end) is replaced by `text`. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Past this many differing lines, the middle of a file is taken as one hunk rather than diffed line by line. */
const MAX_D = 2000;

/** A text's lines, as the diff works on them: split on '\n', so the last one has no newline of its own. */
export const linesOf = (text: string): string[] => text.split('\n');

/**
 * The hunks between two lists of lines: what they have in common at each end trimmed off, then
 * Myers' diff of the middle (one hunk for all of it when that's too different to be worth it).
 */
export function diffLines(a: readonly string[], b: readonly string[]): Hunk[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  if (!n && !m) return [];
  if (!n || !m) return [{ aStart: pre, aLen: n, bStart: pre, bLen: m }];
  const path = myers(a, b, pre, n, m);
  if (!path) return [{ aStart: pre, aLen: n, bStart: pre, bLen: m }];
  // Walk the edit script and gather runs of changes into hunks.
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const step of path) {
    if (step.kind === 'same') {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { aStart: pre + step.x, aLen: 0, bStart: pre + step.y, bLen: 0 };
      hunks.push(cur);
    }
    if (step.kind === 'del') cur.aLen++;
    else cur.bLen++;
  }
  return hunks;
}

type Step = { kind: 'same' | 'del' | 'add'; x: number; y: number };

/** Myers' O(ND) diff of a[off..off+n) against b[off..off+m), as steps; null past MAX_D differences. */
function myers(a: readonly string[], b: readonly string[], off: number, n: number, m: number): Step[] | null {
  const max = Math.min(n + m, MAX_D);
  const size = 2 * max + 1;
  let v = new Int32Array(size + 2);
  // Each round's furthest reaches, only the diagonals it could have touched (−d…d around the middle).
  const trace: { lo: number; v: Int32Array }[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    const lo = Math.max(0, max - d - 1);
    trace.push({ lo, v: v.slice(lo, max + d + 2) });
    const next = v;
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max]) ? v[k + 1 + max] : v[k - 1 + max] + 1;
      let y = x - k;
      while (x < n && y < m && a[off + x] === b[off + y]) {
        x++;
        y++;
      }
      next[k + max] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    v = next;
    if (found >= 0) break;
  }
  if (found < 0) return null;
  // Back from the end along the trace.
  const steps: Step[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const { lo, v: tv } = trace[d];
    const pv = (i: number) => tv[i + max - lo];
    const k = x - y;
    const prevK = k === -d || (k !== d && pv(k - 1) < pv(k + 1)) ? k + 1 : k - 1;
    const px = pv(prevK);
    const py = px - prevK;
    while (x > px && y > py) steps.push({ kind: 'same', x: --x, y: --y });
    if (x === px) steps.push({ kind: 'add', x, y: --y });
    else steps.push({ kind: 'del', x: --x, y });
  }
  while (x > 0 && y > 0) steps.push({ kind: 'same', x: --x, y: --y });
  return steps.reverse();
}

/** The hunks between two texts. */
export const diffTexts = (a: string, b: string): Hunk[] => diffLines(linesOf(a), linesOf(b));

/** How many lines were added and taken away. */
export function countHunks(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    added += h.bLen;
    removed += h.aLen;
  }
  return { added, removed };
}

/** Where each line of `lines` starts in their text, plus the text's length at the end. */
function lineStarts(lines: readonly string[]): number[] {
  const at = [0];
  for (let i = 0; i < lines.length; i++) at.push(at[i] + lines[i].length + (i < lines.length - 1 ? 1 : 0));
  return at;
}

/**
 * The edits (by offset into the old text, all against the old text, none overlapping) that turn
 * `a` into `b`: only the lines that changed, so an editor applying them keeps its cursor and scroll.
 */
export function minimalEdits(a: string, b: string, hunks = diffTexts(a, b)): TextEdit[] {
  const al = linesOf(a);
  const bl = linesOf(b);
  const at = lineStarts(al);
  const edits: TextEdit[] = [];
  for (const h of hunks) {
    const add = bl.slice(h.bStart, h.bStart + h.bLen);
    const s = h.aStart;
    const e = h.aStart + h.aLen;
    if (e < al.length) {
      // Every old line in the range ends in a newline: swap them for the new ones, each with its own.
      edits.push({ start: at[s], end: at[e], text: add.map((l) => `${l}\n`).join('') });
    } else if (h.aLen) {
      // The range runs to the end of the text, whose last line has no newline.
      if (add.length) edits.push({ start: at[s], end: at[al.length], text: add.join('\n') });
      else edits.push({ start: s > 0 ? at[s] - 1 : 0, end: at[al.length], text: '' });
    } else {
      // Lines added after the last one.
      edits.push({ start: at[al.length], end: at[al.length], text: `\n${add.join('\n')}` });
    }
  }
  return edits;
}

/** `text` with `edits` (from minimalEdits) made to it. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Accepting hunk `h` of base→current: the base, with that hunk taken from the current text. */
export function acceptHunk(base: string, current: string, h: Hunk): string {
  const bl = linesOf(base);
  bl.splice(h.aStart, h.aLen, ...linesOf(current).slice(h.bStart, h.bStart + h.bLen));
  return bl.join('\n');
}

/** Rejecting hunk `h` of base→current: the current text, with that hunk put back as the base had it. */
export function rejectHunk(base: string, current: string, h: Hunk): string {
  const cl = linesOf(current);
  cl.splice(h.bStart, h.bLen, ...linesOf(base).slice(h.aStart, h.aStart + h.aLen));
  return cl.join('\n');
}

/** The first line (0-based, in the new text) a list of hunks touches, or undefined. */
export const firstChangedLine = (hunks: readonly Hunk[]): number | undefined => (hunks.length ? hunks[0].bStart : undefined);
