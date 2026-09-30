import { LOCALES, matchLocale, messages, placeName, type Locale } from '../shared/i18n';

// The language the page speaks: the browser's, the first of its languages the office knows.
// `?lang=pt-BR` or `?lang=en` in the address picks one and remembers it for this browser.

const KEY = 'agent-office-lang';

function pickLocale(): Locale {
  try {
    const asked = matchLocale(new URLSearchParams(location.search).get('lang') ?? undefined);
    if (asked) {
      localStorage.setItem(KEY, asked);
      return asked;
    }
    const saved = matchLocale(localStorage.getItem(KEY) ?? undefined);
    if (saved) return saved;
  } catch {
    // no storage (a private window): go by the browser
  }
  for (const tag of (typeof window === 'undefined' ? [] : navigator.languages ?? [navigator.language])) {
    const l = matchLocale(tag);
    if (l) return l;
  }
  return LOCALES[0];
}

export const locale = pickLocale();
if (typeof document !== 'undefined') document.documentElement.lang = locale;

/** The page's words, in its language (see ../shared/locales). */
export const L = messages(locale);

/** The message at a dotted path like `hud.people`, or undefined when there's none. */
function lookup(path: string): string | undefined {
  let v: unknown = L;
  for (const part of path.split('.')) v = (v as Record<string, unknown> | undefined)?.[part];
  return typeof v === 'string' ? v : undefined;
}

/** The attributes a page's HTML marks for translation, and what each one sets. */
const MARKS: [string, (el: HTMLElement, text: string) => void][] = [
  ['data-t', (el, text) => (el.textContent = text)],
  ['data-t-title', (el, text) => (el.title = text)],
  ['data-t-placeholder', (el, text) => el.setAttribute('placeholder', text)],
  ['data-t-aria-label', (el, text) => el.setAttribute('aria-label', text)],
];

/** Puts the words into a page's HTML: each element marked `data-t="hud.people"` (and the -title, -placeholder, -aria-label kinds) gets that message. */
export function translatePage(root: ParentNode = document) {
  for (const [attr, set] of MARKS)
    for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const text = lookup(el.getAttribute(attr)!);
      if (text !== undefined) set(el, text);
    }
}

/** A desk or seat's name in the page's language (see placeName in ../shared/i18n.ts). */
export function placeLabel(place: { id: string; label: string }): string {
  return placeName(L, place);
}

/** A meeting pattern's name, line and rounds note in the page's language (shared/meetings.ts has them in English). */
export function patternText(id: string): { label: string; blurb: string; roundsNote: string } | undefined {
  return L.meetings.patterns[id];
}

export function patternLabel(id: string): string {
  return patternText(id)?.label ?? id;
}

/** A meeting seat's role, which the server names in English (see shared/meetings.ts). */
export function roleLabel(role: string): string {
  return L.meetings.roles[role] ?? role;
}
