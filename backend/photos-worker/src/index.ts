export interface Env {
  FLICKR_API_KEY?: string;
  /** Optional exact frontend origin, e.g. https://example.com. Empty = same origin only. */
  ALLOWED_ORIGIN?: string;
}

const USER_ID = '93665003@N05';
const RENDITIONS = ['s', 'm', 'n', 'z', 'c', 'l', 'h', 'k'] as const;
type Rendition = (typeof RENDITIONS)[number];
const LEGACY_WIDTHS = [320, 640, 960, 1440, 1920] as const;
const LIMIT = 50;
const TTL = 60 * 60;
interface Source {
  rendition: Rendition;
  url: string;
  width: number;
  height: number;
}

interface Photo {
  id: string;
  title: string;
  pageUrl: string;
  width: number;
  height: number;
  sources: Source[];
}

interface Gallery {
  fetchedAt: string;
  photos: Photo[];
}

interface Dependencies {
  fetch: typeof fetch;
  cache: Pick<Cache, 'match' | 'put'>;
  now: () => number;
  reportTiming?: (timing: ImageTiming) => void;
}

type GalleryCacheState = 'hit' | 'miss' | 'shared';
interface ImageTiming {
  event: 'photo_request_timing';
  requestId: string;
  mode: 'rendition' | 'legacy';
  galleryCache: GalleryCacheState;
  galleryMs: number;
  upstreamMs?: number;
  upstreamCache?: string;
  status: number;
}

const CACHE_STATES = new Set([
  'HIT',
  'MISS',
  'EXPIRED',
  'STALE',
  'BYPASS',
  'DYNAMIC',
  'REVALIDATED',
  'UPDATING',
]);

interface Diagnostic {
  stage:
    | 'flickr_fetch'
    | 'flickr_timeout'
    | 'flickr_http'
    | 'flickr_json'
    | 'flickr_body'
    | 'flickr_api'
    | 'flickr_schema'
    | 'image_fetch'
    | 'image_timeout'
    | 'image_http'
    | 'image_redirect'
    | 'image_format';
  upstreamStatus?: number;
  flickrCode?: number;
}

class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    public diagnostic?: Diagnostic,
  ) {
    super(code);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ServiceError(502, 'invalid_flickr_response');
  }
  return value as Record<string, unknown>;
}

function dimension(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' &&
    Number.isInteger(parsed) &&
    parsed > 0 &&
    parsed <= 100000
    ? parsed
    : 0;
}

/** Validate both the origin and the photo-specific filename; never follow arbitrary URLs. */
export function validSource(raw: string, id: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^(live|farm\d+)\.staticflickr\.com$/.test(url.hostname) &&
      new RegExp(`^/\\d+/${id}_[a-fA-F0-9]+(?:_[a-z])?\\.jpg$`).test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

/** Prefer modern formats only when explicitly advertised, respecting q=0 and quality weights. */
type ImageFormat = 'avif' | 'webp' | 'jpeg';
export function negotiateFormat(
  accept: string | null,
  formats: readonly ImageFormat[] = ['avif', 'webp', 'jpeg'],
): ImageFormat | null {
  if (!accept?.trim()) {
    return formats.includes('jpeg') ? 'jpeg' : null;
  }
  const ranges = accept
    .toLowerCase()
    .split(',')
    .map((part) => {
      const [type, ...params] = part
        .trim()
        .split(';')
        .map((value) => value.trim());
      const qParam = params.find((param) => /^q\s*=/.test(param));
      const raw = qParam?.split('=')[1]?.trim();
      let q = 1;
      if (raw !== undefined) {
        const validQuality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw);
        q = validQuality ? Number(raw) : 0;
      }
      return { type, q };
    });
  let selected: 'avif' | 'webp' | 'jpeg' | null = null;
  let best = 0;
  for (const format of formats) {
    const exact = ranges.find((range) => range.type === `image/${format}`);
    const match =
      exact ??
      (format === 'jpeg'
        ? (ranges.find((range) => range.type === 'image/*') ??
          ranges.find((range) => range.type === '*/*'))
        : undefined);
    if (match && match.q > best) {
      selected = format;
      best = match.q;
    }
  }
  return selected;
}

export function normalize(payload: unknown, now: number): Gallery {
  const root = record(payload);
  if (root.stat !== 'ok') {
    const value = root.code;
    let numeric: number | undefined;
    if (typeof value === 'number') {
      numeric = value;
    } else if (typeof value === 'string' && /^\d{1,6}$/.test(value)) {
      numeric = Number(value);
    }
    const flickrCode =
      numeric !== undefined &&
      Number.isInteger(numeric) &&
      numeric >= 0 &&
      numeric <= 999999
        ? numeric
        : undefined;
    throw new ServiceError(502, 'flickr_unavailable', {
      stage: 'flickr_api',
      ...(flickrCode === undefined ? {} : { flickrCode }),
    });
  }
  const list = record(root.photos).photo;
  if (!Array.isArray(list)) {
    throw new ServiceError(502, 'invalid_flickr_response');
  }
  const photos: Photo[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, LIMIT)) {
    const flickrPhoto = record(item);
    if (
      typeof flickrPhoto.id !== 'string' ||
      !/^\d+$/.test(flickrPhoto.id) ||
      seen.has(flickrPhoto.id) ||
      flickrPhoto.owner !== USER_ID ||
      Number(flickrPhoto.ispublic) !== 1
    ) {
      continue;
    }
    const sources: Source[] = [];
    for (const suffix of RENDITIONS) {
      const url = flickrPhoto[`url_${suffix}`];
      const width = dimension(flickrPhoto[`width_${suffix}`]);
      const height = dimension(flickrPhoto[`height_${suffix}`]);
      if (
        typeof url === 'string' &&
        width &&
        height &&
        validSource(url, flickrPhoto.id)
      ) {
        sources.push({ rendition: suffix, url, width, height });
      }
    }
    sources.sort((a, b) => b.width * b.height - a.width * a.height);
    if (!sources.length) {
      continue;
    }
    seen.add(flickrPhoto.id);
    photos.push({
      id: flickrPhoto.id,
      title: typeof flickrPhoto.title === 'string' ? flickrPhoto.title : '',
      pageUrl: `https://www.flickr.com/photos/${USER_ID}/${flickrPhoto.id}/`,
      width: sources[0].width,
      height: sources[0].height,
      sources,
    });
  }
  return { fetchedAt: new Date(now).toISOString(), photos };
}

/** Map old width URLs to an available rendition without resizing it. */
function sourceForWidth(photo: Photo, width: number): Source {
  return (
    [...photo.sources]
      .sort((a, b) => a.width - b.width)
      .find((source) => source.width >= width) ?? photo.sources[0]
  );
}

export function createHandler(dependencies: Dependencies) {
  // Concurrent cache misses share one Flickr request within this Worker instance.
  // Requests with a new API key do not reuse a pending request made with the old key.
  let pending: { key: string; task: Promise<Gallery> } | undefined;
  async function gallery(
    request: Request,
    key: string,
    onCache?: (state: GalleryCacheState) => void,
  ): Promise<Gallery> {
    const cacheKey = new Request(
      new URL('/__internal/gallery-v3', request.url),
    );
    try {
      const hit = await dependencies.cache.match(cacheKey);
      if (hit) {
        const saved = await hit.json<Gallery>();
        const age = dependencies.now() - Date.parse(saved.fetchedAt);
        if (age >= 0 && age < TTL * 1000) {
          onCache?.('hit');
          return saved;
        }
      }
    } catch {
      /* A cache outage must not prevent a fresh, authoritative query. */
    }
    if (pending?.key === key) {
      onCache?.('shared');
      return pending.task;
    }
    onCache?.('miss');
    const task = (async () => {
      const url = new URL('https://www.flickr.com/services/rest/');
      url.search = new URLSearchParams({
        api_key: key,
        method: 'flickr.photos.search',
        user_id: USER_ID,
        privacy_filter: '1',
        media: 'photos',
        sort: 'date-posted-desc',
        per_page: String(LIMIT),
        page: '1',
        format: 'json',
        nojsoncallback: '1',
        extras: RENDITIONS.map((size) => `url_${size}`).join(','),
      }).toString();
      let response: Response;
      const signal = AbortSignal.timeout(10000);
      try {
        response = await dependencies.fetch(url.toString(), {
          redirect: 'manual',
          signal,
        });
      } catch {
        throw new ServiceError(502, 'flickr_unavailable', {
          stage: signal.aborted ? 'flickr_timeout' : 'flickr_fetch',
        });
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ServiceError(502, 'flickr_unavailable', {
          stage: 'flickr_http',
          upstreamStatus: response.status,
        });
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (e) {
        throw new ServiceError(502, 'invalid_flickr_response', {
          stage: signal.aborted
            ? 'flickr_timeout'
            : e instanceof SyntaxError
              ? 'flickr_json'
              : 'flickr_body',
        });
      }
      let data: Gallery;
      try {
        data = normalize(payload, dependencies.now());
      } catch (e) {
        if (e instanceof ServiceError && e.diagnostic) {
          throw e;
        }
        throw new ServiceError(502, 'invalid_flickr_response', {
          stage: 'flickr_schema',
        });
      }
      try {
        await dependencies.cache.put(
          cacheKey,
          new Response(JSON.stringify(data), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `public, max-age=${TTL}`,
            },
          }),
        );
      } catch {
        /* Cache is optional; no stale fallback on upstream failure. */
      }
      return data;
    })();
    pending = { key, task };
    try {
      return await task;
    } finally {
      if (pending?.task === task) {
        pending = undefined;
      }
    }
  }
  return async (request: Request, env: Env): Promise<Response> => {
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    let timing: ImageTiming | undefined;
    const elapsed = (start: number) =>
      Math.min(60000, Math.max(0, Math.round(dependencies.now() - start)));
    function finishTiming(status: number): void {
      if (!timing) return;
      timing.status = status;
      const measurements = [`gallery;dur=${timing.galleryMs}`];
      if (timing.upstreamMs !== undefined) {
        measurements.push(`upstream;dur=${timing.upstreamMs}`);
      }
      headers.set('Server-Timing', measurements.join(', '));
      headers.set('X-Photo-Request-ID', timing.requestId);
      headers.set('X-Photo-Mode', timing.mode);
      headers.set('X-Photo-Gallery-Cache', timing.galleryCache);
      headers.set('X-Photo-Upstream-Cache', timing.upstreamCache ?? 'UNKNOWN');
      if (dependencies.reportTiming) {
        dependencies.reportTiming(timing);
      } else {
        console.info(JSON.stringify(timing));
      }
    }
    const origin = request.headers.get('Origin');
    if (env.ALLOWED_ORIGIN) {
      headers.set('Vary', 'Origin');
    }
    if (origin && origin === env.ALLOWED_ORIGIN) {
      headers.set('Access-Control-Allow-Origin', origin);
    }
    function json(body: unknown, status = 200): Response {
      finishTiming(status);
      const responseHeaders = new Headers(headers);
      responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(body), {
        status,
        headers: responseHeaders,
      });
    }
    try {
      const url = new URL(request.url);
      const rendition =
        /^\/api\/photos\/renditions-v1\/(\d+)\/(s|m|n|z|c|l|h|k)\.jpg$/.exec(
          url.pathname,
        );
      const metadata = url.pathname === '/api/photos/renditions-v1';
      // Keep old URLs working for tabs opened before the rendition release.
      const direct = /^\/api\/photos\/source-v1\/(\d+)\.jpg$/.exec(
        url.pathname,
      );
      const image = /^\/api\/photos\/(\d+)\/(320|640|960|1440|1920)\.jpg$/.exec(
        url.pathname,
      );
      const imageRequest = !!(rendition || image || direct);
      if (url.pathname !== '/api/photos' && !metadata && !imageRequest) {
        return json({ error: 'not_found' }, 404);
      }
      if (request.method !== 'GET') {
        headers.set('Allow', 'GET');
        return json({ error: 'method_not_allowed' }, 405);
      }
      if (url.search) {
        return json({ error: 'query_parameters_not_allowed' }, 400);
      }
      if (imageRequest) {
        headers.append('Vary', 'Accept');
      }
      const format = imageRequest
        ? negotiateFormat(request.headers.get('Accept'))
        : null;
      if (imageRequest && !format) {
        return json({ error: 'not_acceptable' }, 406);
      }
      const key = env.FLICKR_API_KEY?.trim();
      if (!key) {
        return json({ error: 'service_not_configured' }, 503);
      }
      if (imageRequest) {
        timing = {
          event: 'photo_request_timing',
          requestId: crypto.randomUUID(),
          mode: rendition ? 'rendition' : 'legacy',
          galleryCache: 'miss',
          galleryMs: 0,
          status: 200,
        };
      }
      let data: Gallery;
      const galleryStart = dependencies.now();
      try {
        data = await gallery(request, key, (state) => {
          if (timing) timing.galleryCache = state;
        });
      } finally {
        if (timing) timing.galleryMs = elapsed(galleryStart);
      }
      if (!imageRequest) {
        return json({
          fetchedAt: data.fetchedAt,
          limit: LIMIT,
          photos: data.photos.map((photo) => ({
            id: photo.id,
            title: photo.title,
            pageUrl: photo.pageUrl,
            width: photo.width,
            height: photo.height,
            ...(metadata
              ? {}
              : {
                  fullSizeUrl: `${url.origin}/api/photos/source-v1/${photo.id}.jpg`,
                }),
            variants: metadata
              ? [...photo.sources]
                  .sort((a, b) => a.width - b.width)
                  .map((source) => ({
                    rendition: source.rendition,
                    width: source.width,
                    height: source.height,
                    url: `${url.origin}/api/photos/renditions-v1/${photo.id}/${source.rendition}.jpg`,
                  }))
              : LEGACY_WIDTHS.map((width) => ({
                  width: sourceForWidth(photo, width).width,
                  url: `${url.origin}/api/photos/${photo.id}/${width}.jpg`,
                })),
          })),
        });
      }
      const photoId = (rendition ?? direct ?? image)![1];
      const photo = data.photos.find((p) => p.id === photoId);
      if (!photo) {
        return json({ error: 'photo_not_found' }, 404);
      }
      const source = rendition
        ? photo.sources.find((source) => source.rendition === rendition[2])
        : image
          ? sourceForWidth(photo, Number(image[2]))
          : photo.sources[0];
      if (!source) {
        return json({ error: 'rendition_not_found' }, 404);
      }
      // Check gallery membership before fetching a permitted Flickr rendition.
      let upstream: Response;
      const signal = AbortSignal.timeout(15000);
      const upstreamStart = dependencies.now();
      try {
        // workerd rejects redirect: 'error' before fetching. Manual + status checks never follows redirects.
        const options: RequestInit = { redirect: 'manual', signal };
        upstream = await dependencies.fetch(source.url, options);
      } catch {
        throw new ServiceError(502, 'image_unavailable', {
          stage: signal.aborted ? 'image_timeout' : 'image_fetch',
        });
      } finally {
        if (timing) timing.upstreamMs = elapsed(upstreamStart);
      }
      const cacheState = upstream.headers.get('CF-Cache-Status') ?? '';
      if (timing) {
        timing.upstreamCache = CACHE_STATES.has(cacheState)
          ? cacheState
          : 'UNKNOWN';
      }
      const contentType = upstream.headers
        .get('Content-Type')
        ?.split(';')[0]
        .trim()
        .toLowerCase();
      const actualFormat =
        contentType === 'image/avif'
          ? 'avif'
          : contentType === 'image/webp'
            ? 'webp'
            : contentType === 'image/jpeg'
              ? 'jpeg'
              : null;
      let stage: Diagnostic['stage'] | undefined;
      if (!upstream.ok) {
        stage = 'image_http';
      } else if (upstream.redirected) {
        stage = 'image_redirect';
      } else if (!actualFormat) {
        stage = 'image_format';
      }
      if (stage) {
        try {
          await upstream.body?.cancel();
        } catch {
          /* Preserve safe diagnostic if cancelling fails. */
        }
        throw new ServiceError(502, 'image_unavailable', {
          stage,
          upstreamStatus: upstream.status,
        });
      }
      if (!negotiateFormat(request.headers.get('Accept'), [actualFormat!])) {
        await upstream.body?.cancel();
        return json({ error: 'not_acceptable' }, 406);
      }
      // Browser copies expire with the gallery metadata used to approve this photo.
      const remainingSeconds = Math.max(
        0,
        Math.min(
          TTL,
          Math.floor(
            (Date.parse(data.fetchedAt) + TTL * 1000 - dependencies.now()) /
              1000,
          ),
        ),
      );
      headers.set(
        'Cache-Control',
        `private, max-age=${remainingSeconds}, must-revalidate`,
      );
      headers.set('Content-Type', contentType!);
      finishTiming(200);
      return new Response(upstream.body, { headers });
    } catch (e) {
      const error =
        e instanceof ServiceError
          ? e
          : new ServiceError(502, 'upstream_unavailable');
      // Allowlisted stage and bounded numeric codes only. Never log the exception, URL, or body.
      if (error.diagnostic) {
        console.error(
          JSON.stringify({
            event: 'photo_backend_failure',
            ...error.diagnostic,
          }),
        );
        const { stage, upstreamStatus, flickrCode } = error.diagnostic;
        headers.set(
          'X-Photo-Diagnostic',
          stage +
            (upstreamStatus === undefined ? '' : `_${upstreamStatus}`) +
            (flickrCode === undefined ? '' : `_${flickrCode}`),
        );
      }
      return json({ error: error.code }, error.status);
    }
  };
}

let handler: ReturnType<typeof createHandler> | undefined;
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    handler ??= createHandler({
      fetch: globalThis.fetch.bind(globalThis),
      cache: caches.default,
      now: Date.now,
    });
    return handler(request, env);
  },
} satisfies ExportedHandler<Env>;
