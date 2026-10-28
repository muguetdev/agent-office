// Ctrl+K in the Code tab (Cursor's inline "edit this"): the prompt the worker is sent for the lines
// you picked and what you asked. It's in English, like every prompt the office writes for an agent.

/** Longest picked text and instruction sent along. */
export const ASK_TEXT_MAX = 20_000;
export const ASK_INSTRUCTION_MAX = 4000;

export interface CodeAsk {
  path: string;
  from: number;
  to: number;
  text: string;
  instruction: string;
  /** Who asked. */
  by: string;
}

/** The longest run of backticks in `text`, so the fence around it is longer. */
const fenceFor = (text: string) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

/** The prompt for a Ctrl+K ask, or undefined when there's nothing to ask. */
export function askPrompt(a: CodeAsk): string | undefined {
  const instruction = a.instruction.trim().slice(0, ASK_INSTRUCTION_MAX);
  if (!instruction || !a.path) return undefined;
  const from = Math.max(1, Math.floor(a.from) || 1);
  const to = Math.max(from, Math.floor(a.to) || from);
  const lines = from === to ? `line ${from}` : `lines ${from}-${to}`;
  const text = a.text.slice(0, ASK_TEXT_MAX);
  const fence = fenceFor(text);
  return [
    `${a.by} is looking at ${a.path} in the office's code editor and asks about ${lines}:`,
    '',
    instruction,
    '',
    ...(text.trim() ? [`Those lines currently read:`, fence, text, fence, ''] : []),
    `Make the change in ${a.path} directly (keep it to what was asked; the file may have moved on since, so look at it first). They'll review your edit in the editor.`,
  ].join('\n');
}
