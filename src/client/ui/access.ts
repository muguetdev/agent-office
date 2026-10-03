// Who may go where, in 🔑 Accounts: the floors each member may go to (each floor's its own project,
// often its own company), the floors an invite lets its member onto, and the rooftop bar's open link
// for anyone at all (see server/office/access.ts).
import type { AccountInfo, AccountsState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';
import { L } from '../i18n';

export const barLink = (key: string) => `${location.origin}/bar#${key}`;

/** The building's floors to pick from: built or cloning. */
const pickable = () => store.floors.filter((f) => !f.locked);

/** A checkbox per floor, `on` ticked; `changed` hears the ids ticked whenever one changes. */
function floorChecks(on: readonly string[], changed: (ids: string[]) => void): HTMLElement {
  const ticked = new Set(on);
  const box = h('div.floor-checks');
  for (const f of pickable()) {
    const input = h('input', { type: 'checkbox', checked: ticked.has(f.id) }) as HTMLInputElement;
    input.addEventListener('change', () => {
      if (input.checked) ticked.add(f.id);
      else ticked.delete(f.id);
      changed(pickable().filter((o) => ticked.has(o.id)).map((o) => o.id));
    });
    box.append(h('label.floor-check', { title: f.repo ?? f.name }, input, ` ${f.name}`));
  }
  if (!box.childElementCount) box.append(h('span.note', {}, L.access.noFloors));
  return box;
}

/** Under the invite form: which floors the member it makes may go to. Admins go everywhere, so it hides for them. */
export function inviteFloors(role: HTMLSelectElement) {
  let ids: string[] = [];
  const el = h('div.invite-floors', {}, h('span.floors-label', {}, L.access.inviteFloors), floorChecks(ids, (now) => (ids = now)));
  const sync = () => el.classList.toggle('hidden', role.value === 'admin');
  role.addEventListener('change', sync);
  sync();
  return { el, floors: () => (role.value === 'admin' ? [] : ids), reset: () => el.replaceChildren(h('span.floors-label', {}, L.access.inviteFloors), floorChecks((ids = []), (now) => (ids = now))) };
}

/** Accounts whose floor list is open for changing, kept across the panel's redraws. */
const editing = new Set<string>();

/**
 * A member's floors: how many, and a button that opens a checkbox per floor right under them (saved
 * as you tick). Admins go everywhere.
 */
export function memberFloors(net: Net, a: AccountInfo, redraw: () => void): { button: HTMLElement | null; picker: HTMLElement | null } {
  if (a.role === 'admin') return { button: h('span.keys', {}, L.access.everywhere), picker: null };
  const n = (a.floors ?? []).filter((id) => store.floors.some((f) => f.id === id)).length;
  const open = editing.has(a.id);
  const button = h('button.btn', { type: 'button', title: L.access.floorsTip(a.name), 'aria-expanded': String(open) }, `🏢 ${L.access.floorsCount(n)}`);
  button.addEventListener('click', () => {
    if (open) editing.delete(a.id);
    else editing.add(a.id);
    redraw();
  });
  const picker = open ? h('li.floor-pick', {}, floorChecks(a.floors ?? [], (ids) => net.send({ t: 'accounts.floors', accountId: a.id, floors: ids }))) : null;
  return { button, picker };
}

/** 🍸 The bar's open link: anyone who has it comes up to the rooftop bar, and nowhere else. */
export function barSection(net: Net, s: AccountsState): HTMLElement[] {
  const bar = s.bar;
  const open = h('button.btn', { type: 'button', class: bar ? '' : 'primary' }, bar ? L.access.newLink : L.access.openBar);
  open.addEventListener('click', () => {
    if (!bar) return net.send({ t: 'accounts.bar', on: true });
    confirmDialog(L.access.newLinkQ, L.access.newLinkBody, L.access.newLink, () => net.send({ t: 'accounts.bar', on: true }));
  });
  const shut = bar ? h('button.btn.danger', { type: 'button' }, L.access.closeBar) : null;
  shut?.addEventListener('click', () => confirmDialog(L.access.closeBarQ, L.access.closeBarBody, L.access.closeBar, () => net.send({ t: 'accounts.bar', on: false })));
  return [
    h('div.team-head', {}, h('h4', {}, `🍸 ${L.access.barTitle}`), h('span.bar-btns', {}, open, shut)),
    h('p.note', {}, bar ? L.access.barOn : L.access.barOff),
    ...(bar ? [h('div.cmd', {}, h('pre', {}, barLink(bar.key)), copyButton(L.team.copy, () => barLink(bar.key)))] : []),
  ];
}
