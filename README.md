# Olga Zinoveva — personal site

A personal website built with TypeScript and Vite, served by Cloudflare Workers. It includes Home (`/`), About (`/about`), and Photography (`/photography`) pages. The photography gallery shows up to 50 recent public Flickr photos with responsive images and a keyboard-accessible lightbox.

Gallery metadata begins loading during idle time on the initial page. On unconstrained connections, up to four responsive Flickr previews warm sequentially after page load and are reused when opening Photography. Metadata and these previews remain in memory only until the server metadata expires; full-size lightbox images load on demand and fade in after decoding. Loads longer than 180 ms show a blurred preview with a shimmer (static with reduced motion). Images fit the viewport with overlay navigation controls. Successful photo responses can also be cached by the browser until the server metadata expires, for up to one hour.

Gallery and lightbox images use available Flickr renditions through the same-origin Worker. The browser chooses a size using actual image dimensions and display density; square previews account for cropping. The Worker streams the selected image without resizing or recompression. See the [Worker measurement instructions](backend/photos-worker/README.md#measure-image-request-latency) for timing headers and logs.

The navigation and animated background persist between pages. The background supports reduced-motion preferences and a pause/play control. Fonts and the portrait are served locally. The programmatic SVG background uses one shell-owned active-time clock: a soft-edged, 2.6-second inverted-V sweep from bottom to top after initial page/font layout settles, followed by irregular breathing purple islands. Hexagons grow with brightness and contract to 80% size as they fade; inactive hexagons are transparent. Overlapping islands keep most of the field transitioning without repeating bands. Route navigation never restarts it. Geometry adapts on resize, opacity updates are capped at 30 Hz, and hidden tabs stop requesting frames. Reduced motion starts with a static field; the existing play control allows an explicit opt-in.

## Requirements and setup

Use Node.js 24. Install frontend and Worker dependencies from the repository root:

```sh
npm ci
npm ci --prefix backend/photos-worker
```

## Run locally

```sh
npm run dev
```

Open the local URL printed by Vite. Requests to `/api` are proxied to `https://ozinoveva-photos.ozinoveva.workers.dev`. The gallery requires access to that service; the frontend does not need a Flickr key.

To run the frontend and Worker together locally:

```sh
npm run build
npm run worker:dev
```

Open `http://127.0.0.1:8787`. For local Flickr access, create an ignored `.dev.vars` file in the repository root containing:

```dotenv
FLICKR_API_KEY=your_flickr_api_key
```

Without this secret, the local site loads but the photo API returns `503`. See the [Worker README](backend/photos-worker/README.md) for backend-only development, API details, and diagnostics.

`VITE_PHOTOS_API_URL` optionally sets a different photo API endpoint when starting Vite or building the site. Leave it unset for the combined deployment, which uses `/api/photos/renditions-v1`. Never put secrets in `VITE_*` variables or frontend files.

## Source layout

| Path | Contents |
| --- | --- |
| `index.html` | Persistent navigation, background, and page container. |
| `src/templates/` | Page and component HTML. |
| `src/main.ts` | Routing, page titles, navigation, and scroll restoration. |
| `src/about.ts` | About page rendering. |
| `src/gallery.ts` | Gallery rendering and lightbox interactions. |
| `src/photos.ts` | Photo API loading and response validation. |
| `src/background.ts` | Responsive SVG hexagon field and shared animation clock. |
| `src/style.css` | Site styles. |
| `public/` | Static assets copied into the build. |
| `backend/photos-worker/` | Flickr metadata and image proxy Worker. |
| `tests/` | Browser and combined Worker/static-assets routing tests. |

Vite imports HTML templates through `?raw` imports. TypeScript assigns dynamic photo text and attributes through DOM properties.

Run `npm run format` to format frontend sources and the Worker entry point. `npm run format:check` checks formatting without changing files.

## Test and build

Install Chromium for browser tests, then run the full check suite:

```sh
npx playwright install --with-deps chromium
npm run check
```

`check` runs formatting checks, frontend/backend TypeScript checks, backend tests, the production build, deployment configuration and routing tests for production and staging, and desktop/mobile browser tests. Tests use fixtures and require no Flickr credentials. To use an installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`.

Individual commands:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check frontend and Worker TypeScript. |
| `npm test` | Run Worker tests. |
| `npm run test:assets` | Check deployment targets and combined routing in production and staging; requires a build. |
| `npm run test:browser` | Run browser tests; requires a build. |
| `npm run build` | Build the frontend into `dist/`. |
| `npm run preview` | Preview the frontend build; does not run the photo API. |
| `npm run worker:check` | Validate the combined deployment with a dry-run; requires a build. |
| `npm run worker:check:staging` | Validate the staging deployment with a dry-run; requires a build. |
| `npm run worker:dev:staging` | Run the staging configuration locally on port 8787; requires a build. |

## Deployment

The root `wrangler.jsonc` configures the `ozinoveva-photos` Worker with the frontend build in `dist/`. `/api/*` requests reach the Worker; other routes use static assets with a single-page-app fallback.

### Manual production publish

The **CI checks** workflow validates pushes to `master` and `feat/**`, and pull requests targeting `master`. It does not publish.

The **production publish** workflow manually deploys the combined Worker and frontend. It runs only on `master` in `SlyCaptainFlint/blazor-simple-site`, and both the original initiator and any rerun initiator must be `SlyCaptainFlint`.

Configure **Settings → Environments → production** in GitHub:

1. Set `SlyCaptainFlint` as the only required reviewer. Leave **Prevent self-review** off and disable administrator bypass.
2. Allow deployments from the `master` branch only, with no allowed tags.
3. Add environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs **Account → Workers Scripts → Edit**, scoped to the deployment account.

Configure `FLICKR_API_KEY` as a secret on the Cloudflare Worker. The publishing workflow does not set or rotate it.

Once the workflow exists on the default branch, open **Actions → production publish → Run workflow**, select `master`, and approve the production environment deployment. The workflow checks out the selected commit, runs validation and a deployment dry-run, then publishes. Pushes and merges do not trigger publishing.

### Manual staging publish

The **staging publish** workflow deploys the combined site and API to the separate `ozinoveva-photos-staging` Worker using the root configuration's `staging` environment. It has no custom-domain routes. In the current Cloudflare account, its URL after publishing is `https://ozinoveva-photos-staging.ozinoveva.workers.dev`. Each publish replaces the shared staging site.

Configure **Settings → Environments → staging** in GitHub before the first run:

1. Set `SlyCaptainFlint` as the only required reviewer. Leave **Prevent self-review** off and disable administrator bypass.
2. Allow only the `master` and `feat/*` branches, with no allowed tags. GitHub environment branch patterns do not match `/` with `*`; add a matching rule if using nested feature branch names.
3. Add environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Use a dedicated token with **Account → Workers Scripts → Edit**, scoped to the deployment account. This permission applies to Workers across that account; it is not restricted to the staging Worker name. Keep these secrets in the environment rather than at repository scope.

After this workflow has been merged into the default branch, open **Actions → staging publish → Run workflow** and select `master` or a trusted `feat/**` branch containing the workflow and staging configuration. Only `SlyCaptainFlint` may initiate or rerun it. Review the selected commit before approving the staging environment: the selected branch supplies the code and workflow that will run. The workflow validates the site, tests both routing configurations, performs a staging dry-run, and publishes that commit. It does not run automatically on pushes or pull requests.

After the first staging publish, set the `FLICKR_API_KEY` secret on **`ozinoveva-photos-staging`** in Cloudflare. Secrets are configured separately for each Worker; the production secret is not inherited. The same Flickr key may be used, sharing its quota. Until the secret is configured, the staging site loads but the photo API returns `503`. The workflow does not set or rotate this secret. Subsequent publishes retain it.

Photo requests use `/api/photos/renditions-v1` on the staging origin. The workflow explicitly sets that build-time endpoint. Staging is publicly accessible at its `workers.dev` URL unless Cloudflare Access is configured separately.

For local testing, run `npm run build` followed by `npm run worker:dev:staging`. Put a local Flickr key in ignored `.dev.vars.staging` at the repository root; Wrangler falls back to `.dev.vars` if the staging file is absent. Use the root `wrangler.jsonc` with `--env staging` for staging commands; the backend-only configuration targets the production Worker.
