import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const image = readFileSync(new URL('./fixtures/photo.png', import.meta.url));
const photos = Array.from({ length: 50 }, (_, i) => ({
  id: String(1000 + i),
  title: `Photograph ${i + 1}`,
  width: 2048,
  height: 1365,
  variants: [320, 640, 960, 1440, 1920].map((width) => ({
    width,
    url: `/api/photos/${1000 + i}/${width}.jpg`,
  })),
}));

async function fixture(page: Page) {
  await page.route('**/api/photos', (route) =>
    route.fulfill({ json: { fetchedAt: new Date().toISOString(), photos } }),
  );
  await page.route(/\/api\/photos\/\d+\/\d+\.jpg$/, (route) =>
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
    if (path === '/api/photos') metadata++;
    if (/\/api\/photos\/\d+\/\d+\.jpg$/.test(path)) requests.push(path);
  });
  let active = 0;
  let peak = 0;
  await page.route(/\/api\/photos\/\d+\/\d+\.jpg$/, async (route) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      body: image,
      contentType: 'image/png',
      headers: { 'Cache-Control': 'private, max-age=3600, must-revalidate' },
    });
    active--;
  });
  await page.goto('/');
  await expect.poll(() => requests.length).toBe(4);
  await expect.poll(() => active).toBe(0);
  expect(peak).toBe(1);
  expect(requests.every((path) => /\/(320|640)\.jpg$/.test(path))).toBe(true);
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
  await page.route('**/api/photos', async (route) => {
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
  await page.addInitScript(() => {
    const now = Date.now.bind(Date);
    (window as any).timeOffset = 0;
    Date.now = () => now() + (window as any).timeOffset;
  });
  let count = 0;
  await page.route('**/api/photos', (route) => {
    count++;
    return route.fulfill({
      json: {
        fetchedAt: new Date(Date.now() - 3599000).toISOString(),
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
  await page.route(/\/api\/photos\/1000\/\d+\.jpg$/, (route) =>
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
  await page.goto('/photography');
  await expect(page.locator('.photo-open')).toHaveCount(50);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/photos\/1000\/\d+\.jpg$/, async (route) => {
    await gate;
    await route.fulfill({
      body: image,
      contentType: 'image/png',
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  });
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
