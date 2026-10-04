import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedJsonPath,
  normalizePost,
  normalizeComments,
  parseRoute,
  safeUrl,
} from "./reddit.ts";

test("recognizes supported Reddit routes and preserves sorting and search", () => {
  assert.deepEqual(
    parseRoute("https://www.reddit.com/r/typescript/top/?t=week"),
    { sub: "typescript", sort: "top", timeframe: "week" },
  );
  assert.equal(
    parseRoute("https://old.reddit.com/r/test/comments/abc/title/")?.postId,
    "t3_abc",
  );
  assert.equal(
    parseRoute("https://www.reddit.com/search/?q=hello")?.query,
    "hello",
  );
  for (const path of [
    "/login",
    "/settings",
    "/message/inbox",
    "/user/me",
    "/r/test/about/modqueue",
    "/r/test/submit",
  ])
    assert.equal(parseRoute("https://www.reddit.com" + path), null);
  assert.equal(parseRoute("https://reddit.com.evil.test/r/test"), null);
});
test("bridge allows only read-only Reddit JSON paths", () => {
  for (const path of [
    "/hot.json?raw_json=1",
    "/r/test/new.json?after=t3_abc",
    "/comments/abc.json?comment=def",
    "/r/test/about.json",
  ])
    assert.ok(allowedJsonPath(path), path);
  for (const path of [
    "//evil.test/hot.json",
    "https://www.reddit.com/hot.json",
    "/api/vote",
    "/api/comment",
    "/r/test/../../api/me.json",
    "/\\evil.test/hot.json",
    "/r/%2f/api.json",
  ])
    assert.equal(allowedJsonPath(path), false, path);
});
test("normalizes image, gallery, video, deleted text and unsafe media", () => {
  const base = {
    id: "abc",
    name: "t3_abc",
    title: "Test",
    created_utc: 100,
    permalink: "/r/test/comments/abc/test/",
    subreddit: "test",
  };
  const p = normalizePost({
    ...base,
    url: "https://i.redd.it/image.png",
    post_hint: "image",
    score: 42,
  });
  assert.equal(p.media.kind, "image");
  assert.equal(p.createdAt, 100000);
  assert.equal(p.score, 42);
  assert.equal(p.author, "[deleted]");
  const g = normalizePost({
    ...base,
    gallery_data: { items: [{ media_id: "one" }, { media_id: "missing" }] },
    media_metadata: {
      one: {
        s: { u: "https://i.redd.it/one.png?a=1&amp;b=2", x: 600, y: 400 },
      },
    },
  });
  assert.equal(g.media.kind, "gallery");
  if (g.media.kind === "gallery") {
    assert.equal(g.media.items.length, 1);
    assert.ok(g.media.items[0]!.url.includes("&b=2"));
  }
  assert.equal(
    normalizePost({
      ...base,
      media: {
        reddit_video: { fallback_url: "https://v.redd.it/abc/DASH_720.mp4" },
      },
    }).media.kind,
    "video",
  );
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,abc"), "");
});
test("preserves nested comments and missing-reply markers", () => {
  const result = normalizeComments([
    {
      kind: "t1",
      data: {
        id: "c1",
        parent_id: "t3_abc",
        body: "hello",
        replies: {
          data: {
            children: [
              {
                kind: "t1",
                data: { id: "c2", parent_id: "t1_c1", body: "nested" },
              },
              { kind: "more", data: {} },
            ],
          },
        },
      },
    },
    { kind: "more", data: {} },
  ]);
  assert.equal(result.more, true);
  assert.equal(result.comments[0]!.moreReplies, true);
  assert.equal(result.comments[0]!.replies[0]!.parentId, "t1_c1");
});
