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

// Ask for a name once people have accounts; it's optional while the shared password still works.
void fetch('/api/login', { cache: 'no-store' })
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
      location.href = '/';
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
