import test from "node:test";
import assert from "node:assert/strict";

import type { CommentNode } from "../../shared/api.ts";
import { withMoreReplies } from "./replies.ts";

const node = (id: string, replies: CommentNode[] = []): CommentNode => ({
  id,
  parentId: "",
  author: "someone",
  body: id,
  score: 1,
  createdAt: 0,
  edited: false,
  stickied: false,
  locked: false,
  isSubmitter: false,
  permalink: "",
  replies,
  moreReplies: true,
});
const ids = (n: CommentNode) => n.replies.map((reply) => reply.id);

test("keeps the replies shown when only later ones arrive, as from Reddit's HTML", () => {
  const parent = node("t1_p", [node("t1_a")]);
  const next = withMoreReplies(parent, { replies: [node("t1_b"), node("t1_c")], more: true });
  assert.deepEqual(ids(next), ["t1_a", "t1_b", "t1_c"]);
  assert.equal(next.moreReplies, true);
  const last = withMoreReplies(next, { replies: [node("t1_d")], more: false });
  assert.deepEqual(ids(last), ["t1_a", "t1_b", "t1_c", "t1_d"]);
  assert.equal(last.moreReplies, false);
});

test("takes the whole list when all replies arrive again, as from Reddit's JSON", () => {
  const parent = node("t1_p", [node("t1_a")]);
  const next = withMoreReplies(parent, {
    replies: [node("t1_b"), node("t1_a", [node("t1_x")])],
    more: false,
  });
  assert.deepEqual(ids(next), ["t1_b", "t1_a"]);
  assert.deepEqual(ids(next.replies[1]!), ["t1_x"]);
});

test("stops offering more when a load adds nothing", () => {
  const parent = node("t1_p", [node("t1_a")]);
  const next = withMoreReplies(parent, { replies: [node("t1_a")], more: true });
  assert.equal(next.moreReplies, false);
});
