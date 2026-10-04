import notFoundHtml from './templates/not-found.html?raw';
import homeHtml from './templates/home.html?raw';
import '@fontsource/poiret-one/latin-400.css';
import '@fontsource/cairo/latin-400.css';
import '@fontsource/cairo/latin-600.css';
import './style.css';
import { startBackground } from './background';
import { renderAbout } from './about';
import { renderGallery } from './gallery';
import { startPhotoPreload } from './photos';

interface Route {
  page: 'home' | 'about' | 'photography' | 'not-found';
  title: string;
}

const routes: Record<string, Route> = {
  '/': { page: 'home', title: 'Olga Zinoveva' },
  '/about': { page: 'about', title: 'About · Olga Zinoveva' },
  '/photography': { page: 'photography', title: 'Photography · Olga Zinoveva' },
};
const notFoundRoute: Route = {
  page: 'not-found',
  title: 'Page not found · Olga Zinoveva',
};

const main = document.querySelector<HTMLElement>('#main')!;
let view = new AbortController();
let currentPath = '';
interface RouteState {
  scroll: number;
}
if (!history.state?.site) {
  history.replaceState({ ...history.state, site: { scroll: 0 } }, '');
}
history.scrollRestoration = 'manual';
async function render(focus = false, scroll = 0): Promise<void> {
  view.abort();
  view = new AbortController();
  const signal = view.signal;
  currentPath = location.pathname.replace(/\/$/, '') || '/';
  const route = routes[currentPath] ?? notFoundRoute;
  const page = route.page;
  document.body.dataset.page = page;
  document.title = route.title;
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    'nav [data-route]',
  )) {
    if (link.pathname === currentPath) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
  if (page === 'about') {
    renderAbout(main);
  } else if (page === 'home') {
    main.innerHTML = homeHtml;
  } else if (page === 'not-found') {
    main.innerHTML = notFoundHtml;
  }
  // Start gallery synchronously so focus is on the new page while its data loads.
  const ready =
    page === 'photography' ? renderGallery(main, signal) : Promise.resolve();
  if (focus) {
    main.focus({ preventScroll: true });
  }
  window.scrollTo(0, scroll);
  await ready;
  if (!signal.aborted) {
    window.scrollTo(0, scroll);
  }
}
function saveScroll(): void {
  history.replaceState(
    { ...history.state, site: { scroll: window.scrollY } },
    '',
  );
}
document.addEventListener('click', (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const link = (event.target as Element).closest<HTMLAnchorElement>(
    'a[data-route]',
  );
  if (!link || link.target || link.hasAttribute('download')) {
    return;
  }
  const url = new URL(link.href);
  if (url.origin !== location.origin) {
    return;
  }
  event.preventDefault();
  if (url.pathname === currentPath) {
    return;
  }
  saveScroll();
  history.pushState({ site: { scroll: 0 } }, '', url.pathname + url.search);
  void render(true);
});
window.addEventListener('popstate', () => {
  const state = history.state?.site as RouteState | undefined;
  void render(true, state?.scroll || 0);
});
window.addEventListener('pagehide', saveScroll);
let scrollFrame = 0;
window.addEventListener(
  'scroll',
  () => {
    if (!scrollFrame) {
      scrollFrame = requestAnimationFrame(() => {
        saveScroll();
        scrollFrame = 0;
      });
    }
  },
  { passive: true },
);
startBackground();
void render(false, history.state?.site?.scroll || 0);

startPhotoPreload();
