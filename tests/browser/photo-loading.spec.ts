import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, type Page } from '@playwright/test';

const image = readFileSync(new URL('./fixtures/photo.png', import.meta.url));
const photos = Array.from({ length: 50 }, (_, i) => ({
  id: String(1000 + i),
  title: `Photograph ${i + 1}`,
  width: 2048,
  height: 1365,
  variants: [
    ['n', 320],
    ['z', 640],
    ['l', 1024],
    ['h', 1600],
    ['k', 2048],
  ].map(([size, width]) => ({
    width: Number(width),
    height: Math.round((Number(width) * 1365) / 2048),
    url: `/api/photos/renditions-v1/${1000 + i}/${size}.jpg`,
  })),
}));

async function fixture(page: Page) {
  await page.route('**/api/photos/renditions-v1', (route) =>
    route.fulfill({ json: { fetchedAt: new Date().toISOString(), photos } }),
  );
  await page.route(
    /\/api\/photos\/renditions-v1\/\d+\/[smnzclhk]\.jpg$/,
    (route) =>
      route.fulfill({
        body: image,
        contentType: 'image/png',
        headers: { 'Cache-Control': 'private, max-age=3600, must-revalidate' },
      }),
  );
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: false, effectiveType: '4g' },
    }),
  );
}
test.beforeEach(async ({ page }) => fixture(page));

test('idle warmup is bounded and reuses preloaded preview nodes across routes', async ({
  page,
}) => {
  const requests: string[] = [];
  let metadata = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/photos/renditions-v1') metadata++;
    if (/\/api\/photos\/renditions-v1\/\d+\/[smnzclhk]\.jpg$/.test(path))
      requests.push(path);
  });
  let active = 0;
  let peak = 0;
  await page.route(
    /\/api\/photos\/renditions-v1\/\d+\/[smnzclhk]\.jpg$/,
    async (route) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({
        body: image,
        contentType: 'image/png',
        headers: { 'Cache-Control': 'private, max-age=3600, must-revalidate' },
      });
      active--;
    },
  );
  await page.goto('/');
  await expect.poll(() => requests.length).toBe(4);
  await expect.poll(() => active).toBe(0);
  expect(peak).toBe(1);
  expect(requests.every((path) => path.includes('/renditions-v1/'))).toBe(true);
  await page.waitForTimeout(200);
  expect(requests.length).toBe(4);
  await page.getByRole('link', { name: 'Photography', exact: true }).click();
  await expect(page.locator('.photo-open')).toHaveCount(50);
  await expect
    .poll(() =>
      page
        .locator('.photo-open img')
        .first()
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    )
    .toBe(true);
  await page.evaluate(() => {
    (window as any).firstPreview = document.querySelector('.photo-open img');
  });
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await page.getByRole('link', { name: 'Photography', exact: true }).click();
  await expect(page.locator('.photo-open')).toHaveCount(50);
  expect(
    await page.evaluate(
      () =>
        (window as any).firstPreview ===
        document.querySelector('.photo-open img'),
    ),
  ).toBe(true);
  expect(metadata).toBe(1);
  for (const id of [1000, 1001, 1002, 1003])
    expect(requests.filter((path) => path.includes(`/${id}/`))).toHaveLength(1);
});

test('metadata preload is shared with navigation while still pending', async ({
  page,
}) => {
  let count = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/photos/renditions-v1', async (route) => {
    count++;
    await gate;
    await route.fulfill({ json: { photos } });
  });
  await page.goto('/about');
  await expect.poll(() => count).toBe(1);
  await page.getByRole('link', { name: 'Photography', exact: true }).click();
  await expect(page.locator('.gallery-status')).toContainText('Loading');
  release();
  await expect(page.locator('.photo-open')).toHaveCount(50);
  expect(count).toBe(1);
});

for (const connection of [
  { saveData: true, effectiveType: '4g' },
  { saveData: false, effectiveType: '3g' },
]) {
  test(`no speculative downloads on constrained connection ${JSON.stringify(connection)}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) =>
        Object.defineProperty(navigator, 'connection', {
          configurable: true,
          value,
        }),
      connection,
    );
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/photos')) requests.push(request.url());
    });
    await page.goto('/');
    await page.waitForTimeout(2300);
    expect(requests).toHaveLength(0);
    await page.getByRole('link', { name: 'Photography', exact: true }).click();
    await expect(page.locator('.photo-open')).toHaveCount(50);
  });
}

test('client cache expires with server fetchedAt, not an additional hour', async ({
  page,
}) => {
  const initialTime = Date.now();
  await page.addInitScript((initialTime) => {
    (window as any).timeOffset = 0;
    Date.now = () => initialTime + (window as any).timeOffset;
  }, initialTime);
  let count = 0;
  await page.route('**/api/photos/renditions-v1', (route) => {
    count++;
    return route.fulfill({
      json: {
        fetchedAt: new Date(
          count === 1 ? initialTime - 3599000 : initialTime + 2000,
        ).toISOString(),
        photos: count === 1 ? photos : photos.slice(1),
      },
    });
  });
  await page.goto('/photography');
  await expect(page.locator('.photo-open')).toHaveCount(50);
  await page.evaluate(() => {
    (window as any).timeOffset = 2000;
  });
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await page.getByRole('link', { name: 'Photography', exact: true }).click();
  await expect(page.locator('.photo-open')).toHaveCount(49);
  expect(count).toBe(2);
  await expect(page.locator('.photo-open').first()).toHaveAccessibleName(
    'Open Photograph 2',
  );
});

async function gateDecoding(page: Page) {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    (window as any).decoders = [];
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (this.classList.contains('lightbox-image'))
        await new Promise<void>((resolve) =>
          (window as any).decoders.push(resolve),
        );
    };
  });
}

test('lightbox stays hidden through decode and fades in only when ready', async ({
  page,
}) => {
  await gateDecoding(page);
  await page.goto('/photography');
  await page.locator('.photo-open').first().click();
  await expect
    .poll(() => page.evaluate(() => (window as any).decoders.length))
    .toBe(1);
  await expect(page.locator('.lightbox-loading')).toBeVisible();
  await expect(page.locator('.lightbox-image-wrap')).toHaveAttribute(
    'aria-busy',
    'true',
  );
  await expect(page.locator('.lightbox-image')).toHaveCSS(
    'visibility',
    'hidden',
  );
  await page.evaluate(() => (window as any).decoders[0]());
  await expect(page.locator('.lightbox-image')).toHaveClass(/is-ready/);
  await expect(page.locator('.lightbox-image')).toHaveCSS('opacity', '1');
  await expect(page.locator('.lightbox-status')).toBeEmpty();
  await expect(page.locator('.lightbox-loading')).toBeHidden();
});

test('late decode after next, close, or route change cannot flash a stale image', async ({
  page,
}) => {
  await gateDecoding(page);
  await page.goto('/photography');
  await page.locator('.photo-open').first().click();
  await expect
    .poll(() => page.evaluate(() => (window as any).decoders.length))
    .toBe(1);
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.evaluate(() => (window as any).decoders.length))
    .toBe(2);
  await page.evaluate(() => (window as any).decoders[0]());
  await expect(page.locator('.lightbox-image')).toHaveAttribute(
    'alt',
    'Photograph 2',
  );
  await expect(page.locator('.lightbox-image')).not.toHaveClass(/is-ready/);
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as any).decoders[1]());
  await expect(page.locator('.lightbox-image')).toHaveCount(0);
  await page.locator('.photo-open').first().click();
  await expect
    .poll(() => page.evaluate(() => (window as any).decoders.length))
    .toBe(3);
  await page.evaluate(() =>
    document.querySelector<HTMLAnchorElement>('nav a[href="/about"]')!.click(),
  );
  await page.evaluate(() => (window as any).decoders[2]());
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page).toHaveTitle('About · Olga Zinoveva');
});

test('lightbox errors offer retry; reduced motion reveals without animation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let fail = true;
  await page.route(
    /\/api\/photos\/renditions-v1\/1000\/[smnzclhk]\.jpg$/,
    (route) =>
      fail
        ? route.fulfill({ status: 502 })
        : route.fulfill({ body: image, contentType: 'image/png' }),
  );
  await page.goto('/photography');
  await page.locator('.photo-open').first().click();
  await expect(page.locator('.lightbox-retry')).toBeVisible();
  await expect(page.locator('.lightbox-loading')).toBeHidden();
  await expect(page.locator('.lightbox-image')).toHaveCSS(
    'visibility',
    'hidden',
  );
  fail = false;
  await page.locator('.lightbox-retry').click();
  await expect(page.locator('.lightbox-image')).toHaveClass(/is-ready/);
  await expect(page.locator('.lightbox-image')).toHaveCSS(
    'transition-duration',
    '0s',
  );
});

test('slow image response remains concealed until loaded, including a repeated open', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/api\/photos\/renditions-v1\/1000\/[smnzclhk]\.jpg$/,
    async (route) => {
      await gate;
      await route.fulfill({
        body: image,
        contentType: 'image/png',
        headers: { 'Cache-Control': 'public, max-age=60' },
      });
    },
  );
  // The gated eager preview may hold the load event until release().
  await page.goto('/photography', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.photo-open')).toHaveCount(50);
  await page.locator('.photo-open').first().click();
  await expect(page.locator('.lightbox-loading')).toBeVisible();
  await expect(page.locator('.lightbox-image')).toHaveCSS(
    'visibility',
    'hidden',
  );
  release();
  await expect(page.locator('.lightbox-image')).toHaveClass(/is-ready/);
  await page.keyboard.press('Escape');
  await page.locator('.photo-open').first().click();
  await expect(page.locator('.lightbox-image')).toHaveClass(/is-ready/);
});

test('delayed shimmer uses the existing preview and stops with reduced motion', async ({
  page,
}) => {
  await gateDecoding(page);
  await page.goto('/photography');
  const thumbnail = page.locator('.photo-open img').first();
  await expect
    .poll(() =>
      thumbnail.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const source = await thumbnail.evaluate(
    (image: HTMLImageElement) => image.currentSrc,
  );
  await page.locator('.photo-open').first().click();
  await expect(page.locator('.lightbox-loading')).toBeVisible();
  expect(
    await page
      .locator('.lightbox-preview')
      .evaluate((node) => getComputedStyle(node).backgroundImage),
  ).toContain(source);
  await expect(page.locator('.lightbox-preview')).toHaveCSS(
    'filter',
    'blur(12px)',
  );
  expect(
    await page
      .locator('.lightbox-loading')
      .evaluate((node) => getComputedStyle(node, '::after').animationName),
  ).toBe('photo-shimmer');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('.lightbox-loading')
      .evaluate((node) => getComputedStyle(node, '::after').animationName),
  ).toBe('none');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await expect(page.locator('.lightbox-loading')).toBeHidden();
});

test('portrait and landscape photos maximize space with controls over the image', async ({
  page,
}) => {
  const shapedPhotos = [
    { ...photos[0], width: 640, height: 426 },
    { ...photos[1], width: 426, height: 640 },
  ];
  await page.route('**/api/photos/renditions-v1', (route) =>
    route.fulfill({ json: { photos: shapedPhotos } }),
  );
  await page.route(
    /\/api\/photos\/renditions-v1\/1001\/[smnzclhk]\.jpg$/,
    (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="426" height="640"><rect width="426" height="640" fill="purple"/></svg>',
      }),
  );
  await page.goto('/photography');
  await page.locator('.photo-open').first().click();
  const viewport = page.viewportSize()!;
  for (const size of [
    viewport,
    { width: viewport.height, height: viewport.width },
  ]) {
    await page.setViewportSize(size);
    for (const [index, photo] of shapedPhotos.entries()) {
      if (index)
        await page.getByRole('button', { name: 'Next photograph' }).click();
      await expect(page.locator('.lightbox-image')).toHaveClass(/is-ready/);
      const bounds = (await page.locator('.lightbox-image').boundingBox())!;
      const expectedWidth = Math.min(
        size.width - 16,
        ((size.height - 16) * photo.width) / photo.height,
      );
      expect(Math.abs(bounds.width - expectedWidth)).toBeLessThan(2);
      expect(
        Math.abs(bounds.width / bounds.height - photo.width / photo.height),
      ).toBeLessThan(0.01);
      for (const control of [
        '.lightbox-close',
        '.lightbox-prev',
        '.lightbox-next',
      ]) {
        const button = (await page.locator(control).boundingBox())!;
        expect(button.width).toBeGreaterThanOrEqual(44);
        expect(button.height).toBeGreaterThanOrEqual(44);
        expect(button.x).toBeGreaterThanOrEqual(bounds.x);
        expect(button.x + button.width).toBeLessThanOrEqual(
          bounds.x + bounds.width + 1,
        );
        expect(button.y).toBeGreaterThanOrEqual(bounds.y);
        expect(button.y + button.height).toBeLessThanOrEqual(
          bounds.y + bounds.height + 1,
        );
      }
    }
    await page.getByRole('button', { name: 'Previous photograph' }).click();
  }
});

test('a real browser cache hit does not flash the loading affordance', async ({
  page,
}) => {
  // Playwright routing disables HTTP caching, so serve this case over real HTTP.
  await page.unrouteAll();
  const requests = new Map<string, number>();
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path === '/api/photos/renditions-v1') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ photos: photos.slice(0, 1) }));
    } else if (path.startsWith('/api/photos/')) {
      requests.set(path, (requests.get(path) ?? 0) + 1);
      response.setHeader('Content-Type', 'image/png');
      response.setHeader('Cache-Control', 'private, max-age=3600');
      response.end(image);
    } else {
      const asset = path.startsWith('/assets/') ? path : '/index.html';
      const type = asset.endsWith('.js')
        ? 'text/javascript'
        : asset.endsWith('.css')
          ? 'text/css'
          : asset.endsWith('.woff2')
            ? 'font/woff2'
            : asset.endsWith('.woff')
              ? 'font/woff'
              : 'text/html';
      response.setHeader('Content-Type', type);
      response.end(
        readFileSync(new URL(`../../dist${asset}`, import.meta.url)),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    await page.goto(`http://127.0.0.1:${address.port}/photography`);
    await page.locator('.photo-open').first().click();
    await expect(page.locator('.lightbox-image')).toHaveClass(/is-ready/);
    const source = await page
      .locator('.lightbox-image')
      .evaluate(
        (image: HTMLImageElement) => new URL(image.currentSrc).pathname,
      );
    const initialRequests = requests.get(source);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      (window as any).loaderFlashed = false;
      const loader = document.querySelector<HTMLElement>('.lightbox-loading')!;
      new MutationObserver((records) => {
        if (
          records.some(
            (record) =>
              record.attributeName === 'hidden' && record.oldValue === null,
          )
        ) {
          (window as any).loaderFlashed = true;
        }
        if (!loader.hidden) (window as any).loaderFlashed = true;
      }).observe(loader, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['hidden'],
      });
    });
    for (let i = 0; i < 3; i++) {
      await page.locator('.photo-open').first().click();
      await expect(page.locator('.lightbox-image')).toHaveClass(/is-ready/);
      await page.waitForTimeout(250);
      await page.keyboard.press('Escape');
    }
    expect(requests.get(source)).toBe(initialRequests);
    expect(await page.evaluate(() => (window as any).loaderFlashed)).toBe(
      false,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('a single available portrait rendition serves preview and lightbox with its actual width', async ({
  page,
}) => {
  const variant = {
    url: '/api/photos/renditions-v1/1000/z.jpg',
    width: 426,
    height: 640,
  };
  await page.route('**/api/photos/renditions-v1', (route) =>
    route.fulfill({
      json: {
        photos: [
          { ...photos[0], width: 426, height: 640, variants: [variant] },
        ],
      },
    }),
  );
  await page.goto('/photography');
  await expect(page.locator('.photo-open img')).toHaveAttribute(
    'srcset',
    `${variant.url} 426w`,
  );
  await page.locator('.photo-open').click();
  await expect(page.locator('.lightbox-image')).toHaveClass(/is-ready/);
  await expect(page.locator('.lightbox-image')).toHaveAttribute(
    'srcset',
    `${variant.url} 426w`,
  );
  expect(
    await page
      .locator('.lightbox-image')
      .evaluate((img: HTMLImageElement) => new URL(img.currentSrc).pathname),
  ).toBe(variant.url);
});

test('rendition metadata rejects unapproved image URLs', async ({ page }) => {
  for (const url of [
    'https://evil.example/api/photos/renditions-v1/1000/z.jpg',
    'http://user:password@127.0.0.1:4173/api/photos/renditions-v1/1000/z.jpg',
    '/api/photos/renditions-v1/999/z.jpg',
    '/api/photos/renditions-v1/1000/z.jpg?url=evil',
    '/api/photos/renditions-v1/1000/o.jpg',
  ]) {
    await page.route('**/api/photos/renditions-v1', (route) =>
      route.fulfill({
        json: {
          photos: [
            { ...photos[0], variants: [{ width: 640, height: 426, url }] },
          ],
        },
      }),
    );
    await page.goto('/photography');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('.photo-open')).toHaveCount(0);
  }
});

test('square previews request enough landscape pixels for the crop and device density', async ({
  page,
}) => {
  await page.goto('/photography');
  const img = page.locator('.photo-open img').first();
  await expect
    .poll(() => img.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const measured = await img.evaluate((image: HTMLImageElement) => ({
    path: new URL(image.currentSrc).pathname,
    width: image.getBoundingClientRect().width,
    dpr: devicePixelRatio,
  }));
  const selected = photos[0].variants.find((v) => v.url === measured.path)!;
  const target =
    (measured.width * measured.dpr * photos[0].width) / photos[0].height;
  expect(selected.width).toBeGreaterThanOrEqual(Math.min(target, 2048));
});

test('a short gallery supplies enough pixels when auto-fit expands its columns', async ({
  page,
}) => {
  await page.route('**/api/photos/renditions-v1', (route) =>
    route.fulfill({ json: { photos: photos.slice(0, 2) } }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/photography');
  const img = page.locator('.photo-open img').first();
  await expect
    .poll(() => img.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const measured = await img.evaluate((image: HTMLImageElement) => ({
    path: new URL(image.currentSrc).pathname,
    width: image.getBoundingClientRect().width,
    dpr: devicePixelRatio,
  }));
  const selected = photos[0].variants.find((v) => v.url === measured.path)!;
  expect(selected.width).toBeGreaterThanOrEqual(
    Math.min(
      (measured.width * measured.dpr * photos[0].width) / photos[0].height,
      2048,
    ),
  );
});
