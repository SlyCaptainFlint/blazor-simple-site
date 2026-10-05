import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const {
  unstable_readConfig: readConfig,
} = require('../backend/photos-worker/node_modules/wrangler');

function canPublish(environment, overrides = {}) {
  const workflow = readFileSync(
    `.github/workflows/${environment}-publish.yml`,
    'utf8',
  );
  const expression = workflow.match(/^    if: >-\n((?:      .+\n)+)/m)?.[1];
  assert.ok(expression, 'Expected a folded publish-job condition');

  // The current guards use JavaScript-compatible comparisons and &&.
  // Supply GitHub's case-insensitive startsWith to exercise the actual guard.
  return runInNewContext(expression, {
    github: {
      repository: 'SlyCaptainFlint/blazor-simple-site',
      actor: 'SlyCaptainFlint',
      triggering_actor: 'SlyCaptainFlint',
      ref: 'refs/heads/master',
      ...overrides,
    },
    startsWith: (value, prefix) =>
      value.toLowerCase().startsWith(prefix.toLowerCase()),
  });
}

test('staging accepts any branch name and rejects tags and non-branch refs', () => {
  for (const branch of [
    'master',
    'develop',
    'fix/gallery',
    'feat/gallery/loading',
    'experiment/a/b/c',
  ]) {
    assert.equal(
      canPublish('staging', { ref: `refs/heads/${branch}` }),
      true,
      branch,
    );
  }
  for (const ref of [
    'refs/tags/master',
    'refs/tags/v1',
    'refs/pull/16/merge',
    '',
  ]) {
    assert.equal(canPublish('staging', { ref }), false, ref);
  }
});

test('publish guards retain repository and both initiator restrictions', () => {
  for (const environment of ['staging', 'production']) {
    assert.equal(canPublish(environment), true);
    for (const overrides of [
      { repository: 'someone/blazor-simple-site' },
      { actor: 'someone' },
      { triggering_actor: 'someone' },
    ]) {
      assert.equal(
        canPublish(environment, overrides),
        false,
        JSON.stringify(overrides),
      );
    }
  }
  for (const ref of [
    'refs/heads/develop',
    'refs/heads/feat/gallery',
    'refs/tags/master',
  ]) {
    assert.equal(canPublish('production', { ref }), false, ref);
  }
});

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
