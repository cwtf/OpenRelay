import test from "node:test";
import assert from "node:assert/strict";
import { apiVote, resetApiVote } from "./apiVote.ts";

type Call = { url: string; init: RequestInit | undefined };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fakeReddit = (
  respond: (url: URL, init: RequestInit | undefined) => Response,
) => {
  const calls: Call[] = [];
  const fetchFn = (async (input: URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond(new URL(String(input)), init);
  }) as typeof fetch;
  return { calls, fetchFn };
};

const origin = "https://www.reddit.com";

test("casts a same-origin vote with the session modhash", async () => {
  resetApiVote();
  const { calls, fetchFn } = fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash" } })
      : json({}),
  );
  const result = await apiVote(fetchFn, origin, "t1_xyz", -1);
  assert.deepEqual(result, {
    available: true,
    vote: -1,
    status: "changed",
    via: "api",
  });
  assert.equal(calls.length, 2);
  const vote = calls[1]!;
  assert.equal(vote.url, "https://www.reddit.com/api/vote");
  assert.equal(vote.init?.method, "POST");
  assert.equal(vote.init?.credentials, "same-origin");
  assert.equal(
    (vote.init?.headers as Record<string, string>)["X-Modhash"],
    "abc123modhash",
  );
  const body = new URLSearchParams(String(vote.init?.body));
  assert.equal(body.get("id"), "t1_xyz");
  assert.equal(body.get("dir"), "-1");
  assert.equal(body.get("uh"), "abc123modhash");

  // The modhash is reused for later votes.
  await apiVote(fetchFn, origin, "t3_abc", 0);
  assert.equal(calls.length, 3);
});

test("refreshes a stale modhash once after a 403", async () => {
  resetApiVote();
  let hashes = 0;
  let votes = 0;
  const { fetchFn } = fakeReddit((url) => {
    if (url.pathname === "/api/me.json")
      return json({ data: { modhash: "modhash" + ++hashes } });
    return ++votes === 1 ? json({}, 403) : json({});
  });
  const result = await apiVote(fetchFn, origin, "t3_abc", 1);
  assert.equal(result.status, "changed");
  assert.equal(hashes, 2);
  assert.equal(votes, 2);
});

test("requires a signed-in session and reports Reddit's errors", async () => {
  resetApiVote();
  const signedOut = fakeReddit(() => json({}));
  await assert.rejects(
    apiVote(signedOut.fetchFn, origin, "t3_abc", 1),
    /Sign in to Reddit to vote/,
  );
  assert.equal(signedOut.calls.length, 1);

  resetApiVote();
  const archived = fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash" } })
      : json({ json: { errors: [["TOO_OLD", "that's a piece of history now"]] } }),
  );
  await assert.rejects(
    apiVote(archived.fetchFn, origin, "t3_abc", 1),
    /piece of history/,
  );
});

test("rejects malformed votes before any request", async () => {
  resetApiVote();
  const { calls, fetchFn } = fakeReddit(() => json({}));
  for (const [id, dir] of [
    ["t2_user", 1],
    ["t3_ok", 2],
    ["t3_ok", "1"],
    [null, 0],
  ])
    await assert.rejects(apiVote(fetchFn, origin, id, dir), /Invalid vote/);
  assert.equal(calls.length, 0);
});
