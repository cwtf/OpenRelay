import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, parseBlocks } from './markdownParser.ts';

void test('decodes Reddit entities, dropping zero-width spaces', () => {
  assert.equal(
    decodeEntities('a &amp; b &gt; c &#x200B;d &#39;e&#39;'),
    "a & b > c d 'e'"
  );
  assert.equal(decodeEntities('&amp;gt;'), '&gt;');
});

void test('splits paragraphs on blank lines and keeps soft breaks', () => {
  const blocks = parseBlocks('one\ntwo\n\nthree');
  assert.deepEqual(blocks, [
    { t: 'p', text: 'one\ntwo' },
    { t: 'p', text: 'three' },
  ]);
});

void test('parses quotes with lazy continuation but not spoilers', () => {
  const [quote, spoiler] = parseBlocks('> quoted\nstill quoted\n\n>!secret!<');
  assert.equal(quote?.t, 'quote');
  if (quote?.t === 'quote') {
    assert.deepEqual(quote.children, [
      { t: 'p', text: 'quoted\nstill quoted' },
    ]);
  }
  assert.deepEqual(spoiler, { t: 'p', text: '>!secret!<' });
});

void test('parses nested lists', () => {
  const [list] = parseBlocks(
    '1. first\n2. second\n   - inner a\n   - inner b\n3. third'
  );
  assert.equal(list?.t, 'list');
  if (list?.t !== 'list') return;
  assert.equal(list.ordered, true);
  assert.equal(list.items.length, 3);
  const second = list.items[1];
  assert.equal(second?.[1]?.t, 'list');
});

void test('respects ordered list start numbers', () => {
  const [list] = parseBlocks('4. four\n5. five');
  assert.ok(list?.t === 'list' && list.start === 4);
});

void test('parses fenced and indented code verbatim', () => {
  const blocks = parseBlocks(
    '```\n**not bold**\n```\n\n    indented\n    code'
  );
  assert.deepEqual(blocks, [
    { t: 'code', text: '**not bold**' },
    { t: 'code', text: 'indented\ncode' },
  ]);
});

void test('parses tables with alignment', () => {
  const [table] = parseBlocks('| a | b |\n|:--|--:|\n| 1 | 2 |');
  assert.deepEqual(table, {
    t: 'table',
    align: ['left', 'right'],
    head: ['a', 'b'],
    rows: [['1', '2']],
  });
});

void test('parses headings and rules', () => {
  assert.deepEqual(parseBlocks('## Title ##\n\n***'), [
    { t: 'h', level: 2, text: 'Title' },
    { t: 'hr' },
  ]);
});

void test('survives pathological nesting', () => {
  const deep = '>'.repeat(200) + ' deep';
  assert.doesNotThrow(() => parseBlocks(deep));
});
