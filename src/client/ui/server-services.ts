// 🖥️ What runs on a server's floor's server (see server/server-watch.ts): its Docker containers and its
// services, as last seen, each with a 🔁 to restart it for admins (after asking).
import './server-floor.css';
import type { ServerUnit } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { confirmDialog } from './prompt';
import { uptimeLabel } from '../features/boards/server';
import { L } from '../i18n';

export function openServerServices(net: Net) {
  const floor = store.currentFloor();
  if (!floor?.ssh) return;
  const body = h('div.body.team.server-floor');
  const close = h('button.btn.close', { type: 'button', 'aria-label': L.common.close }, '✕');
  const el = h('div.modal', { role: 'dialog', 'aria-label': L.serverFloor.servicesTitle, style: 'width:min(720px,100%)' }, h('header', {}, h('h2', {}, `🖥️ ${floor.name}`), close), body);

  const restart = (unit: ServerUnit) =>
    confirmDialog(L.serverFloor.restartQ(unit.name), L.serverFloor.restartBody, L.serverFloor.restart, () => net.send({ t: 'server.restart', floor: floor.id, ...unit }));

  const row = (unit: ServerUnit, ok: boolean, sub: string) =>
    h(
      'li',
      {},
      h('span.dot', { class: ok ? 'on' : 'bad' }),
      h('span.name', {}, `${{ container: '🐳', process: '📦', service: '⚙️' }[unit.kind]} ${unit.name}`),
      h('span.keys', {}, sub),
      store.me.admin ? h('button.btn', { type: 'button', title: L.serverFloor.restartTip, onclick: () => restart(unit) }, `🔁 ${L.serverFloor.restart}`) : null,
    );

  const render = () => {
    const s = store.server;
    if (!s) return body.replaceChildren(h('p.empty', {}, L.serverFloor.looking));
    const containers = h('ul.team-list');
    for (const c of s.containers) containers.append(row({ kind: 'container', name: c.name }, c.state === 'running', [c.image, c.status].filter(Boolean).join(' · ')));
    if (!s.containers.length) containers.append(h('li.empty', {}, L.serverFloor.noContainers));
    const processes = h('ul.team-list');
    for (const p of s.processes) processes.append(row({ kind: 'process', name: p.name }, p.state === 'online', [p.state, `CPU ${Math.round(p.cpu)}%`, `${Math.round(p.mem / 2 ** 20)} MB`, L.serverFloor.restarts(p.restarts)].join(' · ')));
    const services = h('ul.team-list');
    for (const x of s.services) services.append(row({ kind: 'service', name: x.name }, x.state === 'running', x.state === 'failed' ? L.serverFloor.failed2 : x.status));
    if (!s.services.length) services.append(h('li.empty', {}, L.serverFloor.noServices));
    body.replaceChildren(
      h('p.note', {}, [s.ok ? `✅ ${s.host ?? floor.ssh!.host}` : `❌ ${s.error ?? L.serverFloor.offline}`, `⏱ ${uptimeLabel(s.uptime)}`, L.serverFloor.seen(timeAgo(s.at))].join(' · ')),
      ...(s.processes.length ? [h('h4', {}, `📦 PM2 `, h('span.count', {}, String(s.processes.length))), processes] : []),
      h('h4', {}, `🐳 ${L.serverFloor.containers} `, h('span.count', {}, String(s.containers.length))),
      containers,
      h('h4', {}, `⚙️ ${L.serverFloor.services} `, h('span.count', {}, String(s.services.length))),
      services,
      ...(store.me.admin ? [] : [h('p.note', {}, L.serverFloor.adminsRestart)]),
    );
  };
  const off = store.on('server', render);
  const modal = openModal(el, { onClose: () => off() });
  close.addEventListener('click', () => modal.close());
  render();
}
