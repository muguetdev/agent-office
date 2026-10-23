// Files uploaded into a worker's folder from its Code tab (the client's ui/code-upload.ts, the
// server's code.ts): dragged in from the desktop, or picked with ⬆️ Upload.

/** The biggest file that can be uploaded into a worker's folder. */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/**
 * The name VS Code gives a copy beside a file of the same name: "name copy.ext", then
 * "name copy 2.ext" and so on (`n` counts from 1). A dotfile with no other dot keeps its whole name.
 */
export function copyName(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  return `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`;
}
