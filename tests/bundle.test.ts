import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Netlify's function bundler emits CommonJS even though this package is ESM,
 * and `import.meta` is empty in that output. Source that reads
 * `import.meta.url` unguarded therefore throws at module load, the function
 * never starts, and every request to the deployed site returns a 502.
 *
 * That is invisible to the rest of the suite, which runs the source as ESM, so
 * this test reproduces the real bundle instead of trusting it.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function bundleAsCjs(): Promise<string> {
  const outDir = await mkdtemp(path.join(tmpdir(), 'fn-bundle-'));
  const outfile = path.join(outDir, 'api.cjs');
  await build({
    entryPoints: [path.join(projectRoot, 'netlify', 'functions', 'api.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
    absWorkingDir: projectRoot,
  });
  return outfile;
}

test('the Netlify function survives being bundled as CommonJS', async (t) => {
  const outfile = await bundleAsCjs();
  t.after(() => rm(path.dirname(outfile), { recursive: true, force: true }));

  // Loading is the assertion: an unguarded import.meta.url throws right here.
  const required = createRequire(import.meta.url)(outfile) as {
    handler?: unknown;
    normalizePath?: unknown;
  };
  assert.equal(typeof required.handler, 'function', 'handler must be exported');
  assert.equal(typeof required.normalizePath, 'function');
});

test('the CommonJS bundle serves a request', async (t) => {
  const outfile = await bundleAsCjs();
  t.after(() => rm(path.dirname(outfile), { recursive: true, force: true }));

  const { handler } = createRequire(import.meta.url)(outfile) as {
    handler: (event: unknown, context: unknown) => Promise<{ statusCode: number; body: string }>;
  };

  const response = await handler(
    {
      httpMethod: 'GET',
      // The rewritten shape Netlify sends after the /api/* redirect.
      path: '/.netlify/functions/api/health',
      rawUrl: 'https://site.netlify.app/.netlify/functions/api/health',
      headers: { host: 'site.netlify.app', 'x-nf-client-connection-ip': '203.0.113.9' },
      queryStringParameters: {},
      body: null,
      isBase64Encoded: false,
    },
    { callbackWaitsForEmptyEventLoop: true }
  );

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).status, 'ok');
});
