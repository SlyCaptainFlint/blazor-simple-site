export interface Variant {
  url: string;
  width: number;
  height: number;
}
export interface Photo {
  id: string;
  title: string;
  pageUrl: string;
  width: number;
  height: number;
  variants: Variant[];
}
const DEFAULT_API = '/api/photos/renditions-v1';
const LIVE_API_ORIGIN = 'https://ozinoveva-photos.ozinoveva.workers.dev';
export const PHOTOS_API = import.meta.env.VITE_PHOTOS_API_URL || DEFAULT_API;
const GALLERY_TTL = 60 * 60 * 1000;
let cachedGallery: { photos: Photo[]; expiresAt: number } | undefined;
let pendingGallery: Promise<Photo[]> | undefined;
const previews = new Map<string, HTMLImageElement>();

/** Share metadata across routes without restarting an in-flight preload. */
export async function loadPhotos(signal?: AbortSignal): Promise<Photo[]> {
  signal?.throwIfAborted();
  if (cachedGallery && Date.now() >= cachedGallery.expiresAt) {
    cachedGallery = undefined;
    previews.clear();
  }
  if (!cachedGallery) {
    pendingGallery ??= fetchPhotos().finally(() => {
      pendingGallery = undefined;
    });
    await pendingGallery;
  }
  signal?.throwIfAborted();
  return cachedGallery!.photos;
}

/** Reject malformed service data; remote strings never become HTML. */
async function fetchPhotos(): Promise<Photo[]> {
  const response = await fetch(PHOTOS_API, {
    signal: AbortSignal.timeout(10000),
    priority: 'low',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      'Photography is temporarily unavailable. Please try again.',
    );
  }
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('photos' in payload) ||
    !Array.isArray(payload.photos)
  ) {
    throw new Error(
      'The photo service returned an unexpected response. Please try again.',
    );
  }
  const api = new URL(PHOTOS_API, location.origin);
  const photos = payload.photos.slice(0, 50).map((value: unknown) => {
    if (!value || typeof value !== 'object') {
      throw new Error('Invalid photo');
    }
    const p = value as Record<string, unknown>;
    if (
      typeof p.id !== 'string' ||
      !/^\d+$/.test(p.id) ||
      typeof p.title !== 'string' ||
      typeof p.width !== 'number' ||
      p.width <= 0 ||
      typeof p.height !== 'number' ||
      p.height <= 0 ||
      !Array.isArray(p.variants) ||
      !p.variants.length
    ) {
      throw new Error('Invalid photo');
    }
    const variants = p.variants.map((v: unknown): Variant => {
      if (
        !v ||
        typeof v !== 'object' ||
        !('url' in v) ||
        typeof v.url !== 'string' ||
        !('width' in v) ||
        typeof v.width !== 'number' ||
        !Number.isInteger(v.width) ||
        v.width <= 0 ||
        !('height' in v) ||
        typeof v.height !== 'number' ||
        !Number.isInteger(v.height) ||
        v.height <= 0
      ) {
        throw new Error('Invalid image variant');
      }
      const url = new URL(v.url, api);
      if (
        (url.origin !== api.origin &&
          !(PHOTOS_API === DEFAULT_API && url.origin === LIVE_API_ORIGIN)) ||
        !new RegExp(
          `^/api/photos/renditions-v1/${p.id}/(s|m|n|z|c|l|h|k)\\.jpg$`,
        ).test(url.pathname) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error('Invalid image variant');
      }
      // Same-origin production requests stay relative; review builds can use the public API origin.
      return {
        url:
          PHOTOS_API === DEFAULT_API || url.origin === location.origin
            ? url.pathname
            : url.href,
        width: v.width,
        height: v.height,
      };
    });
    return {
      id: p.id,
      title: p.title,
      width: p.width,
      height: p.height,
      pageUrl: `https://www.flickr.com/photos/93665003@N05/${p.id}/`,
      variants: variants.sort((a, b) => a.width - b.width),
    };
  });
  // Do not extend the Worker's metadata lifetime with a new client-side hour.
  const fetchedAt =
    'fetchedAt' in payload && typeof payload.fetchedAt === 'string'
      ? Date.parse(payload.fetchedAt)
      : Date.now();
  cachedGallery = {
    photos,
    expiresAt:
      Math.min(
        Date.now(),
        Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
      ) + GALLERY_TTL,
  };
  return photos;
}
export function srcset(photo: Photo): string {
  const unique = new Map<number, string>();
  for (const v of photo.variants) {
    if (!unique.has(v.width)) {
      unique.set(v.width, v.url);
    }
  }
  return [...unique].map(([width, url]) => `${url} ${width}w`).join(', ');
}

const PREVIEW_LIMIT = 4;
/** Account for the extra image width hidden by the square gallery crop. */
function previewSizes(photo: Photo, photoCount: number): string {
  const crop = Math.max(1, photo.width / photo.height);
  // Match the gallery's 4px gaps, main padding, and auto-fit columns.
  const columns = (count: number) => Math.min(photoCount, count);
  const slot = (count: number, viewport: string) =>
    `calc((${viewport} - ${64 + 4 * (count - 1)}px) / ${count} * ${crop})`;
  return [
    `(max-width: 640px) calc((100vw - 28px) / 2 * ${crop})`,
    `(max-width: 960px) calc((100vw - 68px) / 2 * ${crop})`,
    `(max-width: 1195px) ${slot(columns(3), '100vw')}`,
    slot(columns(4), 'min(100vw, 1440px)'),
  ].join(', ');
}

/** Reuse a preloaded image so the gallery can display it immediately. */
export function previewImage(
  photo: Photo,
  index: number,
  photoCount: number,
): HTMLImageElement {
  const existing = previews.get(photo.id);
  if (existing) {
    return existing;
  }
  const image = new Image();
  image.alt = photo.title || `Photograph ${index + 1} by Olga Zinoveva`;
  image.width = photo.width;
  image.height = photo.height;
  image.decoding = 'async';
  image.loading = index < PREVIEW_LIMIT ? 'eager' : 'lazy';
  image.fetchPriority = 'low';
  image.sizes = previewSizes(photo, photoCount);
  image.srcset = srcset(photo);
  image.src = photo.variants[0].url;
  if (index < PREVIEW_LIMIT) {
    previews.set(photo.id, image);
    image.addEventListener('error', () => previews.delete(photo.id), {
      once: true,
    });
  }
  return image;
}

function constrainedConnection(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return (
    !!connection?.saveData ||
    ['slow-2g', '2g', '3g'].includes(connection?.effectiveType || '')
  );
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 2000 });
    } else {
      setTimeout(resolve, 300);
    }
  });
}

/** Start metadata during idle time; warm just four previews after critical assets. */
export function startPhotoPreload(): void {
  void (async () => {
    await idle();
    if (constrainedConnection() || document.hidden) {
      return;
    }
    const photos = await loadPhotos();
    if (document.readyState !== 'complete') {
      await new Promise<void>((resolve) =>
        window.addEventListener('load', () => resolve(), { once: true }),
      );
    }
    for (const [index, photo] of photos.slice(0, PREVIEW_LIMIT).entries()) {
      await idle();
      if (
        constrainedConnection() ||
        document.hidden ||
        document.body.dataset.page === 'photography' ||
        !cachedGallery ||
        cachedGallery.photos !== photos ||
        Date.now() >= cachedGallery.expiresAt
      ) {
        return;
      }
      const image = previewImage(photo, index, photos.length);
      // One speculative transfer at a time; failures must not affect the page.
      try {
        await image.decode();
      } catch {
        previews.delete(photo.id);
      }
    }
  })().catch(() => {
    /* Gallery navigation can retry a failed speculative request. */
  });
}
