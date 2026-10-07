// ⚙️ Settings' "Look", under You: the office as it always was, or as a scale model from above (see
// features/diorama). Yours alone, kept in this browser.
import type { Characters, OfficeLook } from '../state/persist';
import { h } from './dom';
import { L } from '../i18n';

const LOOKS: [OfficeLook, string, string][] = [
  ['classic', L.diorama.classic, L.diorama.classicNote],
  ['diorama', L.diorama.diorama, L.diorama.dioramaNote],
];

/** The setting's buttons and note: `get` says which look is on, `set` picks one. */
export function lookSetting(get: () => OfficeLook, set: (look: OfficeLook) => void): Node[] {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': L.diorama.title });
  const note = h('p.setting-note');
  const paint = () => {
    row.replaceChildren(
      ...LOOKS.map(([look, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(get() === look),
            class: get() === look ? 'on' : '',
            onclick: () => {
              if (get() === look) return;
              set(look);
              paint();
            },
          },
          label,
        ),
      ),
    );
    note.textContent = LOOKS.find(([l]) => l === get())![2];
  };
  paint();
  return [row, note];
}

const CHARACTERS: [Characters, string, string][] = [
  ['avatar', L.avatars.avatar, L.avatars.avatarNote],
  ['classic', L.avatars.classic, L.avatars.classicNote],
];

/** ⚙️ → You → Characters: the office avatars or the classic cartoon people. */
export function charactersSetting(get: () => Characters, set: (c: Characters) => void): Node[] {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': L.avatars.title });
  const note = h('p.setting-note');
  const paint = () => {
    row.replaceChildren(
      ...CHARACTERS.map(([c, label]) =>
        h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(get() === c), class: get() === c ? 'on' : '', onclick: () => get() !== c && (set(c), paint()) }, label),
      ),
    );
    note.textContent = CHARACTERS.find(([c]) => c === get())![2];
  };
  paint();
  return [row, note];
}
