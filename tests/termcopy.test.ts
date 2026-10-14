import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Terminal } from '@xterm/xterm';
import { lastReply, plain } from '../src/client/ui/termcopy.ts';

/** A terminal `cols` wide showing `rows`, enough of one for lastReply. */
function screen(cols: number, rows: string[]): Terminal {
  return {
    cols,
    buffer: { active: { length: rows.length, getLine: (y: number) => (rows[y] === undefined ? undefined : { isWrapped: false, translateToString: () => rows[y] }) } },
  } as unknown as Terminal;
}

test("an agent's reply copies without its margin, its paragraphs back together", () => {
  const cols = 40;
  const out = plain(
    [
      '⏺ Preciso que você analise o código atual',
      '  e levante a melhor opção, avaliando tudo',
      '  com calma.',
      '',
      '  1. Arquivamento: mover transações velhas',
      '  2. Índice parcial',
    ],
    cols,
  );
  assert.equal(out, 'Preciso que você analise o código atual e levante a melhor opção, avaliando tudo com calma.\n\n1. Arquivamento: mover transações velhas\n2. Índice parcial');
});

test('the last reply is what sits between what you sent and the done note, above the input box', () => {
  const rows = [
    '> o que eu perguntei antes',
    '⏺ Uma resposta antiga.',
    '> Me manda um prompt pra eu mandar pro dev',
    '⏺ Aqui está o prompt:',
    '',
    '  Analise o código e levante a melhor opção.',
    '',
    '✻ Cogitated for 42s · done 20:18',
    '────────────────────────────────────────',
    '> ',
    '────────────────────────────────────────',
    '  ⏵⏵ auto mode on (shift+tab to cycle)',
    '',
    '',
    '',
  ];
  assert.equal(lastReply(screen(60, rows)), 'Aqui está o prompt:\n\nAnalise o código e levante a melhor opção.');
});

test('a screen with no reply on it gives nothing to copy as one', () => {
  assert.equal(lastReply(screen(40, ['$ ls', '────────────────', '> '])), undefined);
});
