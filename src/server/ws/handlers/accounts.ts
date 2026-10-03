// Inviting, listing and revoking people. Admins only: an admin account, or the shared password.
import type { AccountsClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';
import { L } from '../../i18n.js';
import { accessChanged } from '../../office/access.js';

/** Floor ids from a message: only floors the building has, or is cloning. */
const floorsIn = (ctx: Ctx, v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x, 64)).filter((id) => ctx.floors.has(id) || ctx.building.pending().some((d) => d.id === id)) : []);

/** Whether `c` may manage accounts; if not, they're told so. */
const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId, c.guest).admin) return true;
  ctx.warn(c, L.srv.adminsAccounts);
  return false;
};

export const accountsHandlers = {
  'accounts.get'(ctx, c) {
    if (!admin(ctx, c)) return;
    ctx.sendTo(c, { t: 'accounts', state: ctx.accounts.state(ctx.onlineAccounts()) });
  },
  'accounts.invite'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const r = ctx.accounts.invite(who, msg.role === 'admin' ? 'admin' : 'member', typeof msg.name === 'string' ? msg.name : undefined, floorsIn(ctx, msg.floors));
    if (typeof r === 'string') return ctx.sendTo(c, { t: 'accounts.invited', error: r });
    ctx.sendTo(c, { t: 'accounts.invited', invite: r });
    ctx.accountsChanged();
  },
  'accounts.cancel'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    if (ctx.accounts.cancel(str(msg.inviteId, 32))) ctx.accountsChanged();
  },
  'accounts.revoke'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const id = str(msg.accountId, 32);
    if (id === c.accountId) return ctx.warn(c, L.srv.revokeSelf);
    const a = ctx.accounts.revoke(id);
    if (!a) return;
    console.log(`  ${who} revoked ${a.name}'s account`);
    ctx.toastAll(`${who} revoked ${a.name}'s account`);
    ctx.accountsChanged(); // signs them out everywhere
    ctx.signins.forget(a.id); // and their Claude and GitHub sign-ins go with the account
    ctx.accountLimits.get(a.id)?.reader.close();
    ctx.accountLimits.delete(a.id);
  },
  'accounts.role'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const id = str(msg.accountId, 32);
    if (id === c.accountId) return ctx.warn(c, L.srv.ownRole);
    const a = ctx.accounts.setRole(id, msg.role === 'admin' ? 'admin' : 'member');
    if (!a) return;
    ctx.toastAll(a.role === 'admin' ? L.srv.madeAdmin(who, a.name) : L.srv.noLongerAdmin(a.name));
    ctx.accountsChanged();
    // Everywhere now, or only their own floors again.
    accessChanged(ctx, a.id);
    // Only admins may use the office's own sign-ins: a demoted one is back on their own.
    void ctx.signins.look(a.id, true);
  },
  'accounts.floors'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const a = ctx.accounts.setFloors(str(msg.accountId, 32), floorsIn(ctx, msg.floors));
    if (!a) return;
    console.log(`  ${L.access.floorsLog(who, a.name, a.floors?.length ?? 0)}`);
    ctx.accountsChanged();
    accessChanged(ctx, a.id);
  },
  'accounts.bar'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const bar = ctx.accounts.setBar(msg.on === true, who);
    console.log(`  ${bar ? L.access.barOpenedLog(who) : L.access.barClosedLog(who)}`);
    ctx.accountsChanged();
    // Whoever came in by the old link is out.
    accessChanged(ctx, undefined);
  },
  'accounts.shared'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    if (msg.on === ctx.accounts.sharedPassword) return;
    // Only someone who can still get in without it may switch it off.
    if (!msg.on && !c.accountId) return ctx.warn(c, L.srv.adminFirst);
    ctx.accounts.setSharedPassword(!!msg.on);
    console.log(`  ${msg.on ? L.srv.sharedOnLog(who) : L.srv.sharedOffLog(who)}`);
    ctx.toastAll(msg.on ? L.srv.sharedOn(who) : L.srv.sharedOff(who));
    ctx.accountsChanged(); // signs out whoever came in with it
  },
} satisfies HandlerMap<AccountsClientMsg>;
