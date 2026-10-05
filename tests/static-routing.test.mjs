import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

for (const environment of ['', 'staging']) {
  const port = environment === 'staging' ? 8789 : 8788;
  const origin = `http://127.0.0.1:${port}`;

  test(
    `${environment || 'production'}: assets serve SPA routes while API navigation reaches the Worker`,
    { timeout: 45000 },
    async () => {
      const child = spawn(
        process.execPath,
        [
          'backend/photos-worker/node_modules/wrangler/bin/wrangler.js',
          'dev',
          '--config',
          'wrangler.jsonc',
          '--env',
          environment,
          '--ip',
          '127.0.0.1',
          '--port',
          String(port),
          '--local',
        ],
        {
          env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
          try {
            const r = await fetch(`${origin}/`);
            if (r.ok) {
              ready = true;
              break;
            }
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        assert.ok(ready, `Worker failed to start: ${output}`);
        for (const path of ['/', '/about', '/photography', '/unknown-page']) {
          const r = await fetch(`${origin}${path}`, {
            headers: { 'Sec-Fetch-Mode': 'navigate' },
          });
          assert.equal(r.status, 200);
          assert.match(r.headers.get('Content-Type'), /text\/html/);
          assert.match(await r.text(), /id="background-hexagons"/);
        }
        for (const [path, status, error] of [
          ['/api/photos', 503, 'service_not_configured'],
          ['/api/photos/renditions-v1', 503, 'service_not_configured'],
          ['/api/unknown', 404, 'not_found'],
        ]) {
          const r = await fetch(`${origin}${path}`, {
            headers: { 'Sec-Fetch-Mode': 'navigate' },
          });
          assert.equal(r.status, status);
          assert.match(r.headers.get('Content-Type'), /application\/json/);
          assert.equal((await r.json()).error, error);
        }
        const favicon = await fetch(`${origin}/favicon-32x32.png`);
        assert.equal(favicon.status, 200);
        assert.match(favicon.headers.get('Content-Type'), /image\/png/);
      } finally {
        child.kill('SIGTERM');
        await new Promise((resolve) => {
          child.once('exit', resolve);
          setTimeout(resolve, 3000).unref();
        });
      }
    },
  );
}
