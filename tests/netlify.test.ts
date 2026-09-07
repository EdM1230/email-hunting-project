import assert from 'node:assert/strict';
import test from 'node:test';

// Behave like a Netlify invocation so the serverless defaults are in effect.
process.env.NETLIFY = 'true';

const { handler, normalizePath } = await import('../netlify/functions/api.ts');

test('accepts the original /api path', () => {
  assert.deepEqual(normalizePath('/api/health'), { path: '/api/health', query: {} });
});

test('strips the rewritten function prefix', () => {
  assert.deepEqual(normalizePath('/.netlify/functions/api/health'), {
    path: '/api/health',
    query: {},
  });
  assert.deepEqual(normalizePath('/.netlify/functions/api'), { path: '/api', query: {} });
});

test('separates a query string attached to the path', () => {
  // serverless-http rebuilds the URL from queryStringParameters, so a stray
  // "?" left in the path would 404 every GET.
  assert.deepEqual(normalizePath('/api/verify?email=ada@example.com&skipSmtp=true'), {
    path: '/api/verify',
    query: { email: 'ada@example.com', skipSmtp: 'true' },
  });
  assert.deepEqual(normalizePath('/.netlify/functions/api/verify?email=a@b.com'), {
    path: '/api/verify',
    query: { email: 'a@b.com' },
  });
});

test('never produces a double /api prefix', () => {
  assert.equal(normalizePath('/api/verify').path, '/api/verify');
  assert.equal(normalizePath('/api').path, '/api');
  // The function prefix already ends in "/api", so stripping it from
  // /.netlify/functions/api/verify must not leave a second one behind.
  assert.equal(normalizePath('/.netlify/functions/api/verify').path, '/api/verify');
});

test('mounts a bare or prefix-less path under /api', () => {
  assert.equal(normalizePath('/').path, '/api');
  assert.equal(normalizePath('/verify').path, '/api/verify');
});

function event(method: string, path: string, body?: unknown) {
  return {
    httpMethod: method,
    path,
    rawUrl: `https://example.netlify.app${path}`,
    headers: {
      host: 'example.netlify.app',
      'x-nf-client-connection-ip': '203.0.113.9',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    queryStringParameters: {},
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  };
}

const context = { callbackWaitsForEmptyEventLoop: true };

test('serves health through the Lambda handler', async () => {
  const res = await handler(event('GET', '/api/health'), context);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body as string);
  assert.equal(body.status, 'ok');
  assert.equal(body.serverless, true);
  // Port 25 is blocked on Lambda, so SMTP must be off unless explicitly enabled.
  assert.equal(body.smtpEnabled, false);
  assert.equal(body.mode, 'dns-only');
});

test('verifies through the Lambda handler on both path shapes', async () => {
  for (const path of [
    '/api/verify?email=x@mailinator.com',
    '/.netlify/functions/api/verify?email=x@mailinator.com',
  ]) {
    const res = await handler(event('GET', path), context);
    assert.equal(res.statusCode, 200, `${path} should route`);
    assert.equal(JSON.parse(res.body as string).reason, 'disposable_domain');
  }
});

test('rate limiting does not crash without a socket address', async () => {
  // req.ip is undefined on Lambda; the key generator must cope rather than throw.
  const bare = { ...event('GET', '/api/health'), headers: { host: 'example.netlify.app' } };
  const res = await handler(bare, context);
  assert.equal(res.statusCode, 200);
});

test('returns a JSON 404 for an unknown API route', async () => {
  const res = await handler(event('GET', '/api/nope'), context);
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body as string).error, 'Unknown endpoint');
});
