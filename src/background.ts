const NS = 'http://www.w3.org/2000/svg';
const INTRO_MS = 2600;
const FRAME_MS = 1000 / 30;
const AMBIENT_SPEED = 2.4;
interface Cell {
  node: SVGPolygonElement;
  x: number;
  y: number;
  tone: number;
  opacity: string;
  position: string;
  scale: string;
}
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

/** One shell-owned renderer and active-time clock, independent of the router. */
export function startBackground(): void {
  const svg = document.querySelector<SVGSVGElement>('#background-hexagons')!;
  const field = svg.querySelector<SVGGElement>('#hexagon-field')!;
  const toggle = document.querySelector<HTMLButtonElement>('#motion-toggle')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  let elapsed = reduced.matches || location.pathname !== '/' ? INTRO_MS : 0;
  let previous = 0;
  let nextPaint = 0;
  let frame = 0;
  let cells: Cell[] = [];

  function paint(): void {
    // Keep the intro unchanged; ambient time runs 20% faster than the 2× loop.
    const time =
      (Math.min(elapsed, INTRO_MS) +
        Math.max(0, elapsed - INTRO_MS) * AMBIENT_SPEED) /
      1000;
    const reveal = elapsed / INTRO_MS;
    // Broad pools retain the original purple/lavender clustered palette.
    const pools = [
      [
        0.24 + 0.14 * Math.sin(time * 0.18),
        0.68 + 0.18 * Math.cos(time * 0.13),
      ],
      [
        0.76 + 0.13 * Math.cos(time * 0.14),
        0.63 + 0.23 * Math.sin(time * 0.16),
      ],
      [
        0.52 + 0.28 * Math.sin(time * 0.09),
        0.18 + 0.12 * Math.cos(time * 0.12),
      ],
    ];
    for (const cell of cells) {
      let light = 0;
      for (const [x, y] of pools) {
        const distance =
          ((cell.x - x) / 0.35) ** 2 + ((cell.y - y) / 0.45) ** 2;
        light = Math.max(light, Math.max(0, 1 - distance));
      }
      const sweep = smooth(
        (reveal * 1.65 - (1 - cell.y) * 0.65 - Math.abs(cell.x - 0.5) * 0.3) /
          0.3,
      );
      // Two waves across the viewport keep roughly three quarters of the field
      // transitioning. The quiet part of each cycle is truly transparent.
      const phase =
        cell.x * Math.PI * 4 +
        cell.y * Math.PI * 2 +
        time * 0.32 +
        Math.sin(cell.y * Math.PI * 2 + time * 0.12) * 0.65;
      const breath = smooth((Math.cos(phase) + 0.7) / 1.7);
      const brightness = breath * (0.65 + light * 0.35) * sweep;
      const opacity = (brightness * (0.58 + cell.tone * 0.22)).toFixed(2);
      // Size and light share one envelope: 80% when dark, 100% at full light.
      const scale = (0.8 + brightness * 0.2).toFixed(3);
      if (opacity !== cell.opacity) {
        cell.node.setAttribute('opacity', opacity);
        cell.opacity = opacity;
      }
      if (scale !== cell.scale) {
        cell.node.setAttribute('transform', `${cell.position} scale(${scale})`);
        cell.scale = scale;
      }
    }
    svg.dataset.elapsed = String(Math.round(elapsed));
    svg.dataset.phase = elapsed < INTRO_MS ? 'intro' : 'ambient';
  }

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Bound geometry to 280 polygons, with readable hexagons on narrow screens.
    let radius = Math.max(38, width / 32, Math.sqrt((width * height) / 620));
    while (
      (Math.ceil(width / (Math.sqrt(3) * radius)) + 1) *
        (Math.ceil(height / (radius * 1.5)) + 1) >
      280
    ) {
      radius *= 1.05;
    }
    const stepX = Math.sqrt(3) * radius;
    const stepY = radius * 1.5;
    const points = Array.from({ length: 6 }, (_, i) => {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      return `${(Math.cos(angle) * radius * 0.91).toFixed(2)},${(Math.sin(angle) * radius * 0.91).toFixed(2)}`;
    }).join(' ');
    const fragment = document.createDocumentFragment();
    cells = [];
    for (let row = 0; row <= Math.ceil(height / stepY); row++) {
      for (let col = 0; col <= Math.ceil(width / stepX); col++) {
        const x = col * stepX + (row % 2 ? stepX / 2 : 0);
        const y = row * stepY;
        const tone = ((col * 17 + row * 31) % 19) / 18;
        const node = document.createElementNS(NS, 'polygon');
        node.setAttribute('points', points);
        const position = `translate(${x.toFixed(2)} ${y.toFixed(2)})`;
        node.setAttribute(
          'fill',
          tone > 0.55 ? '#c88cce' : tone > 0.25 ? '#85349f' : '#5809a0',
        );
        fragment.append(node);
        cells.push({
          node,
          x: x / width,
          y: y / height,
          tone,
          position,
          opacity: '',
          scale: '',
        });
      }
    }
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    field.replaceChildren(fragment);
    paint();
  }

  function tick(now: number): void {
    frame = 0;
    if (previous) elapsed += now - previous;
    previous = now;
    // Keep deadlines anchored instead of resetting them to a rounded rAF time.
    // A small tolerance accommodates the browser's sub-millisecond timestamps.
    if (now + 0.5 >= nextPaint) {
      paint();
      nextPaint +=
        Math.max(1, Math.floor((now - nextPaint) / FRAME_MS) + 1) * FRAME_MS;
    }
    frame = requestAnimationFrame(tick);
  }

  function sync(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    // Publish the current active time even between throttled paints, so a
    // paused resize renders precisely the same frozen instant.
    paint();
    const running = !paused && !document.hidden;
    svg.dataset.running = String(running);
    toggle.textContent = paused ? 'Play animation' : 'Pause animation';
    toggle.setAttribute(
      'aria-label',
      `${paused ? 'Play' : 'Pause'} background animation`,
    );
    if (running) frame = requestAnimationFrame(tick);
  }

  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    paused = !paused;
    sync();
  });
  reduced.addEventListener('change', () => {
    paused = reduced.matches;
    if (paused) {
      elapsed = Math.max(elapsed, INTRO_MS);
      paint();
    }
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  // pagehide/pageshow also preserve the clock through the browser's page cache.
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frame);
    previous = 0;
  });
  window.addEventListener('pageshow', sync);
  window.addEventListener('resize', resize, { passive: true });
  resize();
  sync();
}
