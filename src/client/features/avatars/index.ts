/**
 * The office avatars (see dress.ts): every Person made from here on is dressed in one, and each frame
 * the avatars copy their Person's pose. ⚙️ → You → Characters picks them or the classic cartoon people
 * (this browser's choice, for everyone it shows).
 */
import type { Ctx } from '../../core/context';
import { Person } from '../../world/character/person';
import { Avatar } from './dress';

export interface AvatarsDeps {
  /** Whether the avatars are on (else the classic cartoon people). */
  on(): boolean;
  /** Someone shown as the classic cartoon anyway: you in first person, where your own torso and legs are drawn below you. */
  classic(p: Person): boolean;
}

export function installAvatars(ctx: Ctx, deps: AvatarsDeps) {
  const avatars = new Set<Avatar>();
  Person.made = (p) => {
    try {
      const a = new Avatar(p);
      a.show(deps.on() && !deps.classic(p));
      avatars.add(a);
    } catch (err) {
      // The model didn't load: the classic cartoon stays.
      console.error('avatar', err);
    }
  };
  // After everyone's moved and posed (the 'me', 'others' and 'world' ticks), before the frame's drawn.
  ctx.ticks.add('hud', ({ dt }) => {
    const all = deps.on();
    for (const a of avatars) {
      const on = all && !deps.classic(a.person);
      // One whose Person has gone (someone left) is let go of.
      if (!a.person.root.parent) {
        avatars.delete(a);
        continue;
      }
      if (a.root.visible !== on) a.show(on);
      a.update(dt);
    }
  });
}
