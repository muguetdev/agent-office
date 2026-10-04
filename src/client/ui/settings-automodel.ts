// ⚙️ Settings' "Workers choose their model", under Workers: whether Claude Code workers switch their own
// model by how big their task is (see server/model-tiers.ts), for the whole office; admins change it.
import type { Net } from '../net';
import { store } from '../state';
import { h, timeAgo } from './dom';
import { L } from '../i18n';

/** The setting, made by `frame` from what goes in it: on and off as buttons, and a note. Kept up to date until `off`. */
export function autoModelSetting(net: Net, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; off: () => void } {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': L.autoModel.title });
  const note = h('p.setting-note');
  const paint = () => {
    const state = store.prompts.autoModel;
    const on = state?.on !== false;
    row.replaceChildren(
      ...[true, false].map((value) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(on === value),
            class: on === value ? 'on' : '',
            disabled: !store.me.admin,
            onclick: () => on !== value && net.send({ t: 'prompts.autoModel', on: value }),
          },
          value ? L.autoModel.on : L.autoModel.off,
        ),
      ),
    );
    note.textContent = `${L.autoModel.note} ${L.settings.sameForAll(state ? `${state.by}${state.at ? ` ${timeAgo(state.at)}` : ''}` : undefined)}`;
  };
  paint();
  const offs = [store.on('prompts', paint), store.on('me', paint)];
  return { section: frame([row, note]), off: () => offs.forEach((f) => f()) };
}
