// What a person looks like in the office, picked on the character select screen.
// Server and client share these lists so a look is just three small indexes on the wire.

export const SKIN_TONES = ['#ffe3cc', '#ffd7b5', '#f1c27d', '#e0ac69', '#c68642', '#a0663a', '#8d5524', '#5c3a21'];
export const HAIR_COLORS = ['#2b2d42', '#4a3222', '#6f4e37', '#e9c46a', '#c1440e', '#d9d9d9', '#d62828', '#ff8fab', '#9d4edd', '#264653'];
export const HAIR_STYLES = ['Short', 'Long', 'Bun', 'Spiky', 'Curly', 'Ponytail', 'Bald'];

export interface Look {
  skin: number;
  hair: number;
  /** The classic cartoon's hair style (HAIR_STYLES); the avatar's is in `outfit`. */
  style: number;
  /** What the office avatar wears, once it's been picked (else it's chosen from the name). */
  outfit?: Outfit;
}

/** The office avatar's choices (see client/features/avatars), each an index into its list below. */
export interface Outfit {
  cut: number;
  top: number;
  bottom: number;
  shoes: number;
  glasses: number;
  beard: number;
  pants: number;
  shoeColor: number;
}

/** The avatar's hair cuts, and the classic HAIR_STYLES each one is closest to (for the cartoon people). */
export const AVATAR_CUTS = ['Wavy', 'Bun', 'Bob', 'Bald'] as const;
export const CUT_STYLE = [0, 2, 1, 6];
export const AVATAR_TOPS = ['HoodieOpen', 'Jacket', 'Tee'] as const;
export const AVATAR_BOTTOMS = ['Trousers', 'Joggers'] as const;
export const AVATAR_SHOES = ['Sneakers', 'Runners'] as const;
export const AVATAR_GLASSES = ['None', 'Round', 'Square'] as const;
export const AVATAR_BEARDS = ['None', 'Stubble', 'Full'] as const;
export const PANTS_COLORS = ['#2A3044', '#3B4256', '#7F858F', '#B8A486', '#1E1E22', '#4A6FA5', '#5B4636', '#556B3A', '#8C2F39', '#E9E4D8', '#C9A227', '#6D597A'];
export const SHOE_COLORS = ['#F4F4F4', '#2F7FF0', '#2B2F37', '#B9BCC2', '#E63946', '#06D6A0', '#FFD166', '#F77F00', '#9D4EDD', '#FF8FAB', '#8B5A2B', '#264653'];
const OUTFIT_SIZES: Record<keyof Outfit, number> = {
  cut: AVATAR_CUTS.length, top: AVATAR_TOPS.length, bottom: AVATAR_BOTTOMS.length, shoes: AVATAR_SHOES.length,
  glasses: AVATAR_GLASSES.length, beard: AVATAR_BEARDS.length, pants: PANTS_COLORS.length, shoeColor: SHOE_COLORS.length,
};
const OUTFIT_KEYS = Object.keys(OUTFIT_SIZES) as (keyof Outfit)[];

/** An outfit from anything (a message, the browser's storage), or undefined if it isn't a whole, valid one. */
export function sanitizeOutfit(x: unknown): Outfit | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const out = {} as Outfit;
  for (const k of OUTFIT_KEYS) {
    const v = o[k];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= OUTFIT_SIZES[k]) return undefined;
    out[k] = v as number;
  }
  return out;
}

/** An outfit as it goes in the URL ("0,2,1,…"), and back. */
export const outfitParam = (o: Outfit) => OUTFIT_KEYS.map((k) => o[k]).join(',');
export function parseOutfit(s: string | null | undefined): Outfit | undefined {
  const n = (s ?? '').split(',').map(Number);
  return n.length === OUTFIT_KEYS.length ? sanitizeOutfit(Object.fromEntries(OUTFIT_KEYS.map((k, i) => [k, n[i]]))) : undefined;
}

/** A whole outfit from a seed (the name), for someone who hasn't picked one: what they're seen in till they do. */
export function outfitFromSeed(seed: string, style: number): Outfit {
  const h = hash(seed || 'someone');
  const cut = [0, 2, 1, 0, 0, 1, 3][style] ?? 0;
  const g = (h >>> 7) % 8;
  const b = (h >>> 11) % 10;
  return { cut, top: h % 3, bottom: (h >>> 3) % 2, shoes: (h >>> 5) % 2, glasses: g === 0 ? 1 : g === 1 ? 2 : 0, beard: b === 0 ? 1 : b === 1 ? 2 : 0, pants: (h >>> 13) % 4, shoeColor: (h >>> 15) % 4 };
}

/** The outfit someone called `name` wears with `look`: theirs, or the one from their name. */
export const outfitOf = (name: string, look: Look): Outfit => look.outfit ?? outfitFromSeed(name, look.style);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A look picked from a seed, for people who haven't chosen one. */
export function lookFromSeed(seed: string): Look {
  const h = hash(seed);
  return { skin: h % SKIN_TONES.length, hair: (h >>> 3) % HAIR_COLORS.length, style: (h >>> 7) % HAIR_STYLES.length };
}

export function randomLook(): Look {
  const pick = (n: number) => Math.floor(Math.random() * n);
  const outfit = Object.fromEntries(OUTFIT_KEYS.map((k) => [k, pick(OUTFIT_SIZES[k])])) as unknown as Outfit;
  // A beard or glasses now and then, not on most.
  if (pick(3)) outfit.beard = 0;
  if (pick(3)) outfit.glasses = 0;
  return { skin: pick(SKIN_TONES.length), hair: pick(HAIR_COLORS.length), style: CUT_STYLE[outfit.cut], outfit };
}

const NAME_ADJECTIVES = ['Sunny', 'Cosmic', 'Quiet', 'Speedy', 'Clever', 'Brave', 'Jolly', 'Mellow', 'Nimble', 'Plucky', 'Snappy', 'Witty', 'Zesty', 'Cozy', 'Lucky', 'Breezy', 'Chipper', 'Dapper', 'Fuzzy', 'Gentle', 'Groovy', 'Humble', 'Keen', 'Lively', 'Merry', 'Nifty', 'Peppy', 'Spry', 'Swift', 'Tidy', 'Zippy', 'Bold'];
const NAME_ANIMALS = ['Otter', 'Heron', 'Panda', 'Falcon', 'Badger', 'Koala', 'Lynx', 'Marmot', 'Narwhal', 'Octopus', 'Penguin', 'Quokka', 'Raccoon', 'Sloth', 'Tapir', 'Walrus', 'Yak', 'Beaver', 'Capybara', 'Dolphin', 'Ferret', 'Gecko', 'Hedgehog', 'Ibis', 'Jaguar', 'Lemur', 'Moose', 'Newt', 'Owl', 'Puffin', 'Robin', 'Seal'];

/** A made-up name like "Sunny Otter", for people who'd rather not think of one. */
export function randomName(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  return `${pick(NAME_ADJECTIVES)} ${pick(NAME_ANIMALS)}`;
}

/** Coerces anything into a valid look, keeping each part of `fallback` that `x` gets wrong. */
export function sanitizeLook(x: unknown, fallback: Look): Look {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const idx = (v: unknown, n: number, d: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : d);
  const outfit = o.outfit === undefined ? fallback.outfit : sanitizeOutfit(o.outfit);
  return {
    skin: idx(o.skin, SKIN_TONES.length, fallback.skin),
    hair: idx(o.hair, HAIR_COLORS.length, fallback.hair),
    style: idx(o.style, HAIR_STYLES.length, fallback.style),
    ...(outfit ? { outfit } : {}),
  };
}

export function sameLook(a: Look, b: Look): boolean {
  return a.skin === b.skin && a.hair === b.hair && a.style === b.style && JSON.stringify(a.outfit ?? null) === JSON.stringify(b.outfit ?? null);
}
