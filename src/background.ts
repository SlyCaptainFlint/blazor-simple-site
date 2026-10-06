const NS = 'http://www.w3.org/2000/svg';
const INTRO_MS = 2600;
const FRAME_MS = 1000 / 30;
const AMBIENT_SPEED = 4.14;
const MOBILE_INTRO_SPEED = 1.3225;
interface Cell {
  node: SVGPolygonElement;
  x: number;
  y: number;
  tone: number;
  roughness: number;
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
  const mobile = matchMedia('(max-width: 640px)');
  let paused = reduced.matches;
  let elapsed = reduced.matches || location.pathname !== '/' ? INTRO_MS : 0;
  const startedWithIntro = elapsed < INTRO_MS;
  let ready = elapsed >= INTRO_MS;
  let previous = 0;
  let nextPaint = 0;
  let frame = 0;
  let cells: Cell[] = [];
  let paintedElapsed = -1;
  let introSlope = 0.9;
  let haloRadius = 0.235;
  let haloWeight = 0.16;

  function paint(force = false): void {
    if (!force && elapsed === paintedElapsed) return;
    paintedElapsed = elapsed;
    // Intro and ambient progression have separate rates; rAF cadence stays fixed.
    const time =
      (Math.min(elapsed, INTRO_MS) +
        Math.max(0, elapsed - INTRO_MS) * AMBIENT_SPEED) /
      1000;
    const reveal = clamp(elapsed / INTRO_MS);
    const ambientBlend = smooth((reveal - 0.75) / 0.25);
    // Preserve the reveal's lighting, then gently narrow the brightest core.
    // Direct routes and reduced motion use the softer idle profile immediately.
    const ambientEdge =
      startedWithIntro && !reduced.matches
        ? 0.8 + 0.06 * smooth((elapsed - INTRO_MS) / 600)
        : 0.86;
    // Strengthen the idle feather by 30% near the core. Keep the faint outer
    // edge unchanged so the islands retain their active footprint and count.
    const coreFeather =
      startedWithIntro && !reduced.matches
        ? 0.018 * smooth((elapsed - INTRO_MS) / 600)
        : 0.018;
    // Independently drifting, swelling ellipses overlap into irregular islands.
    // Different phases and axes avoid a repeating wave across the whole field.
    const islands =
      ambientBlend > 0
        ? [
            [0.18, 0.2, 0.24, 0.28, 0.13, 0.17, 0.2],
            [0.76, 0.32, 0.24, 0.23, 0.16, 0.11, 1.8],
            [0.43, 0.56, 0.24, 0.29, 0.12, 0.15, 3.4],
            [0.14, 0.84, 0.24, 0.27, 0.17, 0.13, 4.6],
            [0.82, 0.79, 0.25, 0.28, 0.11, 0.19, 5.8],
          ].map(([x, y, width, height, speedX, speedY, phase]) => {
            const angle = Math.sin(time * speedY + phase) * 0.5;
            const swell = 1 + Math.sin(time * 0.21 + phase) * 0.09;
            return {
              x: x + Math.sin(time * speedX + phase) * 0.09,
              y: y + Math.cos(time * speedY + phase) * 0.08,
              width: width * swell,
              height: height / swell,
              cos: Math.cos(angle),
              sin: Math.sin(angle),
            };
          })
        : [];
    for (const cell of cells) {
      let ambientLight = 0;
      for (const island of islands) {
        const dx = cell.x - island.x;
        const dy = cell.y - island.y;
        const distance =
          ((dx * island.cos + dy * island.sin) / island.width) ** 2 +
          ((dy * island.cos - dx * island.sin) / island.height) ** 2 +
          cell.roughness;
        ambientLight = Math.max(
          ambientLight,
          smooth(
            (1 - distance) /
              (ambientEdge + coreFeather * smooth((0.8 - distance) / 0.2)),
          ),
        );
      }
      // A narrow, rough inverted V travels upwards, then dissolves into islands.
      const ridge =
        1.15 -
        reveal * 1.7 +
        Math.abs(cell.x - 0.5) * introSlope +
        cell.roughness * 0.4;
      const offset = cell.y - ridge;
      const introCore = smooth(1 - (offset / 0.165) ** 2);
      const introHalo = smooth(1 - (offset / haloRadius) ** 2) * haloWeight;
      const introLight = introCore + introHalo * (1 - introCore);
      const brightness =
        introLight * (1 - ambientBlend) + ambientLight * ambientBlend;
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
    // Normalized x/y otherwise steepen the V on tall portrait screens. Cap its
    // mobile pixel-space arm slope at 0.7 (a 110-degree apex), retaining desktop.
    introSlope = mobile.matches ? Math.min(0.9, (width / height) * 0.7) : 0.9;
    haloRadius = mobile.matches ? 0.3 : 0.235;
    haloWeight = mobile.matches ? 0.2 : 0.16;
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
          roughness:
            (tone - 0.5) * 0.09 +
            Math.sin((x / width) * 17 + (y / height) * 11) *
              Math.sin((y / height) * 19 - (x / width) * 7) *
              0.08,
          position,
          opacity: '',
          scale: '',
        });
      }
    }
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    field.replaceChildren(fragment);
    paint(true);
  }

  function tick(now: number): void {
    frame = 0;
    if (previous) {
      const delta = now - previous;
      const introSpeed = mobile.matches ? MOBILE_INTRO_SPEED : 1;
      // Split a frame crossing the intro boundary so its ambient remainder
      // advances at the ambient rate, without inheriting the mobile intro rate.
      const introDelta = Math.min(
        delta,
        Math.max(0, INTRO_MS - elapsed) / introSpeed,
      );
      elapsed += introDelta * introSpeed + (delta - introDelta);
    }
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
    const running = ready && !paused && !document.hidden;
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
  // Do not spend intro time on initial page/font layout. The reveal still takes
  // INTRO_MS of desktop active time (32.25% faster on mobile) once the shell is ready.
  const settle = (): void => {
    void document.fonts.ready.then(() => {
      ready = true;
      sync();
    });
  };
  if (!ready) {
    if (document.readyState === 'complete') settle();
    else window.addEventListener('load', settle, { once: true });
  }
}
