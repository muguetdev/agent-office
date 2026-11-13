// The desks' and seats' names in English, apart from the rest of en.ts: placeName (../i18n-core.ts)
// checks a layout's labels against them, and the page shouldn't need all of English to do it.

export const enPlaces = {
  desk: (n: number) => `Desk ${n}`,
  beanBag: (n: number) => `Bean bag ${n}`,
  headOfTable: 'Head of the table',
  meetingChair: (n: number) => `Meeting chair ${n}`,
  /** By id, without a trailing number (see placeLabel in client/i18n.ts). */
  fixed: {
    'station-issues': 'Issues board',
    'station-pulls': 'PR board',
    'station-queue': 'Task queue',
    couch: '🛋️ Couch',
    'lounge-beanbag': '🫘 Beanbag',
    'loft-couch': '🛋️ Couch',
    'boss-chair': "🪑 Boss's chair",
    bench: '🪑 Bench',
    stool: '🪑 Stool',
    'roof-stool': '🪑 Bar stool',
    'roof-sofa': '🛋️ Sofa',
    'roof-lounger': '🏖️ Lounger',
  },
};
