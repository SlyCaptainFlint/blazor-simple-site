# Flickr gallery Worker

One Cloudflare module Worker serves photo metadata and Cloudflare image transformations. No server, S3 copy, KV, Images binding, database, scheduled job, frontend change, or separate resizing Worker is required.

## Selection and API

Source: [FlickrDownload/Function.cs at a1e62fd](https://github.com/SlyCaptainFlint/download-flickr-photos/blob/a1e62fd2e6da8ae3bb34260bb6dc93d2cb8a90da/FlickrDownload/Function.cs).
The Lambda searches user `93665003@N05` without a tag filter (despite its comment), implicitly using Flickr's newest-upload-first order. This Worker explicitly selects public photos, `date-posted-desc`, page 1, 30 results. It retains stable Flickr IDs and order; invalid/non-public/wrong-owner/unusable entries are omitted, not replaced from subsequent pages. An empty account returns an empty list.

- `GET /api/photos`: `{ fetchedAt, limit: 30, photos: [{ id, title, pageUrl, width, height, sources: [{url,width,height}], variants: [{url,width}] }] }`.
- `GET /api/photos/PHOTO_ID/320.jpg` (also 640, 960, 1440, 1920): AVIF, WebP, or JPEG transformed by Cloudflare, quality 82, no metadata, aspect ratio preserved, never upscaled. `Accept` negotiates explicit AVIF/WebP support (quality weights and exclusions respected), with JPEG for absent/wildcard support; unsupported combinations return 406. The `.jpg` route suffix is stable; the response `Content-Type` identifies the actual format. Image responses include `Vary: Accept`, combined with `Origin` for allowed CORS. URLs are absolute in API responses and work on a standalone workers.dev origin. Render variants as `srcset` with corresponding widths (deduplicate equal widths for small originals).
- Requests with arbitrary query parameters, unknown presets, unknown IDs, other routes, or non-GET methods are rejected. No URL-proxy interface is exposed.

Sources are requested with Flickr extras `url_s,url_m,url_l,url_k,url_h`. The largest *available* source is selected; no premium/original size is fabricated. Flickr account/API access determines actual resolution. Source dimensions are preserved; variants report the capped output width. Always show appropriate Flickr attribution/link from `pageUrl`; do not treat photo titles as HTML.

## Cache and security

The internal Cache API holds metadata for at most 60 seconds; a timestamp check enforces expiry even if a stale entry is returned. Concurrent misses coalesce per isolate. The 60-second choice is intentionally shorter than the earlier 15–60 minute proposal: gallery metadata doubles as image authorization, so a long TTL also delays removal/privacy propagation. It trades more Flickr queries (per active edge location) for a short revocation window, using only the existing Cache API and no durable cache. There is no stale fallback: an expired cache plus Flickr failure returns 502. Removed/private photos stop resolving after this metadata window. This is not instantaneous revocation, and it cannot revoke copies a viewer already downloaded.

Every image request validates current cached-gallery membership before invoking Cloudflare's transform cache. Public responses use `Cache-Control: no-store`, preventing a browser/CDN response cache from skipping that membership check. Do not add a Cache Everything rule over `/api/photos*`. Cloudflare manages the underlying transformed-image cache; this deliberately trades additional Worker requests for short, predictable membership expiry.

Only HTTPS `live.staticflickr.com` and `farmN.staticflickr.com` JPEG paths matching the selected photo ID are accepted from Flickr. User headers/cookies are never forwarded, redirects are rejected, and errors never redirect to original images. Flickr credentials and upstream error details are not logged or returned. The secret is absent from the source and bundle. Routes remain publicly readable: CORS restricts browser JS access, not non-browser traffic. Consider account-level rate limits if abusive traffic develops; fixed presets bound transformations per source but are not a spending cap.

## Develop and verify

Requires a current Node version supported by Wrangler (tested with Node 24.19.0).

```sh
cd backend/photos-worker
npm ci
npm run check
npx wrangler deploy --dry-run --outdir dist/wrangler
npm run dev
```

Without credentials, `curl -i http://localhost:8787/api/photos` must return 503 with `{"error":"service_not_configured"}`. Fixture tests require no credentials/network. They verify selection, shape, cache/deletion expiry, CORS, missing secrets, rejected URLs/presets, membership, Cloudflare transform options, and sanitized upstream failures. These do not prove real Flickr access or live image transformation.

For optional real local Flickr access, enter the key only into ignored `.dev.vars` using your secure local editor (`FLICKR_API_KEY=...`). Never paste it in chat or commit it. Local image mocks and dashboard preview do not establish production transformation behavior.

## Deployment handoff (no DNS or paid-plan activation needed by these commands)

**Deployment has not been performed from this environment.** Review account entitlement/quota before enabling real transformations; do not activate a paid plan merely to follow these steps.

### Dashboard: single-file artifact

1. Create/select module Worker `ozinoveva-photos`. Paste **all of `dist/worker.js`** into its JavaScript module entry. It has no imports or npm runtime dependencies.
2. Set compatibility date `2026-10-04`, enable its workers.dev URL, disable preview URLs. No bindings are required.
3. Deploy the bundle; `/api/photos` safely returns 503 until configured.
4. Add `FLICKR_API_KEY` using the dashboard's **Secret** field (not plaintext variable, code, URL, or chat). Secure entry is a user/account-owner step.
5. Optional plaintext `ALLOWED_ORIGIN`: exact current site origin, e.g. `https://example.com`, without a trailing slash. Leave empty for same-origin-only JS access. No wildcard or comma-separated list. This is needed when the unchanged site's eventual frontend integration fetches workers.dev cross-origin. Ordinary `<img>` loads do not require it.
6. Save/deploy the updated settings. No custom-domain route is included, and no DNS change is necessary for workers.dev verification.

### CLI alternative for the account owner

```sh
npm ci
npm run check
npx wrangler login
npx wrangler deploy
npx wrangler secret put FLICKR_API_KEY
```

`wrangler.jsonc` deliberately contains no account ID, zone ID, domain route, secret, or paid feature activation. Wrangler prompts the authenticated owner to select the account if needed. Rename the Worker only if the dashboard owner chooses another name. To add CORS via code config, set `vars.ALLOWED_ORIGIN` to the real site origin and redeploy. Do not run CLI deployment concurrently with dashboard edits.

### Live acceptance checks for the provisioning owner

- Before adding the secret: metadata/image routes return sanitized 503.
- After adding it: metadata returns up to 30 public photos, correct ordering, stable IDs, source dimensions, and links, with no credential in response.
- Fetch one returned 320 variant outside dashboard preview; confirm HTTP 200, expected Content-Type for explicit AVIF/WebP/JPEG Accept headers, output dimensions capped at 320px. Verify all five presets on one photo before integrating. Account support for `cf.image` and the Flickr key remain unverified locally.
- Unknown ID/preset and `?url=...` requests must fail. A bad Flickr key must produce sanitized 502. Never log the key or credential-bearing Flickr URL during checks.
- If transformations are unavailable or quota-limited, the route fails closed; resolve account configuration without authorizing a paid upgrade implicitly.

Cloudflare's current [transform-via-fetch documentation](https://developers.cloudflare.com/images/optimization/transformations/transform-via-workers/) supports `cf.image` on workers.dev, with charges/quota attributed to the Worker account. It uses built-in transformations rather than image processing in Worker JS CPU. No public `/cdn-cgi/image/...` endpoint is needed; that would bypass this Worker's gallery-membership policy.

## Current scope

The repository now contains a separately reviewed Vite/TypeScript frontend migration. The root wrangler.jsonc combines its static assets with this backend; this directory's configuration remains backend-only. Existing production Lambda/S3 resources remain intact until an approved cutover is verified. Do not deploy either configuration while the migration PR is awaiting approval.

## Sanitized Flickr diagnostics

On Flickr failures, `X-Photo-Diagnostic` and a structured `photo_backend_failure` console event distinguish:

- `flickr_fetch`: network/fetch exception before an HTTP response.
- `flickr_timeout`: the bounded request timeout fired (including body reading).
- `flickr_http_NNN`: HTTP status, including redirects (never followed; Location is not logged).
- `flickr_json`: non-JSON response; `flickr_body`: response stream read failure.
- `flickr_api_N`: Flickr `stat: fail` with a bounded numeric API code; `flickr_api` if no safe numeric code exists.
- `flickr_schema`: unexpected successful response structure.

The public JSON remains generic. Only allowlisted stages/numeric codes are emitted: no raw Flickr message, response body, exception, URL, or key. Use `curl -i WORKER_URL/api/photos` to collect the safe header, or an authorized dashboard log/tail session to inspect the structured event. The diagnostic header works even with persistent observability disabled. Do not infer an invalid key from the generic 502 alone.

The endpoint/method/account match the original Lambda. Added explicit public-photo, newest-first and 30-photo parameters plus larger size extras remain intentional; the diagnostic stage determines whether the failure occurs before Flickr API processing or inside it. This release does not change the secret or speculate about its validity.


## Runtime redirect fix and image diagnostics

A real `workerd` check reproduced that `new Request(..., {redirect: "error"})` throws before network I/O. The runtime accepts only `follow` and `manual` despite the broader web/TypeScript API. Both upstream calls now use `manual` and explicitly reject non-success/redirect responses. The runtime regression test boots the actual bundled Worker with fixture outbound responses, checks successful metadata/image delivery and verifies a 302 is rejected without requesting its destination. It does not simulate Cloudflare production image encoding.

Image failures use the same safe diagnostic header/logging with stages `image_fetch`, `image_timeout`, `image_http_STATUS`, `image_redirect_STATUS`, `image_transform_STATUS`, `image_untransformed_STATUS`, and `image_format_STATUS`. When `Cf-Resized` supplies a strictly four-digit `err` code, diagnostics append `_cf_CODE`. The raw header, exception, URL, body, Location, and Content-Type are never logged. Missing `Cf-Resized` fails closed instead of silently passing through an unresized original.

Cloudflare documents that AVIF can fall back to WebP/JPEG: the Worker now accepts that output only when the client accepts its actual format, and sends the actual Content-Type. An AVIF-only request still fails closed if Cloudflare emits another format.

Transform options (width, scale-down, quality, avif/webp/jpeg, metadata:none) are documented options. `Cf-Resized` diagnostics distinguish invalid options (9401), origin denial (9408), and exhausted transformation quota (9422), among other failures. Do not enable paid features to resolve a diagnostic without separate authorization. See [Cloudflare troubleshooting](https://developers.cloudflare.com/images/reference/troubleshooting/) and [format options](https://developers.cloudflare.com/images/optimization/features/#format--f).

Redirect scope: the Worker never follows returned redirects or exposes their Location. Cloudflare's managed resizing service can follow origin redirects internally, as its documentation states; JavaScript redirect mode cannot enforce a policy inside that service. Only validated gallery-specific Flickr origins are submitted, and the source URL is never user-controlled.
