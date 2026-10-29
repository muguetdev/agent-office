// Files the code editor shows rather than edits (see the client's ui/code-media.ts), by extension:
// what kind of viewer each gets and the type the office serves it as (server/http/routes/code.ts).
// Anything that could run in the page (HTML, scripts) is never here: those open as text, or download.

export type MediaKind = 'image' | 'svg' | 'audio' | 'video' | 'pdf' | 'font' | 'model';

const TABLE: Record<string, [MediaKind, string]> = {
  png: ['image', 'image/png'],
  apng: ['image', 'image/apng'],
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  gif: ['image', 'image/gif'],
  webp: ['image', 'image/webp'],
  avif: ['image', 'image/avif'],
  bmp: ['image', 'image/bmp'],
  ico: ['image', 'image/x-icon'],
  svg: ['svg', 'image/svg+xml'],
  mp3: ['audio', 'audio/mpeg'],
  wav: ['audio', 'audio/wav'],
  ogg: ['audio', 'audio/ogg'],
  oga: ['audio', 'audio/ogg'],
  opus: ['audio', 'audio/ogg'],
  m4a: ['audio', 'audio/mp4'],
  aac: ['audio', 'audio/aac'],
  flac: ['audio', 'audio/flac'],
  weba: ['audio', 'audio/webm'],
  mp4: ['video', 'video/mp4'],
  m4v: ['video', 'video/mp4'],
  webm: ['video', 'video/webm'],
  ogv: ['video', 'video/ogg'],
  mov: ['video', 'video/quicktime'],
  pdf: ['pdf', 'application/pdf'],
  ttf: ['font', 'font/ttf'],
  otf: ['font', 'font/otf'],
  woff: ['font', 'font/woff'],
  woff2: ['font', 'font/woff2'],
  glb: ['model', 'model/gltf-binary'],
  gltf: ['model', 'model/gltf+json'],
};

/** Its extension, lower-case; a dot file's name (.env, .png) isn't one. */
function extOf(file: string): string {
  const name = (file.split('/').pop() ?? '').toLowerCase().replace(/^\.+/, '');
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

/** How `file` is shown, or undefined for one the editor opens as text. */
export const mediaKind = (file: string): MediaKind | undefined => TABLE[extOf(file)]?.[0];

/** The type `file` is served as: its own for one shown here, else plain bytes (a download). */
export const mediaType = (file: string): string => TABLE[extOf(file)]?.[1] ?? 'application/octet-stream';
