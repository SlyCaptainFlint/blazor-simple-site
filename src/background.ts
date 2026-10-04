/** The shell owns these video nodes for its entire lifetime; route changes never touch them. */
export function startBackground(): void {
  const loop = document.querySelector<HTMLVideoElement>('#background-loop')!;
  const intro = document.querySelector<HTMLVideoElement>('#background-intro')!;
  const toggle = document.querySelector<HTMLButtonElement>('#motion-toggle')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const suffix = matchMedia('(max-width: 660px)').matches ? '_mobile' : '';
  let paused = reduced.matches;
  let started = false;
  let introDone = location.pathname !== '/';
  function label(): void {
    toggle.textContent = paused ? 'Play animation' : 'Pause animation';
    toggle.setAttribute(
      'aria-label',
      `${paused ? 'Play' : 'Pause'} background animation`,
    );
  }
  function hideIntro(): void {
    introDone = true;
    intro.classList.remove('is-playing');
    intro.pause();
  }
  async function play(): Promise<void> {
    if (!started) {
      started = true;
      loop.src = `/loop${suffix}.mp4`;
      if (!introDone) {
        intro.src = `/intro${suffix}.mp4`;
      }
    }
    try {
      if (!introDone) {
        await intro.play();
        intro.classList.add('is-playing');
      }
      await loop.play();
      loop.classList.add('is-playing');
    } catch {
      // Navigation stays available when autoplay is blocked. The button permits a user-initiated retry.
      loop.pause();
      intro.pause();
      paused = true;
    }
    label();
  }
  toggle.hidden = false;
  label();
  toggle.addEventListener('click', () => {
    paused = !paused;
    if (paused) {
      loop.pause();
      intro.pause();
      label();
    } else {
      void play();
    }
  });
  intro.addEventListener('ended', hideIntro);
  intro.addEventListener('error', hideIntro);
  loop.addEventListener('error', () => {
    loop.classList.remove('is-playing');
    paused = true;
    label();
  });
  reduced.addEventListener('change', () => {
    paused = reduced.matches;
    if (paused) {
      loop.pause();
      intro.pause();
      hideIntro();
      loop.classList.remove('is-playing');
      label();
    } else {
      void play();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      loop.pause();
      intro.pause();
    } else if (!paused) {
      void play();
    }
  });
  if (!paused) {
    void play();
  }
}
