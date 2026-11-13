/**
 * How much the 3D office spends on each frame: everything it draws as it always has (high), or a
 * lighter office for a phone's battery and GPU (low). ⚙️ Settings › Graphics picks one, or leaves it
 * to the device (auto: low on a phone or tablet, high elsewhere, and either way the resolution eases
 * down while frames come slowly; see features/powersave). Kept in this browser alone.
 */

export const GRAPHICS = ['auto', 'high', 'low'] as const;
export type Graphics = (typeof GRAPHICS)[number];

const KEY = 'agent-office.graphics';

/** What ⚙️ Settings › Graphics has picked in this browser. */
export function chosenGraphics(): Graphics {
  try {
    const g = localStorage.getItem(KEY);
    return GRAPHICS.includes(g as Graphics) ? (g as Graphics) : 'auto';
  } catch {
    return 'auto';
  }
}

/** Picks `g` for this browser and reloads, since the renderer's antialiasing is only set as it's made. */
export function chooseGraphics(g: Graphics) {
  try {
    if (g === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, g);
  } catch {
    // no storage: auto it stays
  }
  location.reload();
}

/** A phone or a tablet: a finger is how it's mostly pointed at. */
export function touchFirst(): boolean {
  return matchMedia('(pointer: coarse)').matches;
}

export interface Quality {
  readonly level: 'high' | 'low';
  /** Eases the resolution down while frames come slowly, and back up once they don't (auto only). */
  readonly dynamic: boolean;
  readonly antialias: boolean;
  /** Pixels drawn to a CSS pixel, at most (a phone's screen is 3, a Retina one 2). */
  readonly maxPixelRatio: number;
  /** And the least the dynamic resolution goes down to. */
  readonly minPixelRatio: number;
  /** The sun's shadow map's side, given the biggest texture the GPU takes. */
  shadowSize(maxTexture: number): number;
  /** The sun's shadow is redrawn every this many frames (it moves slowly; what casts it, a little less so). */
  readonly shadowEvery: number;
  /** Frames a second, at most (Infinity: as many as the screen shows). */
  readonly maxFps: number;
  /** And once nobody has touched anything for a while (see features/powersave). */
  readonly idleFps: number;
}

/**
 * Firefox's WebGL pays a lot of main-thread time per draw call, and the sun's shadow is hundreds of
 * them each time it's drawn, so there it's redrawn every other frame. A Retina screen there is drawn
 * at 1.5 pixels to a CSS pixel, not 2: a touch softer, with half as many pixels to fill and hold.
 */
const FIREFOX = navigator.userAgent.includes('Firefox/');

export function qualityFor(g: Graphics, touch = touchFirst()): Quality {
  const low = g === 'low' || (g === 'auto' && touch);
  if (low)
    return {
      level: 'low',
      dynamic: g === 'auto',
      antialias: false,
      maxPixelRatio: 1.25,
      minPixelRatio: 1,
      shadowSize: (max) => Math.min(max, 2048),
      shadowEvery: 2,
      maxFps: 30,
      idleFps: 15,
    };
  return {
    level: 'high',
    dynamic: g === 'auto',
    antialias: true,
    // A phone's screen is sharp enough at 1.5, and drawing it at 3 costs four times the frame.
    maxPixelRatio: FIREFOX || touch ? 1.5 : 2,
    minPixelRatio: 1,
    // Twice as fine where the GPU takes it (any desktop's does): the finer its texels, the less a surface the
    // light comes across side-on speckles in stripes with its own shadow ("shadow acne").
    shadowSize: (max) => (max >= 8192 ? 4096 : 2048),
    shadowEvery: FIREFOX ? 2 : 1,
    maxFps: Infinity,
    idleFps: Infinity,
  };
}

/** This page's: what was picked, made of for this device. */
export const QUALITY: Quality = qualityFor(chosenGraphics());
