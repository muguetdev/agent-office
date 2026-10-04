// The jukebox's YouTube search, and the titles of the videos in its "up next" list (see server/youtube.ts).
import { searchYoutube, youtubeVideos } from '../../youtube.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const youtubeRoutes = {
  search: {
    method: 'GET',
    path: '/api/youtube/search',
    auth: 'session',
    handle: async (_ctx, { res, url }) => {
      try {
        send(res, 200, { videos: await searchYoutube(url.searchParams.get('q') ?? '') });
      } catch {
        send(res, 502, { error: 'youtube' });
      }
    },
  },
  videos: {
    method: 'GET',
    path: '/api/youtube/videos',
    auth: 'session',
    handle: async (_ctx, { res, url }) => send(res, 200, { videos: await youtubeVideos((url.searchParams.get('ids') ?? '').split(',')) }),
  },
} satisfies Record<string, Route>;
