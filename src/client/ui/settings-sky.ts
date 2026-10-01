// ⚙️ Settings' Outside, under Building: which clock the sky keeps, for everyone (see server/sky.ts).
import type { Net } from '../net';
import { store } from '../state';
import { h } from './dom';
import { L } from '../i18n';

/** The real time of day, or a whole day and night every hour: the buttons, kept up to date until `off`. */
export function skyClockSetting(net: Net): { row: HTMLElement; off: () => void } {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': L.settings.skyClock });
  const paint = () => {
    const real = !!store.sky?.realTime;
    row.replaceChildren(
      ...[true, false].map((r) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(real === r),
            class: real === r ? 'on' : '',
            onclick: () => r !== !!store.sky?.realTime && net.send({ t: 'sky.clock', real: r }),
          },
          r ? L.settings.skyRealTime : L.settings.skyHourly,
        ),
      ),
    );
  };
  paint();
  return { row, off: store.on('sky', paint) };
}
