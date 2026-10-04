# Flickr gallery Worker

A Cloudflare Worker that serves a public Flickr photo gallery and resized images for the site. The implementation is in `src/index.ts`.

## Functionality

The Worker requests the 50 newest public photos from Flickr account `93665003@N05`, ordered by upload date. It omits duplicate photos, entries from other accounts, and photos without a usable image source. The response may therefore contain fewer than 50 photos.

Gallery metadata is cached internally for up to one hour. Concurrent cache misses in the same Worker instance share a Flickr request. Each image request checks that the photo belongs to the current gallery. Expired metadata is not served when Flickr is unavailable.

Images use the largest available Flickr source and Cloudflare image transformations. Resizing preserves the aspect ratio, never upscales, uses quality 82, and removes metadata. Only validated Flickr image URLs are accepted; clients cannot supply source URLs.

## API

Both endpoints accept `GET` requests without query parameters.

### `GET /api/photos`

Returns a JSON object with:

| Field | Description |
| --- | --- |
| `fetchedAt` | ISO timestamp of the Flickr metadata fetch. |
| `limit` | Maximum number of photos: `50`. |
| `photos` | Photos in newest-upload-first order; an empty gallery returns `[]`. |

Each photo contains `id`, `title`, `pageUrl` (its Flickr page), `width`, `height`, `sources`, and `variants`. Dimensions describe the largest available source. Each source has `url`, `width`, and `height`; each variant has an absolute `url` and its output `width`, capped at the source width. Variants can be used in an image `srcset`; deduplicate equal output widths for small sources.

### `GET /api/photos/:id/:width.jpg`

Supported width presets: `320`, `640`, `960`, `1440`, and `1920`.

The `Accept` header selects AVIF, WebP, or JPEG. Without an explicit format preference, JPEG is used. The `.jpg` suffix stays the same for all formats; the response `Content-Type` identifies the actual format. Image responses include `Vary: Accept`.

API responses use `Cache-Control: no-store`. Do not override this with a cache rule that bypasses the gallery-membership check.

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
