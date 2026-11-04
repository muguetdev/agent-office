// Push notifications on a phone (server/push/): a worker waiting on you, or done, shows up with the app
// closed. The phone subscribes with the office's key and hands the subscription to the office, which
// sends to it from then on. iPhones only do it from the installed app (iOS 16.4 and up).
import { installed, isIOS, registration } from './pwa';
import { locale } from '../i18n';

export type PushState = 'unsupported' | 'install-first' | 'denied' | 'off' | 'on';

function supported(): boolean {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The subscription this phone has, if any. */
async function current(): Promise<PushSubscription | null> {
  const reg = await registration;
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIOS() && !installed() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (!(await registration)) return 'unsupported';
  return (await current()) ? 'on' : 'off';
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The office's public key, as the push service wants it. */
async function serverKey(): Promise<Uint8Array<ArrayBuffer>> {
  const r = await fetch('/api/push/key', { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) throw new Error(`push key: ${r.status}`);
  const { publicKey } = (await r.json()) as { publicKey: string };
  const b64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Asks for permission (from a tap) and subscribes; the state it ends in. */
export async function turnOn(): Promise<PushState> {
  if (!supported()) return pushState();
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return pushState();
  const reg = await registration;
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  let sub = await current();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: await serverKey() });
  const r = await post('/api/push/subscribe', { subscription: sub.toJSON(), lang: locale });
  if (!r.ok) throw new Error(`subscribe: ${r.status}`);
  return 'on';
}

export async function turnOff(): Promise<PushState> {
  const sub = await current();
  if (sub) {
    await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return pushState();
}

/** One sent to this phone now, to see it works. */
export async function test(): Promise<boolean> {
  const sub = await current();
  if (!sub) return false;
  const r = await post('/api/push/test', { endpoint: sub.endpoint }).catch(() => undefined);
  return !!r?.ok;
}

/** Hands the office this phone's subscription again on every visit, in case it forgot it (or the language changed). */
export async function refresh() {
  if (!supported() || Notification.permission !== 'granted') return;
  const sub = await current();
  if (sub) await post('/api/push/subscribe', { subscription: sub.toJSON(), lang: locale }).catch(() => {});
}
