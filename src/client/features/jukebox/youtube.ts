// YouTube on the jukebox (see shared/youtube.ts): YouTube's own player, out of sight, plays the video the
// office says is on, from where everyone else is in it. Each browser knows the playlist, so whichever one
// gets to the end of a video first tells the office the next one, and everyone moves on to it together.
import type { ClientMsg } from '../../../shared/protocol';
import { toast } from '../../ui/dom';
import { L } from '../../i18n';

/** The bits of YouTube's IFrame player this uses. */
interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cuePlaylist(o: { list: string; listType: 'playlist' }): void;
  getPlaylist(): string[] | null;
  getVideoData(): { video_id?: string; title?: string };
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
  playVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, o: object) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const ENDED = 0;
const PLAYING = 1;
const CUED = 5;
/** Out of sight but on the page (a browser won't play one that isn't), and never in the way. */
const HIDDEN = 'position:fixed;right:0;bottom:0;width:200px;height:200px;opacity:0.01;pointer-events:none;z-index:-1';
/** How far from everyone else it may drift before it's put back (s). */
const DRIFT = 3;

/** What's on, as the office says. */
export interface YoutubeWant {
  list?: string;
  video?: string;
  title?: string;
  startedAt: number;
}

let api: Promise<void> | undefined;
function loadApi(): Promise<void> {
  return (api ??= new Promise((resolve) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.append(s);
  }));
}

class YoutubeJukebox {
  /** How it tells the office (set by the jukebox feature). */
  report: (msg: ClientMsg) => void = () => {};
  private player?: YTPlayer;
  private ready = false;
  private want: YoutubeWant | null = null;
  /** Seconds into what's on, everyone's. */
  private at: () => number = () => 0;
  /** The playlist's videos, once it's been looked at. */
  private ids: string[] = [];
  private idsFor?: string;
  private listTimer = 0;
  private playing: { video: string; startedAt: number } | null = null;
  private volume = 50;
  private errors = 0;
  private box?: HTMLElement;
  /** Where on the page it's shown, while the jukebox is open; out of sight otherwise. */
  private screen: HTMLElement | null = null;
  private placing = 0;
  /** Told when the playlist's videos are known, or the video on changes. */
  readonly listeners = new Set<() => void>();

  /** Plays what the office says is on; called again whenever that changes, or just to stay in step. */
  play(want: YoutubeWant, at: () => number) {
    this.want = want;
    this.at = at;
    if (!this.player) void this.create();
    else this.sync();
  }

  stop() {
    this.want = null;
    this.playing = null;
    if (this.ready) this.player!.stopVideo();
  }

  /** Whether a video's going (for the jukebox's lights). */
  get on(): boolean {
    return !!this.want && this.ready && this.player!.getPlayerState() === PLAYING;
  }

  /** 0–1, already muffled by distance. */
  setVolume(v: number) {
    this.volume = Math.round(Math.max(0, Math.min(1, v)) * 100);
    if (this.ready) this.player!.setVolume(this.volume);
  }

  /** The page was touched: a video the browser wouldn't start by itself can start now. */
  touched() {
    if (this.want && this.playing && this.ready && this.player!.getPlayerState() !== PLAYING && this.player!.getPlayerState() !== ENDED) this.player!.playVideo();
  }

  /** On to the next video in the playlist (the ⏭️ on the jukebox). */
  skip() {
    if (this.playing) this.jump(this.nextId());
  }

  /** Straight to this video (one of the playlist's, from the jukebox's "up next"), for everyone. */
  jump(video: string) {
    if (this.want && this.playing) this.report({ t: 'jukebox.yt', at: this.want.startedAt, video, next: 'skip' });
  }

  /** The playlist's videos, and the one on now. */
  queue(): { ids: string[]; current?: string } {
    return { ids: this.ids, current: this.playing?.video };
  }

  /** Shows the video over `el` (a 16:9 spot in the jukebox), following it while it's there; null hides it again. */
  show(el: HTMLElement | null) {
    this.screen = el;
    cancelAnimationFrame(this.placing);
    this.place();
  }

  private place() {
    const box = this.box;
    if (!box) return;
    const el = this.screen;
    if (!el || !el.isConnected) {
      box.style.cssText = HIDDEN;
      return;
    }
    const r = el.getBoundingClientRect();
    box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:51;border-radius:12px;overflow:hidden`;
    this.placing = requestAnimationFrame(() => this.place());
  }

  private told() {
    for (const f of this.listeners) f();
  }

  private nextId(): string {
    const cur = this.playing!.video;
    return this.ids.length ? this.ids[(this.ids.indexOf(cur) + 1) % this.ids.length] : cur;
  }

  private async create() {
    await loadApi();
    if (this.player) return;
    const box = (this.box = document.createElement('div'));
    box.style.cssText = HIDDEN;
    // Its own frame, which tells YouTube which site it's on: the office's pages send no referrer, and
    // without one YouTube won't play in Safari (error 153).
    const frame = document.createElement('iframe');
    const vars = new URLSearchParams({ enablejsapi: '1', autoplay: '1', controls: '0', disablekb: '1', playsinline: '1', rel: '0', origin: location.origin });
    Object.assign(frame, { width: '100%', height: '100%', referrerPolicy: 'strict-origin-when-cross-origin', allow: 'autoplay; encrypted-media', src: `https://www.youtube.com/embed/?${vars}` });
    box.append(frame);
    document.body.append(box);
    this.place();
    this.player = new window.YT!.Player(frame, {
      events: {
        onReady: () => {
          this.ready = true;
          this.player!.setVolume(this.volume);
          this.sync();
        },
        onStateChange: (e: { data: number }) => this.changed(e.data),
        onError: () => this.failed(),
      },
    });
  }

  private sync() {
    const w = this.want;
    if (!this.ready || !w) return;
    const p = this.player!;
    if (!w.list && this.idsFor) {
      this.idsFor = undefined;
      this.ids = [];
    }
    // A playlist's videos first, so there's a next one to go on to.
    if (w.list && this.idsFor !== w.list) {
      this.idsFor = w.list;
      this.ids = [];
      clearTimeout(this.listTimer);
      // A playlist that won't load (private, or gone) shouldn't keep its first video from playing.
      this.listTimer = window.setTimeout(() => this.listed(), 5000);
      return p.cuePlaylist({ list: w.list, listType: 'playlist' });
    }
    if (w.list && this.listTimer) return;
    const video = w.video ?? this.ids[0];
    if (!video) return toast(L.jukebox.cantYoutube, 'warn');
    if (!w.video) this.report({ t: 'jukebox.yt', at: w.startedAt, video });
    if (this.playing?.video === video && this.playing.startedAt === w.startedAt) {
      const at = this.at();
      const d = p.getDuration();
      if (p.getPlayerState() === PLAYING && d > 0 && at < d && Math.abs(p.getCurrentTime() - at) > DRIFT) p.seekTo(at, true);
      return;
    }
    this.playing = { video, startedAt: w.startedAt };
    this.told();
    p.loadVideoById({ videoId: video, startSeconds: this.at() });
  }

  /** The playlist's been looked at (or given up on). */
  private listed() {
    clearTimeout(this.listTimer);
    this.listTimer = 0;
    this.ids = this.player!.getPlaylist() ?? [];
    this.sync();
    this.told();
  }

  private changed(state: number) {
    const w = this.want;
    if (state === CUED && this.listTimer) return this.listed();
    if (!w || !this.playing || this.playing.startedAt !== w.startedAt) return;
    if (state === PLAYING) {
      this.errors = 0;
      const title = this.player!.getVideoData().title;
      if (!w.title && title) this.report({ t: 'jukebox.yt', at: w.startedAt, video: this.playing.video, title });
    } else if (state === ENDED) this.report({ t: 'jukebox.yt', at: w.startedAt, video: this.nextId(), next: 'ended' });
  }

  /** A video that won't play here (gone, or not allowed off YouTube): on to the next, if there is one. */
  private failed() {
    const w = this.want;
    if (w && this.playing && this.ids.length > 1 && ++this.errors < this.ids.length) this.report({ t: 'jukebox.yt', at: w.startedAt, video: this.nextId(), next: 'ended' });
    else toast(L.jukebox.cantYoutube, 'warn');
  }
}

export const youtube = new YoutubeJukebox();
