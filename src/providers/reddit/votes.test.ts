import test from "node:test";
import assert from "node:assert/strict";
import { forwardVote, isThingId } from "./votes.ts";
test("only accepts full Reddit post/comment identifiers", () => {
  for (const id of ["t3_abc123", "t1_9xyz"]) assert.equal(isThingId(id), true);
  for (const id of ["abc123", "t2_abc", "t3_abc button", null, {}, ["t3_abc"]])
    assert.equal(isThingId(id), false);
});
test("rejects malformed forwarding operations before reading or clicking the page", async () => {
  const doc = new Proxy(
    {},
    {
      get() {
        throw new Error("DOM must not be touched");
      },
    },
  ) as Document;
  for (const [id, direction] of [
    ["t2_bad", 1],
    ["t3_ok", 0],
    ["t3_ok", 2],
    ["t3_ok", "1"],
    [null, -1],
  ]) {
    await assert.rejects(
      forwardVote(doc, id, direction),
      /Invalid vote request/,
    );
  }
});
