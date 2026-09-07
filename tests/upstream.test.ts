import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

/** A stand-in for an upstream verifier running where port 25 is open. */
async function startFakeUpstream(handler: (path: string, body: string) => {
  status?: number;
  json?: unknown;
  text?: string;
}) {
  const received: { path: string; body: string; apiKey?: string }[] = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        body,
        apiKey: req.headers['x-api-key'] as string | undefined,
      });
      const reply = handler(req.url ?? '', body);
      if (reply.text !== undefined) {
        res.writeHead(reply.status ?? 200, { 'content-type': 'text/plain' });
        res.end(reply.text);
        return;
      }
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.json ?? {}));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('bind failed');

  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * The delegation tests exercise the full pipeline, which only reaches the SMTP
 * stage for a domain that publishes a mail server. That needs a real DNS
 * lookup, so skip rather than fail when the sandbox has no resolver.
 */
const PROBE_DOMAIN = 'github.com';
const dnsAvailable = await import('node:dns/promises')
  .then((dns) => dns.resolveMx(PROBE_DOMAIN))
  .then((mx) => mx.length > 0)
  .catch(() => false);

const deliverable = {
  email: `ada@${PROBE_DOMAIN}`,
  normalized: `ada@${PROBE_DOMAIN}`,
  localPart: 'ada',
  domain: PROBE_DOMAIN,
  status: 'deliverable',
  score: 95,
  reason: 'accepted_email',
  message: 'The mail server accepted this address.',
  checks: {
    syntax: true, mxFound: true, smtpConnected: true, mailboxExists: true,
    catchAll: false, disposable: false, roleAccount: false,
    freeProvider: false, parkedDomain: false, gibberish: false,
  },
  mx: [{ exchange: 'mx.example.com', priority: 10 }],
  smtpResponse: '250 2.1.5 Recipient ok',
  durationMs: 400,
  checkedAt: '2026-01-01T00:00:00.000Z',
  cached: false,
};

test('delegates the mailbox probe and returns the upstream verdict', { skip: !dnsAvailable && 'no DNS resolver available' }, async () => {
  const upstream = await startFakeUpstream(() => ({ json: deliverable }));
  process.env.VERIFY_UPSTREAM_URL = upstream.url;
  process.env.VERIFY_UPSTREAM_KEY = 'upstream-secret';

  try {
    const { verifyEmail, clearCache } = await import('../src/lib/verifier.ts');
    clearCache();

    const result = await verifyEmail(`ada@${PROBE_DOMAIN}`);
    assert.equal(result.status, 'deliverable');
    assert.equal(result.score, 95);
    assert.equal(result.checks.mailboxExists, true);
    assert.equal(result.smtpResponse, '250 2.1.5 Recipient ok');

    assert.equal(upstream.received.length, 1, 'exactly one upstream call');
    assert.equal(upstream.received[0]?.path, '/api/verify');
    assert.equal(upstream.received[0]?.apiKey, 'upstream-secret', 'API key must be forwarded');
  } finally {
    await upstream.close();
  }
});

test('does not call upstream for an address a local stage already settles', async () => {
  const upstream = await startFakeUpstream(() => ({ json: deliverable }));
  process.env.VERIFY_UPSTREAM_URL = upstream.url;

  try {
    const { verifyEmail, clearCache } = await import('../src/lib/verifier.ts');
    clearCache();

    // Bad syntax and burner domains are settled locally, before the SMTP stage.
    await verifyEmail('not-an-email');
    await verifyEmail('someone@mailinator.com');
    assert.equal(upstream.received.length, 0, 'no round trip should be spent');

    // skipSmtp means the caller does not want a mailbox probe at all.
    await verifyEmail(`ada@${PROBE_DOMAIN}`, { skipSmtp: true });
    assert.equal(upstream.received.length, 0);
  } finally {
    await upstream.close();
  }
});

test('degrades to unknown when the upstream is unreachable', { skip: !dnsAvailable && 'no DNS resolver available' }, async () => {
  // Nothing is listening on this port.
  process.env.VERIFY_UPSTREAM_URL = 'http://127.0.0.1:1';
  process.env.VERIFY_UPSTREAM_TIMEOUT_MS = '2000';

  const { verifyEmail, clearCache } = await import('../src/lib/verifier.ts');
  clearCache();

  const result = await verifyEmail(`ada@${PROBE_DOMAIN}`);
  assert.equal(result.status, 'unknown', 'must not fabricate a verdict');
  assert.equal(result.reason, 'smtp_unreachable');
  assert.match(result.message, /upstream/i);
});

test('degrades to unknown when the upstream errors or answers with junk', { skip: !dnsAvailable && 'no DNS resolver available' }, async () => {
  const upstream = await startFakeUpstream((path) =>
    path.includes('verify') ? { status: 502, text: 'Bad Gateway' } : { json: {} }
  );
  process.env.VERIFY_UPSTREAM_URL = upstream.url;

  try {
    const { verifyEmail, clearCache } = await import('../src/lib/verifier.ts');
    clearCache();

    const result = await verifyEmail(`ada@${PROBE_DOMAIN}`);
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'smtp_unreachable');
    assert.match(result.message, /502/);
  } finally {
    await upstream.close();
  }
});

test('rejects a malformed upstream payload instead of trusting it', { skip: !dnsAvailable && 'no DNS resolver available' }, async () => {
  const upstream = await startFakeUpstream(() => ({ json: { nonsense: true } }));
  process.env.VERIFY_UPSTREAM_URL = upstream.url;

  try {
    const { verifyEmail, clearCache } = await import('../src/lib/verifier.ts');
    clearCache();

    const result = await verifyEmail(`ada@${PROBE_DOMAIN}`);
    assert.equal(result.status, 'unknown');
    assert.match(result.message, /malformed/i);
  } finally {
    await upstream.close();
  }
});
