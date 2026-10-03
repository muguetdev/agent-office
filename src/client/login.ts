import { L, translatePage } from './i18n';

translatePage();

const form = document.getElementById('form') as HTMLFormElement;
const nameRow = document.getElementById('name-row') as HTMLLabelElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const nameNote = document.getElementById('name-note') as HTMLParagraphElement;
const sub = document.getElementById('sub') as HTMLParagraphElement;
const input = document.getElementById('password') as HTMLInputElement;
const error = document.getElementById('error') as HTMLParagraphElement;
const submit = document.getElementById('submit') as HTMLButtonElement;

const NAME_KEY = 'agent-office.login-name';
/** Where to go once in: the 2D view if that's where you were headed (see loginUrl in net.ts), else the office. */
const NEXT = new URLSearchParams(location.search).get('next') === '/lite' ? '/lite' : '/';

// A sign-in link from the office's terminal (/login#key=…): it works once, so take it out of the
// address bar and trade it for a session. The key is after the #, so it never reaches a server log.
const linkKey = new URLSearchParams(location.hash.slice(1)).get('key');
if (linkKey) {
  history.replaceState(null, '', location.pathname + location.search);
  void fetch('/api/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: linkKey }) })
    .then(async (res) => {
      if (res.ok) return location.replace(NEXT);
      error.textContent = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? L.auth.couldNotSignIn;
    })
    .catch(() => void (error.textContent = L.auth.unreachable));
}

// The rooftop bar's open link (/bar#<key>): no password, just up to the bar as a guest. Someone
// already signed in goes up as themselves.
const barKey = location.pathname === '/bar' ? location.hash.slice(1) : '';
if (barKey) {
  form.hidden = true;
  sub.textContent = L.access.barWelcome;
  void fetch('/api/bar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: barKey }) })
    .then(async (res) => {
      // The office takes a guest straight up to the roof.
      if (res.ok) return location.replace('/');
      error.textContent = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? L.auth.couldNotSignIn;
    })
    .catch(() => void (error.textContent = L.auth.unreachable));
}

// Ask for a name once people have accounts; it's optional while the shared password still works.
if (!barKey) void fetch('/api/login', { cache: 'no-store' })
  .then((r) => r.json())
  .then(({ accounts, shared }: { accounts: boolean; shared: boolean }) => {
    if (!accounts && shared) return;
    nameRow.hidden = false;
    nameInput.required = !shared;
    nameNote.hidden = !shared;
    sub.textContent = shared ? L.auth.whoIsIt : L.auth.whoIsItAccount;
    try {
      nameInput.value = localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      // storage blocked
    }
    (nameInput.value ? input : nameInput).focus();
  })
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  submit.disabled = true;
  const name = nameRow.hidden ? '' : nameInput.value.trim();
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password: input.value }),
    });
    if (res.ok) {
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {
        // storage blocked
      }
      location.href = NEXT;
      return;
    }
    const body = await res.json().catch(() => ({}));
    error.textContent = body.error ?? L.auth.couldNotSignIn;
    input.select();
  } catch {
    error.textContent = L.auth.unreachable;
  } finally {
    submit.disabled = false;
  }
});
