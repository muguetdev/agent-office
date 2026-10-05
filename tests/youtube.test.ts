// YouTube on the jukebox: which video and playlist a pasted link is, and how the office moves along it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { youtubeLink } from '../src/shared/youtube';
import { YOUTUBE } from '../src/shared/jukebox';
import { Jukebox } from '../src/server/jukebox';

test('a YouTube link, whichever way it is written', () => {
  assert.deepEqual(youtubeLink('https://www.youtube.com/watch?v=xbbhp44RsPo&list=RDxbbhp44RsPo&start_radio=1'), { video: 'xbbhp44RsPo', list: 'RDxbbhp44RsPo' });
  assert.deepEqual(youtubeLink('https://youtu.be/xbbhp44RsPo?t=30'), { video: 'xbbhp44RsPo' });
  assert.deepEqual(youtubeLink('https://music.youtube.com/watch?v=xbbhp44RsPo'), { video: 'xbbhp44RsPo' });
  assert.deepEqual(youtubeLink('https://m.youtube.com/shorts/xbbhp44RsPo'), { video: 'xbbhp44RsPo' });
  assert.deepEqual(youtubeLink('https://www.youtube.com/playlist?list=PL1234567890abc'), { list: 'PL1234567890abc' });
  assert.equal(youtubeLink('https://www.youtube.com/'), null);
  assert.equal(youtubeLink('https://example.com/watch?v=xbbhp44RsPo'), null);
  assert.equal(youtubeLink('https://www.youtube.com/watch?v=bad"id'), null);
});

test('the jukebox plays a YouTube playlist, and the first browser to finish a video moves everyone on', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jukebox-'));
  const j = new Jukebox(dir);
  assert.deepEqual(j.play({ url: 'https://www.youtube.com/playlist?list=PL1234567890abc' }, 'Ana'), { changed: true });
  let s = j.state();
  assert.equal(s.track, YOUTUBE);
  assert.equal(s.video, undefined);
  // A browser names the first video, and its title; the start doesn't move.
  assert.ok(j.youtube(s.startedAt, 'aaaaaaaaaaa', undefined, false));
  assert.ok(j.youtube(s.startedAt, 'aaaaaaaaaaa', 'First song', false));
  assert.equal(j.youtube(s.startedAt, 'bbbbbbbbbbb', 'Another', false), false);
  assert.equal(j.state().title, 'First song');
  assert.equal(j.state().startedAt, s.startedAt);
  // Two browsers get to its end: only the first moves it on.
  assert.ok(j.youtube(s.startedAt, 'bbbbbbbbbbb', undefined, true));
  assert.equal(j.youtube(s.startedAt, 'ccccccccccc', undefined, true), false);
  assert.equal(j.state().video, 'bbbbbbbbbbb');
  assert.equal(j.state().title, undefined);
  // It's all still there after a restart.
  s = j.state();
  const again = new Jukebox(dir).state();
  assert.equal(again.track, YOUTUBE);
  assert.equal(again.list, 'PL1234567890abc');
  assert.equal(again.video, 'bbbbbbbbbbb');
  // A stream isn't YouTube.
  j.play({ url: 'https://radio.example.com/live.mp3' }, 'Ana');
  assert.equal(j.youtube(j.state().startedAt, 'aaaaaaaaaaa', undefined, true), false);
});

test("YouTube's search: the videos in a results page, each once, with their channel and length", async () => {
  const { resultsOf } = await import('../src/server/youtube');
  const v = (id: string, title: string) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: 'Chan' }] }, lengthText: { simpleText: '3:10' } } });
  const page = { contents: { sections: [{ items: [v('aaaaaaaaaaa', 'One'), { ad: true }, v('bbbbbbbbbbb', 'Two'), v('aaaaaaaaaaa', 'One again'), v('bad', 'Bad')] }] } };
  assert.deepEqual(resultsOf(page), [
    { id: 'aaaaaaaaaaa', title: 'One', channel: 'Chan', length: '3:10' },
    { id: 'bbbbbbbbbbb', title: 'Two', channel: 'Chan', length: '3:10' },
  ]);
});

test('a jukebox playing to an empty floor turns itself off after a while, and not while anyone is there', async () => {
  const { idleJukeboxes, IDLE_OFF_MS } = await import('../src/server/ws/handlers/jukebox');
  const j = new Jukebox(mkdtempSync(path.join(tmpdir(), 'jukebox-')));
  j.play({ track: 'coffee-break' }, 'Ana');
  const floor = { id: 'f1', jukebox: j };
  const clients = new Map<string, any>([['c1', { peer: { floor: 'f1' } }]]);
  const sent: unknown[] = [];
  const ctx = { floors: new Map([['f1', floor]]), clients, toFloor: (_f: unknown, m: unknown) => sent.push(m) } as any;
  idleJukeboxes(ctx, 0);
  idleJukeboxes(ctx, IDLE_OFF_MS * 2);
  assert.equal(j.state().on, true, 'someone is on the floor');
  clients.clear();
  idleJukeboxes(ctx, IDLE_OFF_MS * 3);
  idleJukeboxes(ctx, IDLE_OFF_MS * 3 + IDLE_OFF_MS / 2);
  assert.equal(j.state().on, true, 'not empty for long enough yet');
  idleJukeboxes(ctx, IDLE_OFF_MS * 4);
  assert.equal(j.state().on, false);
  assert.equal(sent.length, 1, 'the floor hears it went off');
});
