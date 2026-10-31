import test from "node:test";
import assert from "node:assert/strict";
import type { PostSummary } from "../../shared/api";
import { pickUnsaved, type FeedPage } from "./offlinePick.ts";

const post = (id: string, kind = "self") =>
  ({ id: `t3_${id}`, media: { kind } }) as unknown as PostSummary;
/** A feed of pages: `pages[cursor]` is the page after that cursor. */
const feed = (pages: Record<string, FeedPage>) => {
  const asked: string[] = [];
  return {
    asked,
    more: async (after: string) => {
      asked.push(after);
      const page = pages[after];
      if (!page) throw new Error("HTTP 500");
      return page;
    },
  };
};

test("saved posts are skipped and the next ones are taken, in order", async () => {
  const saved = new Set(["t3_a", "t3_c"]);
  const ids = await pickUnsaved(
    { posts: ["a", "b", "c", "d", "e"].map((id) => post(id)), after: "t3_e" },
    2,
    { skip: (id) => saved.has(id), more: async () => assert.fail("no more pages needed") },
  );
  assert.deepEqual(ids, ["t3_b", "t3_d"]);
});

test("further pages are read until enough posts are found", async () => {
  const pages = feed({
    t3_b: { posts: [post("b"), post("c"), post("d", "image")], after: "t3_d" },
    t3_d: { posts: [post("e"), post("f")], after: "t3_f" },
  });
  const before: number[] = [];
  const ids = await pickUnsaved({ posts: [post("a"), post("b")], after: "t3_b" }, 4, {
    skip: (id) => id === "t3_a",
    only: (p) => p.media.kind === "self",
    more: pages.more,
    beforePage: (page) => void before.push(page),
  });
  // b came again on the next page; it's counted once.
  assert.deepEqual(ids, ["t3_b", "t3_c", "t3_e", "t3_f"]);
  assert.deepEqual(pages.asked, ["t3_b", "t3_d"]);
  assert.deepEqual(before, [0, 1]);
});

test("the end of the feed, a failing page or the page limit stops the search", async () => {
  const ended = feed({ t3_a: { posts: [post("b")], after: null } });
  assert.deepEqual(
    await pickUnsaved({ posts: [post("a")], after: "t3_a" }, 10, { skip: () => false, more: ended.more }),
    ["t3_a", "t3_b"],
  );
  const failing = feed({});
  assert.deepEqual(
    await pickUnsaved({ posts: [post("a")], after: "t3_a" }, 10, { skip: () => false, more: failing.more }),
    ["t3_a"],
  );
  // A feed of only saved posts gives up after `maxPages` pages.
  let asked = 0;
  const ids = await pickUnsaved({ posts: [], after: "x" }, 10, {
    skip: () => true,
    more: async (after) => {
      asked++;
      return { posts: [post(after + "1")], after: after + "1" };
    },
    maxPages: 3,
  });
  assert.deepEqual(ids, []);
  assert.equal(asked, 3);
});
