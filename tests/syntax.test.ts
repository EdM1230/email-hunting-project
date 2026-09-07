import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRoleAccount,
  looksGibberish,
  parseEmail,
  suggestCorrection,
} from '../src/lib/syntax.ts';

test('accepts ordinary addresses', () => {
  for (const email of [
    'ada@example.com',
    'ada.lovelace@sub.example.co.uk',
    "o'brien+tag@example.io",
    'a_b-c@example-corp.com',
  ]) {
    assert.equal(parseEmail(email).valid, true, `${email} should be valid`);
  }
});

test('rejects malformed addresses', () => {
  for (const email of [
    '', 'ada', 'ada@', '@example.com', 'ada@@example.com',
    'ada@example', 'ada..lovelace@example.com', '.ada@example.com',
    'ada.@example.com', 'ada@example..com', 'ada@-example.com',
    'ada@example.1',
  ]) {
    assert.equal(parseEmail(email).valid, false, `${email} should be invalid`);
  }
});

test('lowercases the domain but preserves the local part', () => {
  const parsed = parseEmail('  Ada.Lovelace@EXAMPLE.COM ');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.normalized, 'Ada.Lovelace@example.com');
  assert.equal(parsed.domain, 'example.com');
  assert.equal(parsed.localPart, 'Ada.Lovelace');
});

test('enforces the RFC length limits', () => {
  assert.equal(parseEmail(`${'a'.repeat(65)}@example.com`).valid, false);
  assert.equal(parseEmail(`${'a'.repeat(64)}@example.com`).valid, true);
  assert.equal(parseEmail(`${'a'.repeat(250)}@example.com`).valid, false);
});

test('suggests corrections for common domain typos', () => {
  assert.equal(suggestCorrection('gmial.com'), 'gmail.com');
  assert.equal(suggestCorrection('hotnail.com'), 'hotmail.com');
  assert.equal(suggestCorrection('example.com'), undefined);
});

test('detects role accounts, including punctuated variants', () => {
  assert.equal(isRoleAccount('info'), true);
  assert.equal(isRoleAccount('SUPPORT'), true);
  assert.equal(isRoleAccount('no-reply'), true);
  assert.equal(isRoleAccount('help.desk'), true);
  assert.equal(isRoleAccount('ada'), false);
  assert.equal(isRoleAccount('ada.lovelace'), false);
});

test('flags machine-generated local parts without punishing real names', () => {
  assert.equal(looksGibberish('xkzrtqvbnmwp'), true);
  assert.equal(looksGibberish('849302847502'), true);
  assert.equal(looksGibberish('ada.lovelace'), false);
  assert.equal(looksGibberish('christopher'), false);
  assert.equal(looksGibberish('jose.hernandez'), false);
  assert.equal(looksGibberish('bob'), false, 'short names must not be judged');
});
