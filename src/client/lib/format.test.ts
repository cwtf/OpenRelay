import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age, compact, duration, plural } from './format.ts';

void test('formats compact counts', () => {
  assert.equal(compact(999), '999');
  assert.equal(compact(1234), '1.2K');
  assert.equal(compact(2_500_000), '2.5M');
  assert.equal(plural(1, 'comment'), '1 comment');
  assert.equal(plural(12, 'comment'), '12 comments');
});

void test('formats relative ages', () => {
  const now = Date.UTC(2026, 0, 10);
  assert.equal(age(now - 10_000, now), 'now');
  assert.equal(age(now - 5 * 60_000, now), '5m');
  assert.equal(age(now - 3 * 3600_000, now), '3h');
  assert.equal(age(now - 2 * 86_400_000, now), '2d');
  assert.equal(age(now - 400 * 86_400_000, now), '1y');
});

void test('formats durations', () => {
  assert.equal(duration(74), '1:14');
  assert.equal(duration(5), '0:05');
});
