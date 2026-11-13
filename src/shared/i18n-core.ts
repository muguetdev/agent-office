// What the office knows about its languages without loading any of their dictionaries: which there
// are, which one a tag asks for, and the seats' names. The page loads only its own language's
// dictionary (see client/i18n.ts); the server and the tests have them all (./i18n.ts).

import type { en } from './locales/en.js';
import { enPlaces } from './locales/en-places.js';

export type Messages = typeof en;

export const LOCALES = ['en', 'pt-BR', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Every table in a dictionary without Object's prototype, so a lookup by a name from outside (a
 * worker, a role or a board called "constructor") finds nothing and falls back, as for any other
 * name the table doesn't have, instead of finding Object's own function.
 */
export function bare<T>(o: T): T {
  if (o && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype) {
    for (const v of Object.values(o)) bare(v);
    Object.setPrototypeOf(o, null);
  }
  return o;
}

/** The seats' English names, which a layout's labels are checked against (see placeName). */
const EN_PLACES = bare(enPlaces);

/**
 * The language a tag like `pt-BR`, `pt_BR.UTF-8` or `pt` asks for, or undefined when the office
 * doesn't speak it. A bare language picks its first region we have (`pt` is `pt-BR`).
 */
export function matchLocale(tag: string | undefined): Locale | undefined {
  const clean = (tag ?? '').split('.')[0].split('@')[0].replace('_', '-').trim().toLowerCase();
  if (!clean) return undefined;
  const exact = LOCALES.find((l) => l.toLowerCase() === clean);
  if (exact) return exact;
  const lang = clean.split('-')[0];
  return LOCALES.find((l) => l.toLowerCase().split('-')[0] === lang);
}

/**
 * The language a terminal asks for: AGENT_OFFICE_LANG, then the POSIX variables in the order they
 * override each other (LC_ALL, LC_MESSAGES, LANG). The first one set decides, as it does for other
 * programs, so LANG=C means English even when a later variable says otherwise.
 */
export function envLocale(env: Record<string, string | undefined>): Locale {
  for (const name of ['AGENT_OFFICE_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = env[name]?.trim();
    if (value) return matchLocale(value) ?? 'en';
  }
  return 'en';
}

/** A desk or seat's name in a language: shared/layout.ts names them in English, and they're translated here by id. */
export function placeName(m: Messages, place: { id: string; label: string }): string {
  // A map of its own names its seats itself (see shared/maps): those stay as they are.
  if (byId(EN_PLACES, place) !== place.label) return place.label;
  return byId(m.places, place) ?? place.label;
}

function byId(names: Messages['places'], place: { id: string; label: string }): string | undefined {
  const n = Number(/-(\d+)$/.exec(place.id)?.[1]);
  if (place.id.startsWith('desk-')) return names.desk(n);
  if (place.id.startsWith('beanbag-')) return names.beanBag(n);
  if (place.id === 'meeting-1') return names.headOfTable;
  if (place.id.startsWith('meeting-')) return names.meetingChair(n);
  const fixed: Record<string, string> = names.fixed;
  return fixed[place.id.replace(/-\d+$/, '')];
}
