import test from 'node:test';
import assert from 'node:assert/strict';
import { keyLabels } from '../src/client/ui/termkeys.js';

test("shortcuts as a Mac writes them: ⌘ for the office's, ⌃ for the terminal's, ⌥ for Alt", () => {
  const mac = (s: string) => keyLabels(s, true);
  assert.equal(mac('Find a file (Ctrl+P)'), 'Find a file (⌘P)');
  assert.equal(mac('Ctrl+S'), '⌘S');
  assert.equal(mac('Smaller text (Ctrl −)'), 'Smaller text (⌘−)');
  assert.equal(mac('Bigger text (Ctrl +)'), 'Bigger text (⌘+)');
  assert.equal(mac('Wrap long lines (Alt+Z)'), 'Wrap long lines (⌥Z)');
  assert.equal(mac('Leave terminal (Esc or Ctrl+]) · ⎋ Esc or Ctrl+[ sends Esc to the terminal'), 'Leave terminal (Esc or ⌃]) · ⎋ Esc or ⌃[ sends Esc to the terminal');
  assert.equal(mac('Ctrl + ['), '⌃[');
  assert.equal(mac('OpenCode models: Ctrl+X then M'), 'OpenCode models: ⌃X then M');
  assert.equal(mac('Markdown works; ⌘/Ctrl+Enter posts it.'), 'Markdown works; ⌘Enter posts it.');
});

test('elsewhere they stay as written', () => {
  assert.equal(keyLabels('Find a file (Ctrl+P)', false), 'Find a file (Ctrl+P)');
  assert.equal(keyLabels('Markdown works; ⌘/Ctrl+Enter posts it.', false), 'Markdown works; Ctrl+Enter posts it.');
});
