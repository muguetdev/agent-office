// The jukebox's YouTube search and the titles in its "up next" list (see shared/youtube.ts), looked up on
// YouTube's own pages from the office, so it needs no API key; both kept a while, so a search that's
// typed twice, or a playlist everyone's looking at, asks YouTube once.
import { VIDEO_RE, type YoutubeVideo } from '../shared/youtube.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const KEEP_MS = 30 * 60_000;
const MAX_RESULTS = 20;
/** How many titles one ask looks up at most (a mix is about 25 videos). */
export const MAX_IDS = 50;

const searches = new Map<string, { at: number; videos: YoutubeVideo[] }>();
const videos = new Map<string, YoutubeVideo | null>();

async function get(url: string): Promise<Response> {
  return fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(10_000) });
}

const text = (o: any): string | undefined => o?.simpleText ?? o?.runs?.map((r: any) => r.text).join('');

/** The videos in a results page's data (ytInitialData), in order, each once. */
export function resultsOf(data: unknown): YoutubeVideo[] {
  const out: YoutubeVideo[] = [];
  const seen = new Set<string>();
  const walk = (o: any) => {
    if (!o || typeof o !== 'object' || out.length >= MAX_RESULTS) return;
    const v = o.videoRenderer;
    if (v && typeof v.videoId === 'string' && VIDEO_RE.test(v.videoId) && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      const title = text(v.title);
      if (title) out.push({ id: v.videoId, title: title.slice(0, 200), ...(text(v.ownerText) ? { channel: text(v.ownerText)!.slice(0, 100) } : {}), ...(text(v.lengthText) ? { length: text(v.lengthText)!.slice(0, 12) } : {}) });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  return out;
}

/** YouTube's search for `q`: its videos. */
export async function searchYoutube(q: string): Promise<YoutubeVideo[]> {
  q = q.trim().slice(0, 120);
  if (!q) return [];
  const key = q.toLowerCase();
  const kept = searches.get(key);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.videos;
  const html = await (await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=pt-BR&gl=BR`)).text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  const found = m ? resultsOf(JSON.parse(m[1])) : [];
  if (searches.size > 200) searches.clear();
  searches.set(key, { at: Date.now(), videos: found });
  for (const v of found) videos.set(v.id, v);
  return found;
}

/** These videos' titles and channels, in the same order; one YouTube won't say anything about is left out. */
export async function youtubeVideos(ids: string[]): Promise<YoutubeVideo[]> {
  ids = [...new Set(ids.filter((id) => VIDEO_RE.test(id)))].slice(0, MAX_IDS);
  await Promise.all(
    ids
      .filter((id) => !videos.has(id))
      .map(async (id) => {
        try {
          const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
          const o = r.ok ? ((await r.json()) as { title?: unknown; author_name?: unknown }) : null;
          videos.set(id, o && typeof o.title === 'string' ? { id, title: o.title.slice(0, 200), ...(typeof o.author_name === 'string' ? { channel: o.author_name.slice(0, 100) } : {}) } : null);
        } catch {
          // asked again next time
        }
      }),
  );
  if (videos.size > 5000) videos.clear();
  return ids.map((id) => videos.get(id)).filter((v): v is YoutubeVideo => !!v);
}
