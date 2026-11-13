/**
 * The office easy on a phone's battery and GPU: it draws no more frames a second than the quality
 * takes (see core/quality.ts), fewer once nobody has touched anything for a while, hardly any while a
 * window covers the whole view, and (on auto) eases its resolution down while frames come slowly and
 * back up once they don't. A hidden tab draws nothing already: the browser stops its frames.
 */
import type { Ctx } from '../../core/context';
import { QUALITY, type Quality } from '../../core/quality';
import { modalsOpen, onModalChange } from '../../ui/dom';

/** Nothing touched for this long (ms), and the office is idle. */
const IDLE_MS = 30_000;
/** Frames a second while a window covers the whole view: enough to keep the clock and the sound going. */
const COVERED_FPS = 4;
/** How often (ms) whether a window covers the view is looked at again while one is open (it may grow, or the phone turn). */
const COVER_CHECK_MS = 1000;

export function installPowerSave(ctx: Ctx, quality: Quality = QUALITY) {
  // ---- What the quality takes, and less when idle -----------------------------------------------
  let touchedAt = performance.now();
  const touched = () => void (touchedAt = performance.now());
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(type, touched, { passive: true, capture: true });
  ctx.pace.cap(() => {
    if (quality.idleFps === Infinity) return quality.maxFps;
    // Walking, or anything you're in the middle of (a car, the ladder), isn't idle either.
    if (ctx.player.moving || ctx.activities.busy()) touched();
    return performance.now() - touchedAt > IDLE_MS ? quality.idleFps : quality.maxFps;
  });

  // ---- A window over the whole view --------------------------------------------------------------
  let covered = false;
  let checkedAt = 0;
  const check = () => {
    checkedAt = performance.now();
    covered = modalsOpen() > 0 && coversView();
  };
  onModalChange(() => requestAnimationFrame(check));
  window.addEventListener('resize', () => modalsOpen() > 0 && check());
  ctx.pace.cap(() => {
    if (modalsOpen() === 0) return (covered = false), Infinity;
    if (performance.now() - checkedAt > COVER_CHECK_MS) check();
    return covered ? COVERED_FPS : Infinity;
  });

  // ---- The resolution, with how fast frames come --------------------------------------------------
  if (quality.dynamic) dynamicResolution(ctx, quality);
}

/** A window open over the whole view, so that none of the office shows. */
function coversView(): boolean {
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const el of document.querySelectorAll<HTMLElement>('#modal-root > .backdrop > *')) {
    const r = el.getBoundingClientRect();
    if (r.left <= 1 && r.top <= 1 && r.right >= w - 1 && r.bottom >= h - 1) return true;
  }
  return false;
}

/** How long (ms) frames have to stay slow, or quick, before the resolution steps down, or up. */
const SLOW_FOR_MS = 2000;
const QUICK_FOR_MS = 6000;
/** After a step down, how long (ms) before it may step back up: a GPU that's behind looks quick to the main thread. */
const SETTLE_MS = 30_000;
/** A step of the resolution, in pixels to a CSS pixel. */
const STEP = 0.125;

/**
 * Steps the resolution down while frames come more slowly than the pace asks for (or 60 a second,
 * without one), and back up once they come on time with time to spare, between the quality's least
 * and most. Frames held back on purpose (a window over the view) aren't counted.
 */
function dynamicResolution(ctx: Ctx, quality: Quality) {
  const most = Math.min(window.devicePixelRatio, quality.maxPixelRatio);
  const least = Math.min(most, quality.minPixelRatio);
  let ratio = most;
  /** Frame interval and the time spent in a frame (ms), averaged over the last few. */
  let interval = 0;
  let work = 0;
  let since = performance.now();
  let state: 'ok' | 'slow' | 'quick' = 'ok';
  let started = 0;
  let upAfter = 0;

  ctx.ticks.add('pre', ({ delta, now }) => {
    started = now;
    const fps = Math.min(60, ctx.pace.limit());
    // Held back on purpose, or a stall (a hidden tab, a hitch): not how fast it can go.
    if (fps < 20 || delta > 0.5) {
      since = now;
      state = 'ok';
      return;
    }
    interval = interval ? interval * 0.9 + delta * 1000 * 0.1 : delta * 1000;
    const target = 1000 / fps;
    const next = interval > target * 1.3 ? 'slow' : interval < target * 1.1 && work < target * 0.45 ? 'quick' : 'ok';
    if (next !== state) {
      state = next;
      since = now;
      return;
    }
    if (state === 'slow' && now - since > SLOW_FOR_MS && ratio > least) set(Math.max(least, ratio - STEP), now);
    else if (state === 'quick' && now - since > QUICK_FOR_MS && now > upAfter && ratio < most) set(Math.min(most, ratio + STEP), now);
  });
  // After the frame's drawn (the render phase's own ticks come first): how long it all took.
  ctx.ticks.add('render', () => {
    const took = performance.now() - started;
    work = work ? work * 0.9 + took * 0.1 : took;
  });

  function set(r: number, now: number) {
    if (r < ratio) upAfter = now + SETTLE_MS;
    ratio = r;
    since = now;
    // setPixelRatio sizes the canvas's buffer anew at the size it has.
    ctx.renderer.setPixelRatio(ratio);
  }
}
