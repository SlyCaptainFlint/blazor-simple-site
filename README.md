# Olga Zinoveva — personal site

A vanilla TypeScript + Vite site with three client routes (`/`, `/about`, `/photography`) and a Flickr photo API on Cloudflare Workers. No frontend framework or .NET runtime is required.

The shell owns the existing purple-hexagon MP4 intro/background and navigation. Routing only replaces `<main>`, so the playing background survives repeated navigation and browser back/forward. The videos and fallback artwork are unchanged; a programmatic animation redesign is a separate decision. Fonts and portrait are served locally.

## Local development

Requires Node 24 (or a Vite-compatible Node >=22.12).

```sh
npm ci
npm ci --prefix backend/photos-worker
npm run dev
```

Vite's development proxy forwards `/api` read-only to the existing `ozinoveva-photos.ozinoveva.workers.dev` service. No Flickr credentials are used by the frontend. A network that cannot reach that host will show the gallery error/retry state. Never place a Flickr key in `VITE_*`, HTML, or checked-in files.

## Validation

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:assets
npm run test:browser
npm run worker:check
```

`npm run check` runs type checking, backend tests, production build, combined Worker routing tests and desktop/mobile browser tests. Tests use deterministic photo fixtures, without API credentials or production mutations. For an installed system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`.

The Worker-routing test verifies SPA direct navigation and that `/api/unknown` is JSON 404 even with navigation headers. Browser tests cover responsive layout down to 320px, history/scroll restoration, the same playing video node across routes, lightbox focus/keyboard behavior, reduced motion, errors/retry and cleanup during pending requests.

For a local combined Worker/static-assets preview:

```sh
npm run build
npm run worker:dev
```

Without a local `FLICKR_API_KEY` secret, this serves the site and returns a safe 503 for metadata. Fixtures in browser tests do not change the production application. `VITE_PHOTOS_API_URL` optionally selects a public endpoint for isolated review builds; the combined production build should omit it and use `/api/photos`.

## Deployment safety and cutover

**This migration is review-only until separately approved. Nothing in CI deploys.** The former `master` push → S3 workflow is removed in this branch because it would publish the wrong build after merging. Branch/PR pushes and merging this PR cannot deploy the migrated site. The currently deployed S3 objects, live photo Worker, Lambda, and DNS are untouched. No workflow has been globally disabled outside the PR.

The root `wrangler.jsonc` is the future combined deployment configuration: the same `ozinoveva-photos` Worker serves the API, with Vite's `dist/` as static assets. Assets are served first; `assets.run_worker_first` is **only** `["/api/*"]`. Other routes receive the SPA fallback. Do not use global Worker-first or an asset cache override on API paths. The existing backend-only configuration remains available in `backend/photos-worker`.

After review, approval, and verification of the existing encrypted secret, an authorized operator can deploy the reviewed build with the **root** config. This overwrites the live Worker's code/assets, so it is deliberately not an automatic script or workflow. A separate DNS/domain cutover decision is still needed for the real site. Preserve the previous Worker version and S3 deployment for rollback. Do not retire Lambda/S3 until the cutover is verified. Do not activate any paid plan as an implicit migration step.

See [backend setup, safety and diagnostics](backend/photos-worker/README.md) for the photo contract, current source selection, cache privacy window, resizing and secure secret configuration.

## Review screenshots

See [the review gallery](docs/review/README.md). Screenshots show the production build, not design mockups. The local environment's proxy denied access to workers.dev, so gallery screenshots use the site's existing public S3 photos as temporary browser test fixtures with generic titles. They demonstrate layout and interaction, **not** fresh Flickr data or production resizing. No test fixtures or screenshots are shipped in `dist/`.
