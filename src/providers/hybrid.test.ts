import test from "node:test";
import assert from "node:assert/strict";
import type { PostSummary } from "../shared/api.ts";
import {
  decodeCursor,
  encodeCursor,
  hybridPost,
  mergeFeeds,
  qualifiedName,
} from "./hybrid.ts";

const post = (id: string, createdAt = 0, more: Partial<PostSummary> = {}) =>
  ({ id, createdAt, subreddit: "test", author: "someone", ...more }) as PostSummary;
const ids = (posts: PostSummary[]) => posts.map((p) => p.id);

test("spreads each source evenly by its own rank", () => {
  const reddit = ["r1", "r2", "r3", "r4"].map((id) => post(id));
  const lemmy = ["l1", "l2"].map((id) => post(id));
  assert.deepEqual(ids(mergeFeeds([reddit, lemmy], "hot")), ["r1", "l1", "r2", "r3", "l2", "r4"]);
  // Scores don't matter: Reddit's are far larger than Lemmy's.
  assert.deepEqual(ids(mergeFeeds([[post("r", 0, { score: 50000 })], [post("l", 0, { score: 5 })]], "top")), ["r", "l"]);
  assert.deepEqual(ids(mergeFeeds([[], lemmy], "hot")), ["l1", "l2"]);
});

test("mixes New by time", () => {
  const reddit = [post("r1", 500), post("r2", 100)];
  const lemmy = [post("l1", 400), post("l2", 300), post("l3", 50)];
  assert.deepEqual(ids(mergeFeeds([reddit, lemmy], "new")), ["r1", "l1", "l2", "r2", "l3"]);
});

test("pages each source with its own cursor until all run out", () => {
  const first = decodeCursor(null, ["lemmy.world", "lemmy.ml"]);
  assert.deepEqual(first, { reddit: null, lemmy: { "lemmy.world": null, "lemmy.ml": null } });
  const after = encodeCursor({ reddit: "t3_abc", lemmy: { "lemmy.world": "Pa1", "lemmy.ml": null } });
  assert.ok(after?.startsWith("hybrid:"));
  assert.deepEqual(decodeCursor(after, ["lemmy.world", "lemmy.ml"]), {
    reddit: "t3_abc",
    lemmy: { "lemmy.world": "Pa1" },
  });
  // An instance removed since stops; Reddit running out leaves Lemmy going.
  assert.deepEqual(decodeCursor(after, ["lemmy.ml"]), { reddit: "t3_abc", lemmy: {} });
  assert.deepEqual(
    decodeCursor(encodeCursor({ reddit: null, lemmy: { "lemmy.world": "Pa2" } }), ["lemmy.world"]),
    { reddit: null, lemmy: { "lemmy.world": "Pa2" } },
  );
  assert.equal(encodeCursor({ reddit: null, lemmy: { "lemmy.world": null } }), null);
});

test("refuses a cursor it didn't write", () => {
  for (const after of ["t3_abc", "hybrid:", "hybrid:{"])
    assert.throws(() => decodeCursor(after, ["lemmy.world"]), /Invalid hybrid feed cursor/);
  // Values it can't use end their source.
  assert.deepEqual(decodeCursor("hybrid:null", ["lemmy.world"]), { reddit: null, lemmy: {} });
  const long = encodeCursor({ reddit: "x".repeat(500), lemmy: { "lemmy.world": 7 as any } });
  assert.deepEqual(decodeCursor(long, ["lemmy.world"]), { reddit: null, lemmy: {} });
});

test("writes a Lemmy post's local names with their instance", () => {
  assert.equal(qualifiedName("technology", "lemmy.world"), "technology@lemmy.world");
  assert.equal(qualifiedName("linux@lemmy.ml", "lemmy.world"), "linux@lemmy.ml");
  assert.equal(qualifiedName("[deleted]", "lemmy.world"), "[deleted]");
  assert.equal(qualifiedName("", "lemmy.world"), "");
  const shown = hybridPost(post("t3_1_x", 0, { subreddit: "memes", author: "bob@sh.itjust.works" }), "lemmy.world");
  assert.equal(shown.subreddit, "memes@lemmy.world");
  assert.equal(shown.author, "bob@sh.itjust.works");
});
