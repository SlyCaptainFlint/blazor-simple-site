export interface Variant { url: string; width: number }
export interface Photo { id: string; title: string; pageUrl: string; width: number; height: number; variants: Variant[] }
const DEFAULT_API = '/api/photos';
const LIVE_API_ORIGIN = 'https://ozinoveva-photos.ozinoveva.workers.dev';
export const PHOTOS_API = import.meta.env.VITE_PHOTOS_API_URL || DEFAULT_API;
/** Reject malformed service data; remote strings never become HTML. */
export async function loadPhotos(signal: AbortSignal): Promise<Photo[]> {
  const response = await fetch(PHOTOS_API, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Photography is temporarily unavailable. Please try again.');
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('photos' in payload) || !Array.isArray(payload.photos)) {
    throw new Error('The photo service returned an unexpected response. Please try again.');
  }
  const api = new URL(PHOTOS_API, location.origin);
  return payload.photos.slice(0, 30).map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid photo');
    const p = value as Record<string, unknown>;
    if (typeof p.id !== 'string' || !/^\d+$/.test(p.id) || typeof p.title !== 'string' ||
        typeof p.width !== 'number' || p.width <= 0 || typeof p.height !== 'number' || p.height <= 0 ||
        !Array.isArray(p.variants) || !p.variants.length) throw new Error('Invalid photo');
    const variants = p.variants.map((v: unknown): Variant => {
      if (!v || typeof v !== 'object' || !('url' in v) || typeof v.url !== 'string' || !('width' in v) || typeof v.width !== 'number' || v.width <= 0) throw new Error('Invalid image variant');
      const url = new URL(v.url, api);
      if ((url.origin !== api.origin && !(PHOTOS_API === DEFAULT_API && url.origin === LIVE_API_ORIGIN)) || !new RegExp(`^/api/photos/${p.id}/(320|640|960|1440|1920)\\.jpg$`).test(url.pathname) || url.search || url.hash) throw new Error('Invalid image variant');
      // Same-origin production requests stay relative; review builds can use the public API origin.
      return {url: PHOTOS_API === DEFAULT_API || url.origin === location.origin ? url.pathname : url.href, width: v.width};
    });
    return {id:p.id, title:p.title, width:p.width, height:p.height,
      pageUrl:`https://www.flickr.com/photos/93665003@N05/${p.id}/`, variants};
  });
}
export function srcset(photo: Photo): string {
  const unique = new Map<number, string>();
  for (const v of photo.variants) if (!unique.has(v.width)) unique.set(v.width, v.url);
  return [...unique].map(([width, url]) => `${url} ${width}w`).join(', ');
}
