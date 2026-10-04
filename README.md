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

After review, approval, and verification of the existing encrypted secret, use the manual **production publish** workflow described below. It deploys with the **root** config and overwrites the live Worker's code/assets. A separate DNS/domain cutover decision is still needed for the real site. Preserve the previous Worker version and S3 deployment for rollback. Do not retire Lambda/S3 until the cutover is verified. Do not activate any paid plan as an implicit migration step.

### Manual production publish

`CI checks` (`.github/workflows/verify.yml`) validates pushes and pull requests without deployment credentials. `production publish` (`.github/workflows/production-publish.yml`) runs only through **Actions → production publish → Run workflow**, after the workflow is merged into the default branch. Select `master`. Both the original initiator and any rerun initiator must be `SlyCaptainFlint`; other branches, accounts, and forks skip the publish job. The workflow checks out the exact selected commit, reruns all checks and a deployment dry-run, then publishes the combined Worker and static assets. Pushes and merges do not trigger publishing.

Before the first publish, configure **Settings → Environments → production** (these settings are not created by this YAML):

1. Set `SlyCaptainFlint` as the only required reviewer. Leave **Prevent self-review** off so the owner can approve their own manual run. Disable administrator bypass of protection rules.
2. Restrict deployment branches to the selected branch `master`, with no allowed tags.
3. Add environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Use a Cloudflare token with Workers deployment permissions scoped to the intended account. Keep these credentials out of repository/organization secrets so other jobs cannot access them without environment approval.
4. Verify that the existing Worker has its encrypted `FLICKR_API_KEY`; do not copy it into GitHub or frontend configuration. This workflow does not set or rotate it.

Public visitors cannot manually dispatch this repository's workflows; GitHub requires write access. The actor guard is an additional check, not a substitute for environment protection: someone who can edit workflows could remove it. Keep repository administration trusted and protect `master` and workflow changes if granting others write access. No GitHub environment rules or secrets are configured by this change, and the publish workflow has not been run.

See [backend setup, safety and diagnostics](backend/photos-worker/README.md) for the photo contract, current source selection, cache privacy window, resizing and secure secret configuration.
