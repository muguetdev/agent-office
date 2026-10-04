import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JUKEBOX_TUNES, STREAM, YOUTUBE, checkStreamUrl, trackTitle, tuneById, type JukeboxState } from '../shared/jukebox.js';
import { VIDEO_RE, youtubeLink } from '../shared/youtube.js';
import { L } from './i18n.js';

interface Saved {
  on: boolean;
  track: string;
  url?: string;
  list?: string;
  video?: string;
  title?: string;
  by?: string;
  /** When the track started, on this machine's clock. */
  startedAt: number;
}

/**
 * The lounge jukebox on one floor, saved in .agent-office/jukebox.json. It only says what's on and
 * since when; every browser plays it for itself, from the same point.
 */
export class Jukebox {
  private s: Saved = { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now() };
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'jukebox.json');
    this.load();
  }

  state(): JukeboxState {
    const { on, track, url, list, video, title, by, startedAt } = this.s;
    const yt = track === YOUTUBE ? { ...(list ? { list } : {}), ...(video ? { video } : {}), ...(title ? { title } : {}) } : {};
    return { on, track, ...(url && (track === STREAM || track === YOUTUBE) ? { url } : {}), ...yt, ...(by ? { by } : {}), startedAt, elapsed: Math.max(0, Date.now() - startedAt) };
  }

  /** What's on, for toasts: “Rainy Window”, or where a stream comes from. */
  title(): string {
    return trackTitle(this.s, L);
  }

  /** Puts on a tune, a stream, or (with neither) whatever it had. Says whether anything changed, or why it can't. */
  play(input: { track?: unknown; url?: unknown }, by: string): { changed: boolean } | { error: string } {
    if (input.url !== undefined && input.url !== '') {
      const u = checkStreamUrl(input.url, L);
      if ('error' in u) return u;
      const yt = youtubeLink(u.url);
      this.set(yt ? { on: true, track: YOUTUBE, url: u.url, ...yt, by } : { on: true, track: STREAM, url: u.url, by });
    } else if (input.track !== undefined) {
      if (typeof input.track !== 'string' || !tuneById(input.track)) return { error: L.srvFloor.noTune };
      this.set({ on: true, track: input.track, by });
    } else {
      if (this.s.on) return { changed: false };
      this.set({ ...this.s, on: true, by });
    }
    return { changed: true };
  }

  /**
   * What a browser playing YouTube here says: the video that's on and its title, or (`next`) the one after
   * the video that started at `at`, once it's over or someone skipped it. Only the first browser to say
   * so moves it on (they all would); says whether anything changed.
   */
  youtube(at: unknown, video: unknown, title: unknown, next: boolean, by?: string): boolean {
    const s = this.s;
    if (s.track !== YOUTUBE || !s.on || at !== s.startedAt || typeof video !== 'string' || !VIDEO_RE.test(video)) return false;
    const name = typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : undefined;
    if (next) {
      this.set({ ...s, video, title: name, ...(by ? { by } : {}) });
      return true;
    }
    // Naming the video that's on: the first one of a playlist, or its title.
    if (s.video && s.video !== video) return false;
    if (s.video === video && (s.title || !name)) return false;
    this.s = { ...s, video, ...(name ? { title: name } : {}) };
    this.save();
    return true;
  }

  /** On to the next tune; from a stream, back to the first one. */
  skip(by: string) {
    const i = JUKEBOX_TUNES.findIndex((t) => t.id === this.s.track);
    this.set({ on: true, track: JUKEBOX_TUNES[(i + 1) % JUKEBOX_TUNES.length].id, by });
  }

  stop(by: string): boolean {
    if (!this.s.on) return false;
    this.s = { ...this.s, on: false, by };
    this.save();
    return true;
  }

  private set(s: Omit<Saved, 'startedAt'>) {
    // Always later than the last start, which is what tells one play from the next.
    this.s = { ...s, startedAt: Math.max(Date.now(), this.s.startedAt + 1) };
    this.save();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      const linked = s.track === STREAM || s.track === YOUTUBE;
      const url = linked ? checkStreamUrl(s.url) : undefined;
      if (linked ? !url || 'error' in url : typeof s.track !== 'string' || !tuneById(s.track)) return;
      const yt = s.track === YOUTUBE && url && 'url' in url ? youtubeLink(url.url) : null;
      if (s.track === YOUTUBE && !yt) return;
      this.s = {
        on: s.on === true,
        track: s.track!,
        ...(url && 'url' in url ? { url: url.url } : {}),
        ...(yt ?? {}),
        ...(yt && typeof s.video === 'string' && VIDEO_RE.test(s.video) ? { video: s.video } : {}),
        ...(yt && typeof s.title === 'string' ? { title: s.title.slice(0, 120) } : {}),
        ...(typeof s.by === 'string' ? { by: s.by.slice(0, 24) } : {}),
        startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : Date.now(),
      };
    } catch {
      // a broken file just means a quiet lounge
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
