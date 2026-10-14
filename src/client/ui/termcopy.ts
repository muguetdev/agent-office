import type { Terminal } from '@xterm/xterm';

// Copying out of a worker's terminal as text you can paste anywhere: an agent's reply, or what you
// selected. What a terminal shows isn't plain text: the agent (Claude Code, Codex…) draws its reply
// indented by a margin and breaks every line at the window's width itself, so a straight copy comes
// out indented, with a line break wherever the window happened to end. These put the paragraphs
// back together and take the margin off.

/** A line of the program's frame, not of what it said: a rule across the window, or its status lines. */
const RULE = /^\s*[─━═╌┄-]{8,}\s*$/;
/** Where something you typed is echoed (the input box's prompt, or what you sent, above the reply). */
const PROMPT = /^\s*[>❯›]\s/;
/** The note an agent leaves under a finished reply ("✻ Cogitated for 42s", "* Worked for 3m"). */
const DONE = /^\s*[✻✽✳*·]\s+\S+ (for|in) \d/;
/** A bullet the agent puts before a step or a reply (Claude Code's ⏺). */
const MARK = /^(\s*)[⏺●◉]\s/;

/** The buffer's lines from `from` to `to` (inclusive), and the window's width. */
function lines(term: Terminal, from: number, to: number): string[] {
  const out: string[] = [];
  const buf = term.buffer.active;
  for (let y = from; y <= to; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    // A line the terminal wrapped itself continues the one before it.
    const text = line.translateToString(true);
    if (line.isWrapped && out.length) out[out.length - 1] += text;
    else out.push(text);
  }
  return out;
}

/**
 * Text drawn for a `cols`-wide window, as text: the agent's bullets and the common margin off, and
 * a line that ran to the edge joined to the next one when that one carries on the same paragraph.
 */
export function plain(raw: string[], cols: number): string {
  // The bullet takes the place it took on screen, so the reply's own margin lines up under it.
  const rows = raw.map((l) => l.replace(MARK, '$1  ').replace(/\s+$/, ''));
  while (rows.length && !rows[0].trim()) rows.shift();
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  const indent = (l: string) => l.length - l.trimStart().length;
  const margin = Math.min(...rows.filter((l) => l.trim()).map(indent));
  const out: string[] = [];
  let prev: string | undefined;
  for (const row of rows) {
    const line = row.slice(Number.isFinite(margin) ? margin : 0);
    // Broken by the edge of the window, not by the agent: the line before ran (nearly) to it, and this
    // one starts with words at the indent the paragraph's text has (not a new item or a heading).
    const continues = prev !== undefined && prev.length + margin >= cols - 12 && line.trim() && !/^\s*([-*•]|\d+[.)]|#)\s/.test(line);
    if (continues) out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`;
    else out.push(line);
    prev = row;
  }
  return out.join('\n');
}

/**
 * The agent's last reply: from under the last thing you sent it to its note that it's done (or the
 * input box under it). Undefined when the screen doesn't look like an agent's reply.
 */
export function lastReply(term: Terminal): string | undefined {
  const buf = term.buffer.active;
  const text = (y: number) => buf.getLine(y)?.translateToString(true) ?? '';
  // The screen's empty rows under what's on it.
  let last = buf.length - 1;
  while (last > 0 && !text(last).trim()) last--;
  // Up from the bottom past the input box: its rules, the prompt in it and the status lines under it.
  let end = last;
  let rules = 0;
  for (let y = last; y >= Math.max(0, last - 12); y--) if (RULE.test(text(y))) (rules++, (end = y - 1));
  if (!rules) end = last;
  while (end > 0 && (!text(end).trim() || DONE.test(text(end)))) end--;
  // Up to what you sent.
  let start = end;
  while (start > 0 && !PROMPT.test(text(start - 1)) && !RULE.test(text(start - 1))) start--;
  if (start >= end) return undefined;
  const reply = plain(lines(term, start, end), term.cols);
  return reply.trim() ? reply : undefined;
}

/** What's selected, as text (see plain). */
export function selection(term: Terminal): string {
  const raw = term.getSelection();
  return raw ? plain(raw.split('\n'), term.cols) : '';
}

/** Puts `text` on the clipboard; true if it got there. */
export async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // An older browser, or one that wants the copy to come from a selection: a hidden text box.
    const box = document.createElement('textarea');
    box.value = text;
    box.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  }
}
