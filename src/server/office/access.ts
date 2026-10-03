// Who may go where in the building. Each floor is its own project (often its own company): admins,
// and whoever came in with the shared office password, go everywhere; a member only onto the floors
// an admin let them onto; and anyone with the rooftop bar's open link only up to the bar. Nobody
// sees into a floor they can't go to: its people, its chat, its workers or its files. Only its name
// shows, on the elevator's panel.
import { WebSocket } from 'ws';
import { ROOF } from '../../shared/rooftop.js';
import type { ChatLine, ClientMsg, FloorInfo, ServerMsg } from '../../shared/protocol.js';
import type { Accounts } from '../accounts.js';
import type { Session } from '../auth.js';
import type { Floor } from '../floor.js';
import type { Ctx } from './context.js';
import type { Client } from './client.js';
import { L } from '../i18n.js';

/** Whoever's asking: a connection (Client) or a request's session (see whoOf). */
export interface Who {
  accountId?: string;
  guest?: boolean;
}

export const whoOf = (session: Session): Who => ({ accountId: session.account?.id, guest: session.guest });

/** Goes everywhere: an admin, or the shared office password. */
export function everywhere(accounts: Accounts, who: Who): boolean {
  if (who.guest) return false;
  if (!who.accountId) return true;
  return accounts.get(who.accountId)?.role === 'admin';
}

/**
 * Whether `who` may be at `place`: a floor's id, the roof (the bar's open to everyone who's in), or
 * none (the lobby, while the building has no floors yet).
 */
export function mayEnter(accounts: Accounts, who: Who, place: string | undefined): boolean {
  if (place === ROOF) return true;
  if (who.guest) return false;
  if (place === undefined || everywhere(accounts, who)) return true;
  const floors = accounts.get(who.accountId)?.floors;
  return Array.isArray(floors) && floors.includes(place);
}

/** The floor of a request's `?floor=`, if it's one the session may go to. */
export const floorFor = (ctx: Ctx, session: Session, id: string | null): Floor | undefined => {
  const floor = ctx.floors.get(id ?? '');
  return floor && mayEnter(ctx.accounts, whoOf(session), floor.id) ? floor : undefined;
};

/** Whether a session may use a worker's web server (a service tunnel): one on a floor it may go to. */
export const mayUseService = (ctx: Ctx, session: Session | undefined, workerId: string) => {
  const floor = ctx.workerFloor(workerId);
  return !!session && !!floor && mayEnter(ctx.accounts, whoOf(session), floor.id);
};

/** The first floor `who` may go to, for arriving in the office. */
export const firstFloorFor = (ctx: Ctx, who: Who): Floor | undefined => [...ctx.floors.values()].find((f) => mayEnter(ctx.accounts, who, f.id));

/** Whether `viewer` sees `c` at all: they're somewhere the viewer may go too. */
export const sees = (ctx: Ctx, viewer: Who, c: Client) => mayEnter(ctx.accounts, viewer, c.peer.floor);

/** The people `viewer` sees, for the welcome and each floor they arrive on. */
export const peersFor = (ctx: Ctx, viewer: Client) => [...ctx.clients.values()].filter((o) => o === viewer || sees(ctx, viewer, o)).map((o) => o.peer);

/** Something about `c` (they moved floors, sat down, picked up a drink): to everyone who sees them. */
export function toSeers(ctx: Ctx, c: Client, msg: ServerMsg, except?: string, droppable = false) {
  const json = JSON.stringify(msg);
  for (const o of ctx.clients.values()) {
    if (o.id === except || o.ws.readyState !== WebSocket.OPEN || !sees(ctx, o, c)) continue;
    if (droppable && o.ws.bufferedAmount > 4 * 1024 * 1024) continue;
    o.ws.send(json);
  }
}

/**
 * `c` moved from `was` to where they are now: whoever saw them there and doesn't any more sees them
 * go, and whoever sees them now gets them as they are (a peer.update adds someone new, too).
 */
export function moved(ctx: Ctx, c: Client, was: string | undefined) {
  const update = JSON.stringify({ t: 'peer.update', peer: c.peer } satisfies ServerMsg);
  const leave = JSON.stringify({ t: 'peer.leave', id: c.id } satisfies ServerMsg);
  for (const o of ctx.clients.values()) {
    if (o === c || o.ws.readyState !== WebSocket.OPEN) continue;
    if (sees(ctx, o, c)) o.ws.send(update);
    else if (mayEnter(ctx.accounts, o, was)) o.ws.send(leave);
  }
}

/** A floor `who` can't go to, on their elevator panel: its name and how big it is outside, and nothing of what's in it. */
const locked = (f: FloorInfo, guest: boolean): FloorInfo => ({
  id: f.id,
  name: guest ? L.access.privateFloor : f.name,
  dir: '',
  palette: f.palette,
  addedBy: '',
  addedAt: 0,
  workers: 0,
  busy: 0,
  waiting: 0,
  people: 0,
  wing: f.wing,
  locked: true,
});

/** The building's floors as `who` sees them. */
export const floorsFor = (ctx: Ctx, who: Who, list: FloorInfo[]): FloorInfo[] =>
  everywhere(ctx.accounts, who) ? list : list.map((f) => (mayEnter(ctx.accounts, who, f.id) ? f : locked(f, !!who.guest)));

/** Sends each person the building's floors as they see them. */
export function floorsToEveryone(ctx: Ctx, list: FloorInfo[]) {
  for (const c of ctx.clients.values()) ctx.sendTo(c, { t: 'floors', floors: floorsFor(ctx, c, list) });
}

/** A chat line `who` may read: one said somewhere they may go (and the lines from before places had chats, for those who go everywhere). */
export const readsLine = (accounts: Accounts, who: Who, line: ChatLine) => (line.place === undefined ? everywhere(accounts, who) : mayEnter(accounts, who, line.place || undefined));

/** The chat of the place `c` is at now: what was said there (see ChatLine.place). */
export const chatHere = (ctx: Ctx, c: Client, n = 50): ChatLine[] => {
  const place = c.peer.floor ?? '';
  return ctx.chat
    .recent(400)
    .filter((l) => (l.place === undefined ? everywhere(ctx.accounts, c) : l.place === place))
    .slice(-n);
};

/** A chat line, to everyone at the place it was said. */
export function sayHere(ctx: Ctx, c: Client, line: ChatLine) {
  for (const o of ctx.clients.values()) if (o.peer.floor === c.peer.floor) ctx.sendTo(o, { t: 'chat', ...line });
}

/** WebSocket close code for someone whose way around the building changed: their page connects again and starts over. */
const ACCESS_CHANGED = 4002;

/**
 * What `accountId` (or, with none, every guest) may see changed: their pages connect again, so
 * they're shown only what they may see now, and taken off any floor they may no longer be on.
 */
export function accessChanged(ctx: Ctx, accountId: string | undefined) {
  for (const c of ctx.clients.values()) {
    if (c.out || (accountId ? c.accountId !== accountId : !c.guest)) continue;
    c.out = true;
    c.ws.close(ACCESS_CHANGED, 'Access changed');
  }
}

/** What a guest's page may send: walking about and everything up at the bar. Anything else is dropped (see dispatch). */
const GUEST_SENDS: ReadonlySet<string> = new Set<ClientMsg['t']>(['move', 'act', 'sit', 'emote', 'profile', 'doing', 'voice', 'rtc', 'chat', 'ping', 'floor.go', 'toss', 'horn']);

/** What a guest hears of what goes out to the whole building: how it looks. Not its toasts, settings or spend. */
const GUEST_HEARS: ReadonlySet<string> = new Set<ServerMsg['t']>(['sky', 'theme', 'map', 'language', 'upgrade', 'peer.join', 'peer.update', 'peer.leave', 'peer.act']);

/** Whether a message to everyone (see Messaging.broadcast) goes to `c` too. */
export const hears = (c: Client, t: string) => !c.guest || GUEST_HEARS.has(t);

/** Whether `c` may send a message of type `t` at all. */
export const maySend = (c: Client, t: string) => !c.guest || GUEST_SENDS.has(t);
