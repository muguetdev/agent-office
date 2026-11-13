// The office's words, in every language it speaks. English is the source: every other language
// is typed against it, so a missing or misshapen message fails the typecheck instead of showing up
// blank. Messages that take values are functions, which lets each language do its own plurals.
// Add a language by adding its dictionary below, its tag to LOCALES (./i18n-core.ts) and its
// loader to the page's (client/i18n.ts).

import { en } from './locales/en.js';
import { ko } from './locales/ko.js';
import { ptBR } from './locales/pt-BR.js';
import { bare, type Locale, type Messages } from './i18n-core.js';

export * from './i18n-core.js';

const DICTIONARIES: Record<Locale, Messages> = { en: bare(en), 'pt-BR': bare(ptBR), ko: bare(ko) };

export function messages(locale: Locale): Messages {
  return DICTIONARIES[locale];
}
