import assert from 'node:assert/strict';
import test from 'node:test';

// Keep this suite offline and deterministic: the stages exercised here all
// short-circuit before any DNS or SMTP traffic.
process.env.SMTP_ENABLED = 'false';

const { verifyEmail, clearCache } = await import('../src/lib/verifier.ts');

test('rejects malformed addresses without touching the network', async () => {
  const result = await verifyEmail('not-an-email');
  assert.equal(result.status, 'undeliverable');
  assert.equal(result.score, 0);
  assert.equal(result.reason, 'invalid_syntax');
  assert.equal(result.checks.syntax, false);
});

test('flags disposable domains as risky before any DNS lookup', async () => {
  const result = await verifyEmail('someone@mailinator.com');
  assert.equal(result.reason, 'disposable_domain');
  assert.equal(result.status, 'risky');
  assert.ok(result.score <= 20, 'a burner mailbox must not score highly');
  assert.equal(result.checks.disposable, true);
  assert.equal(result.checks.mxFound, false, 'DNS should be skipped entirely');
});

test('surfaces a correction for a mistyped provider domain', async () => {
  const result = await verifyEmail('ada@gmial.com');
  assert.equal(result.didYouMean, 'gmail.com');
});

test('normalizes the domain but keeps the local part intact', async () => {
  const result = await verifyEmail('Ada.Lovelace@MAILINATOR.COM');
  assert.equal(result.normalized, 'Ada.Lovelace@mailinator.com');
  assert.equal(result.domain, 'mailinator.com');
});

test('serves a repeat lookup from cache', async () => {
  clearCache();
  const first = await verifyEmail('repeat@mailinator.com');
  const second = await verifyEmail('repeat@mailinator.com');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.status, first.status);

  const fresh = await verifyEmail('repeat@mailinator.com', { fresh: true });
  assert.equal(fresh.cached, false, '`fresh` must bypass the cache');
});

test('never returns a score outside 0-100', async () => {
  for (const email of ['x', 'info@mailinator.com', 'xkzrtqvbnmwp@mailinator.com']) {
    const { score } = await verifyEmail(email);
    assert.ok(score >= 0 && score <= 100, `${email} scored ${score}`);
  }
});
