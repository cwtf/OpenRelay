import test from "node:test";
import assert from "node:assert/strict";
import { hostTag } from "./lemmy.ts";
import { lemmyAction, lemmyVote, resetLemmyWrites, sessionToken } from "./writes.ts";

const ORIGIN = "https://lemmy.world";
const TAG = hostTag("lemmy.world");
const TOKEN = "aaa.bbb.ccc";

type Sent = { method: string; path: string; auth: string | null; body: any };
function fakeFetch(answers: Record<string, unknown>, status = 200) {
  const sent: Sent[] = [];
  const fetchFn = (async (url: URL, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    sent.push({
      method: String(init.method),
      path: url.pathname + url.search,
      auth: headers.Authorization ?? null,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    const answer = answers[url.pathname] ?? {};
    return new Response(JSON.stringify(answer), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, sent };
}

test("reads lemmy-ui's sign-in token from its cookie", () => {
  assert.equal(sessionToken(`theme=dark; jwt=${TOKEN}; x=1`), TOKEN);
  assert.equal(sessionToken("theme=dark"), null);
  assert.equal(sessionToken("jwt=not a token"), null);
});

test("votes on this instance's posts and comments only", async () => {
  resetLemmyWrites();
  const { fetchFn, sent } = fakeFetch({ "/api/v3/post/like": { post_view: { my_vote: 1 } } });
  assert.deepEqual(await lemmyVote(fetchFn, ORIGIN, TOKEN, `t3_101_${TAG}`, 1), {
    available: true,
    vote: 1,
    status: "changed",
    via: "api",
  });
  assert.deepEqual(sent, [
    { method: "POST", path: "/api/v3/post/like", auth: `Bearer ${TOKEN}`, body: { post_id: 101, score: 1 } },
  ]);
  for (const id of ["t3_101_othertag", "t3_abc123", "t5_1_" + TAG, 101])
    await assert.rejects(lemmyVote(fetchFn, ORIGIN, TOKEN, id, 1), /Invalid request/);
  await assert.rejects(lemmyVote(fetchFn, ORIGIN, TOKEN, `t1_5_${TAG}`, 2), /Invalid request/);
  assert.equal(sent.length, 1);
});

test("replies to a comment with its post, and returns the new comment", async () => {
  const { fetchFn, sent } = fakeFetch({
    "/api/v3/comment": {
      comment_view: {
        comment: { id: 300, post_id: 101, content: "Thanks!", path: "0.201.300", published: "2026-11-01T00:00:00Z" },
        creator: { id: 1, name: "me", local: true },
        post: { id: 101, creator_id: 70 },
        counts: { score: 1, child_count: 0 },
        my_vote: 1,
      },
    },
  });
  const result = await lemmyAction(fetchFn, ORIGIN, null, "comment", { parent: `t1_201_${TAG}`, text: "Thanks!" });
  // The first call (GET) finds the parent's post; the answer is reused here.
  assert.equal(sent[0]!.method, "GET");
  assert.equal(sent[0]!.path, "/api/v3/comment?id=201");
  assert.deepEqual(sent[1], {
    method: "POST",
    path: "/api/v3/comment",
    auth: null,
    body: { post_id: 101, parent_id: 201, content: "Thanks!" },
  });
  assert.equal(result.comment?.id, `t1_300_${TAG}`);
  assert.equal(result.comment?.parentId, `t1_201_${TAG}`);
  assert.equal(result.comment?.vote, 1);
});

test("saves, deletes, subscribes and posts with Lemmy's IDs", async () => {
  const { fetchFn, sent } = fakeFetch({
    "/api/v3/community": { community_view: { community: { id: 9 } } },
    "/api/v3/post": { post_view: { post: { id: 555 } } },
  });
  await lemmyAction(fetchFn, ORIGIN, TOKEN, "save", { id: `t1_201_${TAG}` });
  await lemmyAction(fetchFn, ORIGIN, TOKEN, "del", { id: `t3_101_${TAG}` });
  await lemmyAction(fetchFn, ORIGIN, TOKEN, "subscribe", { action: "unsub", sr: "linux@lemmy.ml" });
  const posted = await lemmyAction(fetchFn, ORIGIN, TOKEN, "submit", {
    sr: "linux@lemmy.ml",
    kind: "self",
    title: "Hello",
    text: "Body",
  });
  assert.deepEqual(
    sent.map((s) => [s.method, s.path, s.body]),
    [
      ["PUT", "/api/v3/comment/save", { comment_id: 201, save: true }],
      ["POST", "/api/v3/post/delete", { post_id: 101, deleted: true }],
      ["GET", "/api/v3/community?name=linux%40lemmy.ml", null],
      ["POST", "/api/v3/community/follow", { community_id: 9, follow: false }],
      ["GET", "/api/v3/community?name=linux%40lemmy.ml", null],
      ["POST", "/api/v3/post", { name: "Hello", community_id: 9, body: "Body", nsfw: false }],
    ],
  );
  assert.deepEqual(posted, { id: `t3_555_${TAG}` });
});

test("refuses unknown or invalid writes before sending anything", async () => {
  const { fetchFn, sent } = fakeFetch({});
  await assert.rejects(lemmyAction(fetchFn, ORIGIN, TOKEN, "approve", { id: `t3_1_${TAG}` }), /can't do that on Lemmy/);
  await assert.rejects(lemmyAction(fetchFn, ORIGIN, TOKEN, "comment", { parent: `t3_1_${TAG}`, text: "  " }), /Invalid request/);
  await assert.rejects(lemmyAction(fetchFn, ORIGIN, TOKEN, "subscribe", { action: "sub", sr: "bad name" }), /Invalid request/);
  await assert.rejects(lemmyAction(fetchFn, ORIGIN, TOKEN, "submit", { sr: "linux", kind: "link", title: "x", url: "javascript:alert(1)" }), /Invalid request/);
  assert.equal(sent.length, 0);
});

test("explains Lemmy's errors", async () => {
  const { fetchFn } = fakeFetch({ "/api/v3/post/save": { error: "not_logged_in" } }, 400);
  await assert.rejects(lemmyAction(fetchFn, ORIGIN, null, "save", { id: `t3_1_${TAG}` }), /Sign in to Lemmy first/);
});
