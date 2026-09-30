import { envLocale, messages } from '../shared/i18n.js';

// The office's words on the server, in the language its terminal asks for (AGENT_OFFICE_LANG, else
// the POSIX locale; see ../shared/i18n.ts): its console, the toasts and errors it sends the pages,
// and what it posts to Slack or Discord. One office speaks one language to everyone in it.

export const locale = envLocale(process.env);

export const L = messages(locale);
