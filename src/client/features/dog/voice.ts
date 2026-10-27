// How the floor's pet sounds and carries on, by what it is: a dog of any breed, or the cat. The rig, the
// clips and the server's day for it are the same for both (see world.ts and server/dog.ts); this is what
// differs on the page: its call and the bubble with it, the sound when it's petted, panting, how it looks
// petted, its nose and what the hint bar says it's doing.
import { petEmoji, type DogAct, type DogBreed } from '../../../shared/dog';
import { L } from '../../i18n';

export interface DogSounds {
  bark(x: number, z: number, times: number): void;
  /** A happy little yip, when someone pets it. */
  yip(x: number, z: number): void;
  meow(x: number, z: number, times: number): void;
  /** A purr, when someone pets the cat. */
  purr(x: number, z: number): void;
}

export interface Voice {
  /** In front of its name on its tag and in the hint bar. */
  emoji: string;
  /** Its call at a worker that needs input, in the page's language: in the bubble the first time, and every time after. */
  calls(): [string, string];
  call(sounds: DogSounds, x: number, z: number, times: number): void;
  /** Someone just petted it. */
  petted(sounds: DogSounds, x: number, z: number): void;
  /** Hangs its mouth open panting when it's happy or after a run. */
  pants: boolean;
  /** How open its eyes are while it's petted (1 is wide open; a cat narrows them, content). */
  pettedEyes: number;
  /** Paint for its parts, over the dog's (by material name, see world.ts's PAINT). */
  paint: Record<string, string>;
  /** What it's up to, for the hint bar, in the page's language: "napping under Ada's desk". `w` is the worker's name. */
  doing(act: DogAct, moving: boolean, w: string, petBy?: string): string;
}

const DOG: Voice = {
  emoji: petEmoji('pup'),
  calls: () => [L.dog.woof3, L.dog.woof2],
  call: (s, x, z, times) => s.bark(x, z, times),
  petted: (s, x, z) => s.yip(x, z),
  pants: true,
  pettedEyes: 1,
  paint: {},
  doing(act, moving, w, petBy) {
    switch (act) {
      case 'bark':
        return moving ? L.dog.runningTo(w) : L.dog.barkingAt(w);
      case 'nap':
        return moving ? L.dog.offNap : L.dog.napping(w);
      case 'wag':
        return petBy ? L.dog.waggingAt(petBy) : L.dog.wagging;
      case 'lie':
        return moving ? L.dog.trottingLounge : L.dog.lounging;
      case 'sniff':
        return moving ? L.dog.trotting : L.dog.sniffing;
      case 'sit':
        return L.dog.sitting;
      default:
        return '';
    }
  },
};

const CAT: Voice = {
  emoji: petEmoji('cat'),
  calls: () => [L.cat.meow2, L.cat.meow1],
  call: (s, x, z, times) => s.meow(x, z, times - 1),
  petted: (s, x, z) => s.purr(x, z),
  pants: false,
  pettedEyes: 0.35,
  paint: { Nose: '#f29bb0' },
  doing(act, moving, w, petBy) {
    switch (act) {
      case 'bark':
        return moving ? L.dog.runningTo(w) : L.cat.meowingAt(w);
      case 'nap':
        return moving ? L.dog.offNap : L.cat.curledUp(w);
      case 'wag':
        return petBy ? L.cat.purringAt(petBy) : L.cat.purring;
      case 'lie':
        return moving ? L.cat.paddingLounge : L.cat.loafing;
      case 'sniff':
        return moving ? L.cat.prowling : L.cat.washing;
      case 'sit':
        return L.dog.sitting;
      default:
        return '';
    }
  },
};

export function voiceOf(breed: DogBreed): Voice {
  return breed === 'cat' ? CAT : DOG;
}
