# Flickr gallery Worker

A Cloudflare Worker that serves the site's public Flickr gallery and streams Flickr image renditions. The implementation is in `src/index.ts`.

## Functionality

The Worker requests the 50 newest public photos from Flickr account `93665003@N05`, ordered by upload date. It omits duplicate photos, entries from other accounts, and photos without usable image sources. The response may contain fewer than 50 photos.

One Flickr API request includes the available `url_s`, `url_m`, `url_n`, `url_z`, `url_c`, `url_l`, `url_h`, and `url_k` renditions and their dimensions. The Worker retains the returned URLs; it does not construct Flickr secrets or make per-photo size queries. Missing sizes are omitted. The frontend uses responsive `srcset` and `sizes` for gallery previews and the lightbox, including portrait images and square preview crops.

Gallery metadata is cached internally for up to one hour. Concurrent misses in the same Worker instance share a Flickr request. Every image request checks membership in the current gallery before fetching its selected rendition. Expired metadata is not served when Flickr is unavailable.

Image bytes stream without Cloudflare image transformations, resizing, recompression, or metadata removal. Only validated HTTPS Flickr URLs matching the photo ID are accepted. Requests never forward client cookies or authorization headers, and redirects are rejected.

## API

All endpoints accept `GET` without query parameters.

### `GET /api/photos/renditions-v1`

Returns `fetchedAt` (ISO metadata-fetch timestamp), `limit` (`50`), and `photos` (an array, possibly empty).

Each photo contains `id`, `title`, `pageUrl` (its Flickr page), `width`, `height`, and `variants`. Photo dimensions describe its largest available rendition. Each variant contains an absolute proxy `url`, `rendition`, and actual `width` and `height`, ordered by ascending width. Use the actual width as its `srcset` descriptor and deduplicate equal widths.

### `GET /api/photos/renditions-v1/:id/:rendition.jpg`

Streams one of the renditions advertised for that photo:

| Rendition | Nominal longest edge |
| --- | --- |
| `s` | 240px |
| `n` | 320px |
| `m` | 500px |
| `z` | 640px |
| `c` | 800px |
| `l` | 1024px |
| `h` | 1600px |
| `k` | 2048px |

These identifiers correspond to Flickr API fields, not filename suffixes. Availability depends on the uploaded image and sharing settings. Reported dimensions can be smaller than the nominal size. A requested rendition absent from the current metadata returns `404`.

The response reports the actual upstream JPEG, WebP, or AVIF `Content-Type` and includes `Vary: Accept`. It does not convert formats; a client that excludes the source format receives `406`. Image fetches have a 15-second timeout.

Successful images use `Cache-Control: private, max-age=<seconds>, must-revalidate`, capped at the remaining gallery-metadata lifetime, up to one hour. Removed photos can remain in a browser's cache until this expires. Metadata and errors use `Cache-Control: no-store`. The image subrequest has no cache TTL override; upstream CDN caching is separate from the browser and gallery caches.

### Compatibility endpoints

`/api/photos` retains the earlier metadata shape for already-open clients, with numeric image URLs and a `fullSizeUrl`. `/api/photos/:id/:width.jpg` accepts the previous `320`, `640`, `960`, `1440`, and `1920` widths and streams the smallest available rendition meeting that width, or the largest if none does. `/api/photos/source-v1/:id.jpg` streams the largest rendition. These endpoints do not resize images. New clients use the rendition endpoints above.

### Errors

Errors return JSON with an `error` string.

| Status | Meaning |
| --- | --- |
| `400` | Query parameters are not allowed. |
| `404` | Unknown route, unsupported rendition, or photo/rendition absent from the gallery. |
| `405` | Method other than `GET`. |
| `406` | The source image format is unacceptable to the client. |
| `502` | Flickr or the image fetch failed or returned an invalid response. |
| `503` | `FLICKR_API_KEY` is missing. |

## Configuration

| Setting | Description |
| --- | --- |
| `FLICKR_API_KEY` | Required secret for Flickr API requests. |
| `ALLOWED_ORIGIN` | Optional exact frontend origin, such as `https://example.com`, without a trailing slash. Leave empty for same-origin use. |

`ALLOWED_ORIGIN` enables CORS for one matching browser origin; it does not authenticate requests. The API is publicly readable.

The account, photo limit, renditions, and metadata-cache duration are defined by `USER_ID`, `LIMIT`, `RENDITIONS`, and `TTL` in `src/index.ts`.

## Run locally

Use Node.js 24. From the repository root:

```sh
cd backend/photos-worker
npm ci
```

Create an ignored `.dev.vars` file in this directory:

```dotenv
FLICKR_API_KEY=your_flickr_api_key
```

Keep it out of version control. Start the Worker and request metadata:

```sh
npm run dev
curl -i http://localhost:8787/api/photos/renditions-v1
```

Without the key, the API returns `503` with `{"error":"service_not_configured"}`. Fetching real metadata and images requires network access to Flickr. For development with the frontend, see the [project README](../../README.md#local-development).

## Test and build

From `backend/photos-worker`:

```sh
npm run check
```

This runs TypeScript checks, tests, and the bundle build. Individual commands:

```sh
npm run typecheck
npm test
npm run build
```

Tests use fixtures and require no Flickr credentials. They cover gallery selection, available renditions, actual dimensions, caching, validation, CORS, accepted image formats, streaming, timing, and errors. A runtime test exercises the bundled Worker in `workerd`.

The build writes `dist/worker.js`. Validate the backend deployment package without publishing:

```sh
npx wrangler deploy --dry-run --outdir dist/wrangler
```

## Deployment

This directory's `wrangler.jsonc` runs the backend alone. The repository-root configuration deploys it together with the built frontend. Both target `ozinoveva-photos`. Use the [production publish workflow](../../README.md#manual-production-publish) for the combined site. Configure `FLICKR_API_KEY` as a secret on the deployed Worker.

## Troubleshooting

Upstream failures include an `X-Photo-Diagnostic` header and emit a structured `photo_backend_failure` log event. `flickr_*` identifies Flickr transport, timeout, HTTP, API, JSON, body-read, or schema failures. `image_*` identifies image transport, timeout, HTTP, redirect, or content-type failures. Numeric suffixes identify upstream HTTP statuses or Flickr API codes. Diagnostics omit credentials, source URLs, raw bodies, and exception messages.

## Measure image request latency

Image responses include `Server-Timing` and an `X-Photo-Request-ID` matching a structured `photo_request_timing` log event. Durations are milliseconds, rounded and bounded to 0–60,000.

| Log field | Response header / meaning |
| --- | --- |
| `galleryMs` | `Server-Timing: gallery;dur=...`: metadata lookup or refresh, including a Flickr API call and cache write on a miss. |
| `upstreamMs` | `Server-Timing: upstream;dur=...`: image fetch to response headers. |
| `galleryCache` | `X-Photo-Gallery-Cache`: `hit`, `miss`, or `shared` (an in-flight metadata request). |
| `upstreamCache` | `X-Photo-Upstream-Cache`: allowlisted upstream `CF-Cache-Status`, or `UNKNOWN`. |
| `mode` | `X-Photo-Mode`: `rendition` or `legacy` for compatibility routes. |
| `status` | HTTP status when response headers are produced. |
| `requestId` | Generated ID matching `X-Photo-Request-ID`. |

Events omit photo IDs, source URLs, credentials, request headers, exception text, and image content. They are emitted before the body streams, so timings exclude body download, browser decoding, and fade-in; later streaming failures are not captured. Early method/path/query/configuration rejections do not emit image timing events.

Watch live logs from an authenticated Cloudflare session, from this directory:

```sh
npx wrangler tail --format json
```

Persistent Workers Logs are disabled in the checked-in configurations.

After publishing, reload the site. In browser Developer Tools, enable **Disable cache** and inspect gallery and lightbox rendition requests. Record the selected rendition, dimensions, byte count, content type, time to first byte, download time, and timing/cache headers. Repeat requests to compare initial and warm performance. Disable cache prevents browser responses from replaying old timing headers; it does not force a cold upstream cache. Turn it off to check normal repeat visits.

For command-line measurements, copy an image URL returned by the metadata API:

```sh
image_url='REPLACE_WITH_RETURNED_VARIANT_URL'
curl --silent --show-error --dump-header - --output /dev/null \
  --header 'Accept: image/avif,image/webp,image/jpeg' \
  --write-out 'ttfb=%{time_starttransfer}s total=%{time_total}s bytes=%{size_download}\n' \
  "$image_url"
```

Do not append cache-busting query parameters; the API rejects them.
