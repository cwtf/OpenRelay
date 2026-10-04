import test from "node:test";
import assert from "node:assert/strict";
import { apiAction, apiVote, resetWrites } from "./writes.ts";

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
  resetWrites();
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
  resetWrites();
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
  resetWrites();
  const signedOut = fakeReddit(() => json({}));
  await assert.rejects(
    apiVote(signedOut.fetchFn, origin, "t3_abc", 1),
    /Sign in to Reddit first/,
  );
  assert.equal(signedOut.calls.length, 1);

  resetWrites();
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
  resetWrites();
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

const signedIn = () =>
  fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash", id: "me42" } })
      : url.pathname === "/api/submit"
        ? json({ json: { errors: [], data: { name: "t3_new1", url: "https://www.reddit.com/r/test/comments/new1/x/" } } })
        : json({}),
  );
const sent = (call: Call) => Object.fromEntries(new URLSearchParams(String(call.init?.body)));

test("runs allow-listed actions with only their own parameters", async () => {
  resetWrites();
  const { calls, fetchFn } = signedIn();
  await apiAction(fetchFn, origin, "read_message", { id: "t4_abc", extra: "x" });
  assert.equal(new URL(calls[1]!.url).pathname, "/api/read_message");
  assert.deepEqual(sent(calls[1]!), { id: "t4_abc", uh: "abc123modhash", api_type: "json" });

  await apiAction(fetchFn, origin, "friend", { name: "spez" });
  assert.deepEqual(sent(calls[2]!), {
    name: "spez",
    type: "friend",
    container: "t2_me42",
    uh: "abc123modhash",
    api_type: "json",
  });

  const created = await apiAction(fetchFn, origin, "submit", {
    sr: "test",
    kind: "self",
    title: "Hello",
    text: "Body",
    nsfw: true,
  });
  assert.deepEqual(created, {
    id: "t3_new1",
    url: "https://www.reddit.com/r/test/comments/new1/x/",
  });
  assert.deepEqual(sent(calls[3]!), {
    sr: "test",
    kind: "self",
    title: "Hello",
    text: "Body",
    sendreplies: "true",
    nsfw: "true",
    spoiler: "false",
    resubmit: "false",
    uh: "abc123modhash",
    api_type: "json",
  });
});

test("rejects unknown actions and invalid parameters before any request", async () => {
  resetWrites();
  const { calls, fetchFn } = signedIn();
  for (const [name, args] of [
    ["vote", { id: "t3_a", dir: 1 }],
    ["delete_account", {}],
    ["__proto__", {}],
    ["del_msg", { id: "t1_comment" }],
    ["approve", { id: "t5_sub" }],
    ["compose", { to: "a b", subject: "s", text: "t" }],
    ["compose", { to: "spez", subject: "", text: "t" }],
    ["submit", { sr: "test", kind: "link", title: "x", url: "javascript:alert(1)" }],
    ["submit", { sr: "../api", kind: "self", title: "x" }],
    ["submit", { sr: "test", kind: "self", title: "x".repeat(301) }],
    ["read_message", null],
    ["subscribe", { action: "join", sr: "test" }],
    ["subscribe", { action: "sub", sr: "a/b" }],
    ["compose", { to: "/r/a/b", subject: "s", text: "t" }],
  ] as const)
    await assert.rejects(apiAction(fetchFn, origin, name, args), /Invalid request/, name);
  assert.equal(calls.length, 0);
});

test("subscribes and messages a community's moderators", async () => {
  resetWrites();
  const { calls, fetchFn } = signedIn();
  await apiAction(fetchFn, origin, "subscribe", { action: "sub", sr: "typescript" });
  assert.equal(new URL(calls[1]!.url).pathname, "/api/subscribe");
  assert.deepEqual(sent(calls[1]!), {
    action: "sub",
    sr_name: "typescript",
    skip_initial_defaults: "true",
    uh: "abc123modhash",
    api_type: "json",
  });
  await apiAction(fetchFn, origin, "subscribe", { action: "unsub", sr: "typescript" });
  assert.deepEqual(sent(calls[2]!), {
    action: "unsub",
    sr_name: "typescript",
    uh: "abc123modhash",
    api_type: "json",
  });
  await apiAction(fetchFn, origin, "compose", { to: "/r/typescript", subject: "Hi", text: "Mods" });
  assert.equal(sent(calls[3]!).to, "/r/typescript");
});

test("returns the posted reply as a comment", async () => {
  resetWrites();
  const { calls, fetchFn } = fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash", id: "me42" } })
      : json({
          json: {
            errors: [],
            data: {
              things: [
                {
                  kind: "t1",
                  data: {
                    id: "new9", name: "t1_new9", parent_id: "t1_abc", author: "me",
                    body: "Thanks **a lot**", score: 1, created_utc: 1700000000,
                    permalink: "/r/test/comments/p1/x/new9/", likes: true,
                  },
                },
              ],
            },
          },
        }),
  );
  const result = await apiAction(fetchFn, origin, "comment", {
    parent: "t1_abc",
    text: "Thanks **a lot**",
  });
  assert.deepEqual(sent(calls[1]!), {
    thing_id: "t1_abc",
    text: "Thanks **a lot**",
    uh: "abc123modhash",
    api_type: "json",
  });
  assert.equal(result.id, "t1_new9");
  assert.equal(result.comment?.id, "t1_new9");
  assert.equal(result.comment?.parentId, "t1_abc");
  assert.equal(result.comment?.body, "Thanks **a lot**");
  assert.equal(result.comment?.vote, 1);
});
