// YouTube on the jukebox (see client/features/jukebox/youtube.ts): which video or playlist a link someone
// pasted is, whichever way YouTube wrote it.

/** A video's id, and a playlist's (a mix, RD…, is one too). */
export const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
export const LIST_RE = /^[A-Za-z0-9_-]{2,64}$/;

export interface YoutubeLink {
  video?: string;
  list?: string;
}

/**
 * The video and the playlist in a YouTube link (youtube.com/watch, youtu.be, /shorts, /live, /embed,
 * /playlist, music.youtube.com), or null for any other link. It has at least one of the two.
 */
export function youtubeLink(raw: string): YoutubeLink | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  const path = u.pathname.split('/').filter(Boolean);
  let video: string | undefined;
  if (host === 'youtu.be') video = path[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') video = path[0] === 'watch' ? (u.searchParams.get('v') ?? undefined) : ['shorts', 'live', 'embed', 'v'].includes(path[0]) ? path[1] : undefined;
  else return null;
  const list = u.searchParams.get('list') ?? undefined;
  const out: YoutubeLink = {
    ...(video && VIDEO_RE.test(video) ? { video } : {}),
    ...(list && LIST_RE.test(list) ? { list } : {}),
  };
  return out.video || out.list ? out : null;
}

/** A video, as the jukebox's YouTube search and its "up next" list show it. */
export interface YoutubeVideo {
  id: string;
  title: string;
  channel?: string;
  /** "5:22"; none for a live one. */
  length?: string;
}

/** A video's own link with a mix that starts from it: put on, it carries on like a radio. */
export const radioOf = (id: string) => `https://www.youtube.com/watch?v=${id}&list=RD${id}`;
/** A video's thumbnail. */
export const thumbOf = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
