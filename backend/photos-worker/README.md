# Flickr gallery Worker

A Cloudflare Worker that serves a public Flickr photo gallery and resized images for the site. The implementation is in `src/index.ts`.

## Functionality

The Worker requests the 50 newest public photos from Flickr account `93665003@N05`, ordered by upload date. It omits duplicate photos, entries from other accounts, and photos without a usable image source. The response may therefore contain fewer than 50 photos.

Gallery metadata is cached internally for up to one hour. Concurrent cache misses in the same Worker instance share a Flickr request. Each image request checks that the photo belongs to the current gallery. Expired metadata is not served when Flickr is unavailable.

Images use the largest available Flickr source and Cloudflare image transformations. Resizing preserves the aspect ratio, never upscales, uses quality 82, and removes metadata. Only validated Flickr image URLs are accepted; clients cannot supply source URLs.

## API

All endpoints accept `GET` requests without query parameters.

### `GET /api/photos`

Returns a JSON object with:

| Field | Description |
| --- | --- |
| `fetchedAt` | ISO timestamp of the Flickr metadata fetch. |
| `limit` | Maximum number of photos: `50`. |
| `photos` | Photos in newest-upload-first order; an empty gallery returns `[]`. |

Each photo contains `id`, `title`, `pageUrl` (its Flickr page), `width`, `height`, `sources`, and `variants`. Dimensions describe the largest available source. Each source has `url`, `width`, and `height`; each variant has an absolute `url` and its output `width`, capped at the source width. Variants can be used in an image `srcset`; deduplicate equal output widths for small sources. When `PHOTO_LIGHTBOX_MODE=source-v1`, each photo also includes `fullSizeUrl`, which the lightbox uses instead of the resized variants. Gallery thumbnails continue using resized variants.

### `GET /api/photos/:id/:width.jpg`

Supported width presets: `320`, `640`, `960`, `1440`, and `1920`.

The `Accept` header selects AVIF, WebP, or JPEG. Without an explicit format preference, JPEG is used. The `.jpg` suffix stays the same for all formats; the response `Content-Type` identifies the actual format. Image responses include `Vary: Accept`.

Successful image responses use `Cache-Control: private, max-age=<seconds>, must-revalidate`. Browsers can reuse them for up to one hour, capped at the remaining lifetime of the gallery metadata. Cached photos may remain visible after removal from Flickr until that time expires. Metadata and error responses use `Cache-Control: no-store`.

### `GET /api/photos/source-v1/:id.jpg`

Streams the same largest Flickr source selected by the resized endpoint, without Cloudflare image transformations, recompression, or metadata removal. The response uses the upstream JPEG, WebP, or AVIF content type; it does not convert the source to match the client's preferred format. A client that excludes the source format receives `406`.

This route applies the same gallery-membership, source URL, method, query, redirect, timeout, and content-type checks as the resized route. Browser cache lifetime follows the same gallery expiry. The separate versioned URL prevents cached resized responses from being used for the source baseline. Source files may be larger than their resized variants.

### Errors

Errors return JSON with an `error` string.

| Status | Meaning |
| --- | --- |
| `400` | Query parameters are not allowed. |
| `404` | Unknown route, unsupported width preset, or photo absent from the gallery. |
| `405` | Method other than `GET`. |
| `406` | No supported image format is acceptable to the client. |
| `502` | Flickr or image transformation failed, or returned an invalid response. |
| `503` | `FLICKR_API_KEY` is missing. |

## Configuration

| Setting | Description |
| --- | --- |
| `FLICKR_API_KEY` | Required secret for Flickr API requests. |
| `PHOTO_LIGHTBOX_MODE` | `source-v1` selects the source baseline in the lightbox. `resized` or an omitted value uses responsive transformed images. Both Wrangler configurations currently select `source-v1`. |
| `ALLOWED_ORIGIN` | Optional exact frontend origin, such as `https://example.com`, without a trailing slash. Leave empty for same-origin use. |

`ALLOWED_ORIGIN` enables CORS for one matching browser origin; it does not authenticate requests. The API is publicly readable.

The Flickr account, photo limit, image presets, and metadata cache duration are defined by `USER_ID`, `LIMIT`, `WIDTHS`, and `TTL` in `src/index.ts`.

## Run locally

Use Node.js 24. From the repository root:

```sh
cd backend/photos-worker
npm ci
```

Create an ignored `.dev.vars` file in this directory for local Flickr access:

```dotenv
FLICKR_API_KEY=your_flickr_api_key
```

Keep this file out of version control. Start the local Worker:

```sh
npm run dev
```

Request the gallery at `http://localhost:8787/api/photos`:

```sh
curl -i http://localhost:8787/api/photos
```

Without the key, this returns `503` with `{"error":"service_not_configured"}`. Actual image transformations require Cloudflare's deployed service; local tests use mocked transformation responses.

For local development with the frontend, see the [project README](../../README.md#local-development).

## Test and build

Run these commands from `backend/photos-worker`:

```sh
npm run check
```

This runs TypeScript checks, tests, and the bundle build. The individual commands are:

```sh
npm run typecheck
npm test
npm run build
```

Tests use fixtures and require no Flickr credentials or live Flickr requests. They cover gallery selection, caching, request validation, CORS, format negotiation, transformation requests, and error handling. A runtime test executes the bundled Worker in `workerd`, including redirect handling. Tests do not perform real Cloudflare image encoding.

The build writes `dist/worker.js`. To validate the backend deployment package without publishing:

```sh
npx wrangler deploy --dry-run --outdir dist/wrangler
```

## Deployment

This directory's `wrangler.jsonc` runs the backend alone. The repository-root `wrangler.jsonc` deploys the backend together with the built frontend. Both target the `ozinoveva-photos` Worker. Use the [production publish workflow](../../README.md#manual-production-publish) to publish the combined site.

Configure `FLICKR_API_KEY` as a secret on the deployed Worker. Cloudflare image transformations must be available for the account serving image requests.

## Troubleshooting

Inspect response headers with `curl -i`. Upstream failures include an `X-Photo-Diagnostic` header and emit a structured `photo_backend_failure` log event.

- `flickr_*` identifies Flickr transport, timeout, HTTP, API, JSON, body-read, or response-schema failures.
- `image_*` identifies image transport, timeout, HTTP, redirect, transformation, missing-transformation, or output-format failures.
- Numeric suffixes identify upstream HTTP statuses or Flickr API codes. An optional `_cf_CODE` suffix identifies a Cloudflare resizing error.

Diagnostics omit credentials, source URLs, raw upstream bodies, and exception messages. For resizing error codes, see [Cloudflare image troubleshooting](https://developers.cloudflare.com/images/reference/troubleshooting/).

## Measure image request latency

Image responses include `Server-Timing` and an `X-Photo-Request-ID` matching a structured `photo_request_timing` log event. Durations are in milliseconds, rounded and bounded to 0–60,000.

| Field | Meaning |
| --- | --- |
| `galleryMs` / `gallery;dur` | Time spent reading or refreshing gallery metadata, including a Flickr API call and metadata cache write on a miss. |
| `upstreamMs` / `upstream;dur` | Time from starting the image subrequest until its response headers arrive. In `source-v1` mode this omits transformations; in `resized` mode it includes the transformation service's wait. |
| `galleryCache` | `hit`, `miss`, or `shared` (an in-flight request in this Worker instance). Also returned in `X-Photo-Gallery-Cache`. |
| `upstreamCache` | Allowlisted upstream `CF-Cache-Status`, or `UNKNOWN` when unavailable. Also returned in `X-Photo-Upstream-Cache`; it is not an independent measurement of every cache inside the image service. |
| `mode` | `source-v1` or `resized`, also returned in `X-Photo-Mode`. |
| `status` | HTTP status returned when headers are produced. A later streaming failure is not captured by this timing event. |
| `requestId` | Generated ID matching `X-Photo-Request-ID`. |

The event contains no photo IDs, source URLs, credentials, request headers, exception text, or image content. It is emitted before streaming the response body, so these timings exclude body download, browser decoding, and the lightbox fade. Early method/path/query/configuration rejections do not emit image timing events.

To watch new requests from an authenticated Cloudflare session, run from `backend/photos-worker`:

```sh
npx wrangler tail --format json
```

Logging is live; persistent Workers Logs remain disabled in the checked-in configurations.

After deployment, reload the site and open browser Developer Tools. In Network, enable **Disable cache**, then open a photo. The lightbox request should use `/api/photos/source-v1/`. Record its response headers, time to first byte, download time, content type, and byte count. Disable cache prevents cached browser responses from replaying old timing headers; it does not guarantee a cold Cloudflare or Flickr cache. Turn it off again when testing normal repeat visits.

For a command-line comparison, choose a current photo ID from `/api/photos`, then run each URL several times with the same `Accept` header. Curl does not maintain a browser response cache:

```sh
site_url='https://ozinoveva-photos.ozinoveva.workers.dev'
photo_id='REPLACE_WITH_CURRENT_PHOTO_ID'
for photo_path in "/api/photos/source-v1/${photo_id}.jpg" "/api/photos/${photo_id}/1920.jpg"; do
  curl --silent --show-error --dump-header - --output /dev/null \
    --header 'Accept: image/avif,image/webp,image/jpeg' \
    --write-out 'ttfb=%{time_starttransfer}s total=%{time_total}s bytes=%{size_download}\n' \
    "${site_url}${photo_path}"
done
```

Compare first-byte and `upstream` timings separately from total transfer time. Record the first request and repeat requests, their cache states, and output formats. Resized requests include both source access and transformation; a source request alone does not isolate encoding cost. Cold source and cold transformed-variant caches are different states, and thumbnails may already have warmed the source. Do not append cache-busting query parameters; the API rejects them.

To restore the lightbox's resized delivery, set `PHOTO_LIGHTBOX_MODE` to `resized` in both Wrangler configurations and publish through the normal workflow. Reload the page to replace its in-memory gallery metadata. The source endpoint remains available for explicit comparisons; reverting the diagnostic PR removes it and the timing instrumentation.
