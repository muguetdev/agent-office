// Giving a worker a machine of its own (see server/machines/), or taking it away: the 🖥️ Own machine
// row in its ⚙️ settings (worker-config.ts), the 🖥️ With its own machine option when hiring, and the
// question when it's busy: now (which interrupts it), or once it finishes.
import './machines.css';
import type { WorkerInfo } from '../../../shared/protocol';
import { isBusy } from '../../../shared/status';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal } from '../dom';
import { L } from '../../i18n';

/** Whether you may give and take machines here at all. */
export const mayGiveMachines = (): boolean => !!store.machines?.may && !store.me.guest;

/** Gives the worker a machine (`on`) or takes it away, asking first when that would interrupt it. */
export function setMachine(net: Net, w: WorkerInfo, on: boolean) {
  if (!isBusy(w.status) || w.status === 'starting') return net.send({ t: 'machine.give', workerId: w.id, on });
  const now = h('button.btn.danger', { type: 'button' }, L.machines.now);
  const later = h('button.btn.primary', { type: 'button' }, L.machines.whenDone);
  const el = h(
    'div.modal',
    { role: 'alertdialog', 'aria-label': L.machines.busyQ(w.name) },
    h('header', {}, h('h2', {}, L.machines.busyQ(w.name))),
    h('div.body', {}, h('p', { style: 'margin:0;font-weight:700' }, on ? L.machines.busyGive : L.machines.busyTake)),
    h('footer', {}, h('span.grow'), now, later),
  );
  const modal = openModal(el);
  now.addEventListener('click', () => {
    modal.close();
    net.send({ t: 'machine.give', workerId: w.id, on });
  });
  later.addEventListener('click', () => {
    modal.close();
    net.send({ t: 'machine.give', workerId: w.id, on, later: true });
  });
  setTimeout(() => later.focus(), 30);
}

/**
 * The 🖥️ Own machine row of a worker's ⚙️ settings, or null when it can't have one (a shell, or no
 * host, or not yours to give). `apply` sends the change, if there's one, once the settings are saved.
 */
export function machineRow(w: WorkerInfo): { element: HTMLElement; apply(net: Net): void } | null {
  if (w.kind !== 'agent' || !mayGiveMachines()) return null;
  const had = !!w.machine || w.machineBusy === 'giving' || w.machineBusy === 'soon-give';
  const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
  box.checked = had;
  const element = h('div', {}, h('label.machine-row', {}, box, L.machines.own), h('p.setting-note', {}, L.machines.ownNote));
  return {
    element,
    apply(net) {
      const live = store.workers.get(w.id);
      if (live && box.checked !== had) setMachine(net, live, box.checked);
    },
  };
}

/** The 🖥️ With its own machine option when hiring, or null when there's no host or it isn't yours to give. */
export function machineHireOption(): { element: HTMLElement; checked(): boolean } | null {
  if (!mayGiveMachines()) return null;
  const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
  return { element: h('label.machine-row', { title: L.machines.withMachineTip }, box, L.machines.withMachine), checked: () => box.checked };
}
