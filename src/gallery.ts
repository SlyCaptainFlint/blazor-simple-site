import galleryHtml from './templates/gallery.html?raw';
import galleryErrorHtml from './templates/gallery-error.html?raw';
import photoCardHtml from './templates/photo-card.html?raw';
import lightboxHtml from './templates/lightbox.html?raw';
import { createTemplateElement } from './template';
import { loadPhotos, srcset, type Photo } from './photos';

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
      const button = card.querySelector<HTMLButtonElement>('.photo-open')!;
      button.setAttribute(
        'aria-label',
        `Open ${photo.title || `photograph ${index + 1}`}`,
      );
      const image = card.querySelector<HTMLImageElement>('img')!;
      image.alt = photo.title || `Photograph ${index + 1} by Olga Zinoveva`;
      image.width = photo.width;
      image.height = photo.height;
      image.loading = index < 4 ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.sizes =
        '(max-width: 640px) calc((100vw - 24px) / 2), (max-width: 960px) calc((100vw - 48px) / 2), (max-width: 1280px) calc((100vw - 48px) / 3), 350px';
      image.srcset = srcset(photo);
      image.src = photo.variants[0].url;
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
      grid.append(card);
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
  const wrap = dialog.querySelector<HTMLElement>('.lightbox-image-wrap')!;
  const status = dialog.querySelector<HTMLElement>('.lightbox-status')!;
  let index = 0;
  let trigger: HTMLElement | null = null;
  let previousOverflow = '';
  function show(next: number): void {
    index = (next + photos.length) % photos.length;
    const photo = photos[index];
    dialog.setAttribute('aria-label', photo.title || 'Untitled photograph');
    status.textContent = 'Loading photograph…';
    const image = document.createElement('img');
    image.alt = photo.title || 'Untitled photograph';
    image.width = photo.width;
    image.height = photo.height;
    image.addEventListener(
      'load',
      () => {
        if (wrap.contains(image)) {
          status.textContent = '';
        }
      },
      { signal },
    );
    image.addEventListener(
      'error',
      () => {
        if (wrap.contains(image)) {
          status.textContent =
            'This photograph could not load. Try the next photograph.';
          image.hidden = true;
        }
      },
      { signal },
    );
    image.sizes = '(max-width: 640px) calc(100vw - 32px), 90vw';
    image.srcset = srcset(photo);
    image.src = photo.variants.at(-1)!.url;
    wrap.replaceChildren(image);
  }
  function restore(): void {
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
