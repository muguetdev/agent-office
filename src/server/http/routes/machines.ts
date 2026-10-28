// A worker's machine's desktop, proxied by the office (see machines/proxy.ts): signed in, on a floor
// you may be on, and nothing under /api/machines/ but the desktops.
import type { Route } from '../router.js';
import { MACHINES_PREFIX, proxyDesktop } from '../../machines/proxy.js';

export const machineRoutes = {
  desktop: { prefix: MACHINES_PREFIX, auth: 'session', handle: (ctx, { req, res, session }) => proxyDesktop(ctx, req, res, session) },
} satisfies Record<string, Route>;
