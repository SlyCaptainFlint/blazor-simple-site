import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler, normalize, validSource, negotiateFormat} from '../src/index.js';
const owner = '93665003@N05';
function photo(id = '123') {return {id, owner, ispublic: 1, title: 'A photo',
  url_l: `https://live.staticflickr.com/1/${id}_abcdef_b.jpg`, width_l: '1024', height_l: '768',
  url_h: `https://live.staticflickr.com/1/${id}_abcdef_h.jpg`, width_h: 1600, height_h: 1200};}
function payload(photos: unknown[] = [photo()]) {return {stat: 'ok', photos: {photo: photos}};}
function setup() {
  let now = 100000;
  let upstream: unknown = payload();
  let fail = false;
  let imageType = 'image/jpeg';
  let redirect = false;
  const calls: {url: string; init: any}[] = [];
  const entries = new Map<string, Response>();
  const cache = {match: async (r: Request) => entries.get(r.url)?.clone(),
    put: async (r: Request, v: Response) => {entries.set(r.url, v.clone());}};
  const fetcher = async (input: any, init: any) => {
    const url = String(input); calls.push({url, init});
    if (fail) throw new Error('secret-and-upstream-details');
    if (url.includes('services/rest')) return Response.json(upstream);
    const r = new Response('image bytes', {status: redirect ? 302 : 200, headers: {'Content-Type': imageType, 'Cf-Resized': 'internal=fixture'}});
    return r;
  };
  const handler = createHandler({fetch: fetcher as any, cache: cache as any, now: () => now});
  const get = (path = '/api/photos', env: any = {FLICKR_API_KEY: 'private-key'}, init?: RequestInit) =>
    handler(new Request(`https://photos.example${path}`, init) as any, env);
  return {get, calls, entries, advance: (milliseconds = 3600000) => {now += milliseconds;}, set: (p: unknown) => {upstream = p;},
    fail: () => {fail = true;}, imageType: (t: string) => {imageType = t;}, redirect: () => {redirect = true;}};
}
test('missing secret fails closed without upstream requests', async () => {
  const s = setup(); const r = await s.get('/api/photos', {});
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), {error:'service_not_configured'}); assert.equal(s.calls.length, 0);
});
test('preserves account/newest-public search and returns stable IDs, source dimensions and fixed variants', async () => {
  const s = setup(); const r = await s.get(); const body: any = await r.json();
  const q = new URL(s.calls[0].url).searchParams;
  for (const [key,value] of Object.entries({method:'flickr.photos.search', user_id:owner, sort:'date-posted-desc', privacy_filter:'1', per_page:'50', page:'1', media:'photos'})) assert.equal(q.get(key),value);
  assert.equal(body.limit, 50); assert.equal(q.has('tags'), false); assert.equal(body.photos[0].id,'123'); assert.equal(body.photos[0].width,1600);
  assert.deepEqual(body.photos[0].variants.map((v:any)=>v.width),[320,640,960,1440,1600]);
  assert.equal(body.photos[0].variants[0].url,'https://photos.example/api/photos/123/320.jpg');
  assert.equal(JSON.stringify(body).includes('private-key'),false); assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('caps gallery at 50, excludes private/wrong owner/duplicate/unsafe photos', () => {
  assert.equal(normalize(payload(Array.from({length:55},(_,i)=>photo(String(i)))),0).photos.length,50);
  assert.equal(normalize(payload([photo(),photo(),{...photo('124'),ispublic:0},{...photo('125'),owner:'other'},
    {...photo('126'),url_l:'https://evil.example/a.jpg',url_h:'https://evil.example/a.jpg'}]),0).photos.length,1);
});
test('rejects arbitrary hosts, credentials, ports, redirects and mismatched photo paths', () => {
  for (const url of ['https://live.staticflickr.com.evil.test/1/123_abcdef_b.jpg','http://live.staticflickr.com/1/123_abcdef_b.jpg',
    'https://user@live.staticflickr.com/1/123_abcdef_b.jpg','https://live.staticflickr.com:444/1/123_abcdef_b.jpg',
    'https://live.staticflickr.com/1/999_abcdef_b.jpg','https://live.staticflickr.com/1/123_abcdef_b.jpg?url=evil']) assert.equal(validSource(url,'123'),false);
  assert.equal(validSource('https://farm1.staticflickr.com/1/123_abcdef_b.jpg','123'),true);
});
test('validates method/path/preset/query before fetching', async () => {
  const s = setup();
  for (const [path,status] of [['/api/photos?url=https://evil.test',400],['/api/photos/123/321.jpg',404],['/api/photos/999/640.jpg?width=2',400],['/__internal/gallery-v2',404]]) assert.equal((await s.get(String(path))).status,status);
  assert.equal((await s.get('/api/photos',undefined,{method:'POST'})).status,405);
  assert.equal(s.calls.length,0);
});
test('resizes largest permitted source with fixed options and no user headers', async () => {
  const s=setup(); const r=await s.get('/api/photos/123/640.jpg',undefined,{headers:{Cookie:'do-not-forward',Authorization:'do-not-forward'}});
  assert.equal(r.status,200); assert.equal(r.headers.get('Content-Type'),'image/jpeg');
  const call=s.calls[1]; assert.equal(call.url,photo().url_h); assert.equal(call.init.redirect,'manual');
  assert.deepEqual(call.init.cf.image,{width:640,fit:'scale-down',quality:82,format:'jpeg',metadata:'none'});
  assert.equal(call.init.headers,undefined);
});
test('unknown IDs cannot fetch images even on allowed Flickr host', async () => {
  const s=setup(); assert.equal((await s.get('/api/photos/999/640.jpg')).status,404); assert.equal(s.calls.length,1);
});
test('gallery cache lasts one hour and removed photos stop resolving at expiry', async () => {
  const s=setup(); await s.get();
  assert.equal(s.entries.values().next().value?.headers.get('Cache-Control'), 'public, max-age=3600');
  s.set(payload([])); s.advance(3599999);
  const cached: any = await (await s.get()).json();
  assert.equal(cached.photos[0].id, '123'); assert.equal(s.calls.length,1);
  s.advance(1); assert.equal((await s.get('/api/photos/123/640.jpg')).status,404); assert.equal(s.calls.length,2);
});
test('expired cache fails closed instead of serving stale photos, with sanitized error', async () => {
  const s=setup(); await s.get(); s.advance(); s.fail(); const r=await s.get('/api/photos/123/640.jpg');
  assert.equal(r.status,502); assert.deepEqual(await r.json(),{error:'flickr_unavailable'});
});
test('Flickr errors and malformed JSON payloads return sanitized failures', async () => {
  for(const data of [{stat:'fail',message:'secret'}, {}, {stat:'ok',photos:{photo:'wrong'}}]) {
    const s=setup();s.set(data);assert.equal((await s.get()).status,502);
  }
});
test('transform errors, redirects and non-images never fall back to source bytes', async () => {
  for (const mode of ['redirect','html']) {const s=setup(); if(mode==='redirect')s.redirect();else s.imageType('text/html');
    assert.equal((await s.get('/api/photos/123/640.jpg')).status,502);}
});
test('CORS only permits the configured exact frontend origin', async () => {
  const s=setup();const env={FLICKR_API_KEY:'key',ALLOWED_ORIGIN:'https://site.example'};
  for(const origin of ['https://site.example','https://evil.example']) {
    const r=await s.get('/api/photos',env,{headers:{Origin:origin}});
    assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin===env.ALLOWED_ORIGIN?origin:null);
  }
});
test('concurrent misses coalesce into one upstream query',async()=>{
  const s=setup(); await Promise.all([s.get(),s.get(),s.get()]); assert.equal(s.calls.length,1);
});

test('negotiates explicit modern formats, quality preferences, wildcards, and exclusions', () => {
  const cases: [string | null, string | null][] = [
    [null, 'jpeg'], ['*/*', 'jpeg'], ['image/*', 'jpeg'],
    ['image/avif,image/webp,image/*,*/*;q=0.8', 'avif'],
    ['image/webp,image/*', 'webp'], ['image/avif;q=0,image/webp', 'webp'],
    ['image/avif;q=0.5,image/webp;q=0.9,image/jpeg;q=0.2', 'webp'],
    ['image/avif;q=0.2,image/jpeg', 'jpeg'],
    ['image/avif;q=0,image/webp;q=0,image/jpeg;q=0,*/*', null],
    ['image/png', null], ['image/avif;q=bogus,image/jpeg', 'jpeg'],
    ['IMAGE/AVIF;Q=1,image/webp;q=0.5', 'avif']
  ];
  for (const [accept, expected] of cases) assert.equal(negotiateFormat(accept), expected, String(accept));
});
test('each format uses matching transform, MIME and Vary without dropping CORS', async () => {
  for(const format of ['avif','webp','jpeg']) {
    const s=setup(); s.imageType(`image/${format}`);
    const r=await s.get('/api/photos/123/1920.jpg', {FLICKR_API_KEY:'key',ALLOWED_ORIGIN:'https://site.example'},
      {headers:{Accept:`image/${format}`,Origin:'https://site.example'}});
    assert.equal(r.status,200); assert.equal(r.headers.get('Content-Type'),`image/${format}`);
    assert.equal(s.calls[1].init.cf.image.format,format); assert.equal(s.calls[1].init.cf.image.width,1920);
    assert.equal(s.calls[1].init.cf.image.fit,'scale-down');
    assert.deepEqual(r.headers.get('Vary')?.split(',').map(v=>v.trim()).sort(),['Accept','Origin']);
  }
});
test('unsupported Accept fails before upstream and a mismatched output MIME fails closed', async () => {
  const s=setup(); assert.equal((await s.get('/api/photos/123/320.jpg',undefined,{headers:{Accept:'image/png'}})).status,406);
  assert.equal(s.calls.length,0);
  assert.equal((await s.get('/api/photos/123/320.jpg',undefined,{headers:{Accept:'image/avif'}})).status,502);
});
test('all five presets resolve; larger Flickr source allows a 1920 variant', async () => {
  const s=setup();s.set(payload([{...photo(),url_k:'https://live.staticflickr.com/1/123_abcdef_k.jpg',width_k:2048,height_k:1536}]));
  const body:any=await (await s.get()).json();
  assert.deepEqual(body.photos[0].variants.map((v:any)=>v.width),[320,640,960,1440,1920]);
  for(const width of [320,640,960,1440,1920]) assert.equal((await s.get(`/api/photos/123/${width}.jpg`)).status,200);
  for(const width of [1024,1600]) assert.equal((await s.get(`/api/photos/123/${width}.jpg`)).status,404);
});
test('safe diagnostics distinguish transport, HTTP, JSON, schema and Flickr API failures', async () => {
  const original = console.error;
  const logs: string[] = [];
  console.error = (message: string) => {logs.push(message);};
  try {
    const cases: [() => Promise<Response>, string][] = [
      [async()=>{throw new Error('https://secret.example/?api_key=private-key');}, 'flickr_fetch'],
      [async()=>new Response('private-key raw body',{status:403}), 'flickr_http_403'],
      [async()=>new Response('',{status:302,headers:{Location:'https://secret.example'}}), 'flickr_http_302'],
      [async()=>new Response('private-key invalid json'), 'flickr_json'],
      [async()=>Response.json({stat:'ok',photos:{photo:'private-key'}}), 'flickr_schema'],
      [async()=>Response.json({stat:'fail',code:100,message:'private-key'}), 'flickr_api_100'],
      [async()=>Response.json({stat:'fail',code:'105',message:'private-key'}), 'flickr_api_105'],
      [async()=>Response.json({stat:'fail',code:'private-key',message:'private-key'}), 'flickr_api'],
      [async()=>Response.json({stat:'fail',code:123456789,message:'private-key'}), 'flickr_api']
    ];
    for(const [upstream,expected] of cases) {
      const handler=createHandler({fetch:upstream as any,cache:{match:async()=>undefined,put:async()=>{}} as any,now:Date.now});
      const r=await handler(new Request('https://photos.example/api/photos') as any,{FLICKR_API_KEY:'private-key'});
      assert.equal(r.status,502);assert.equal(r.headers.get('X-Photo-Diagnostic'),expected);
      assert.equal((await r.text()).includes('private-key'),false);
    }
    assert.equal(logs.length,cases.length);
    for(const log of logs) {
      assert.equal(log.includes('private-key'),false);assert.equal(log.includes('https://'),false);
      const obj=JSON.parse(log); assert.equal(obj.event,'photo_backend_failure');
      assert.ok(Object.keys(obj).every(k=>['event','stage','upstreamStatus','flickrCode'].includes(k)));
    }
  } finally {console.error=original;}
});
test('timeout diagnostic uses signal state, never exception text', async()=>{
  const original=AbortSignal.timeout;
  const originalLog=console.error;
  try {
    AbortSignal.timeout=()=>AbortSignal.abort(); console.error=()=>{};
    const s=setup();s.fail(); const r=await s.get();assert.equal(r.headers.get('X-Photo-Diagnostic'),'flickr_timeout');
  } finally {AbortSignal.timeout=original;console.error=originalLog;}
});

test('documented AVIF fallback only succeeds when the actual format is acceptable',async()=>{
  const s=setup();s.imageType('image/webp');
  const ok=await s.get('/api/photos/123/320.jpg',undefined,{headers:{Accept:'image/avif,image/webp'}});
  assert.equal(ok.status,200);assert.equal(ok.headers.get('Content-Type'),'image/webp');
  const denied=await s.get('/api/photos/123/320.jpg',undefined,{headers:{Accept:'image/avif,image/webp;q=0'}});
  assert.equal(denied.status,502);assert.equal(denied.headers.get('X-Photo-Diagnostic'),'image_format_200');
});
test('safe image diagnostics distinguish HTTP, resizing errors and absent transform evidence',async()=>{
  const original=console.error;const logs:string[]=[];console.error=(message:string)=>{logs.push(message);};
  try {
    for(const [status,header,expected] of [
      [403,'err=9408','image_http_403_cf_9408'],[302,null,'image_http_302'],
      [200,'err=9422','image_transform_200_cf_9422'],[200,null,'image_untransformed_200'],
      [503,'err=private-key https://secret.example','image_http_503']
    ] as const) {
      const handler=createHandler({cache:{match:async()=>undefined,put:async()=>{}} as any,now:Date.now,
        fetch:(async(url:any)=>String(url).includes('services/rest')?Response.json(payload()):new Response('private-key body',{status,headers:{'Content-Type':'image/jpeg',...(header?{'Cf-Resized':header}:{})}})) as any});
      const r=await handler(new Request('https://photos.example/api/photos/123/320.jpg') as any,{FLICKR_API_KEY:'private-key'});
      assert.equal(r.status,502);assert.equal(r.headers.get('X-Photo-Diagnostic'),expected);
    }
    assert.equal(logs.some(log=>log.includes('private-key')||log.includes('https://')),false);
  } finally {console.error=original;}
});


test('browser image caching expires with gallery metadata, rounding down partial seconds', async () => {
  const s = setup();
  const first = await s.get('/api/photos/123/640.jpg');
  assert.equal(first.headers.get('Cache-Control'), 'private, max-age=3600, must-revalidate');
  s.advance(1800500);
  const later = await s.get('/api/photos/123/640.jpg');
  assert.equal(later.headers.get('Cache-Control'), 'private, max-age=1799, must-revalidate');
  s.advance(1799000);
  const expiring = await s.get('/api/photos/123/640.jpg');
  assert.equal(expiring.headers.get('Cache-Control'), 'private, max-age=0, must-revalidate');
  s.set(payload([]));
  s.advance(500);
  const removed = await s.get('/api/photos/123/640.jpg');
  assert.equal(removed.status, 404);
  assert.equal(removed.headers.get('Cache-Control'), 'no-store');
});

test('image failures remain uncacheable', async () => {
  const s = setup();
  s.imageType('text/html');
  const response = await s.get('/api/photos/123/640.jpg');
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('cacheable images vary on Origin even when no CORS permission is returned', async () => {
  const s = setup();
  const env = { FLICKR_API_KEY: 'key', ALLOWED_ORIGIN: 'https://site.example' };
  for (const origin of [undefined, 'https://evil.example', env.ALLOWED_ORIGIN]) {
    const response = await s.get('/api/photos/123/640.jpg', env, {
      headers: origin ? { Origin: origin } : {},
    });
    assert.deepEqual(response.headers.get('Vary')?.split(',').map(v => v.trim()).sort(), ['Accept', 'Origin']);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin === env.ALLOWED_ORIGIN ? origin : null);
  }
});
