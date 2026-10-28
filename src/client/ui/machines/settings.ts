// ⚙️ Settings → Building → 🖥️ Agent machines (admins only): the machines host, this office's key and
// the line that lets it in there, a test, each machine's size, how many a floor may have, and whether
// members may give them too (see server/machines/).
import './machines.css';
import type { Net } from '../../net';
import { store } from '../../state';
import { MACHINES_PER_FLOOR_MAX, MACHINE_CPUS_MAX, MACHINE_CPUS_MIN, authorizeLine } from '../../../shared/machines';
import { h, toast } from '../dom';
import { confirmDialog } from '../prompt';
import { toClipboard } from '../termcopy';
import { L } from '../../i18n';

/** The setting, made by `frame` from what goes in it; `off` stops it following the office. */
export function machinesSetting(net: Net, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; off(): void } {
  const input = (attrs: Record<string, string | number>) => h('input', { autocomplete: 'off', spellcheck: 'false', ...attrs }) as HTMLInputElement;
  const host = input({ type: 'text', placeholder: L.machines.hostPlaceholder, maxlength: 300, 'aria-label': L.machines.host });
  const office = input({ type: 'text', maxlength: 40, 'aria-label': L.machines.office });
  const mem = input({ type: 'text', maxlength: 8, placeholder: '2g', 'aria-label': L.machines.mem });
  const cpus = input({ type: 'number', min: MACHINE_CPUS_MIN, max: MACHINE_CPUS_MAX, step: 0.5, 'aria-label': L.machines.cpus });
  const perFloor = input({ type: 'number', min: 1, max: MACHINES_PER_FLOOR_MAX, step: 1, 'aria-label': L.machines.perFloor });
  const members = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const save = h('button.btn.primary', { type: 'button' }, L.machines.save);
  const test = h('button.btn', { type: 'button' }, L.machines.test);
  const remove = h('button.btn.danger', { type: 'button' }, L.machines.remove);
  const tested = h('p.machine-tested.hidden', { role: 'status' });
  const key = h('code.machine-key');
  const line = h('code.machine-key');
  const copyKey = h('button.btn', { type: 'button' }, L.machines.copy);
  const copyLine = h('button.btn', { type: 'button' }, L.machines.copy);
  const keyBox = h('div', {}, h('p.setting-note', {}, L.machines.key), key, h('div.machine-actions', {}, copyKey), h('p.setting-note', {}, L.machines.authorize), line, h('div.machine-actions', {}, copyLine));
  const row = (label: string, el: HTMLElement) => [h('label', {}, label), el];
  const section = frame([
    h('p.setting-note', {}, L.machines.note),
    h('div.machine-grid', {}, ...row(L.machines.host, host), ...row(L.machines.office, office), ...row(L.machines.mem, mem), ...row(L.machines.cpus, cpus), ...row(L.machines.perFloor, perFloor)),
    h('label.machine-row', {}, members, L.machines.members),
    h('div.machine-actions', {}, save, test, remove),
    tested,
    keyBox,
  ]);
  section.classList.add('machine-setting');

  /** Someone's typing in it: what the office says doesn't overwrite that. */
  let editing = false;
  for (const el of [host, office, mem, cpus, perFloor, members]) el.addEventListener('input', () => (editing = true));
  const paint = () => {
    const st = store.machines;
    const a = st?.admin;
    section.classList.toggle('hidden', !a);
    if (!a) return;
    if (!editing) {
      host.value = a.host;
      office.value = a.office;
      mem.value = a.mem;
      cpus.value = String(a.cpus);
      perFloor.value = String(a.perFloor);
      members.checked = a.members;
    }
    remove.classList.toggle('hidden', !a.host);
    test.classList.toggle('hidden', !a.host);
    keyBox.classList.toggle('hidden', !a.publicKey);
    key.textContent = a.publicKey ?? '';
    line.textContent = a.publicKey ? authorizeLine(a.publicKey, a.office) : '';
    const t = store.machinesTested;
    tested.classList.toggle('hidden', !t);
    if (t) {
      tested.textContent = t.text;
      tested.classList.toggle('bad', !t.ok);
    }
  };
  const copy = (text: string) => void toClipboard(text).then((ok) => toast(ok ? L.machines.copied : L.terminal.copyFailed, ok ? 'info' : 'warn'));
  copyKey.addEventListener('click', () => copy(key.textContent ?? ''));
  copyLine.addEventListener('click', () => copy(line.textContent ?? ''));
  save.addEventListener('click', () => {
    editing = false;
    net.send({ t: 'machines.set', host: host.value.trim(), office: office.value.trim(), mem: mem.value.trim(), cpus: Number(cpus.value), perFloor: Number(perFloor.value), members: members.checked });
  });
  test.addEventListener('click', () => {
    store.machinesTested = { ok: true, text: L.machines.testing };
    paint();
    net.send({ t: 'machines.test' });
  });
  remove.addEventListener('click', () => confirmDialog(L.machines.removeQ, L.machines.removeBody, L.machines.remove, () => net.send({ t: 'machines.remove' })));
  const off = store.on('machines', paint);
  paint();
  net.send({ t: 'machines.get' });
  return { section, off };
}
