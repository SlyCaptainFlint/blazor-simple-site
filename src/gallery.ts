import { loadPhotos, srcset, type Photo } from './photos';

export async function renderGallery(main: HTMLElement, signal: AbortSignal): Promise<void> {
  main.innerHTML = `<section class="photography-page" aria-labelledby="page-title">
    <h1 id="page-title" class="sr-only">Photography</h1>
    <div class="gallery-status" role="status">Loading photographs…</div>
    <div class="gallery"></div>
    <p class="gallery-credit">Photography by Olga Zinoveva · <a href="https://www.flickr.com/photos/93665003@N05/" target="_blank" rel="noopener noreferrer">View on Flickr ↗</a></p>
  </section>`;
  const status = main.querySelector<HTMLElement>('.gallery-status')!;
  const grid = main.querySelector<HTMLElement>('.gallery')!;
  try {
    const photos = await loadPhotos(signal);
    if (signal.aborted) return;
    if (!photos.length) { status.textContent = 'No public photographs are available right now.'; return; }
    status.hidden = true;
    const lightbox = createLightbox(photos, signal);
    photos.forEach((photo, index) => {
      const card = document.createElement('div'); card.className = 'photo-card';
      const button = document.createElement('button'); button.className = 'photo-open'; button.type = 'button';
      button.setAttribute('aria-label', `Open ${photo.title || `photograph ${index + 1}`}`);
      const image = document.createElement('img');
      image.alt = photo.title || `Photograph ${index + 1} by Olga Zinoveva`;
      image.width = photo.width; image.height = photo.height;
      image.loading = index < 4 ? 'eager' : 'lazy'; image.decoding = 'async';
      image.sizes = '(max-width: 640px) calc((100vw - 24px) / 2), (max-width: 960px) calc((100vw - 48px) / 2), (max-width: 1280px) calc((100vw - 48px) / 3), 350px';
      image.srcset = srcset(photo); image.src = photo.variants[0].url;
      image.addEventListener('load', () => button.classList.add('loaded'), {signal});
      image.addEventListener('error', () => { button.classList.add('image-failed'); image.hidden = true; button.title = 'Preview unavailable. Open photograph to retry.'; }, {signal});
      const fallback = document.createElement('span'); fallback.className = 'photo-fallback'; fallback.textContent = 'Preview unavailable';
      button.append(image, fallback);
      button.addEventListener('click', () => lightbox.open(index, button), {signal});
      const link = document.createElement('a'); link.className = 'photo-source'; link.href = photo.pageUrl;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Flickr ↗';
      link.setAttribute('aria-label', `${photo.title || `Photograph ${index + 1}`} on Flickr`);
      card.append(button, link); grid.append(card);
    });
  } catch {
    if (signal.aborted) return;
    status.textContent = 'Photography is temporarily unavailable. Please try again.';
    const retry = document.createElement('button'); retry.className = 'text-button'; retry.type = 'button'; retry.textContent = 'Try again';
    retry.addEventListener('click', () => { void renderGallery(main, signal); }, {once:true,signal});
    status.append(document.createElement('br'), retry);
  }
}
function createLightbox(photos: Photo[], signal: AbortSignal): { open: (index: number, trigger: HTMLElement) => void } {
  const dialog = document.createElement('dialog'); dialog.className = 'lightbox'; dialog.setAttribute('aria-labelledby','lightbox-title');
  dialog.innerHTML = `<div class="lightbox-shell">
    <button class="lightbox-close icon-button" type="button" aria-label="Close photograph">×</button>
    <button class="lightbox-prev icon-button" type="button" aria-label="Previous photograph">‹</button>
    <figure><div class="lightbox-image-wrap"></div><figcaption><span id="lightbox-title"></span><span class="lightbox-count"></span><a class="lightbox-source" target="_blank" rel="noopener noreferrer">View on Flickr ↗</a></figcaption></figure>
    <button class="lightbox-next icon-button" type="button" aria-label="Next photograph">›</button>
    <p class="lightbox-status" role="status"></p>
  </div>`;
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
    dialog.querySelector('#lightbox-title')!.textContent = photo.title || 'Untitled photograph';
    dialog.querySelector('.lightbox-count')!.textContent = `${index + 1} / ${photos.length}`;
    dialog.querySelector<HTMLAnchorElement>('.lightbox-source')!.href = photo.pageUrl;
    status.textContent = 'Loading photograph…';
    const image = document.createElement('img'); image.alt = photo.title || 'Untitled photograph';
    image.width = photo.width; image.height = photo.height;
    image.addEventListener('load', () => { if (wrap.contains(image)) status.textContent = ''; }, {signal});
    image.addEventListener('error', () => { if (wrap.contains(image)) { status.textContent = 'This photograph could not load. Try the next photograph or view it on Flickr.'; image.hidden = true; } }, {signal});
    image.sizes = '(max-width: 640px) calc(100vw - 32px), 90vw';
    image.srcset = srcset(photo); image.src = photo.variants.at(-1)!.url;
    wrap.replaceChildren(image);
  }
  function restore(): void {
    document.body.style.overflow = previousOverflow;
    if (!signal.aborted && trigger?.isConnected) trigger.focus({preventScroll:true});
  }
  close.addEventListener('click', () => dialog.close(), {signal});
  dialog.addEventListener('close', restore, {signal});
  dialog.addEventListener('click', (event) => { if (event.target === dialog || event.target === dialog.querySelector('.lightbox-shell')) dialog.close(); }, {signal});
  dialog.querySelector('.lightbox-prev')!.addEventListener('click', () => show(index - 1), {signal});
  dialog.querySelector('.lightbox-next')!.addEventListener('click', () => show(index + 1), {signal});
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
  }, {signal});
  signal.addEventListener('abort', () => {
    if (dialog.open) { dialog.close(); restore(); }
    dialog.remove();
  }, {once:true});
  return {open(next, origin) {
    index = next; trigger = origin; previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; show(index); dialog.showModal(); close.focus();
  }};
}
