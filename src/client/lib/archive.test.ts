import test from "node:test";
import assert from "node:assert/strict";
import type { CommentNode } from "../../shared/api";
import { normalizeComments } from "../../extension/reddit.ts";
import {
  ArchiveError,
  archivedComments,
  archivedPost,
  archivedReplies,
  archivedThread,
  removedComments,
  sortArchived,
  withArchived,
  withArchivedPost,
} from "./archive.ts";

const g = globalThis as any;
const requests: { url: URL; init: RequestInit }[] = [];
/** Answers each archive request from `routes`, by path. */
const serve = (routes: Record<string, unknown>) => {
  requests.length = 0;
  g.fetch = async (input: URL, init: RequestInit) => {
    requests.push({ url: input, init });
    if (!(input.pathname in routes)) return new Response("", { status: 404 });
    const body = routes[input.pathname];
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  };
};

const comment = (id: string, body: string, extra: object = {}) => ({
  kind: "t1",
  data: { id, name: `t1_${id}`, author: `u${id}`, body, created_utc: 1, ...extra },
});

test("restores a removed post from the archive without cookies or referrer", async () => {
  serve({
    "/api/posts/ids": {
      data: [
        { id: "p", title: "Original", author: "op", selftext: "Body", is_self: true, retrieved_on: 50 },
      ],
    },
  });
  const copy = await archivedPost("t3_p");
  assert.equal(requests[0]?.url.searchParams.get("ids"), "p");
  assert.equal(requests[0]?.init.credentials, "omit");
  assert.equal(requests[0]?.init.referrerPolicy, "no-referrer");
  assert.equal(copy.capturedAt, 50000);
  const live = {
    ...copy,
    title: "[ Removed by moderator ]",
    author: "[deleted]",
    body: "[removed]",
    score: 9,
    removed: "mods" as const,
  };
  const merged = withArchivedPost(live, copy);
  assert.equal(merged.title, "Original");
  assert.equal(merged.body, "Body");
  assert.equal(merged.score, 9);
  assert.equal("removed" in merged, false);
});

test("tells a missing copy from an unreachable archive", async () => {
  serve({ "/api/posts/ids": { data: [] } });
  await assert.rejects(archivedPost("p"), (e: ArchiveError) => e.kind === "missing");
  // The author deleted it later, so the archive's copy isn't shown.
  serve({
    "/api/posts/ids": { data: [{ id: "p", selftext: "x", _meta: { removal_type: "deleted" } }] },
  });
  await assert.rejects(archivedPost("p"), (e: ArchiveError) => e.kind === "missing");
  serve({ "/api/posts/ids": new TypeError("Failed to fetch") });
  await assert.rejects(archivedPost("p"), (e: ArchiveError) => e.kind === "unreachable");
  serve({ "/api/posts/ids": { data: null, error: "Query timed out" } });
  await assert.rejects(archivedPost("p"), (e: ArchiveError) => e.kind === "unreachable");
  serve({});
  await assert.rejects(archivedPost("p"), (e: ArchiveError) => e.kind === "unreachable");
});

test("fills removed comments with archived copies and marks the rest missing", async () => {
  const live = normalizeComments([
    comment("a", "[removed]", {
      author: "[deleted]",
      score: 12,
      replies: { kind: "Listing", data: { children: [comment("b", "[removed]", { author: "[deleted]" })] } },
    }),
    comment("c", "[deleted]", { author: "[deleted]" }),
    comment("d", "Visible"),
  ]).comments;
  const ids = removedComments(live);
  assert.deepEqual(ids, ["t1_a", "t1_b"]);
  serve({
    "/api/comments/ids": {
      data: [comment("a", "Restored text", { is_submitter: true }).data],
    },
  });
  const found = await archivedComments(ids);
  assert.equal(requests[0]?.url.searchParams.get("ids"), "a,b");
  const tree = withArchived(live, found, new Set(ids));
  const [a, c, d] = tree as [CommentNode, CommentNode, CommentNode];
  assert.equal(a.body, "Restored text");
  assert.equal(a.author, "ua");
  assert.equal(a.score, 12);
  assert.equal(a.isSubmitter, true);
  assert.equal(a.archive, "restored");
  assert.equal("removed" in a, false);
  assert.equal(a.replies[0]?.archive, "missing");
  assert.equal(a.replies[0]?.body, "[removed]");
  // Deleted by its author: never looked up.
  assert.equal(c.removed, "author");
  assert.equal(c.archive, undefined);
  assert.equal(d.body, "Visible");
});

test("looks up comments in batches of 500", async () => {
  serve({ "/api/comments/ids": { data: [] } });
  const ids = Array.from({ length: 501 }, (_, i) => `t1_${i.toString(36)}`);
  const found = await archivedComments(ids);
  assert.equal(found.size, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.url.searchParams.get("ids"), (500).toString(36));
});

test("builds a whole thread from the archive, blanking author deletions", async () => {
  serve({
    "/api/posts/ids": { data: [{ id: "p", title: "T", selftext: "Body", is_self: true }] },
    "/api/comments/tree": {
      data: [
        comment("a", "Kept", {
          score: 1,
          replies: {
            kind: "Listing",
            data: {
              children: [
                comment("b", "Gone later", { _meta: { removal_type: "deleted" } }),
                { kind: "more", data: { id: "m", children: ["x"] } },
              ],
            },
          },
        }),
        comment("z", "Top", { score: 5 }),
      ],
    },
  });
  const page = await archivedThread("t3_p", 100);
  const tree = requests.find((r) => r.url.pathname === "/api/comments/tree");
  assert.equal(tree?.url.searchParams.get("link_id"), "t3_p");
  assert.equal(tree?.url.searchParams.get("limit"), "100");
  assert.equal(page.post.body, "Body");
  const [a] = page.comments;
  assert.equal(a?.replies[0]?.body, "[deleted]");
  assert.equal(a?.replies[0]?.author, "[deleted]");
  assert.equal(a?.replies[0]?.removed, "author");
  assert.equal(a?.moreReplies, true);
  assert.deepEqual(
    sortArchived(page.comments, "top").map((c) => c.id),
    ["t1_z", "t1_a"],
  );
  assert.deepEqual(
    sortArchived(page.comments, "new").map((c) => c.id),
    ["t1_a", "t1_z"],
  );
});

test("loads a comment's replies from the archive's subtree", async () => {
  serve({
    "/api/comments/tree": {
      data: [
        comment("a", "Parent", {
          replies: { kind: "Listing", data: { children: [comment("b", "Child")] } },
        }),
      ],
    },
  });
  const result = await archivedReplies("t3_p", "t1_a");
  assert.equal(requests[0]?.url.searchParams.get("parent_id"), "t1_a");
  assert.deepEqual(result.replies.map((c) => c.body), ["Child"]);
  assert.equal(result.more, false);
});
