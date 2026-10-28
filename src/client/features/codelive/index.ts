/**
 * The live Code tab (ui/code-live/): links the office's socket, so a worker's Code tab, whenever
 * it's opened, hears what changes in the worker's folder as it happens. Nothing else runs until then.
 */
import type { Ctx } from '../../core/context';
import { linkCodeLive } from '../../ui/code-live/link';

export function installCodeLive(ctx: Ctx) {
  linkCodeLive(ctx.net);
}
