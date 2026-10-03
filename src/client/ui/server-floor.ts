// 🖥️ A floor that's a server (see server/servers.ts), for admins: adding one, then its key for the
// server's authorized_keys and trying the way in. The same window shows an existing one's key again.
import './server-floor.css';
import type { ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import { copyButton } from './team';
import { L } from '../i18n';

let onMessage: ((msg: ServerMsg) => void) | null = null;

/** Main feeds server messages through here, so the open window hears back. */
export function routeServerMessage(msg: ServerMsg) {
  if (msg.t === 'server.added' || msg.t === 'server.key' || msg.t === 'server.tested') onMessage?.(msg);
}

/** Adds a server's floor; with `floorId`, shows that one's key and lets you try the way in. */
export function openServerFloor(net: Net, floorId?: string) {
  const body = h('div.body.team.server-floor');
  const close = h('button.btn.close', { type: 'button', 'aria-label': L.common.close }, '✕');
  const title = h('h2', {}, `🖥️ ${L.serverFloor.title}`);
  const el = h('div.modal', { role: 'dialog', 'aria-label': L.serverFloor.title, style: 'width:min(640px,100%)' }, h('header', {}, title, close), body);

  const field = (label: string, input: HTMLInputElement) => h('label.server-field', {}, h('span', {}, label), input);
  const name = h('input', { type: 'text', maxlength: 60, placeholder: L.serverFloor.namePh, autocomplete: 'off' }) as HTMLInputElement;
  const host = h('input', { type: 'text', maxlength: 253, placeholder: '203.0.113.7', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const user = h('input', { type: 'text', maxlength: 32, value: 'root', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const port = h('input', { type: 'number', min: 1, max: 65535, value: 22 }) as HTMLInputElement;
  const error = h('p.team-status.error.hidden');
  const add = h('button.btn.primary', { type: 'submit' }, L.serverFloor.add);
  const form = h('form.server-form', {}, field(L.serverFloor.name, name), field(L.serverFloor.host, host), h('div.server-row', {}, field(L.serverFloor.user, user), field(L.serverFloor.port, port)), error, h('div.seg', {}, add)) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    add.disabled = true;
    error.classList.add('hidden');
    net.send({ t: 'server.add', name: name.value.trim(), host: host.value.trim(), user: user.value.trim(), port: Number(port.value) || undefined });
  });

  /** Its key, how to let it in, and trying the way in. */
  const showKey = (floor: string, key: string | undefined) => {
    const f = store.floors.find((o) => o.id === floor);
    title.textContent = `🖥️ ${f?.name ?? (name.value.trim() || L.serverFloor.title)}`;
    const result = h('pre.server-result.hidden');
    const test = h('button.btn.primary', { type: 'button' }, L.serverFloor.test);
    test.addEventListener('click', () => {
      test.disabled = true;
      result.classList.remove('hidden', 'ok', 'bad');
      result.textContent = L.serverFloor.testing;
      net.send({ t: 'server.test', floor });
    });
    tested = (ok, output) => {
      test.disabled = false;
      result.classList.add(ok ? 'ok' : 'bad');
      result.textContent = `${ok ? L.serverFloor.works : L.serverFloor.fails}\n${output}`;
    };
    const line = key ? `mkdir -p ~/.ssh && echo '${key}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys` : '';
    body.replaceChildren(
      // The command first: the key on its own isn't something to type into a shell.
      h('p.note', {}, L.serverFloor.keyNote(f?.ssh ? `${f.ssh.user}@${f.ssh.host}` : '')),
      h('div.cmd', {}, h('pre', {}, key ? line : L.serverFloor.noKey), key ? copyButton(L.team.copy, () => line) : null),
      h('p.note', {}, L.serverFloor.orRun),
      h('div.cmd', {}, h('pre', {}, key ?? ''), key ? copyButton(L.team.copy, () => key) : null),
      h('p.note', {}, L.serverFloor.then(floor)),
      h('div.seg', {}, test),
      result,
      // The code it runs: its issues and pull requests on the floor's boards.
      h('h4', {}, `🔗 ${L.serverFloor.repo}`),
      h('form.repo-row', { onsubmit: (e: Event) => (e.preventDefault(), net.send({ t: 'server.repo', floor, repo: repoSelect.value })) }, repoSelect, h('button.btn.primary', { type: 'submit' }, L.serverFloor.saveRepo)),
      h('p.note', {}, L.serverFloor.repoNote),
    );
    linked = f?.repo ?? '';
    fillRepos();
    // The office's own GitHub's repositories (see Building.repos), asked for again once they're a few minutes old.
    const r = store.repos;
    if (!r.loading && (!r.at || Date.now() - r.at > 5 * 60_000 || r.error)) {
      store.repos = { ...r, loading: true };
      net.send({ t: 'floor.repos' });
    }
  };
  /** The repositories the office's GitHub can see, to pick the one the server runs from: none at the top, the linked one picked. */
  const repoSelect = h('select.repo-pick', { 'aria-label': L.serverFloor.repo }) as HTMLSelectElement;
  let linked = '';
  const fillRepos = () => {
    const r = store.repos;
    const names = [...new Set([...(linked ? [linked] : []), ...r.list.map((x) => x.name)])].sort((a, b) => a.localeCompare(b));
    repoSelect.replaceChildren(
      h('option', { value: '' }, r.loading && !r.list.length ? L.common.loading : L.serverFloor.noRepoPick),
      ...names.map((n) => h('option', { value: n, selected: n === linked }, `${r.list.find((x) => x.name === n)?.private ? '🔒 ' : ''}${n}`)),
    );
    repoSelect.value = linked;
  };
  let tested: ((ok: boolean, output: string) => void) | null = null;

  onMessage = (msg) => {
    if (msg.t === 'server.added') {
      add.disabled = false;
      if (msg.error || !msg.floor) {
        error.textContent = msg.error ?? L.serverFloor.failed;
        return error.classList.remove('hidden');
      }
      showKey(msg.floor, msg.publicKey);
    } else if (msg.t === 'server.key' && msg.floor === floorId) showKey(msg.floor, msg.publicKey);
    else if (msg.t === 'server.tested') tested?.(msg.ok, msg.output);
  };
  if (floorId) {
    body.append(h('p.empty', {}, L.common.loading));
    net.send({ t: 'server.key', floor: floorId });
  } else body.append(h('p.note', {}, L.serverFloor.intro), form);

  const offRepos = store.on('repos', fillRepos);
  const modal = openModal(el, { onClose: () => ((onMessage = null), offRepos()) });
  close.addEventListener('click', () => modal.close());
  if (!floorId) setTimeout(() => name.focus(), 30);
}
