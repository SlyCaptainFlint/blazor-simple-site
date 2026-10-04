import { defineConfig } from 'vite';
export default defineConfig({
  // Read-only development proxy; no Flickr secret is ever needed by the frontend.
  server: { proxy: { '/api': 'https://ozinoveva-photos.ozinoveva.workers.dev' } },
});
