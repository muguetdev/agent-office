import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { lightIndoors } from '../../world/indoor-light';

/**
 * The light inside the office (see world/indoor-light.ts): from overhead, as bright as the sun is, or as
 * the lamps once it's dark enough for them. After the sky's had its say (core/loop.ts's env tick), so it
 * follows the sun of the moment; where you stand doesn't come into it.
 */
export function installLamplight(ctx: Ctx, parts: Pick<Parts, 'stage'>) {
  ctx.ticks.add('env', () => lightIndoors(parts.stage.sun, ctx.sky.lampsOn));
}
