# Olga Zinoveva — personal site

A personal website built with TypeScript and Vite, served by Cloudflare Workers. It includes Home (`/`), About (`/about`), and Photography (`/photography`) pages. The photography gallery shows up to 50 recent public Flickr photos with responsive images and a keyboard-accessible lightbox.

Gallery metadata begins loading during idle time on the initial page. On unconstrained connections, up to four responsive previews (at most 640 pixels wide) warm sequentially after page load and are reused when opening Photography. Metadata and these previews remain in memory only until the server metadata expires; full-size lightbox images load on demand and fade in after decoding. Successful photo responses can also be cached by the browser until the server metadata expires, for up to one hour.

The navigation and animated background persist between pages. The background supports reduced-motion preferences and a pause/play control. Fonts, the portrait, and background assets are served locally.

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

Without this secret, the local site loads but the photo API returns `503`. Actual image transformations require Cloudflare's deployed service. See the [Worker README](backend/photos-worker/README.md) for backend-only development, API details, and diagnostics.

`VITE_PHOTOS_API_URL` optionally sets a different photo API endpoint when starting Vite or building the site. Leave it unset for the combined deployment, which uses `/api/photos`. Never put secrets in `VITE_*` variables or frontend files.

## Source layout

| Path | Contents |
| --- | --- |
| `index.html` | Persistent navigation, background, and page container. |
| `src/templates/` | Page and component HTML. |
| `src/main.ts` | Routing, page titles, navigation, and scroll restoration. |
| `src/about.ts` | About page rendering. |
| `src/gallery.ts` | Gallery rendering and lightbox interactions. |
| `src/photos.ts` | Photo API loading and response validation. |
| `src/background.ts` | Background playback and motion controls. |
| `src/style.css` | Site styles. |
| `public/` | Static assets copied into the build. |
| `backend/photos-worker/` | Flickr API and image transformation Worker. |
| `tests/` | Browser and combined Worker/static-assets routing tests. |

Vite imports HTML templates through `?raw` imports. TypeScript assigns dynamic photo text and attributes through DOM properties.

Run `npm run format` to format frontend sources and the Worker entry point. `npm run format:check` checks formatting without changing files.

## Test and build

Install Chromium for browser tests, then run the full check suite:

```sh
npx playwright install --with-deps chromium
npm run check
```

`check` runs formatting checks, frontend/backend TypeScript checks, backend tests, the production build, routing tests, and desktop/mobile browser tests. Tests use fixtures and require no Flickr credentials. To use an installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`.

Individual commands:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check frontend and Worker TypeScript. |
| `npm test` | Run Worker tests. |
| `npm run test:assets` | Test combined routing; requires a build. |
| `npm run test:browser` | Run browser tests; requires a build. |
| `npm run build` | Build the frontend into `dist/`. |
| `npm run preview` | Preview the frontend build; does not run the photo API. |
| `npm run worker:check` | Validate the combined deployment with a dry-run; requires a build. |

## Deployment

The root `wrangler.jsonc` configures the `ozinoveva-photos` Worker with the frontend build in `dist/`. `/api/*` requests reach the Worker; other routes use static assets with a single-page-app fallback.

### Manual production publish

The **CI checks** workflow validates pushes to `master` and `feat/**`, and pull requests targeting `master`. It does not publish.

The **production publish** workflow manually deploys the combined Worker and frontend. It runs only on `master` in `SlyCaptainFlint/blazor-simple-site`, and both the original initiator and any rerun initiator must be `SlyCaptainFlint`.

Configure **Settings → Environments → production** in GitHub:

1. Set `SlyCaptainFlint` as the only required reviewer. Leave **Prevent self-review** off and disable administrator bypass.
2. Allow deployments from the `master` branch only, with no allowed tags.
3. Add environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs **Account → Workers Scripts → Edit**, scoped to the deployment account.

Configure `FLICKR_API_KEY` as a secret on the Cloudflare Worker. The publishing workflow does not set or rotate it. The account must support Cloudflare image transformations.

Once the workflow exists on the default branch, open **Actions → production publish → Run workflow**, select `master`, and approve the production environment deployment. The workflow checks out the selected commit, runs validation and a deployment dry-run, then publishes. Pushes and merges do not trigger publishing.
