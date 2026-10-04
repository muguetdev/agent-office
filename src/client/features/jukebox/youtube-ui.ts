// The jukebox's YouTube: the video that's on, a search of YouTube to put a song on (it carries on with a
// mix that starts from it, like a radio), and the playlist's "up next", to go straight to one.
import { YOUTUBE } from '../../../shared/jukebox';
import { radioOf, thumbOf, type YoutubeVideo } from '../../../shared/youtube';
import type { Net } from '../../net';
import { store } from '../../state';
import { h } from '../../ui/dom';
import { youtube } from './youtube';
import { L } from '../../i18n';

/** Titles already looked up, for the "up next" list. */
const known = new Map<string, YoutubeVideo>();

async function getVideos(url: string): Promise<YoutubeVideo[]> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { videos: YoutubeVideo[] }).videos;
}

function videoRow(v: YoutubeVideo, on: boolean, title: string, pick: () => void) {
  const li = h(
    'li.jb-yt',
    { class: on ? 'on' : '', tabindex: 0, role: 'button', title },
    h('img', { src: thumbOf(v.id), alt: '', loading: 'lazy' }),
    h('div.svc-main', {}, h('div.svc-title', {}, v.title), h('div.svc-meta', {}, [v.channel, v.length].filter(Boolean).join(' · '))),
  );
  li.addEventListener('click', pick);
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  });
  return li;
}

export function youtubePanel(net: Net) {
  /** Where the video's shown, between the window's header and its body (which scrolls). */
  const screen = h('div.jb-screen');
  const q = h('input', { type: 'text', placeholder: L.jukebox.ytPlaceholder, 'aria-label': L.jukebox.ytSearch, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const go = h('button.btn.primary', { type: 'button' }, '🔎');
  const results = h('ul.svc-list');
  const nextLabel = h('label', { style: 'margin-top:16px' }, L.jukebox.upNext);
  const next = h('ul.svc-list');
  const section = h('div', {}, h('label', { style: 'margin-top:16px' }, L.jukebox.ytSearch), h('div.webhook', {}, q, go), results, nextLabel, next);

  const search = async () => {
    const text = q.value.trim();
    if (!text) return q.focus();
    results.replaceChildren(h('li.empty', {}, L.jukebox.ytSearching));
    try {
      const found = await getVideos(`/api/youtube/search?q=${encodeURIComponent(text)}`);
      for (const v of found) known.set(v.id, v);
      results.replaceChildren(...(found.length ? found.map((v) => videoRow(v, false, L.jukebox.putOn(v.title), () => net.send({ t: 'jukebox.play', url: radioOf(v.id) }))) : [h('li.empty', {}, L.jukebox.ytNothing)]));
    } catch {
      results.replaceChildren(h('li.empty', {}, L.jukebox.ytFailed));
    }
  };
  go.addEventListener('click', () => void search());
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void search();
  });

  let asked = '';
  const render = () => {
    const j = store.jukebox;
    const on = j.on && j.track === YOUTUBE;
    screen.hidden = !on;
    youtube.show(on ? screen : null);
    const { ids, current } = youtube.queue();
    const shown = on && ids.length > 1;
    nextLabel.hidden = next.hidden = !shown;
    if (!shown) return;
    // From the one on now, round the playlist.
    const at = Math.max(0, ids.indexOf(current ?? ''));
    const order = [...ids.slice(at), ...ids.slice(0, at)];
    next.replaceChildren(...order.map((id) => videoRow(known.get(id) ?? { id, title: '…' }, id === current, id === current ? L.jukebox.playingNow : L.jukebox.putOn(known.get(id)?.title ?? ''), () => id !== current && youtube.jump(id))));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length && missing.join() !== asked) {
      asked = missing.join();
      void getVideos(`/api/youtube/videos?ids=${missing.join(',')}`)
        .then((found) => {
          for (const v of found) known.set(v.id, v);
          render();
        })
        .catch(() => {});
    }
  };
  youtube.listeners.add(render);

  return {
    screen,
    section,
    render,
    dispose() {
      youtube.listeners.delete(render);
      youtube.show(null);
    },
  };
}
