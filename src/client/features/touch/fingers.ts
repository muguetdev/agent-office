/**
 * Fingers on the scene: a thumb landing low on the left is a thumbstick that walks you (and runs,
 * pushed all the way), any other finger drags to look around, and a tap uses what's there, as a click
 * would: in first person the view turns to it first, so it's what the crosshair is on. Two fingers
 * pinched together or apart in third person zoom the camera out or in, as the mouse wheel does.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { h } from '../../ui/dom';
import { L } from '../../i18n';

/** How far the knob goes from the middle of the stick, in px. */
const RADIUS = 56;
/** Pushed less than this (of RADIUS) the stick does nothing; past RUN_AT, you run. */
const DEAD = 0.18;
const RUN_AT = 0.92;
/** The thumbstick takes a thumb landing left of this (of the width), below this (of the height). */
const STICK_W = 0.42;
const STICK_TOP = 0.3;
/** Looking around: radians per px dragged, in first person and orbiting in third. */
const LOOK = 0.0065;
const ORBIT = 0.008;
/** How much finer a drag turns you while something else has the camera (lining up a shot at the golf tee). */
const AIM = 0.35;
/** A tap: a finger that moved less than this (px) and was down less than TAP_MS. */
const TAP_PX = 10;
const TAP_MS = 400;

type Finger = { id: number; x0: number; y0: number; x: number; y: number; at: number; moved: number };

export function mountFingers(ctx: Ctx, layer: HTMLElement) {
  const { player, canvas, camera } = ctx;
  const knob = h('div.touch-knob');
  const base = h('div.touch-stick', { 'aria-hidden': 'true', title: L.touch.stick }, knob);
  layer.append(base);

  let stick: Finger | null = null;
  let look: Finger | null = null;
  /** A second finger beside the look one: the two pinch (see pinched). */
  let pinch: Finger | null = null;
  /** How far apart the pinching fingers were when they last moved. */
  let spread = 0;
  /** The keys the stick holds down now (see hold). */
  let held = new Set<string>();

  /** Holds down the keys for where the stick is, and lets go of the rest; again every frame, since a window opening or a key clears them. */
  function hold() {
    const want = new Set<string>();
    const s = player.stick;
    if (s && player.enabled) {
      const len = Math.hypot(s.x, s.z);
      if (len > DEAD) {
        // A key for each way the stick leans well enough: the ladder and the car go by them.
        if (s.z < -0.38 * len) want.add('KeyW');
        if (s.z > 0.38 * len) want.add('KeyS');
        if (s.x < -0.38 * len) want.add('KeyA');
        if (s.x > 0.38 * len) want.add('KeyD');
        if (len > RUN_AT) want.add('ShiftLeft');
      }
    }
    for (const c of held) if (!want.has(c)) player.setKey(c, false);
    for (const c of want) player.setKey(c, true);
    held = want;
  }

  function moveStick(f: Finger) {
    let dx = f.x - f.x0;
    let dy = f.y - f.y0;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx *= RADIUS / len;
      dy *= RADIUS / len;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    player.stick = { x: dx / RADIUS, z: dy / RADIUS };
    hold();
  }

  function placeStick(x: number, y: number) {
    base.style.left = `${x}px`;
    base.style.top = `${y}px`;
  }

  /** Lets go of the stick: back to where it waits, and you stop. */
  function dropStick() {
    stick = null;
    player.stick = null;
    knob.style.transform = '';
    base.classList.remove('on');
    base.style.left = base.style.top = '';
    hold();
  }

  /** Lets go of every finger (a window opened). */
  function release() {
    look = pinch = null;
    dropStick();
  }

  /** Turns the view to look at the point under (x, y) on the screen, in first person. */
  function aimAt(x: number, y: number) {
    const r = canvas.getBoundingClientRect();
    const d = new THREE.Vector3(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    player.camYaw = Math.atan2(-d.x, -d.z);
    player.lookPitch = THREE.MathUtils.clamp(Math.asin(d.y), -1.45, 1.45);
    player.updateCamera(true);
  }

  /** A tap to use in first person waits for the aim tick to see what the crosshair is on now. */
  let tapPending = false;
  function tap(f: Finger) {
    if (!player.enabled || !player.onClick) return;
    if (player.view === 'first') {
      // At the tee, or wherever the camera isn't yours, the view stays put.
      if (!ctx.activities.any('takesCamera')) aimAt(f.x, f.y);
      tapPending = true;
      return;
    }
    const r = canvas.getBoundingClientRect();
    player.onClick(new THREE.Vector2(((f.x - r.left) / r.width) * 2 - 1, -((f.y - r.top) / r.height) * 2 + 1));
  }
  ctx.ticks.add('hud', () => {
    if (!tapPending) return;
    tapPending = false;
    player.onClick?.(new THREE.Vector2(0, 0));
  });
  ctx.ticks.add('pre', () => {
    if (stick) hold();
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !player.enabled) return;
    e.preventDefault();
    const f: Finger = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, at: performance.now(), moved: 0 };
    const r = canvas.getBoundingClientRect();
    if (!stick && e.clientX - r.left < r.width * STICK_W && e.clientY - r.top > r.height * STICK_TOP) {
      stick = f;
      placeStick(f.x0, f.y0);
      base.classList.add('on');
      moveStick(f);
    } else if (!look) look = f;
    else if (!pinch) {
      pinch = f;
      spread = Math.hypot(f.x - look.x, f.y - look.y);
      // Two fingers down aren't a tap.
      look.moved = Math.max(look.moved, TAP_PX);
    } else return;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    if (stick?.id === e.pointerId) {
      stick.x = e.clientX;
      stick.y = e.clientY;
      moveStick(stick);
      return;
    }
    if (pinch && (pinch.id === e.pointerId || look?.id === e.pointerId)) return pinched(e);
    if (look?.id !== e.pointerId) return;
    const dx = e.clientX - look.x;
    const dy = e.clientY - look.y;
    look.x = e.clientX;
    look.y = e.clientY;
    look.moved += Math.abs(dx) + Math.abs(dy);
    // The first few px of a tap aren't a look.
    if (look.moved < TAP_PX || !player.enabled || !player.mouseLook) return;
    // At the tee, a drag lines up the shot: finer than looking around.
    const fine = ctx.activities.any('takesCamera') ? AIM : 1;
    if (player.view === 'first') {
      player.camYaw -= dx * LOOK * fine;
      player.lookPitch = THREE.MathUtils.clamp(player.lookPitch - dy * LOOK, -1.45, 1.45);
    } else {
      player.camYaw -= dx * ORBIT * fine;
      player.camPitch = THREE.MathUtils.clamp(player.camPitch + dy * ORBIT * 0.6, 0.05, 1.3);
    }
  });
  /** A pinching finger moved: in third person the camera comes in as they spread and goes out as they close. */
  function pinched(e: PointerEvent) {
    const f = pinch!.id === e.pointerId ? pinch! : look!;
    f.x = e.clientX;
    f.y = e.clientY;
    const now = Math.hypot(pinch!.x - look!.x, pinch!.y - look!.y);
    if (spread > 0 && now > 0 && player.enabled && player.view === 'third') player.camDist = THREE.MathUtils.clamp((player.camDist * spread) / now, 2.5, 16);
    spread = now;
  }

  const up = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    if (stick?.id === e.pointerId) return dropStick();
    // One of a pinch up: the other carries on looking, from where it is.
    if (pinch?.id === e.pointerId) return void (pinch = null);
    if (pinch && look?.id === e.pointerId) {
      look = pinch;
      look.moved = Math.max(look.moved, TAP_PX);
      pinch = null;
      return;
    }
    if (look?.id !== e.pointerId) return;
    const f = look;
    look = null;
    if (e.type === 'pointerup' && f.moved < TAP_PX && performance.now() - f.at < TAP_MS) tap(f);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return { release };
}
