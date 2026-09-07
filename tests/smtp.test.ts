import assert from 'node:assert/strict';
import test from 'node:test';
import { startFakeSmtp } from './helpers/fake-smtp.ts';

// config reads the environment once at import time, so point the prober at the
// fake server before anything pulls config in.
process.env.SMTP_TIMEOUT_MS = '2000';
process.env.PER_HOST_DELAY_MS = '0';
process.env.SMTP_HELO_HOST = 'prober.test';
process.env.SMTP_FROM_EMAIL = 'probe@prober.test';

const { probeMailbox } = await import('../src/lib/smtp.ts');

function probeAgainst(port: number, email: string, detectCatchAll = false) {
  return probeMailbox(email, ['127.0.0.1'], { port, detectCatchAll });
}

test('reports a mailbox the server accepts', async () => {
  const server = await startFakeSmtp({
    recipients: { 'ada@example.com': '250 2.1.5 Recipient ok' },
  });
  try {
    const result = await probeAgainst(server.port, 'ada@example.com');
    assert.equal(result.connected, true);
    assert.equal(result.mailbox, 'exists');
    // The envelope must be a probe, never an actual message.
    assert.ok(server.commands.some((c) => c.startsWith('EHLO prober.test')));
    assert.ok(server.commands.some((c) => c === 'MAIL FROM:<probe@prober.test>'));
    assert.ok(server.commands.some((c) => c === 'RCPT TO:<ada@example.com>'));
    assert.ok(!server.commands.some((c) => c.toUpperCase().startsWith('DATA')));
  } finally {
    await server.close();
  }
});

test('reports a mailbox the server rejects', async () => {
  const server = await startFakeSmtp({ defaultRcpt: '550 5.1.1 User unknown' });
  try {
    const result = await probeAgainst(server.port, 'nobody@example.com');
    assert.equal(result.mailbox, 'not_found');
  } finally {
    await server.close();
  }
});

test('detects an accept-all domain via a decoy recipient', async () => {
  const server = await startFakeSmtp({ defaultRcpt: '250 2.1.5 Accepted' });
  try {
    const result = await probeAgainst(server.port, 'ada@example.com', true);
    assert.equal(result.mailbox, 'exists');
    assert.equal(result.catchAll, true);
    const rcpts = server.commands.filter((c) => c.startsWith('RCPT TO'));
    assert.equal(rcpts.length, 2, 'a decoy recipient should also be probed');
  } finally {
    await server.close();
  }
});

test('does not claim accept-all when the decoy is rejected', async () => {
  const server = await startFakeSmtp({
    recipients: { 'ada@example.com': '250 OK' },
    defaultRcpt: '550 5.1.1 User unknown',
  });
  try {
    const result = await probeAgainst(server.port, 'ada@example.com', true);
    assert.equal(result.catchAll, false);
  } finally {
    await server.close();
  }
});

test('treats a 4xx deferral as greylisting rather than a rejection', async () => {
  const server = await startFakeSmtp({
    defaultRcpt: '450 4.7.1 Greylisted, please try again later',
  });
  try {
    const result = await probeAgainst(server.port, 'ada@example.com');
    assert.equal(result.mailbox, 'greylisted');
  } finally {
    await server.close();
  }
});

test('separates a policy block from a missing mailbox', async () => {
  const server = await startFakeSmtp({
    defaultRcpt: '550 5.7.1 Message rejected due to reputation policy',
  });
  try {
    const result = await probeAgainst(server.port, 'ada@example.com');
    assert.equal(result.mailbox, 'blocked');
  } finally {
    await server.close();
  }
});

test('recognises a full mailbox', async () => {
  const server = await startFakeSmtp({ defaultRcpt: '552 5.2.2 Mailbox over quota' });
  try {
    const result = await probeAgainst(server.port, 'ada@example.com');
    assert.equal(result.mailbox, 'mailbox_full');
  } finally {
    await server.close();
  }
});

test('parses multi-line greetings and EHLO responses', async () => {
  const server = await startFakeSmtp({
    greeting: '220-fake.test ESMTP\r\n220-still talking\r\n220 ready',
    recipients: { 'ada@example.com': '250 OK' },
  });
  try {
    const result = await probeAgainst(server.port, 'ada@example.com');
    assert.equal(result.connected, true);
    assert.equal(result.mailbox, 'exists');
  } finally {
    await server.close();
  }
});

test('reports an unreachable server instead of guessing', async () => {
  const server = await startFakeSmtp({ hangUp: true });
  try {
    const result = await probeAgainst(server.port, 'ada@example.com');
    assert.equal(result.connected, false);
    assert.equal(result.mailbox, 'unknown');
    assert.ok(result.error);
  } finally {
    await server.close();
  }
});

test('falls through to a backup mail exchanger', async () => {
  const server = await startFakeSmtp({ recipients: { 'ada@example.com': '250 OK' } });
  try {
    // 192.0.2.0/24 is TEST-NET-1: reserved, and never routable.
    const result = await probeMailbox('ada@example.com', ['192.0.2.1', '127.0.0.1'], {
      port: server.port,
      detectCatchAll: false,
    });
    assert.equal(result.connected, true);
    assert.equal(result.host, '127.0.0.1');
  } finally {
    await server.close();
  }
});
