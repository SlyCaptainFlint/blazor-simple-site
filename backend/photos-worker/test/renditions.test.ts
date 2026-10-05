import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, normalize } from '../src/index.js';

const source = 'https://live.staticflickr.com/1/123_abcdef_k.jpg';
const payload = {
  stat: 'ok',
  photos: {
    photo: [
      {
        id: '123',
        owner: '93665003@N05',
        ispublic: 1,
        title: 'Fixture',
        url_l: 'https://live.staticflickr.com/1/123_abcdef_b.jpg',
        width_l: 1024,
        height_l: 683,
        url_k: source,
        width_k: 2048,
        height_k: 1365,
      },
    ],
  },
};

function setup(
  options: {
    response?: () => Response;
    fetchFailure?: boolean;
    timeScale?: number;
  } = {},
) {
  let now = 100000;
  const timeScale = options.timeScale ?? 1;
  const calls: { url: string; init: any }[] = [];
  const timings: any[] = [];
  const cache = new Map<string, Response>();
  const handler = createHandler({
    now: () => now,
    reportTiming: (timing) => timings.push({ ...timing }),
    cache: {
      match: async (request: Request) => {
        now += 3 * timeScale;
        return cache.get(request.url)?.clone();
      },
      put: async (request: Request, response: Response) => {
        now += 4 * timeScale;
        cache.set(request.url, response.clone());
      },
    } as any,
    fetch: (async (url: string, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('services/rest')) {
        now += 40 * timeScale;
        return Response.json(payload);
      }
      now += 75 * timeScale;
      if (options.fetchFailure)
        throw new Error('secret key and private source URL');
      return (
        options.response?.() ??
        new Response('source bytes', {
          headers: { 'Content-Type': 'image/jpeg', 'CF-Cache-Status': 'HIT' },
        })
      );
    }) as any,
  });
  const get = (
    path = '/api/photos/renditions-v1/123/k.jpg',
    init?: RequestInit,
  ) =>
    handler(new Request(`https://site.example${path}`, init) as any, {
      FLICKR_API_KEY: 'private-key',
    });
  return { get, calls, timings };
}

test('rendition metadata advertises supplied URLs and real dimensions in one API request', async () => {
  const s = setup();
  const data: any = await (await s.get('/api/photos/renditions-v1')).json();
  assert.deepEqual(data.photos[0].variants, [
    {
      rendition: 'l',
      width: 1024,
      height: 683,
      url: 'https://site.example/api/photos/renditions-v1/123/l.jpg',
    },
    {
      rendition: 'k',
      width: 2048,
      height: 1365,
      url: 'https://site.example/api/photos/renditions-v1/123/k.jpg',
    },
  ]);
  assert.equal(data.photos[0].fullSizeUrl, undefined);
  assert.equal(data.photos[0].sources, undefined);
  assert.equal(
    new URL(s.calls[0].url).searchParams.get('extras'),
    'url_s,url_m,url_n,url_z,url_c,url_l,url_h,url_k',
  );
  const small = await s.get('/api/photos/renditions-v1/123/l.jpg');
  assert.equal(small.status, 200);
  assert.equal(s.calls[1].url, payload.photos.photo[0].url_l);
  assert.equal(s.calls[1].init.cf, undefined);
  assert.equal(
    (await s.get('/api/photos/renditions-v1/123/z.jpg')).status,
    404,
  );
  assert.equal(s.calls.length, 2);
});

test('old metadata and image URLs remain usable without a transform', async () => {
  const s = setup();
  const data: any = await (await s.get('/api/photos')).json();
  assert.equal(
    data.photos[0].fullSizeUrl,
    'https://site.example/api/photos/source-v1/123.jpg',
  );
  for (const path of [
    '/api/photos/source-v1/123.jpg',
    '/api/photos/123/1920.jpg',
  ]) {
    assert.equal((await s.get(path)).status, 200);
    assert.equal(s.calls.at(-1)!.url, source);
    assert.equal(s.calls.at(-1)!.init.cf, undefined);
  }
});

test('portrait and missing-size normalization preserves actual widths and skips invalid candidates', () => {
  const photo = payload.photos.photo[0];
  const data = normalize(
    {
      stat: 'ok',
      photos: {
        photo: [
          {
            ...photo,
            width_l: 683,
            height_l: 1024,
            width_k: 1365,
            height_k: 2048,
            url_z: 'https://live.staticflickr.com/1/123_abcdef_z.jpg',
            width_z: 426,
            height_z: 640,
            url_c: 'https://evil.example/123.jpg',
            width_c: 533,
            height_c: 800,
          },
        ],
      },
    },
    0,
  );
  assert.deepEqual(
    data.photos[0].sources.map((s) => [s.rendition, s.width, s.height]),
    [
      ['k', 1365, 2048],
      ['l', 683, 1024],
      ['z', 426, 640],
    ],
  );
  const only = normalize(
    { stat: 'ok', photos: { photo: [{ ...photo, url_k: undefined }] } },
    0,
  );
  assert.equal(only.photos[0].sources.length, 1);
  assert.equal(only.photos[0].width, 1024);
});

test('source requests omit transformation options, preserve bytes and MIME, and never forward user headers', async () => {
  const s = setup();
  const response = await s.get(undefined, {
    headers: {
      Accept: 'image/avif,image/webp,image/jpeg',
      Authorization: 'private',
      Cookie: 'private',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'source bytes');
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Vary'), 'Accept');
  assert.equal(response.headers.get('X-Photo-Mode'), 'rendition');
  assert.equal(s.calls[1].url, source);
  assert.equal(s.calls[1].init.cf, undefined);
  assert.equal(s.calls[1].init.headers, undefined);
  assert.equal(s.calls[1].init.redirect, 'manual');
  assert.ok(s.calls[1].init.signal instanceof AbortSignal);
});

test('timings separate gallery work from fetch-to-headers and identify warm gallery hits', async () => {
  const s = setup();
  const cold = await s.get();
  assert.equal(
    cold.headers.get('Server-Timing'),
    'gallery;dur=47, upstream;dur=75',
  );
  assert.equal(cold.headers.get('X-Photo-Gallery-Cache'), 'miss');
  assert.equal(cold.headers.get('X-Photo-Upstream-Cache'), 'HIT');
  assert.equal(cold.headers.get('X-Photo-Request-ID'), s.timings[0].requestId);
  const warm = await s.get();
  assert.equal(
    warm.headers.get('Server-Timing'),
    'gallery;dur=3, upstream;dur=75',
  );
  assert.equal(warm.headers.get('X-Photo-Gallery-Cache'), 'hit');
  assert.equal(
    s.calls.filter((call) => call.url.includes('services/rest')).length,
    1,
  );
  for (const timing of s.timings) {
    assert.deepEqual(
      Object.keys(timing).sort(),
      [
        'event',
        'requestId',
        'mode',
        'galleryCache',
        'galleryMs',
        'upstreamMs',
        'upstreamCache',
        'status',
      ].sort(),
    );
    assert.match(timing.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(timing.status, 200);
    assert.equal(JSON.stringify(timing).includes('private-key'), false);
    assert.equal(JSON.stringify(timing).includes(source), false);
  }
});

test('streaming returns headers and emits timing without waiting for image bytes', async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      body = controller;
    },
  });
  const s = setup({
    response: () =>
      new Response(stream, { headers: { 'Content-Type': 'image/jpeg' } }),
  });
  const response = await s.get();
  assert.equal(s.timings.length, 1);
  assert.equal(
    response.headers.get('Server-Timing'),
    'gallery;dur=47, upstream;dur=75',
  );
  body.enqueue(new TextEncoder().encode('later image bytes'));
  body.close();
  assert.equal(await response.text(), 'later image bytes');
});

test('source URL validation rejects arbitrary paths, queries, missing IDs and wrong methods', async () => {
  const s = setup();
  for (const [path, status] of [
    ['/api/photos/renditions-v1/123/k.jpg?url=https://evil.example', 400],
    ['/api/photos/renditions-v2/123/k.jpg', 404],
    ['/api/photos/renditions-v1/https://evil.example', 404],
    ['/api/photos/renditions-v1/999/k.jpg', 404],
  ] as const)
    assert.equal((await s.get(path)).status, status);
  assert.equal((await s.get(undefined, { method: 'POST' })).status, 405);
  assert.equal(
    s.calls.some((call) => !call.url.includes('services/rest')),
    false,
  );
});

test('source response MIME must be supported and acceptable; redirects and non-images fail closed', async () => {
  for (const [status, contentType, expected] of [
    [302, 'image/jpeg', 502],
    [200, 'text/html', 502],
    [200, 'image/jpeg', 406],
  ] as const) {
    const s = setup({
      response: () =>
        new Response('untrusted', {
          status,
          headers: {
            'Content-Type': contentType,
            Location: 'https://evil.example',
          },
        }),
    });
    const response = await s.get(undefined, {
      headers: { Accept: 'image/avif' },
    });
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(s.calls.length, 2);
  }
  for (const format of ['jpeg', 'webp', 'avif']) {
    const s = setup({
      response: () =>
        new Response('bytes', {
          headers: { 'Content-Type': `image/${format}` },
        }),
    });
    const response = await s.get(undefined, {
      headers: { Accept: `image/${format}` },
    });
    assert.equal(response.headers.get('Content-Type'), `image/${format}`);
    assert.equal(response.status, 200);
  }
});

test('upstream failures retain timing without exposing exception text; unknown cache labels are discarded', async () => {
  const failing = setup({ fetchFailure: true });
  const response = await failing.get();
  assert.equal(response.status, 502);
  assert.equal(failing.timings[0].upstreamMs, 75);
  assert.equal(failing.timings[0].status, 502);
  assert.equal(JSON.stringify(failing.timings).includes('secret'), false);
  const s = setup({
    response: () =>
      new Response('bytes', {
        headers: {
          'Content-Type': 'image/jpeg',
          'CF-Cache-Status': 'sensitive upstream content',
        },
      }),
  });
  assert.equal(
    (await s.get()).headers.get('X-Photo-Upstream-Cache'),
    'UNKNOWN',
  );
  assert.equal(s.timings[0].upstreamCache, 'UNKNOWN');
});

test('timing durations are bounded even with extreme or backward clocks', async () => {
  for (const [timeScale, expected] of [
    [100000, 60000],
    [-100, 0],
  ]) {
    const s = setup({ timeScale });
    const response = await s.get();
    assert.equal(response.status, 200);
    assert.equal(s.timings[0].galleryMs, expected);
    assert.equal(s.timings[0].upstreamMs, expected);
  }
});
