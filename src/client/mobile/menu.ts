// The phone app's two menus (sheet.ts): the floors, to go to another, and ☰ More, with push
// notifications, installing the app, the meeting room and the 3D office.
import type { Net } from '../net';
import { store } from '../state';
import { cloneLabel } from '../../shared/floors';
import { h, toast } from '../ui/dom';
import { L } from '../i18n';
import { openSheet, sheetRow } from './sheet';
import { canPromptInstall, installed, isIOS, promptInstall } from './pwa';
import { pushState, test, turnOff, turnOn, type PushState } from './push';

/** Every floor, the one you're on marked, with who's waiting on each. */
export function openFloors(net: Net) {
  const rows = store.floors.map((f) => {
    const here = f.id === store.floor;
    const sub = f.cloning ? cloneLabel(f.clone) : [f.repo, f.people ? `👥 ${f.people}` : ''].filter(Boolean).join(' · ') || null;
    const right = f.waiting ? h('span.sheet-count.bad', {}, `🙋 ${f.waiting}`) : here ? h('span.sheet-check', {}, '✓') : null;
    return sheetRow(f.ssh ? '🖥️' : '🏢', f.name, sub, {
      on: here,
      disabled: !!f.cloning || !!f.locked,
      right,
      onclick: () => {
        modal.close();
        if (!here) net.send({ t: 'floor.go', floor: f.id });
      },
    });
  });
  const modal = openSheet(L.mobile.floors, h('div.sheet-list', {}, ...(rows.length ? rows : [h('p.sheet-empty', {}, L.lite.noFloors)])));
}

export interface MoreDeps {
  meeting(): void;
}

/** ☰ More. */
export function openMore(deps: MoreDeps) {
  const pushBox = h('div.sheet-list');
  const installBox = h('div.sheet-list');
  const modal = openSheet(
    L.mobile.more,
    h('h3.sheet-h', {}, L.mobile.notifications),
    pushBox,
    installed() ? null : h('h3.sheet-h', {}, L.mobile.app),
    installed() ? null : installBox,
    h('h3.sheet-h', {}, L.mobile.office),
    h(
      'div.sheet-list',
      {},
      sheetRow('🤝', L.mobile.meeting, L.mobile.meetingSub, { onclick: () => (modal.close(), deps.meeting()), right: '›' }),
      sheetRow('🏢', L.mobile.to3d, L.mobile.to3dSub, { onclick: () => (location.href = '/?3d=1'), right: '›' }),
      sheetRow('🔄', L.mobile.reload, null, { onclick: () => location.reload(), right: '›' }),
    ),
  );

  async function paintPush(state?: PushState) {
    const s = state ?? (await pushState());
    const rows: HTMLElement[] = [];
    if (s === 'on') {
      rows.push(sheetRow('🔔', L.mobile.pushOn, L.mobile.pushOnSub, { right: h('span.sheet-pill.good', {}, L.mobile.on) }));
      rows.push(
        sheetRow('🧪', L.mobile.pushTest, null, {
          onclick: async () => {
            toast((await test()) ? L.mobile.pushSent : L.mobile.pushFailed, 'info');
          },
          right: '›',
        }),
      );
      rows.push(sheetRow('🔕', L.mobile.pushOff, null, { onclick: () => void run(turnOff), right: '›' }));
    } else if (s === 'off') {
      rows.push(sheetRow('🔔', L.mobile.pushTurnOn, L.mobile.pushTurnOnSub, { onclick: () => void run(turnOn), right: h('span.sheet-pill', {}, L.mobile.off) }));
    } else if (s === 'denied') {
      rows.push(sheetRow('🚫', L.mobile.pushDenied, L.mobile.pushDeniedSub));
    } else if (s === 'install-first') {
      rows.push(sheetRow('📲', L.mobile.pushInstallFirst, L.mobile.iosSteps));
    } else {
      rows.push(sheetRow('🔕', L.mobile.pushUnsupported, window.isSecureContext ? null : L.mobile.needsHttps));
    }
    pushBox.replaceChildren(...rows);
  }

  async function run(fn: () => Promise<PushState>) {
    pushBox.classList.add('busy');
    try {
      await paintPush(await fn());
    } catch (e) {
      toast(`${L.mobile.pushFailed} (${(e as Error).message})`, 'error');
      await paintPush();
    } finally {
      pushBox.classList.remove('busy');
    }
  }

  function paintInstall() {
    if (canPromptInstall()) {
      installBox.replaceChildren(
        sheetRow('📲', L.mobile.install, L.mobile.installSub, {
          onclick: async () => {
            if (await promptInstall()) modal.close();
            else paintInstall();
          },
          right: '›',
        }),
      );
    } else if (isIOS()) {
      installBox.replaceChildren(sheetRow('📲', L.mobile.install, L.mobile.iosSteps));
    } else {
      installBox.replaceChildren(sheetRow('📲', L.mobile.install, L.mobile.installMenu));
    }
  }

  void paintPush();
  paintInstall();
}
