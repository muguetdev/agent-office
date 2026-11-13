// A worker's terminal window, loaded the first time it's wanted: the window and xterm.js are most of
// a phone's first download otherwise (see terminal-window.ts, which is the window itself). Once the
// page has drawn, it's fetched in the background (preloadTerminal), so opening one is as quick as ever.
import type { ServerMsg } from '../../shared/protocol';
import type * as Window from './terminal-window';
import { toast } from './dom';
import { L } from '../i18n';

export type { TerminalFind, TerminalOptions } from './terminal-window';

let win: typeof Window | null = null;
let loading: Promise<typeof Window> | null = null;
/** The last terminal asked for while the window was still loading: only that one opens. */
let asked = 0;

function load(): Promise<typeof Window> {
  loading ??= import('./terminal-window').then(
    (m) => (win = m),
    (err) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

/** Fetches the terminal window once the page is idle, so the first one opens straight away. */
export function preloadTerminal() {
  const go = () => void load().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 8000 });
  else setTimeout(go, 3000);
}

/** Every server message comes through here, for the open terminal to pick its own (none open before it's loaded). */
export function routeTerminalMessage(msg: ServerMsg) {
  win?.routeTerminalMessage(msg);
}

/** The worker whose terminal is open, if one is. */
export function openTerminalFor(): string | null {
  return win?.openTerminalFor() ?? null;
}

/** Opens a worker's terminal (see openTerminal in terminal-window.ts). */
export function openTerminal(...args: Parameters<typeof Window.openTerminal>) {
  if (win) return win.openTerminal(...args);
  const mine = ++asked;
  load().then(
    (m) => mine === asked && m.openTerminal(...args),
    () => toast(L.term2.loadFailed, 'warn'),
  );
}
