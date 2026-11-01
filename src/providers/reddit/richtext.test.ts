import test from "node:test";
import assert from "node:assert/strict";
import { hasMediaRef, toRichtext } from "./richtext.ts";

const doc = (markdown: string) => JSON.parse(toRichtext(markdown)).document;

test("finds media by ID, not images linked by URL or emotes", () => {
  assert.equal(hasMediaRef("![gif](giphy|abc123)"), true);
  assert.equal(hasMediaRef("a ![img](asset1) b"), true);
  assert.equal(hasMediaRef("![img](https://i.redd.it/x.png)"), false);
  assert.equal(hasMediaRef("![img](emote|t5_2qh1i|1234)"), false);
  assert.equal(hasMediaRef("no media"), false);
});

test("puts media in blocks of their own, a bare Giphy GIF downsized as Reddit names it", () => {
  assert.deepEqual(doc("![gif](giphy|hMN4LbnxS2tMY29Vc1)"), [
    { e: "gif", id: "giphy|hMN4LbnxS2tMY29Vc1|downsized" },
  ]);
  assert.deepEqual(doc("Before ![img](asset1) after\n\n![gif](giphy|g1|downsized)"), [
    { e: "par", c: [{ e: "text", t: "Before" }] },
    { e: "img", id: "asset1" },
    { e: "par", c: [{ e: "text", t: "after" }] },
    { e: "gif", id: "giphy|g1|downsized" },
  ]);
});

test("keeps inline formatting as ranges in code points", () => {
  assert.deepEqual(doc("😀 **bold _both_** ~~gone~~ `x` ^up"), [
    {
      e: "par",
      c: [
        {
          e: "text",
          t: "😀 bold both gone x up",
          f: [[1, 2, 5], [3, 7, 4], [8, 12, 4], [64, 17, 1], [32, 19, 2]],
        },
      ],
    },
  ]);
});

test("converts links, mentions, spoilers and line breaks", () => {
  assert.deepEqual(doc("[see **this**](https://example.com) r/pics /u/someone >!secret!< https://a.b/c.\nnext  \nline"), [
    {
      e: "par",
      c: [
        { e: "link", u: "https://example.com", t: "see this", f: [[1, 4, 4]] },
        { e: "text", t: " " },
        { e: "r/", t: "pics", l: false },
        { e: "text", t: " " },
        { e: "u/", t: "someone", l: true },
        { e: "text", t: " " },
        { e: "spoilertext", c: [{ e: "text", t: "secret" }] },
        { e: "text", t: " " },
        { e: "link", u: "https://a.b/c", t: "https://a.b/c" },
        { e: "text", t: ". next" },
        { e: "br" },
        { e: "text", t: "line" },
      ],
    },
  ]);
});

test("converts headings, quotes, lists, code and rules", () => {
  assert.deepEqual(doc("# Title\n\n> quoted\n\n1. one\n2. two\n\n```\ncode\n```\n\n---"), [
    { e: "h", l: 1, c: [{ e: "text", t: "Title" }] },
    { e: "blockquote", c: [{ e: "par", c: [{ e: "text", t: "quoted" }] }] },
    {
      e: "list",
      o: true,
      c: [
        { e: "li", c: [{ e: "par", c: [{ e: "text", t: "one" }] }] },
        { e: "li", c: [{ e: "par", c: [{ e: "text", t: "two" }] }] },
      ],
    },
    { e: "code", c: [{ e: "raw", t: "code" }] },
    { e: "hr" },
  ]);
});
