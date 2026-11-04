// The 2D view as an app on a phone (a PWA): the service worker (public/sw.js) that lets it be
// installed, work offline and get push notifications; the browser's install prompt, kept for the ☰
// menu's button; the count on the app's icon; and the phone's back gesture closing the window on top
// rather than leaving the app.
import { closeTopModal, modalsOpen, onModalChange } from '../ui/dom';

/** Opened from the home screen, as an app, rather than in a browser tab. */
export function installed(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** An iPhone or iPad, where apps are installed from Safari's share menu and push needs one installed. */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** The service worker, once it's registered (undefined where there's none: plain http, an old browser). */
export let registration: Promise<ServiceWorkerRegistration | undefined> = Promise.resolve(undefined);

/** What the service worker tells an open app: a push came in, or a notification was tapped. */
export type SwMessage = { t: 'push'; data: { kind?: string; workerId?: string } } | { t: 'open'; url: string; workerId?: string; floor?: string };

export function registerApp(onMessage: (m: SwMessage) => void) {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  registration = navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && typeof e.data === 'object' && 't' in e.data) onMessage(e.data as SwMessage);
  });
  watchInstallPrompt();
  backGesture();
}

// ---- Installing ---------------------------------------------------------------------------------
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallPrompt | undefined;
const installListeners = new Set<() => void>();

function watchInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Kept for the ☰ menu's button, instead of the browser's own bar.
    e.preventDefault();
    deferred = e as InstallPrompt;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = undefined;
    installListeners.forEach((fn) => fn());
  });
}

/** The browser can install it from a button (Chrome, Edge, Samsung Internet; not Safari). */
export function canPromptInstall(): boolean {
  return !!deferred;
}

export function onInstallChange(fn: () => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const d = deferred;
  deferred = undefined;
  await d.prompt();
  const { outcome } = await d.userChoice;
  installListeners.forEach((fn) => fn());
  return outcome === 'accepted';
}

// ---- The app's icon -----------------------------------------------------------------------------
/** How many workers are waiting on someone, on the app's icon (where the phone shows one). */
export function setBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?(n: number): Promise<void>; clearAppBadge?(): Promise<void> };
  try {
    if (n > 0) void nav.setAppBadge?.(n)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  } catch {
    // not allowed here
  }
}

// ---- Back ---------------------------------------------------------------------------------------
/**
 * While a window's open there's one extra step in the history, so the phone's back gesture (or the
 * browser's back button) closes the window on top instead of leaving the app. A window closed by its
 * ✕ takes its step back out.
 */
function backGesture() {
  let guarded = false;
  let ours = 0;
  let pending = false;
  const settle = () => {
    pending = false;
    const open = modalsOpen() > 0;
    if (open && !guarded) {
      history.pushState({ sheet: true }, '');
      guarded = true;
    } else if (!open && guarded) {
      guarded = false;
      ours++;
      history.back();
    }
  };
  // A window that closes as another opens (one terminal for the next) is one change, not two.
  onModalChange(() => {
    if (pending) return;
    pending = true;
    setTimeout(settle, 0);
  });
  window.addEventListener('popstate', () => {
    if (ours > 0) return void ours--;
    if (!guarded) return;
    guarded = false;
    closeTopModal();
    // More windows under it (or one that wants an answer first): the next back is for it.
    if (modalsOpen() > 0) settle();
  });
}
