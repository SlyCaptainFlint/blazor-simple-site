import { test, expect, type Page } from '@playwright/test';
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
);
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
    route.fulfill({ json: { limit: 50, photos } }),
  );
  await page.route(/\/api\/photos\/\d+\/\d+\.jpg$/, (route) =>
    route.fulfill({ body: image, contentType: 'image/png' }),
  );
}
test.beforeEach(async ({ page }) => {
  await fixture(page);
});
test('direct routes have titles, navigation state, and no horizontal overflow', async ({
  page,
}) => {
  for (const [path, title] of [
    ['/', 'Olga Zinoveva'],
    ['/about', 'About · Olga Zinoveva'],
    ['/photography', 'Photography · Olga Zinoveva'],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('nav [aria-current="page"]')).toHaveAttribute(
      'href',
      path,
    );
    await expect(page.locator('h1')).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await expect(page.locator('.photo-open')).toHaveCount(50);
});
test('navigation/back/forward preserves the same SVG and uninterrupted timeline', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.mp4')) requests.push(r.url());
  });
  await page.goto('/');
  await expect
    .poll(() =>
      page.locator('#background-hexagons').getAttribute('data-running'),
    )
    .toBe('true');
  let elapsed = Number(
    await page.locator('#background-hexagons').getAttribute('data-elapsed'),
  );
  await page.evaluate(() => {
    (window as any).originalBackground = document.querySelector(
      '#background-hexagons',
    );
    (window as any).originalDocument = document;
  });
  for (let i = 0; i < 3; i++) {
    for (const [label, path] of [
      ['About', '/about'],
      ['Photography', '/photography'],
      ['Main', '/'],
    ]) {
      await page
        .getByRole('navigation')
        .getByRole('link', { name: label, exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(path === '/' ? '/$' : `${path}$`),
      );
      expect(
        await page.evaluate(
          () =>
            document.querySelector('#background-hexagons') ===
              (window as any).originalBackground &&
            document === (window as any).originalDocument,
        ),
      ).toBe(true);
      await expect(page.locator('#background-hexagons')).toHaveAttribute(
        'data-running',
        'true',
      );
      const next = Number(
        await page.locator('#background-hexagons').getAttribute('data-elapsed'),
      );
      expect(next).toBeGreaterThanOrEqual(elapsed);
      elapsed = next;
    }
  }
  await page.goBack();
  await expect(page).toHaveTitle('Photography · Olga Zinoveva');
  await page.goForward();
  await expect(page).toHaveTitle('Olga Zinoveva');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page.locator('#background-hexagons')).toHaveAttribute(
    'data-phase',
    'ambient',
  );
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await page.getByRole('link', { name: 'Main', exact: true }).click();
  await expect(page.locator('#background-hexagons')).toHaveAttribute(
    'data-phase',
    'ambient',
  );
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
test('accessible lightbox wraps with arrows, traps focus, closes with Escape and restores focus', async ({
  page,
}) => {
  await page.goto('/photography');
  const first = page.locator('.photo-open').first();
  await first.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Close photograph', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog).toHaveAccessibleName('Photograph 50');
  await page.keyboard.press('ArrowRight');
  await expect(dialog).toHaveAccessibleName('Photograph 1');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Photograph 2');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => !!document.activeElement?.closest('dialog')),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(first).toBeFocused();
  expect(await page.locator('body').evaluate((el) => el.style.overflow)).toBe(
    '',
  );
});
test('phone resize, failed image and repeated gallery navigation remain usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/photography');
  await expect(page.locator('.photo-open')).toHaveCount(50);
  const width = await page
    .locator('.photo-open')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(100);
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect
    .poll(() =>
      page
        .locator('.photo-open')
        .first()
        .evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBeGreaterThan(width);
  await page.route(/\/api\/photos\/1000\/\d+\.jpg$/, (route) =>
    route.fulfill({ status: 502 }),
  );
  await page.reload();
  await expect(page.locator('.photo-open').first()).toHaveClass(/image-failed/);
  await page.locator('.photo-open').first().click();
  await expect(page.locator('.lightbox-status')).toContainText(
    'could not load',
  );
  await page
    .getByRole('button', { name: 'Next photograph', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Photograph 2');
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('link', { name: 'About', exact: true }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    await page.getByRole('link', { name: 'Photography', exact: true }).click();
    await expect(page.locator('dialog')).toHaveCount(1);
  }
});
test('empty, failure and retry states plus unknown route', async ({ page }) => {
  await page.route('**/api/photos', (route) =>
    route.fulfill({ status: 503, json: { error: 'service_not_configured' } }),
  );
  await page.goto('/photography');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.route('**/api/photos', (route) =>
    route.fulfill({ json: { photos: [] } }),
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('status')).toContainText('No public photographs');
  await page.goto('/missing');
  await expect(page).toHaveTitle('Page not found · Olga Zinoveva');
  await page.getByRole('link', { name: 'Return home' }).click();
  await expect(page).toHaveTitle('Olga Zinoveva');
});
test('reduced motion is static and permits explicit playback', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const videos: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('.mp4')) videos.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'About', exact: true }).click();
  expect(videos).toEqual([]);
  await expect(
    page.getByRole('button', { name: 'Play background animation' }),
  ).toBeVisible();
  const svg = page.locator('#background-hexagons');
  await expect(svg).toHaveAttribute('data-phase', 'ambient');
  const elapsed = await svg.getAttribute('data-elapsed');
  await page.waitForTimeout(150);
  await expect(svg).toHaveAttribute('data-elapsed', elapsed!);
  await page.getByRole('button', { name: 'Play background animation' }).click();
  await expect(svg).toHaveAttribute('data-running', 'true');
  await expect
    .poll(async () => Number(await svg.getAttribute('data-elapsed')))
    .toBeGreaterThan(Number(elapsed));
  expect(videos).toEqual([]);
});
test('leaving a pending gallery cancels its work and leaves no stale dialog', async ({
  page,
}) => {
  await page.route('**/api/photos', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: { photos } }).catch(() => {});
  });
  await page.goto('/photography');
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await page.waitForTimeout(650);
  await expect(page).toHaveTitle('About · Olga Zinoveva');
  await expect(page.locator('.gallery')).toHaveCount(0);
  await expect(page.locator('dialog')).toHaveCount(0);
});
test('history restores gallery scroll and route changes clean up an open modal', async ({
  page,
}) => {
  await page.goto('/photography');
  await expect(page.locator('.photo-open')).toHaveCount(50);
  await page.evaluate(() => scrollTo(0, 500));
  await expect
    .poll(() => page.evaluate(() => history.state.site.scroll))
    .toBe(500);
  await page.evaluate(() =>
    document.querySelector<HTMLAnchorElement>('nav a[href="/about"]')!.click(),
  );
  await expect(page).toHaveTitle('About · Olga Zinoveva');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.goBack();
  await expect(page.locator('.photo-open')).toHaveCount(50);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(500);
  await page.locator('.photo-open').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goForward();
  await expect(page).toHaveTitle('About · Olga Zinoveva');
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(await page.locator('body').evaluate((el) => el.style.overflow)).toBe(
    '',
  );
});

test('photos have no corner links and lightbox shows only image and navigation controls', async ({
  page,
}) => {
  await page.goto('/photography');
  await expect(page.locator('.photo-open')).toHaveCount(50);
  await expect(
    page.locator('.gallery a, .photo-source, .gallery-credit'),
  ).toHaveCount(0);
  await page.locator('.photo-open').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Photograph 1');
  await expect(dialog.locator('img')).toHaveAttribute('alt', 'Photograph 1');
  await expect(
    dialog.locator('figcaption, a, .lightbox-count, .lightbox-source'),
  ).toHaveCount(0);
  await expect(page.locator('.lightbox-status')).toHaveText('');
  await expect(dialog).toHaveText('× ‹ ›');
});

test('SVG resize and pause preserve active time and direct routes skip the intro', async ({
  page,
}) => {
  await page.goto('/about');
  const svg = page.locator('#background-hexagons');
  await expect(svg).toHaveAttribute('data-phase', 'ambient');
  await page
    .getByRole('button', { name: 'Pause background animation' })
    .click();
  const elapsed = await svg.getAttribute('data-elapsed');
  for (const [width, height] of [
    [320, 700],
    [1920, 1080],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(svg).toHaveAttribute('viewBox', `0 0 ${width} ${height}`);
    expect(await svg.locator('polygon').count()).toBeLessThan(300);
    await expect(svg).toHaveAttribute('data-elapsed', elapsed!);
  }
  await page.waitForTimeout(150);
  await expect(svg).toHaveAttribute('data-elapsed', elapsed!);
  await page.getByRole('button', { name: 'Play background animation' }).click();
  await expect
    .poll(async () => Number(await svg.getAttribute('data-elapsed')))
    .toBeGreaterThan(Number(elapsed));
});
test('hidden tabs suspend the clock without resetting the intro', async ({
  page,
}) => {
  await page.goto('/');
  const svg = page.locator('#background-hexagons');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(svg).toHaveAttribute('data-running', 'false');
  const elapsed = await svg.getAttribute('data-elapsed');
  await page.waitForTimeout(150);
  await expect(svg).toHaveAttribute('data-elapsed', elapsed!);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(svg).toHaveAttribute('data-running', 'true');
  await expect
    .poll(async () => Number(await svg.getAttribute('data-elapsed')))
    .toBeGreaterThan(Number(elapsed));
});
