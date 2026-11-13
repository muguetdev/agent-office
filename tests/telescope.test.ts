import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TelescopeView } from '../src/client/features/telescope/controller.js';

class Classes {
  values = new Set<string>();
  add(...names: string[]) { names.forEach((name) => this.values.add(name)); }
  remove(...names: string[]) { names.forEach((name) => this.values.delete(name)); }
}

test('telescope view restores its camera and callbacks across repeated visits', () => {
  const camera = new THREE.PerspectiveCamera(61, 1.5, 0.1, 100);
  camera.position.set(2, 3, 4);
  camera.rotation.set(0.2, -0.4, 0.1);
  camera.zoom = 1.25;
  const position = camera.position.clone();
  const quaternion = camera.quaternion.clone();
  const overlay = { classList: new Classes() };
  const button = new EventTarget();
  const pointer = new EventTarget();
  let enters = 0;
  let exits = 0;
  const view = new TelescopeView(camera, overlay as never, button, pointer, () => enters++, () => exits++);

  for (let visit = 0; visit < 3; visit++) {
    assert.equal(view.enter(), true);
    assert.equal(view.enter(), false, 'enter is idempotent');
    assert.equal(camera.fov, 16);
    assert.notDeepEqual(camera.position.toArray(), position.toArray());
    assert.equal(overlay.classList.values.has('active'), true);

    const aimed = camera.quaternion.clone();
    const move = new Event('pointermove');
    Object.defineProperties(move, { movementX: { value: 80 }, movementY: { value: -25 } });
    pointer.dispatchEvent(move);
    view.update();
    assert.ok(camera.quaternion.angleTo(aimed) > 0.05, 'mouse movement aims the telescope');

    camera.position.set(99, 99, 99);
    camera.fov = 55;
    view.update();
    assert.equal(camera.fov, 16);
    assert.notDeepEqual(camera.position.toArray(), [99, 99, 99]);

    button.dispatchEvent(new Event('click'));
    assert.equal(view.active, false);
    assert.deepEqual(camera.position.toArray(), position.toArray());
    assert.ok(camera.quaternion.angleTo(quaternion) < 1e-7);
    assert.equal(camera.fov, 61);
    assert.equal(camera.zoom, 1.25);
    assert.equal(overlay.classList.values.has('active'), false);
    assert.equal(view.exit(), false, 'exit is idempotent');
  }

  assert.equal(enters, 3);
  assert.equal(exits, 3, 'one exit callback per visit proves click listeners did not accumulate');
});

test('a pinch zooms the telescope in only so far, a finger turns it, and the next look starts zoomed out', () => {
  const camera = new THREE.PerspectiveCamera(61, 1.5, 0.1, 100);
  const pointer = new EventTarget();
  const view = new TelescopeView(camera, { classList: new Classes() } as never, new EventTarget(), pointer, () => {}, () => {});
  view.enter();
  view.zoomBy(2);
  view.update();
  assert.equal(camera.fov, 8);
  view.zoomBy(10);
  view.update();
  assert.ok(Math.abs(camera.fov - 16 / 3) < 1e-9, 'no further in than three times');
  view.zoomBy(0.01);
  view.update();
  assert.equal(camera.fov, 16, 'no further out than as it comes');

  const aimed = camera.quaternion.clone();
  view.turn(60, 0);
  view.update();
  assert.ok(camera.quaternion.angleTo(aimed) > 0.05, 'a finger turns it');
  // A touch's own pointermove is left to the touch controls, which know where the finger was.
  const before = camera.quaternion.clone();
  const move = new Event('pointermove');
  Object.defineProperties(move, { pointerType: { value: 'touch' }, movementX: { value: 80 }, movementY: { value: 0 } });
  pointer.dispatchEvent(move);
  view.update();
  assert.ok(camera.quaternion.angleTo(before) < 1e-6, "a touch's own move is left alone");

  view.zoomBy(2);
  view.exit();
  view.enter();
  assert.equal(camera.fov, 16);
});
