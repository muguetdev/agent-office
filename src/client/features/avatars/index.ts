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
  /** Whether `p` is you in first person, whose body is drawn below the camera without its head and arms. */
  firstPerson(p: Person): boolean;
}

export function installAvatars(ctx: Ctx, deps: AvatarsDeps) {
  const avatars = new Set<Avatar>();
  Person.made = (p) => {
    try {
      const a = new Avatar(p);
      a.show(deps.on());
      avatars.add(a);
    } catch (err) {
      // The model didn't load: the classic cartoon stays.
      console.error('avatar', err);
    }
  };
  // After everyone's moved and posed (the 'me', 'others' and 'world' ticks), before the frame's drawn.
  ctx.ticks.add('hud', ({ dt }) => {
    const on = deps.on();
    // Your first-person hands are the avatar's, which don't dress up for a holiday.
    ctx.hands.setPlain(on);
    for (const a of avatars) {
      // One whose Person has gone (someone left) is let go of.
      if (!a.person.root.parent) {
        avatars.delete(a);
        continue;
      }
      if (a.root.visible !== on) a.show(on);
      a.firstPerson(on && deps.firstPerson(a.person));
      a.update(dt);
    }
  });
}
