// Talking to the office's review routes (server/http/routes/code-review.ts) for the Code tab.

export interface ReviewFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  added: number;
  removed: number;
  base: string;
  sig: string;
}

export type Answer<T> = { ok: true; body: T } | { ok: false; status: number; error?: string };

export async function call<T>(url: string, init?: RequestInit): Promise<Answer<T>> {
  try {
    const r = await fetch(url, { cache: 'no-store', ...init });
    const body = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, body: body as T } : { ok: false, status: r.status, error: (body as { error?: string }).error };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** A POST of `body` as JSON. */
export const post = <T>(url: string, body: object) => call<T>(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
