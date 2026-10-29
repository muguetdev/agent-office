// Which files the code editor shows rather than edits (shared/media.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaKind, mediaType } from '../src/shared/media.ts';

test('pictures, sound, video, PDFs, fonts and models are shown; pages, scripts and code are not', () => {
  assert.equal(mediaKind('assets/Logo.PNG'), 'image');
  assert.equal(mediaKind('icon.svg'), 'svg');
  assert.equal(mediaKind('a/b/song.mp3'), 'audio');
  assert.equal(mediaKind('demo.webm'), 'video');
  assert.equal(mediaKind('docs/manual.pdf'), 'pdf');
  assert.equal(mediaKind('fonts/Inter.woff2'), 'font');
  assert.equal(mediaKind('models/car.glb'), 'model');
  for (const text of ['index.html', 'app.js', 'Makefile', '.png', 'png', 'notes.md', 'a.png.ts']) assert.equal(mediaKind(text), undefined, text);
  assert.equal(mediaType('x.jpeg'), 'image/jpeg');
  assert.equal(mediaType('x.html'), 'application/octet-stream');
});
