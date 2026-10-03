// ⚙️ A worker's settings after it's hired: its provider, model and effort. Saving starts it again on
// them, carrying on its conversation (see server/ws/handlers/configure.ts).
import { PROVIDER_META } from '../../shared/providers';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import { agentFields, resolvedProvider } from './provider';
import { L } from '../i18n';

export function openWorkerConfig(net: Net, workerId: string) {
  const w = store.workers.get(workerId);
  if (!w || w.kind !== 'agent') return;
  const was = { provider: w.provider ?? resolvedProvider(store.project?.defaultProvider, store.project), model: w.model, effort: w.effort };
  const fields = agentFields(store.project, `configure-${workerId}`, was);
  const note = h('p.setting-note', {}, L.configure.note);
  const close = h('button.btn.close', { type: 'button', 'aria-label': L.common.close }, '✕');
  const cancel = h('button.btn', { type: 'button' }, L.hints.cancel);
  const save = h('button.btn.primary', { type: 'submit' }, L.configure.save);
  const form = h(
    'form.modal.worker-config',
    { role: 'dialog', 'aria-label': L.configure.title(w.name), style: 'width:min(520px,100%)' },
    h('header', {}, h('h2', {}, `⚙️ ${L.configure.title(w.name)}`), close),
    h('div.body', {}, fields.element, note),
    h('footer', {}, h('span.grow'), cancel, save),
  ) as HTMLFormElement;
  // Another provider can't carry on the conversation: say so before it's saved.
  const sync = () => (note.textContent = fields.value() !== was.provider ? L.configure.newProvider : PROVIDER_META[fields.value()].switchesModel ? L.configure.note : L.configure.newSession);
  sync();
  fields.element.addEventListener('change', sync);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fields.valid()) return;
    net.send({ t: 'worker.configure', workerId, provider: fields.value(), model: fields.model(), effort: fields.effort() });
    modal.close();
  });
  const modal = openModal(form, { doing: L.configure.doing(w.name) });
  close.addEventListener('click', () => modal.close());
  cancel.addEventListener('click', () => modal.close());
}
