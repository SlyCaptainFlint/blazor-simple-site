import { expect, test } from '@playwright/test';

test('breathing follows brightness, has a dark rest, and covers most of the field', async ({
  page,
}) => {
  await page.route('**/api/photos/renditions-v1', (route) =>
    route.fulfill({ json: { photos: [] } }),
  );
  await page.clock.install({ time: new Date('2026-10-05T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-05T00:00:01Z'));
  await page.goto('/about');
  const svg = page.locator('#background-hexagons');
  let previous: { opacity: number; scale: number }[] = [];
  const coverage: number[] = [];
  let smallest = 1;
  let largest = 0;
  for (let sample = 0; sample < 16; sample++) {
    await page.clock.fastForward(650);
    await page.clock.runFor(40);
    const cells = await svg.locator('polygon').evaluateAll((nodes) =>
      nodes.map((element) => {
        const node = element as SVGPolygonElement;
        const position = node.transform.baseVal.getItem(0).matrix;
        return {
          opacity: Number(node.getAttribute('opacity')),
          scale: node.transform.baseVal.getItem(1).matrix.a,
          inViewport:
            position.e >= 0 &&
            position.e < innerWidth &&
            position.f >= 0 &&
            position.f < innerHeight,
        };
      }),
    );
    const visibleField = cells.filter((cell) => cell.inViewport);
    const active = visibleField.filter((cell) => cell.opacity > 0);
    coverage.push(active.length / visibleField.length);
    // Natural islands can merge and separate; coverage is approximate over time.
    expect(active.length / visibleField.length).toBeGreaterThan(0.5);
    expect(active.length / visibleField.length).toBeLessThan(0.9);
    expect(
      cells.some((cell) => cell.opacity === 0 && cell.scale <= 0.802),
    ).toBe(true);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      smallest = Math.min(smallest, cell.scale);
      largest = Math.max(largest, cell.scale);
      expect(cell.scale).toBeGreaterThanOrEqual(0.799);
      expect(cell.scale).toBeLessThanOrEqual(1.001);
      if (previous.length) {
        // A cell must grow with its own brightness and contract as it fades.
        expect(
          (cell.opacity - previous[i].opacity) *
            (cell.scale - previous[i].scale),
        ).toBeGreaterThanOrEqual(-0.00002);
      }
    }
    previous = cells;
  }
  const meanCoverage =
    coverage.reduce((total, value) => total + value, 0) / coverage.length;
  expect(meanCoverage).toBeGreaterThan(0.6);
  expect(meanCoverage).toBeLessThan(0.8);
  expect(smallest).toBeLessThanOrEqual(0.802);
  expect(largest).toBeGreaterThan(0.98);
});

test('intro is an inverted V that travels upward before ambient islands', async ({
  page,
}) => {
  await page.route('**/api/photos/renditions-v1', (route) =>
    route.fulfill({ json: { photos: [] } }),
  );
  await page.clock.install({ time: new Date('2026-10-05T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-05T00:00:01Z'));
  await page.goto('/');
  const sample = () =>
    page.locator('polygon').evaluateAll((nodes) => {
      const cells = nodes
        .map((element) => {
          const node = element as SVGPolygonElement;
          const position = node.transform.baseVal.getItem(0).matrix;
          return {
            x: position.e / innerWidth,
            y: position.f / innerHeight,
            light: Number(node.getAttribute('opacity')),
          };
        })
        .filter(
          (cell) => cell.x >= 0 && cell.x <= 1 && cell.y >= 0 && cell.y <= 1,
        );
      const meanY = (values: typeof cells) =>
        values.reduce((sum, cell) => sum + cell.y * cell.light, 0) /
        values.reduce((sum, cell) => sum + cell.light, 0);
      return {
        center: meanY(cells.filter((cell) => Math.abs(cell.x - 0.5) < 0.15)),
        arms: meanY(cells.filter((cell) => Math.abs(cell.x - 0.5) > 0.3)),
      };
    });
  await page.clock.runFor(950);
  const first = await sample();
  expect(first.arms - first.center).toBeGreaterThan(0.12);
  await page.clock.runFor(500);
  const later = await sample();
  expect(first.center - later.center).toBeGreaterThan(0.15);
  await expect(page.locator('#background-hexagons')).toHaveAttribute(
    'data-phase',
    'intro',
  );
  await page.clock.runFor(1400);
  await expect(page.locator('#background-hexagons')).toHaveAttribute(
    'data-phase',
    'ambient',
  );
});
