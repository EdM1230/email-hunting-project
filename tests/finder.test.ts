import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCandidates, normalizeName, splitFullName } from '../src/lib/finder.ts';

test('strips accents, case and punctuation from names', () => {
  assert.equal(normalizeName('José'), 'jose');
  assert.equal(normalizeName("O'Brien"), 'obrien');
  assert.equal(normalizeName('Núñez-Ruiz'), 'nunezruiz');
  assert.equal(normalizeName('  Ada  '), 'ada');
});

test('splits full names into first and last', () => {
  assert.deepEqual(splitFullName('Ada Lovelace'), { first: 'Ada', last: 'Lovelace' });
  assert.deepEqual(splitFullName('Ada King Lovelace'), { first: 'Ada', last: 'Lovelace' });
  assert.deepEqual(splitFullName('Ada'), { first: 'Ada', last: '' });
  assert.deepEqual(splitFullName('  '), { first: '', last: '' });
});

test('orders candidates by how common the pattern is', () => {
  const candidates = buildCandidates('Ada', 'Lovelace', 'Example.com');
  assert.equal(candidates[0]?.email, 'ada.lovelace@example.com');
  assert.equal(candidates[0]?.pattern, '{first}.{last}');
  assert.ok(candidates.some((c) => c.email === 'alovelace@example.com'));
  assert.ok(candidates.some((c) => c.email === 'adalovelace@example.com'));
});

test('emits no duplicate candidates', () => {
  const candidates = buildCandidates('Ada', 'Lovelace', 'example.com');
  assert.equal(new Set(candidates.map((c) => c.email)).size, candidates.length);
});

test('skips last-name patterns when only a first name is known', () => {
  const candidates = buildCandidates('Ada', '', 'example.com');
  assert.deepEqual(candidates.map((c) => c.email), ['ada@example.com']);
});
