import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEmailList, toCsv } from '../src/lib/csv.ts';
import type { VerificationResult } from '../src/types.ts';

test('extracts addresses from messy pasted input', () => {
  const input = `
    ada@example.com, grace@example.org
    Alan Turing <alan@example.net>
    "quoted",tim@example.io;
    not-an-email
  `;
  assert.deepEqual(parseEmailList(input), [
    'ada@example.com',
    'grace@example.org',
    'alan@example.net',
    'tim@example.io',
  ]);
});

test('drops duplicates case-insensitively', () => {
  const list = parseEmailList('ada@example.com\nADA@Example.com\nada@example.com');
  assert.deepEqual(list, ['ada@example.com']);
});

test('strips trailing punctuation left by CSV exports', () => {
  assert.deepEqual(parseEmailList('ada@example.com.'), ['ada@example.com']);
});

function result(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    email: 'ada@example.com',
    normalized: 'ada@example.com',
    localPart: 'ada',
    domain: 'example.com',
    status: 'deliverable',
    score: 95,
    reason: 'accepted_email',
    message: 'The mail server accepted this address.',
    checks: {
      syntax: true, mxFound: true, smtpConnected: true, mailboxExists: true,
      catchAll: false, disposable: false, roleAccount: false,
      freeProvider: false, parkedDomain: false, gibberish: false,
    },
    mx: [],
    durationMs: 12,
    checkedAt: '2026-01-01T00:00:00.000Z',
    cached: false,
    ...overrides,
  };
}

test('quotes CSV fields that contain commas or quotes', () => {
  const csv = toCsv([result({ message: 'Rejected, said "no such user"' })]);
  const [header, row] = csv.split('\r\n');
  assert.ok(header?.startsWith('email,status,score'));
  assert.ok(row?.includes('"Rejected, said ""no such user"""'));
});

test('renders a header even for an empty result set', () => {
  assert.equal(toCsv([]).split('\r\n').length, 1);
});
