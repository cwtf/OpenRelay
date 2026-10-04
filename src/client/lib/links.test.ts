import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInlineImage, normaliseHref, resolveLink } from './links.ts';

void test('opens Reddit post permalinks in the reader', () => {
  assert.deepEqual(
    resolveLink('https://www.reddit.com/r/pics/comments/abc123/some_title/'),
    {
      kind: 'post',
      id: 'abc123',
    }
  );
  assert.deepEqual(resolveLink('https://old.reddit.com/comments/xyz9'), {
    kind: 'post',
    id: 'xyz9',
  });
  assert.deepEqual(resolveLink('https://redd.it/q1w2e3'), {
    kind: 'post',
    id: 'q1w2e3',
  });
});

void test('opens community links in the reader', () => {
  assert.deepEqual(resolveLink('/r/AskScience'), {
    kind: 'sub',
    name: 'AskScience',
  });
  assert.deepEqual(resolveLink('r/pottery'), { kind: 'sub', name: 'pottery' });
  assert.deepEqual(resolveLink('https://reddit.com/r/news/'), {
    kind: 'sub',
    name: 'news',
  });
});

void test('sends everything else to the browser', () => {
  assert.deepEqual(resolveLink('https://example.com/a?b=c'), {
    kind: 'external',
    url: 'https://example.com/a?b=c',
  });
  assert.deepEqual(resolveLink('/u/spez'), {
    kind: 'external',
    url: 'https://www.reddit.com/u/spez',
  });
});

void test('rejects unsafe schemes', () => {
  assert.equal(normaliseHref('javascript:alert(1)'), null);
  assert.equal(normaliseHref('data:text/html,hi'), null);
  assert.equal(resolveLink('javascript:alert(1)'), null);
});

void test('detects inline-able image links', () => {
  assert.ok(
    isInlineImage('https://preview.redd.it/abc.jpeg?width=640&format=pjpg')
  );
  assert.ok(isInlineImage('https://i.redd.it/xyz.png'));
  assert.ok(!isInlineImage('https://example.com/cat.png'));
  assert.ok(!isInlineImage('https://i.redd.it/xyz.png" onerror="x'));
});
