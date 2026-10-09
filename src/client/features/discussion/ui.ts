import './ui.css';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';
import { L } from '../../i18n';
import { canDiscuss, DISCUSSION_MESSAGES, DISCUSSION_TOPIC_MAX } from '../../../shared/discussions';

/** Start a visible, bounded exchange between workers already at their desks. */
export function openDiscussion(onStart: (first: string, second: string, topic: string) => void) {
  const workers = [...store.workers.values()].filter(canDiscuss);
  if (workers.length < 2) return void toast(L.discussion.needTwo, 'warn');
  const option = (w: (typeof workers)[number]) => h('option', { value: w.id }, w.name);
  const first = h('select', { 'aria-label': L.discussion.owner }, ...workers.map(option)) as HTMLSelectElement;
  const second = h('select', { 'aria-label': L.discussion.reviewer }, ...workers.map(option)) as HTMLSelectElement;
  first.value = workers[0].id;
  second.value = workers[1].id;
  const topic = h('textarea', { rows: 5, maxlength: DISCUSSION_TOPIC_MAX, placeholder: L.discussion.topicPlaceholder, 'aria-label': L.discussion.topic }) as HTMLTextAreaElement;
  const submit = h('button.btn.primary', { type: 'submit' }, L.discussion.start);
  const form = h(
    'form.modal.discussion-form',
    { role: 'dialog', 'aria-label': L.discussion.dialog },
    h('header', {}, h('h2', {}, L.discussion.title)),
    h(
      'div.body',
      {},
      h('p', {}, L.discussion.about(DISCUSSION_MESSAGES)),
      h('label', {}, L.discussion.owner, first),
      h('label', {}, L.discussion.reviewer, second),
      h('label', {}, L.discussion.topic, topic),
    ),
    h('footer', {}, submit),
  ) as HTMLFormElement;
  // Its ✕ and Esc come from openModal, and closing it hands the mouse straight back to the view.
  const modal = openModal(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (first.value === second.value) return void toast(L.discussion.pickDifferent, 'warn');
    if (!topic.value.trim()) return topic.focus();
    onStart(first.value, second.value, topic.value.trim());
    modal.close();
  });
  topic.focus();
}
