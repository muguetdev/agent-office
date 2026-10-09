/** 💬 Discuss on the Workers panel: two workers already at their desks talk something through in the floor's chat. */
import type { Ctx } from '../../core/context';
import { saveSettings } from '../../state/persist';
import { $, h } from '../../ui/dom';
import { L } from '../../i18n';
import { openDiscussion } from './ui';

export function installDiscussion(ctx: Ctx) {
  const button = h('button.workers-discuss', { type: 'button', title: L.discussion.buttonTip }, L.discussion.button);
  const title = $('workers-panel').querySelector('h3');
  title?.insertBefore(button, title.querySelector('.panel-x'));
  button.addEventListener('click', () =>
    openDiscussion((first, second, topic) => {
      // It happens in the chat, so the chat comes out to follow it.
      if (!ctx.settings.hud.chat) {
        ctx.settings.hud = { ...ctx.settings.hud, chat: true };
        saveSettings(ctx.settings);
        $('chat').classList.remove('hud-off');
        ctx.hud.refresh();
      }
      ctx.net.send({ t: 'discussion.start', first, second, topic });
    }),
  );
}
