import galleryHtml from './templates/gallery.html?raw';
import galleryErrorHtml from './templates/gallery-error.html?raw';
import photoCardHtml from './templates/photo-card.html?raw';
import lightboxHtml from './templates/lightbox.html?raw';
import { createTemplateElement } from './template';
import { loadPhotos, previewImage, srcset, type Photo } from './photos';

export async function renderGallery(
  main: HTMLElement,
  signal: AbortSignal,
): Promise<void> {
  main.innerHTML = galleryHtml;
  const status = main.querySelector<HTMLElement>('.gallery-status')!;
  const grid = main.querySelector<HTMLElement>('.gallery')!;
  try {
    const photos = await loadPhotos(signal);
    if (signal.aborted) {
      return;
    }
    if (!photos.length) {
      status.textContent = 'No public photographs are available right now.';
      return;
    }
    status.hidden = true;
    const lightbox = createLightbox(photos, signal);
    photos.forEach((photo, index) => {
      const card = createTemplateElement<HTMLDivElement>(photoCardHtml);
      // Adopt the template into the live document before moving a warmed image.
      grid.append(card);
      const button = card.querySelector<HTMLButtonElement>('.photo-open')!;
      button.setAttribute(
        'aria-label',
        `Open ${photo.title || `photograph ${index + 1}`}`,
      );
      const image = previewImage(photo, index);
      image.fetchPriority = 'auto';
      card.querySelector('img')!.replaceWith(image);
      if (image.complete && image.naturalWidth) {
        button.classList.add('loaded');
      }
      image.addEventListener('load', () => button.classList.add('loaded'), {
        signal,
      });
      image.addEventListener(
        'error',
        () => {
          button.classList.add('image-failed');
          image.hidden = true;
          button.title = 'Preview unavailable. Open photograph to retry.';
        },
        { signal },
      );
      button.addEventListener('click', () => lightbox.open(index, button), {
        signal,
      });
    });
  } catch {
    if (signal.aborted) {
      return;
    }
    status.innerHTML = galleryErrorHtml;
    const retry = status.querySelector<HTMLButtonElement>('button')!;
    retry.addEventListener(
      'click',
      () => {
        void renderGallery(main, signal);
      },
      { once: true, signal },
    );
  }
}
function createLightbox(
  photos: Photo[],
  signal: AbortSignal,
): { open: (index: number, trigger: HTMLElement) => void } {
  const dialog = createTemplateElement<HTMLDialogElement>(lightboxHtml);
  document.body.append(dialog);
  const close = dialog.querySelector<HTMLButtonElement>('.lightbox-close')!;
  const stage = dialog.querySelector<HTMLElement>('.lightbox-stage')!;
  const wrap = dialog.querySelector<HTMLElement>('.lightbox-image-wrap')!;
  const status = dialog.querySelector<HTMLElement>('.lightbox-status')!;
  let index = 0;
  let trigger: HTMLElement | null = null;
  let previousOverflow = '';
  const loading = dialog.querySelector<HTMLElement>('.lightbox-loading')!;
  const preview = dialog.querySelector<HTMLElement>('.lightbox-preview')!;
  const retry = dialog.querySelector<HTMLButtonElement>('.lightbox-retry')!;
  let cancelImage = () => {};
  let sequence = 0;

  function show(next: number): void {
    cancelImage();
    const current = ++sequence;
    const controller = new AbortController();
    index = (next + photos.length) % photos.length;
    const photo = photos[index];
    dialog.setAttribute('aria-label', photo.title || 'Untitled photograph');
    wrap.setAttribute('aria-busy', 'true');
    status.textContent = '';
    status.classList.remove('is-loading');
    loading.hidden = true;
    const thumbnail =
      document.querySelectorAll<HTMLImageElement>('.photo-open img')[index];
    preview.style.backgroundImage =
      thumbnail?.complete && thumbnail.naturalWidth
        ? `url(${JSON.stringify(thumbnail.currentSrc)})`
        : '';
    // Fit the placeholder and final photo to the same aspect ratio.
    stage.style.aspectRatio = `${photo.width} / ${photo.height}`;
    stage.style.width = `min(100%, calc((100dvh - 16px) * ${photo.width / photo.height}))`;
    retry.hidden = true;
    const image = new Image();
    image.alt = photo.title || 'Untitled photograph';
    image.width = photo.width;
    image.height = photo.height;
    image.decoding = 'async';
    image.className = 'lightbox-image';
    let timeout: ReturnType<typeof setTimeout>;
    let loadingDelay: ReturnType<typeof setTimeout>;
    let finished = false;
    const active = () =>
      current === sequence && dialog.open && !signal.aborted && !finished;
    function fail(): void {
      if (!active()) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      clearTimeout(loadingDelay);
      wrap.setAttribute('aria-busy', 'false');
      loading.hidden = true;
      status.classList.remove('is-loading');
      retry.hidden = false;
      status.textContent =
        'This photograph could not load. Try again or choose another photograph.';
    }
    image.addEventListener(
      'load',
      () => {
        void image
          .decode()
          .then(() => {
            if (!active()) {
              return;
            }
            finished = true;
            clearTimeout(timeout);
            clearTimeout(loadingDelay);
            loading.hidden = true;
            status.classList.remove('is-loading');
            retry.hidden = true;
            status.textContent = '';
            wrap.setAttribute('aria-busy', 'false');
            image.classList.add('is-ready');
          })
          .catch(fail);
      },
      { signal: controller.signal, once: true },
    );
    image.addEventListener('error', fail, {
      signal: controller.signal,
      once: true,
    });
    image.sizes = `(max-aspect-ratio: ${photo.width}/${photo.height}) calc(100vw - 16px), calc((100dvh - 16px) * ${photo.width / photo.height})`;
    if (photo.fullSizeUrl) {
      image.src = photo.fullSizeUrl;
    } else {
      image.srcset = srcset(photo);
      image.src = photo.variants.at(-1)!.url;
    }
    wrap.replaceChildren(loading, image);
    // Fast cache hits and decodes finish before any loading affordance appears.
    loadingDelay = setTimeout(() => {
      if (active()) {
        loading.hidden = false;
        status.classList.add('is-loading');
        status.textContent = 'Loading photograph…';
      }
    }, 180);
    timeout = setTimeout(fail, 20000);
    cancelImage = () => {
      ++sequence;
      clearTimeout(timeout);
      clearTimeout(loadingDelay);
      controller.abort();
      image.removeAttribute('srcset');
      image.removeAttribute('src');
      loading.hidden = true;
      preview.style.backgroundImage = '';
      status.textContent = '';
      wrap.replaceChildren(loading);
    };
  }
  retry.addEventListener('click', () => show(index), { signal });
  function restore(): void {
    cancelImage();
    document.body.style.overflow = previousOverflow;
    if (!signal.aborted && trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
    }
  }
  close.addEventListener('click', () => dialog.close(), { signal });
  dialog.addEventListener('close', restore, { signal });
  dialog.addEventListener(
    'click',
    (event) => {
      if (
        event.target === dialog ||
        event.target === dialog.querySelector('.lightbox-shell')
      ) {
        dialog.close();
      }
    },
    { signal },
  );
  dialog
    .querySelector('.lightbox-prev')!
    .addEventListener('click', () => show(index - 1), { signal });
  dialog
    .querySelector('.lightbox-next')!
    .addEventListener('click', () => show(index + 1), { signal });
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        show(index + 1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        show(index - 1);
      }
    },
    { signal },
  );
  signal.addEventListener(
    'abort',
    () => {
      if (dialog.open) {
        dialog.close();
        restore();
      }
      cancelImage();
      dialog.remove();
    },
    { once: true },
  );
  return {
    open(next, origin) {
      index = next;
      trigger = origin;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      show(index);
      dialog.showModal();
      close.focus();
    },
  };
}
