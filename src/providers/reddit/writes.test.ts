import test from "node:test";
import assert from "node:assert/strict";
import { apiAction, apiUpload, apiVote, csrfToken, resetWrites } from "./writes.ts";

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
    ["save", { id: "t5_sub" }],
    ["edit", { id: "t1_abc", text: "" }],
    ["edit", { id: "t4_msg", text: "x" }],
    ["del", { id: "t4_msg" }],
    ["del", { id: "t5_sub" }],
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

// Reddit's short answer to /api/comment: no author, body or time, and `id`
// is already the full name.
const shortReply = () =>
  json({
    json: {
      errors: [],
      data: {
        things: [
          {
            kind: "t1",
            data: {
              id: "t1_new9", parent: "t1_abc", link: "t3_p1",
              contentText: "Thanks **a lot**", contentHTML: "<p>…</p>", replies: "",
            },
          },
        ],
      },
    },
  });

test("completes a short reply response from /api/info", async () => {
  resetWrites();
  const { calls, fetchFn } = fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash", id: "me42", name: "SylviaJarvis" } })
      : url.pathname === "/api/info.json"
        ? json({
            data: {
              children: [
                {
                  kind: "t1",
                  data: {
                    id: "new9", name: "t1_new9", parent_id: "t1_abc",
                    author: "SylviaJarvis", body: "Thanks **a lot**", score: 1,
                    created_utc: 1700000000, likes: true,
                    permalink: "/r/test/comments/p1/x/new9/",
                  },
                },
              ],
            },
          })
        : shortReply(),
  );
  const result = await apiAction(fetchFn, origin, "comment", {
    parent: "t1_abc",
    text: "Thanks **a lot**",
  });
  const info = new URL(calls[2]!.url);
  assert.equal(info.pathname, "/api/info.json");
  assert.equal(info.searchParams.get("id"), "t1_new9");
  assert.equal(calls[2]!.init?.method, undefined); // A read, not a write.
  assert.equal(result.id, "t1_new9");
  assert.equal(result.comment?.id, "t1_new9");
  assert.equal(result.comment?.author, "SylviaJarvis");
  assert.equal(result.comment?.body, "Thanks **a lot**");
  assert.equal(result.comment?.createdAt, 1700000000 * 1000);
  assert.equal(result.comment?.vote, 1);
});

test("builds a short reply response from the session when /api/info fails", async () => {
  resetWrites();
  const { fetchFn } = fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash", id: "me42", name: "SylviaJarvis" } })
      : url.pathname === "/api/info.json"
        ? json({}, 500)
        : shortReply(),
  );
  const before = Date.now();
  const result = await apiAction(fetchFn, origin, "comment", {
    parent: "t1_abc",
    text: "Thanks **a lot**",
  });
  assert.equal(result.comment?.id, "t1_new9");
  assert.equal(result.comment?.parentId, "t1_abc");
  assert.equal(result.comment?.author, "SylviaJarvis");
  assert.equal(result.comment?.body, "Thanks **a lot**");
  assert.ok(result.comment!.createdAt >= before);
  assert.equal(result.comment?.score, 1);
  assert.equal(result.comment?.vote, 1);
});

test("saves, unsaves, edits and deletes with their own parameters", async () => {
  resetWrites();
  const { calls, fetchFn } = signedIn();
  await apiAction(fetchFn, origin, "save", { id: "t3_abc" });
  assert.equal(new URL(calls[1]!.url).pathname, "/api/save");
  assert.deepEqual(sent(calls[1]!), { id: "t3_abc", uh: "abc123modhash", api_type: "json" });
  await apiAction(fetchFn, origin, "unsave", { id: "t1_def" });
  assert.equal(new URL(calls[2]!.url).pathname, "/api/unsave");
  await apiAction(fetchFn, origin, "edit", { id: "t1_def", text: "Fixed typo" });
  assert.equal(new URL(calls[3]!.url).pathname, "/api/editusertext");
  assert.deepEqual(sent(calls[3]!), {
    thing_id: "t1_def",
    text: "Fixed typo",
    uh: "abc123modhash",
    api_type: "json",
  });
  // The answer has no comment, so the edited one is read back.
  assert.equal(new URL(calls[4]!.url).pathname, "/api/info.json");
  await apiAction(fetchFn, origin, "del", { id: "t3_abc" });
  assert.equal(new URL(calls[5]!.url).pathname, "/api/del");
  assert.deepEqual(sent(calls[5]!), { id: "t3_abc", uh: "abc123modhash", api_type: "json" });
});

const myComment = (id: string, parent: string, created: number) => ({
  kind: "t1",
  data: {
    id, name: `t1_${id}`, parent_id: parent, author: "SylviaJarvis",
    body: "![gif](giphy|abc|downsized)", score: 1, created_utc: created, likes: true,
    permalink: `/r/test/comments/p1/x/${id}/`,
  },
});

test("finds a reply Reddit's answer leaves out among the account's newest comments", async () => {
  resetWrites();
  const now = Math.floor(Date.now() / 1000);
  const { calls, fetchFn } = fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash", id: "me42", name: "SylviaJarvis" } })
      : url.pathname === "/user/SylviaJarvis/comments.json"
        ? json({
            data: {
              children: [
                myComment("other1", "t1_zzz", now),
                myComment("new9", "t1_abc", now),
                myComment("old1", "t1_abc", now - 3600),
              ],
            },
          })
        : json({ json: { errors: [], data: {} } }),
  );
  const result = await apiAction(fetchFn, origin, "comment", {
    parent: "t1_abc",
    text: "![gif](giphy|abc)",
  });
  const listing = new URL(calls[2]!.url);
  assert.equal(listing.pathname, "/user/SylviaJarvis/comments.json");
  assert.equal(listing.searchParams.get("sort"), "new");
  assert.equal(calls[2]!.init?.method, undefined); // A read, not a write.
  assert.equal(result.comment?.id, "t1_new9");
  assert.equal(result.comment?.parentId, "t1_abc");
  assert.equal(result.comment?.author, "SylviaJarvis");
});

test("takes no earlier reply to the same parent for the one just posted", async () => {
  resetWrites();
  const { calls, fetchFn } = fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash", id: "me42", name: "SylviaJarvis" } })
      : url.pathname === "/user/SylviaJarvis/comments.json"
        ? json({ data: { children: [myComment("old1", "t1_abc", Date.now() / 1000 - 3600)] } })
        : json({ json: { errors: [], data: {} } }),
  );
  const waits: number[] = [];
  const result = await apiAction(
    fetchFn,
    origin,
    "comment",
    { parent: "t1_abc", text: "![gif](giphy|abc)" },
    async (ms) => void waits.push(ms),
  );
  assert.equal(result.comment, undefined);
  // Looked three times, a little longer apart each time, before giving up.
  assert.deepEqual(waits, [1500, 3000]);
  assert.equal(calls.filter((call) => new URL(call.url).pathname.endsWith("/comments.json")).length, 3);
});

test("looks again for a reply Reddit lists a few seconds late", async () => {
  resetWrites();
  const now = Math.floor(Date.now() / 1000);
  let looks = 0;
  const { fetchFn } = fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash", id: "me42", name: "SylviaJarvis" } })
      : url.pathname === "/user/SylviaJarvis/comments.json"
        ? json({ data: { children: looks++ ? [myComment("late1", "t1_abc", now)] : [] } })
        : json({ json: { errors: [], data: {} } }),
  );
  const waits: number[] = [];
  const result = await apiAction(
    fetchFn,
    origin,
    "comment",
    { parent: "t1_abc", text: "![gif](giphy|abc)" },
    async (ms) => void waits.push(ms),
  );
  assert.equal(result.comment?.id, "t1_late1");
  assert.deepEqual(waits, [1500]);
});

const IMAGE = { name: "image.png", type: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };
const CSRF = "d2149875bcae15a0df3d84a6457cda61";
/** New Reddit's answer to CreateMediaUploadLease (trimmed). */
const lease = (url: string) => ({
  data: {
    createMediaUploadLease: {
      mediaId: "media123",
      uploadLease: {
        uploadLeaseUrl: url,
        uploadLeaseHeaders: [
          { header: "key", value: "media123" },
          { header: "policy", value: "p0licy" },
          { header: "Content-Type", value: "image/png" },
        ],
      },
      ok: true,
      errors: null,
    },
  },
  errors: [],
  operation: "CreateMediaUploadLease",
});

test("reads new Reddit's CSRF token from its cookie", () => {
  assert.equal(csrfToken(`loid=x; csrf_token=${CSRF}; pc=td`), CSRF);
  assert.equal(csrfToken(`csrf_token=${CSRF}`), CSRF);
  assert.equal(csrfToken("loid=x; not_csrf_token=abcdefgh12"), null);
  assert.equal(csrfToken("csrf_token=<script>"), null);
  assert.equal(csrfToken(""), null);
});

test("uploads an image through new Reddit's lease to its S3 bucket without credentials", async () => {
  resetWrites();
  const { calls, fetchFn } = fakeReddit((url) =>
    url.pathname === "/svc/shreddit/graphql"
      ? json(lease("https://reddit-uploaded-media.s3-accelerate.amazonaws.com/"))
      : new Response("", { status: 201 }),
  );
  assert.deepEqual(await apiUpload(fetchFn, origin, IMAGE, CSRF), { id: "media123" });
  // No modhash: the lease is a same-origin GraphQL call with the CSRF token.
  const leased = calls[0]!;
  assert.equal(leased.url, "https://www.reddit.com/svc/shreddit/graphql");
  assert.equal(leased.init?.method, "POST");
  assert.equal(leased.init?.credentials, "same-origin");
  assert.equal((leased.init?.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(String(leased.init?.body)), {
    operation: "CreateMediaUploadLease",
    variables: { input: { mimetype: "PNG" } },
    csrf_token: CSRF,
  });
  const upload = calls[1]!;
  assert.equal(upload.url, "https://reddit-uploaded-media.s3-accelerate.amazonaws.com/");
  assert.equal(upload.init?.credentials, "omit");
  assert.equal(upload.init?.headers, undefined);
  const form = upload.init?.body as FormData;
  assert.deepEqual([...form.keys()], ["key", "policy", "Content-Type", "file"]);
  assert.equal(form.get("key"), "media123");
  assert.equal((form.get("file") as File).type, "image/png");
  assert.equal(calls.length, 2);
});

test("leases each image type under new Reddit's name for it", async () => {
  for (const [type, mimetype] of [["image/jpeg", "JPEG"], ["image/gif", "GIF"], ["image/webp", "WEBP"]]) {
    const { calls, fetchFn } = fakeReddit((url) =>
      url.pathname === "/svc/shreddit/graphql"
        ? json(lease("https://reddit-uploaded-media.s3-accelerate.amazonaws.com/"))
        : new Response("", { status: 201 }),
    );
    await apiUpload(fetchFn, origin, { ...IMAGE, type }, CSRF);
    assert.equal(JSON.parse(String(calls[0]!.init?.body)).variables.input.mimetype, mimetype);
  }
});

test("asks to sign in when there is no CSRF token, and sends nothing", async () => {
  const { calls, fetchFn } = fakeReddit(() => json({}));
  await assert.rejects(apiUpload(fetchFn, origin, IMAGE, null), /Sign in to Reddit/);
  assert.equal(calls.length, 0);
});

test("says so when Reddit refuses the upload lease", async () => {
  for (const respond of [
    () => json({}, 403),
    () => json({ data: { createMediaUploadLease: { ok: false, errors: [{ message: "Nope" }] } } }),
    () => json({ data: null, errors: [{ message: "Bad csrf" }] }),
  ]) {
    const { calls, fetchFn } = fakeReddit(respond);
    await assert.rejects(apiUpload(fetchFn, origin, IMAGE, CSRF), /refused the image upload/);
    // Nothing goes to S3.
    assert.equal(calls.length, 1);
  }
});

test("sends an upload lease nowhere but Reddit's bucket", async () => {
  for (const url of ["https://evil.example.com/", "https://reddit-uploaded-media.s3.amazonaws.com.evil.example/", "http://reddit-uploaded-media.s3-accelerate.amazonaws.com/", "//reddit-uploaded-media.s3-accelerate.amazonaws.com"]) {
    const { calls, fetchFn } = fakeReddit(() => json(lease(url)));
    await assert.rejects(apiUpload(fetchFn, origin, IMAGE, CSRF), /did not accept the image/);
    assert.equal(calls.length, 1, url);
  }
});

test("sends a reply with an uploaded image as Reddit's richtext", async () => {
  resetWrites();
  const { calls, fetchFn } = fakeReddit((url) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash" } })
      : json({ json: { errors: [], data: { things: [] } } }),
  );
  await apiAction(fetchFn, origin, "comment", { parent: "t1_abc", text: "Look\n\n![img](asset123)\n\n" });
  // Built here: Reddit's converter answers a browser session with 404.
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ["/api/me.json", "/api/comment"],
  );
  assert.deepEqual(sent(calls[1]!), {
    thing_id: "t1_abc",
    richtext_json: JSON.stringify({
      document: [{ e: "par", c: [{ e: "text", t: "Look" }] }, { e: "img", id: "asset123" }],
    }),
    uh: "abc123modhash",
    api_type: "json",
  });
  // A plain reply, or one that only links an image, stays Markdown.
  await apiAction(fetchFn, origin, "comment", { parent: "t1_abc", text: "![img](https://i.redd.it/x.png)" });
  assert.equal(new URL(calls[2]!.url).pathname, "/api/comment");
  assert.equal(sent(calls[2]!).text, "![img](https://i.redd.it/x.png)");
});

test("sends the fallback with links when Reddit refuses a reply's media by ID", async () => {
  resetWrites();
  // Refuses media by ID, takes plain Markdown.
  let answer = (body: Record<string, string>): Response =>
    body.richtext_json
      ? json({ json: { errors: [["BAD_MEDIA", "That media can't be used here.", "richtext_json"]] } })
      : json({ json: { errors: [], data: { things: [] } } });
  const { calls, fetchFn } = fakeReddit((url, init) =>
    url.pathname === "/api/me.json"
      ? json({ data: { modhash: "abc123modhash" } })
      : answer(Object.fromEntries(new URLSearchParams(String(init?.body)))),
  );
  const args = {
    parent: "t1_abc",
    text: "Look\n\n![img](asset123)\n\n",
    fallback: "Look\n\n[Image](https://i.redd.it/asset123.png)\n\n",
  };
  assert.deepEqual(await apiAction(fetchFn, origin, "comment", args), {
    linked: true,
    reason: "That media can't be used here.",
  });
  const comments = calls.filter((call) => new URL(call.url).pathname === "/api/comment");
  assert.equal(comments.length, 2);
  assert.ok(sent(comments[0]!).richtext_json);
  assert.equal(sent(comments[1]!).text, args.fallback);
  // Accepted by ID, the fallback isn't sent.
  answer = () => json({ json: { errors: [], data: { things: [] } } });
  calls.length = 0;
  assert.deepEqual(await apiAction(fetchFn, origin, "comment", args), {});
  assert.equal(calls.filter((call) => new URL(call.url).pathname === "/api/comment").length, 1);
  // A 5xx may have posted the reply, so nothing is sent again.
  answer = () => json({}, 500);
  calls.length = 0;
  await assert.rejects(apiAction(fetchFn, origin, "comment", args), /500/);
  assert.equal(calls.filter((call) => new URL(call.url).pathname === "/api/comment").length, 1);
  // Nor is a reply without media by ID, whose fallback could change nothing.
  answer = () => json({ json: { errors: [["RATELIMIT", "Take a break.", "ratelimit"]] } });
  calls.length = 0;
  await assert.rejects(
    apiAction(fetchFn, origin, "comment", { parent: "t1_abc", text: "Hi", fallback: "Hi there" }),
    /Take a break/,
  );
  assert.equal(calls.filter((call) => new URL(call.url).pathname === "/api/comment").length, 1);
  // Reddit's rate limit on the reply itself isn't about its media: no fallback.
  calls.length = 0;
  await assert.rejects(apiAction(fetchFn, origin, "comment", args), /Take a break/);
  assert.equal(calls.filter((call) => new URL(call.url).pathname === "/api/comment").length, 1);
  // A fallback Reddit asks to wait a few seconds for is sent again after them.
  let limited = 1;
  answer = (body) =>
    body.richtext_json
      ? json({ json: { errors: [["BAD_MEDIA", "That media can't be used here.", "richtext_json"]] } })
      : limited-- > 0
        ? json({ json: { errors: [["RATELIMIT", "Take a break for 5 seconds before trying again.", "ratelimit"]] } })
        : json({ json: { errors: [], data: { things: [] } } });
  const waits: number[] = [];
  const wait = async (ms: number) => void waits.push(ms);
  calls.length = 0;
  assert.equal((await apiAction(fetchFn, origin, "comment", args, wait)).linked, true);
  assert.deepEqual(waits, [6000]);
  assert.equal(calls.filter((call) => new URL(call.url).pathname === "/api/comment").length, 3);
  // A longer wait isn't waited out.
  answer = (body) =>
    body.richtext_json
      ? json({ json: { errors: [["BAD_MEDIA", "That media can't be used here.", "richtext_json"]] } })
      : json({ json: { errors: [["RATELIMIT", "Take a break for 9 minutes before trying again.", "ratelimit"]] } });
  calls.length = 0;
  await assert.rejects(apiAction(fetchFn, origin, "comment", args, wait), /9 minutes/);
  assert.deepEqual(waits, [6000]);
  assert.equal(calls.filter((call) => new URL(call.url).pathname === "/api/comment").length, 2);
  // The fallback is checked like the text, before any request.
  calls.length = 0;
  await assert.rejects(apiAction(fetchFn, origin, "comment", { ...args, fallback: 5 }));
  await assert.rejects(apiAction(fetchFn, origin, "edit", { id: "t1_abc", text: "x", fallback: "y".repeat(40001) }));
  assert.equal(calls.length, 0);
});
