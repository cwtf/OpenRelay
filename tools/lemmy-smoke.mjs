// Lemmy in the real extension: add an instance from the drawer's source
// switcher, read its feed, a post and its comment tree through Lemmy's API,
// switch back to Reddit, mix it into Reddit's front page as the hybrid feed,
// and remove it again. Fixture pages and API answers
// only (shaped like lemmy.world's, Lemmy 0.19); no real site is contacted.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = resolve("test-results");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(resolve(out, "lemmy-profile-"));
// Third-party cookies blocked, as in browser-smoke: no localStorage in the frame.
await mkdir(resolve(profile, "Default"));
await writeFile(
  resolve(profile, "Default/Preferences"),
  JSON.stringify({
    profile: { cookie_controls_mode: 1, block_third_party_cookies: true },
  }),
);
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    `--disable-extensions-except=${resolve("dist")}`,
    `--load-extension=${resolve("dist")}`,
  ],
  viewport: { width: 1280, height: 900 },
});
const errors = [];

// -- Reddit: just enough for the reader to open on r/test.
const redditPage = `<!doctype html><html><head><title>Reddit fixture</title></head><body><shreddit-post id="t3_abc123" post-title="A Reddit post" author="example_user" subreddit-prefixed-name="r/test" permalink="/r/test/comments/abc123/a_reddit_post/" content-href="https://www.reddit.com/r/test/comments/abc123/a_reddit_post/" post-type="text" score="5" comment-count="0" created-timestamp="2023-11-14T22:13:20Z"><div slot="text-body">Reddit text.</div></shreddit-post></body></html>`;
await context.route(/^https:\/\/www\.reddit\.com\//, (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith(".json"))
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        url.pathname === "/api/me.json"
          ? {}
          : url.pathname.endsWith("/about.json")
            ? { data: { display_name: "test", title: "Test community" } }
            : { kind: "Listing", data: { children: [], after: null } },
      ),
    });
  return route.fulfill({ contentType: "text/html", body: redditPage });
});

// -- Lemmy: lemmy-ui pages and Lemmy's v3 API on one origin.
const creator = (id, name, host) => ({
  id, name, local: !host, actor_id: `https://${host ?? "lemmy.world"}/u/${name}`,
});
const linux = { id: 9, name: "linux", title: "Linux", actor_id: "https://lemmy.ml/c/linux", local: false, nsfw: false, description: "All things Linux.\n\nBe nice." };
const postView = (id, name, extra = {}) => ({
  post: { id, name, body: "", creator_id: 70, published: "2026-10-31T18:06:09.395174Z", locked: false, deleted: false, removed: false, nsfw: false, featured_community: false, featured_local: false, ...extra },
  creator: creator(70, "poster", "lemmy.ml"),
  community: linux,
  counts: { score: 42, comments: 4 },
  subscribed: "Subscribed",
  saved: false,
  my_vote: 0,
});
const textPost = postView(101, "Which distro for an old laptop?", {
  body: "It has **4 GB** of RAM. Also asked in !linux@lemmy.ml\n\n::: spoiler Full specs\nIntel Atom N270\n:::",
});
const imagePost = postView(102, "My desktop", {
  url: "https://lemmy.world/pictrs/image/desk.png",
  url_content_type: "image/png",
  thumbnail_url: "https://lemmy.world/pictrs/image/desk-thumb.png",
});
const commentView = (id, path, content, childCount) => ({
  comment: { id, post_id: 101, content, path, published: "2026-10-31T19:00:00Z", deleted: false, removed: false, distinguished: false },
  creator: creator(id, `user${id}`),
  post: { id: 101, creator_id: 70, locked: false },
  community: linux,
  counts: { score: 3, child_count: childCount },
  my_vote: 0,
});
const comments = [
  commentView(201, "0.201", "First comment", 1),
  commentView(202, "0.201.202", "Nested reply", 0),
  // Lemmy counts a reply that this page of comments left out.
  commentView(203, "0.203", "Has a hidden reply", 1),
];
const hidden = commentView(204, "0.203.204", "The hidden reply", 0);
const site = {
  my_user: {
    local_user_view: { person: { name: "lemmy_user" } },
    follows: [{ community: linux }],
    moderates: [],
  },
};
const lemmyReads = [];
const lemmyWrites = [];
// The hybrid feed's reads, which the reader makes itself, signed out.
const readerReads = [];
await context.route(/^https:\/\/lemmy\.world\//, async (route) => {
  const url = new URL(route.request().url());
  const headers = await route.request().allHeaders();
  if (route.request().method() !== "GET") {
    const body = JSON.parse(route.request().postData() || "{}");
    lemmyWrites.push({
      method: route.request().method(),
      path: url.pathname,
      body,
      auth: route.request().headers().authorization ?? null,
    });
    const reply = url.pathname === "/api/v3/comment"
      ? { comment_view: { ...commentView(300, `0.${body.parent_id}.300`, body.content, 0), creator: creator(1, "lemmy_user"), my_vote: 1 } }
      : url.pathname === "/api/v3/post/like"
        ? { post_view: { ...textPost, my_vote: body.score } }
        : {};
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(reply) });
  }
  if (!url.pathname.startsWith("/api/")) {
    if (url.pathname.startsWith("/pictrs/"))
      return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    // Like Cloudflare's bot check, which some instances put in front of lemmy-ui.
    if (url.searchParams.has("challenge"))
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><title>Just a moment...</title><form id="challenge-form"></form>',
      });
    // lemmy-ui renders into #root and hands its state over in window.isoData.
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Lemmy fixture</title><div id=\"root\"><h1>Lemmy fixture</h1></div><script>window.isoData = {};</script>",
    });
  }
  lemmyReads.push(url.pathname + url.search);
  if (route.request().frame().url().startsWith("chrome-extension://"))
    readerReads.push({
      path: url.pathname + url.search,
      cookie: headers.cookie ?? null,
      auth: headers.authorization ?? null,
    });
  // Lemmy's API allows any origin, as lemmy.world's does.
  const answer = (body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": headers.origin ?? "*", vary: "Origin" },
      body: JSON.stringify(body),
    });
  switch (url.pathname) {
    case "/api/v3/site":
      return answer(site);
    case "/api/v3/user/replies":
      return answer({
        replies: [{ ...commentView(201, "0.201", "First comment", 1), comment_reply: { id: 1201, read: true }, recipient: creator(1, "lemmy_user") }],
      });
    case "/api/v3/user/mention":
      return answer({ mentions: [] });
    case "/api/v3/private_message/list":
      return answer({
        private_messages: [
          {
            private_message: { id: 77, content: "Welcome to Lemmy!", read: false, published: "2026-11-01T01:00:00Z", deleted: false },
            creator: creator(5, "admin"),
            recipient: creator(1, "lemmy_user"),
          },
        ],
      });
    case "/api/v3/user/unread_count":
      return answer({ replies: 2, mentions: 0, private_messages: 0 });
    case "/api/v3/post/list":
      return answer({ posts: [textPost, imagePost] });
    case "/api/v3/post":
      return url.searchParams.get("id") === "101"
        ? answer({ post_view: textPost, community_view: { community: linux, counts: {} }, moderators: [] })
        : answer({ error: "couldnt_find_post" }, 404);
    case "/api/v3/comment/list":
      return answer({
        comments: url.searchParams.get("parent_id") === "203" ? [comments[2], hidden] : comments,
      });
    case "/api/v3/community":
      return answer({
        community_view: { community: linux, counts: { subscribers: 1234, users_active_day: 56 }, subscribed: "Subscribed" },
        moderators: [{ moderator: creator(5, "mod", "lemmy.ml") }],
      });
    default:
      return answer({ error: "not_found" }, 404);
  }
});
// A site that loads the reader in a frame without being added.
await context.route("https://evil.example/**", (route) =>
  route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Evil</title>" }),
);

// lemmy-ui's sign-in, as a signed-in viewer has it.
await context.addCookies([
  { name: "jwt", value: "aaa.bbb.ccc", domain: "lemmy.world", path: "/", secure: true },
]);
const page = await context.newPage();
page.on("pageerror", (err) => errors.push(err.message));
async function reader() {
  await page.waitForFunction(() => document.getElementById("openrelay-extension"));
  for (let i = 0; i < 100; i++) {
    const frame = page.frames().find((f) => f.url().startsWith("chrome-extension://"));
    if (frame) {
      await frame.locator(".post-title").first().waitFor();
      return frame;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("The reader did not load");
}
const worker =
  context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
const registered = () =>
  worker.evaluate(() =>
    chrome.scripting.getRegisteredContentScripts().then((scripts) => scripts.map((s) => s.matches)),
  );

try {
  await page.goto("https://www.reddit.com/r/test/");
  let app = await reader();
  const extensionId = new URL(app.url()).host;
  // Chrome's prompt for the instance can't be answered here; grant it as the
  // Site access control on chrome://extensions does.
  const extensions = await context.newPage();
  await extensions.goto("chrome://extensions/");
  await extensions.evaluate(
    (id) => chrome.developerPrivate.addHostPermission(id, "https://lemmy.world/*"),
    extensionId,
  );
  await extensions.close();

  // lemmy.world is listed from the start, but OpenRelay doesn't run there
  // until it's opened (and Chrome's access is granted).
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator(".drawer-item.source-current").click();
  await app.locator(".source-row .drawer-item", { hasText: "lemmy.world" }).waitFor();
  assert.deepEqual(await registered(), []);
  // The add sheet checks what's typed; adding a listed instance keeps one row.
  await app.getByRole("button", { name: "Add Lemmy instance" }).click();
  const address = app.getByLabel("Instance address");
  await address.fill("http://lemmy.world");
  await address.press("Enter");
  await app.getByText("Enter an instance's address, like lemmy.world").waitFor();
  await address.fill("!linux@Lemmy.World");
  await address.press("Enter");
  await app.locator(".toast", { hasText: "Added lemmy.world" }).waitFor();
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  assert.deepEqual(
    await app.locator(".source-row .label").evaluateAll((els) => els.map((el) => el.textContent)),
    ["Hybrid", "lemmy.world"],
  );
  await page.screenshot({ path: resolve(out, "lemmy-switcher.png") });

  // Opening it asks for access, registers the content script there, and
  // loads the instance in this tab, where OpenRelay opens.
  await app.locator(".source-row .drawer-item", { hasText: "lemmy.world" }).click();
  await page.waitForURL("https://lemmy.world/");
  assert.deepEqual(await registered(), [["https://lemmy.world/*"]]);
  app = await reader();
  await app.getByText("Which distro for an old laptop?").first().waitFor();
  assert.ok(await app.getByText("c/linux@lemmy.ml").count());
  assert.equal(await page.locator("#openrelay-extension").count(), 1);
  assert.match(lemmyReads.find((r) => r.startsWith("/api/v3/post/list")), /sort=Hot/);

  // The drawer: this instance's account, and only what Lemmy supports.
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.getByText("Signed in as @lemmy_user").waitFor();
  await page.waitForTimeout(400); // Let the drawer finish sliding in.
  assert.deepEqual(
    await app
      .locator(".drawer-body > .drawer-item .label")
      .evaluateAll((els) => els.map((el) => el.textContent)),
    ["lemmy.world", "Profile", "Inbox", "New Post", "User", "Save feed for offline", "Saved for offline", "Settings"],
  );
  await page.screenshot({ path: resolve(out, "lemmy-drawer.png") });
  await app.locator("body").press("Escape");
  await app.locator(".has-drawer").waitFor({ state: "detached" });

  // A post and its comment tree, built from Lemmy's paths.
  await app.getByRole("button", { name: "Which distro for an old laptop?", exact: true }).first().click();
  await app.getByText("4 GB", { exact: true }).waitFor();
  await app.getByText("Nested reply").waitFor();
  // Lemmy's Markdown: a folded spoiler, and a community link on this instance.
  await app.locator("details.md-details summary", { hasText: "Full specs" }).waitFor();
  assert.equal(await app.locator("details.md-details p").isVisible(), false);
  await app.locator("details.md-details summary").click();
  await app.locator("details.md-details p", { hasText: "Intel Atom N270" }).waitFor();
  assert.equal(
    await app.locator("a.md-link:visible", { hasText: "!linux@lemmy.ml" }).getAttribute("href"),
    "https://lemmy.world/c/linux@lemmy.ml",
  );
  assert.equal(await app.getByText("The hidden reply").count(), 0);
  await app.getByRole("button", { name: "Load more replies" }).click();
  await app.getByText("The hidden reply").waitFor();
  await app.locator(".more-row").waitFor({ state: "detached" });
  await page.waitForTimeout(400); // Let the reply finish animating in.
  assert.ok(lemmyReads.some((r) => r.startsWith("/api/v3/comment/list?parent_id=203")));
  await page.screenshot({ path: resolve(out, "lemmy-post.png") });

  // Writes go to Lemmy's API with lemmy-ui's sign-in token.
  await app.getByRole("button", { name: "Upvote this post" }).first().click();
  await app.getByRole("button", { name: "Undo upvote this post" }).first().waitFor();
  await app.getByRole("button", { name: "Reply to post" }).click();
  await app.getByRole("textbox", { name: "Reply" }).fill("Try Debian.");
  await app.getByRole("button", { name: "Send" }).click();
  await app.locator(".toast", { hasText: "Reply sent" }).waitFor();
  await app.getByText("Try Debian.").first().waitFor();
  assert.deepEqual(lemmyWrites, [
    { method: "POST", path: "/api/v3/post/like", body: { post_id: 101, score: 1 }, auth: "Bearer aaa.bbb.ccc" },
    { method: "POST", path: "/api/v3/comment", body: { post_id: 101, content: "Try Debian." }, auth: "Bearer aaa.bbb.ccc" },
  ]);
  lemmyWrites.length = 0;

  // The inbox: replies and private messages, read without marking them.
  await app.getByRole("button", { name: "Open menu" }).first().click();
  await app.locator(".drawer-item", { hasText: "Inbox" }).click();
  await app.getByText("Welcome to Lemmy!").waitFor();
  assert.ok(lemmyReads.some((r) => r.startsWith("/api/v3/user/replies?") && r.includes("unread_only=false")));
  assert.deepEqual(lemmyWrites, []);
  await app.getByText("Welcome to Lemmy!").click();
  for (let i = 0; i < 50 && !lemmyWrites.length; i++) await page.waitForTimeout(100);
  assert.deepEqual(lemmyWrites.map((w) => [w.path, w.body]), [
    ["/api/v3/private_message/mark_as_read", { private_message_id: 77, read: true }],
  ]);
  await page.screenshot({ path: resolve(out, "lemmy-inbox.png") });
  lemmyWrites.length = 0;
  await app.locator("body").press("Escape");

  // A bot check in front of lemmy-ui is left alone.
  await page.goto("https://lemmy.world/?challenge");
  await page.waitForTimeout(1500);
  assert.equal(await page.locator("#openrelay-extension").count(), 0);
  await page.goto("https://lemmy.world/");
  app = await reader();

  // Back to Reddit through the switcher.
  await app.locator("body").press("Escape");
  await app.getByRole("button", { name: "Open menu" }).first().click();
  await app.locator(".drawer-item.source-current").click();
  await app.locator(".source-row .drawer-item", { hasText: "Reddit" }).click();
  await page.waitForURL("https://www.reddit.com/");
  app = await reader();

  // Hybrid opens Reddit's front page again, marked as the hybrid feed.
  const switchTo = async (label) => {
    await app.getByRole("button", { name: "Open menu" }).first().click();
    await app.locator(".drawer-item.source-current").click();
    await Promise.all([
      page.waitForEvent("load"),
      app.locator(".source-row .drawer-item", { hasText: label }).click(),
    ]);
    assert.equal(page.url(), "https://www.reddit.com/");
    app = await reader();
    await app.getByRole("button", { name: "Open menu" }).first().click();
    await app.locator(".drawer-item.source-current .label", { hasText: label }).waitFor();
    await app.locator("body").press("Escape");
    await app.locator(".has-drawer").waitFor({ state: "detached" });
  };
  await switchTo("Hybrid");

  // The hybrid feed: Reddit's front page with lemmy.world's Local feed,
  // read by the reader signed out, under Lemmy's names.
  await app.getByText("Which distro for an old laptop?").first().waitFor();
  assert.ok(await app.getByText("A Reddit post").count());
  assert.ok(await app.getByText("c/linux@lemmy.ml").count());
  assert.ok(await app.getByText("@poster@lemmy.ml").count());
  assert.ok(readerReads.length);
  for (const read of readerReads) {
    assert.match(read.path, /^\/api\/v3\/post\/list\?type_=Local&/);
    assert.equal(read.cookie, null);
    assert.equal(read.auth, null);
  }
  // Reddit's votes stay; Lemmy's posts are voted on on their instance.
  assert.ok(await app.locator('[data-thing-id="t3_abc123"] .vote-btn').count());
  assert.equal(await app.locator('[data-thing-id^="t3_101_"] .vote-btn').count(), 0);
  await page.screenshot({ path: resolve(out, "lemmy-hybrid.png") });
  // A Lemmy post opens on its instance, where OpenRelay reads it in full.
  const writesBefore = lemmyWrites.length;
  await app.getByRole("button", { name: "Which distro for an old laptop?", exact: true }).first().click();
  await page.waitForURL("https://lemmy.world/post/101");
  app = await reader();
  await app.getByText("Nested reply").waitFor();
  assert.equal(lemmyWrites.length, writesBefore);
  // Reddit's front page stays the hybrid feed until another source is picked.
  await page.goto("https://www.reddit.com/");
  app = await reader();
  await app.getByText("Which distro for an old laptop?").first().waitFor();

  await switchTo("Reddit");
  await app.getByText("A Reddit post").first().waitFor();
  assert.equal(await app.getByText("Which distro for an old laptop?").count(), 0);

  // A site that wasn't added gets nothing, even with the reader in a frame.
  await page.goto("https://evil.example/");
  assert.equal(await page.locator("#openrelay-extension").count(), 0);
  await page.evaluate((id) => {
    const frame = document.createElement("iframe");
    frame.src = `chrome-extension://${id}/reader.html#source=${encodeURIComponent("https://evil.example/")}`;
    document.body.append(frame);
  }, extensionId);
  const evil = await (async () => {
    for (let i = 0; i < 100; i++) {
      const frame = page.frames().find((f) => f.url().startsWith("chrome-extension://"));
      if (frame) return frame;
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  await evil.getByText("OpenRelay isn't set up for this site.").waitFor();

  // Removing the instance stops OpenRelay there.
  await page.goto("https://www.reddit.com/r/test/");
  app = await reader();
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator(".drawer-item.source-current").click();
  await app.getByRole("button", { name: "Remove lemmy.world" }).click();
  assert.equal(await app.locator(".source-row").count(), 0);
  for (let i = 0; i < 50 && (await registered()).length; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await registered(), []);
  await page.goto("https://lemmy.world/");
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("#openrelay-extension").count(), 0);
  // The default stays removed.
  await page.goto("https://www.reddit.com/r/test/");
  app = await reader();
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator(".drawer-item.source-current").click();
  await app.getByRole("button", { name: "Add Lemmy instance" }).waitFor();
  assert.equal(await app.locator(".source-row").count(), 0);

  assert.deepEqual(lemmyWrites, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: lemmy.world listed by default and opened from the switcher (access, content script registered), add sheet checks, feed, community labels, post with comment tree and more replies via Lemmy's API, spoilers and !community links, drawer limited to what Lemmy supports, vote and reply sent to Lemmy's API with the sign-in token, inbox read without marking and a message marked read when opened, hybrid feed (Reddit's front page with lemmy.world's Local feed read signed out, Lemmy names, no Lemmy votes, Lemmy posts opened on the instance) and back to Reddit, reader refused on a site not added, removal unregisters and stays removed; no other writes, no page errors.",
  );
} finally {
  await context.close();
}
