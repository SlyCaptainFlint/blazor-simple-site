import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('real workerd runtime serves gallery and rendition requests without unsupported redirect mode', async () => {
  const bundle = await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    write: false,
  });
  const calls: { url: string; redirect: string }[] = [];
  let imageStatus = 200;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: '2026-10-04',
      script: bundle.outputFiles[0].text,
      bindings: { FLICKR_API_KEY: 'fixture-only-not-a-secret' },
      outboundService: async (request: any) => {
        calls.push({ url: request.url, redirect: request.redirect });
        if (request.url.startsWith('https://www.flickr.com/services/rest/'))
          return Response.json({
            stat: 'ok',
            photos: {
              photo: [
                {
                  id: '123',
                  owner: '93665003@N05',
                  ispublic: 1,
                  title: 'Fixture',
                  url_k: 'https://live.staticflickr.com/1/123_abcdef_k.jpg',
                  width_k: 2048,
                  height_k: 1365,
                },
              ],
            },
          });
        assert.equal(
          request.url,
          'https://live.staticflickr.com/1/123_abcdef_k.jpg',
        );
        return new Response('fixture image response', {
          status: imageStatus,
          headers: {
            'Content-Type': 'image/jpeg',
            ...(imageStatus === 302
              ? { Location: 'https://untrusted.invalid' }
              : {}),
          },
        });
      },
    }),
  );
  try {
    const metadata = await mf.dispatchFetch(
      'https://fixture.test/api/photos/renditions-v1',
    );
    assert.equal(metadata.status, 200);
    const rendition = await mf.dispatchFetch(
      'https://fixture.test/api/photos/renditions-v1/123/k.jpg',
    );
    assert.equal(rendition.status, 200);
    assert.equal(await rendition.text(), 'fixture image response');
    assert.equal(rendition.headers.get('Content-Type'), 'image/jpeg');
    const direct = await mf.dispatchFetch(
      'https://fixture.test/api/photos/source-v1/123.jpg',
    );
    assert.equal(direct.status, 200);
    assert.equal(await direct.text(), 'fixture image response');
    assert.equal(direct.headers.get('X-Photo-Mode'), 'legacy');
    assert.match(
      direct.headers.get('Server-Timing')!,
      /gallery;dur=\d+, upstream;dur=\d+/,
    );
    imageStatus = 302;
    const rejected = await mf.dispatchFetch(
      'https://fixture.test/api/photos/123/320.jpg',
    );
    assert.equal(rejected.status, 502);
    assert.equal(rejected.headers.get('X-Photo-Diagnostic'), 'image_http_302');
    assert.equal(
      calls.some((call) => call.url.startsWith('https://untrusted.invalid')),
      false,
    );
  } finally {
    await mf.dispose();
  }
});
