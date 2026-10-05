import { expect, test } from '@playwright/test';

test('breathing follows brightness, has a dark rest, and covers most of the field', async ({
  page,
}) => {
  await page.route('**/api/photos/renditions-v1', (route) =>
    route.fulfill({ json: { photos: [] } }),
  );
  await page.clock.install();
  await page.goto('/about');
  const svg = page.locator('#background-hexagons');
  let previous: { opacity: number; scale: number }[] = [];
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
    expect(active.length / visibleField.length).toBeGreaterThan(0.6);
    expect(active.length / visibleField.length).toBeLessThan(0.8);
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
  expect(smallest).toBeLessThanOrEqual(0.802);
  expect(largest).toBeGreaterThan(0.98);
});
