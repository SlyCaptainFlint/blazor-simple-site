import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const {
  unstable_readConfig: readConfig,
} = require('../backend/photos-worker/node_modules/wrangler');

test('staging resolves to a separate Worker without production routes', () => {
  // Use Wrangler's resolved configuration so inherited settings are checked too.
  const production = readConfig({ config: 'wrangler.jsonc', env: '' });
  const staging = readConfig({ config: 'wrangler.jsonc', env: 'staging' });

  assert.equal(production.name, 'ozinoveva-photos');
  assert.equal(staging.name, 'ozinoveva-photos-staging');
  assert.notEqual(staging.name, production.name);
  assert.equal(staging.workers_dev, true);
  assert.equal(staging.preview_urls, false);
  assert.deepEqual(staging.routes, []);
  assert.equal(staging.route, undefined);
});

test('staging serves the combined site and API with explicit same-origin vars', () => {
  const staging = readConfig({ config: 'wrangler.jsonc', env: 'staging' });

  assert.equal(staging.main, resolve('backend/photos-worker/src/index.ts'));
  assert.deepEqual(staging.assets, {
    directory: './dist',
    not_found_handling: 'single-page-application',
    run_worker_first: ['/api/*'],
  });
  assert.deepEqual(staging.vars, { ALLOWED_ORIGIN: '' });
});
