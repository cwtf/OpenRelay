// Loads the real built extension against Reddit fixtures and walks the
// Relay-style account screens: Profile, User, Compose, Inbox, Moderator,
// Friends and New Post. Every write is captured; nothing reaches Reddit.
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve("test-results");
await mkdir(out, { recursive: true });
const context = await chromium.launchPersistentContext(
  await mkdtemp(resolve(out, "account-profile-")),
  {
    channel: "chromium",
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
    viewport: { width: 900, height: 900 },
  },
);
const errors = [];
const writes = [];
const post = (id, title, extra = {}) => ({
  kind: "t3",
  data: {
    id, name: "t3_" + id, title, author: "fixture_user", subreddit: "test",
    permalink: `/r/test/comments/${id}/x/`, url: `https://www.reddit.com/r/test/comments/${id}/x/`,
    is_self: true, selftext: "", score: 5, num_comments: 1, created_utc: 1700000000, ...extra,
  },
});
const comment = (id, body, extra = {}) => ({
  kind: "t1",
  data: {
    id, name: "t1_" + id, body, author: "fixture_user", score: 7, created_utc: 1700000100,
    subreddit: "test", link_id: "t3_p1", link_title: "Profile post",
    permalink: `/r/test/comments/p1/x/${id}/`, ...extra,
  },
});
const listing = (children) => ({ kind: "Listing", data: { after: null, children } });
// Reddit's context view for the inbox reply r1: a long parent, then r1.
const threadWithReply = comment("c0", Array.from({ length: 80 }, (_, i) => "Parent line " + i).join("\n\n"), {
  replies: listing([comment("r1", "A reply to you", { author: "carol", parent_id: "t1_c0" })]),
});
const json = {
  "/api/me.json": { data: { name: "fixture_user", id: "u1", modhash: "fixturemodhash1", is_mod: true, inbox_count: 2 } },
  "/r/test/hot.json": listing([post("p1", "Profile post")]),
  "/r/test/about.json": { data: { display_name: "test", title: "Test community" } },
  "/user/fixture_user/about.json": { data: { name: "fixture_user", link_karma: 1200, comment_karma: 3400, created_utc: 1500000000 } },
  "/user/spez/about.json": { data: { name: "spez", link_karma: 10, comment_karma: 20, created_utc: 1100000000, is_friend: false } },
  "/user/fixture_user/overview.json": listing([post("p1", "Profile post"), comment("c1", "A profile comment")]),
  "/user/spez/overview.json": listing([comment("c2", "Spez speaks", { author: "spez" })]),
  "/user/fixture_user/saved.json": listing([post("s1", "A saved post")]),
  "/message/inbox.json": listing([
    { kind: "t4", data: { name: "t4_m1", subject: "Hello there", body: "A private message", author: "spez", dest: "fixture_user", new: true, created_utc: 1700000200 } },
    { kind: "t1", data: { name: "t1_r1", type: "comment_reply", link_title: "Profile post", subreddit: "test", body: "A reply to you", author: "carol", dest: "fixture_user", new: true, created_utc: 1700000300, context: "/r/test/comments/p1/x/r1/?context=3" } },
  ]),
  "/r/mod/about/modqueue.json": listing([
    post("q1", "Reported post", { user_reports: [["spam", 2]], mod_reports: [] }),
    comment("q2", "Reported comment", { user_reports: [["rude", 1]], mod_reports: [] }),
  ]),
  "/prefs/friends.json": [{ kind: "UserList", data: { children: [{ name: "zed", date: 2 }, { name: "amy", date: 1 }] } }],
  "/r/test/about/rules.json": { rules: [{ short_name: "Be kind", description: "No **insults**." }] },
};
await context.route(/^https:\/\/www\.reddit\.com\//, async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() !== "GET") {
    writes.push({ path: url.pathname, body: Object.fromEntries(new URLSearchParams(request.postData())) });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        url.pathname === "/api/submit"
          ? { json: { errors: [], data: { name: "t3_new1", url: "https://www.reddit.com/r/test/comments/new1/x/" } } }
          : {},
      ),
    });
  }
  if (url.pathname.endsWith(".json"))
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        json[url.pathname] ??
          (url.pathname.startsWith("/comments/")
            ? [
                listing([post(url.pathname.split("/")[2].replace(".json", ""), "Opened post")]),
                listing(
                  url.searchParams.get("comment") === "r1"
                    ? [threadWithReply]
                    : Array.from({ length: 12 }, (_, i) =>
                        comment("top" + i, "Top-level comment " + i, { link_id: "t3_p1" }),
                      ),
                ),
              ]
            : listing([])),
      ),
    });
  return route.fulfill({
    contentType: "text/html",
    body: '<title>Reddit fixture</title><shreddit-post id="t3_p1" post-title="Profile post" author="fixture_user" subreddit-prefixed-name="r/test" permalink="/r/test/comments/p1/x/" post-type="text"></shreddit-post>',
  });
});

const page = await context.newPage();
page.on("pageerror", (err) => errors.push(err.message));
const lastWrite = () => writes.at(-1);
const settle = () => page.waitForTimeout(450); // Let screen/sheet motion finish.

try {
  await page.goto("https://www.reddit.com/r/test/");
  let app;
  for (let i = 0; i < 60 && !app; i++) {
    app = page.frames().find((f) => f.url().startsWith("chrome-extension://"));
    if (!app) await page.waitForTimeout(100);
  }
  await app.locator(".post-title").first().waitFor();
  const drawer = async (item) => {
    await app.getByRole("button", { name: "Open menu" }).click();
    await app.locator(".drawer-item", { hasText: item }).first().click();
    await app.locator(".has-drawer").waitFor({ state: "detached" });
  };
  const top = () => app.locator(".screen").last();
  const back = async () => {
    await top().getByRole("button", { name: "Back", exact: true }).click();
    await settle();
  };
  const bar = (label) => top().locator(".bottom-bar .bar-btn", { hasText: label });

  // Profile: own account, Relay header and sections, no Friend/Message.
  await drawer("Profile");
  await top().getByText("A profile comment").waitFor();
  assert.equal(await top().locator(".appbar-title .name").textContent(), "u/fixture_user");
  assert.match(await top().locator(".profile-karma").textContent(), /^Karma: 1\.2K \/ 3\.4K/);
  assert.deepEqual(
    await top().locator(".bottom-bar .bar-btn span").allTextContents(),
    ["Sort", "Refresh", "Section"],
  );
  await settle();
  await page.screenshot({ path: resolve(out, "account-profile.png") });
  await bar("Section").click();
  await app.getByRole("button", { name: "Saved" }).click();
  await top().getByText("A saved post").waitFor();
  assert.match(await top().locator(".appbar-title .sub").textContent(), /^Saved · New/);
  await back();

  // Profile posts follow the Layout setting: cards by default, then List.
  const profilePosts = async () => {
    await drawer("Profile");
    await top().locator(".listing-post").first().waitFor();
    return top().locator(".feed");
  };
  let feed = await profilePosts();
  assert.equal(await feed.getAttribute("data-layout"), "cards");
  assert.notEqual(
    await feed.locator(".listing-post").first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
    "0px",
  );
  await back();
  await drawer("Settings");
  await app.getByRole("radio", { name: "List", exact: true }).click();
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  feed = await profilePosts();
  assert.equal(await feed.getAttribute("data-layout"), "list");
  await feed.locator(".listing-post .row").first().waitFor(); // List row markup.
  await settle();
  await page.screenshot({ path: resolve(out, "account-profile-list.png") });
  await back();

  // User: another profile with Friend and a Send Message FAB that composes.
  await drawer("User");
  await app.getByLabel("Username").fill("spez");
  await app.getByLabel("Username").press("Enter");
  await top().getByText("Spez speaks").waitFor();
  await bar("Friend").click();
  await bar("UnFriend").waitFor();
  assert.deepEqual(lastWrite(), {
    path: "/api/friend",
    body: { name: "spez", type: "friend", container: "t2_u1", uh: "fixturemodhash1", api_type: "json" },
  });
  await top().getByRole("button", { name: "Send Message" }).click();
  await settle();
  assert.equal(await top().getByLabel("Username").inputValue(), "spez");
  await top().getByLabel("Title").fill("Hi");
  await top().getByLabel("Message").fill("Hello from OpenRelay");
  await top().locator(".fab.is-extended:not(:disabled)").waitFor();
  await app.locator(".screen.is-entering").waitFor({ state: "detached" });
  await page.screenshot({ path: resolve(out, "account-compose.png") });
  await top().getByRole("button", { name: "Send" }).click();
  await app.locator(".toast", { hasText: "Message sent" }).waitFor();
  assert.deepEqual(lastWrite().body, {
    to: "spez", subject: "Hi", text: "Hello from OpenRelay", uh: "fixturemodhash1", api_type: "json",
  });
  await settle();
  await back(); // Profile -> feed

  // Inbox: unread items, tap to expand (marks read), reply, Read All.
  await drawer("Inbox");
  const message = top().locator('[data-mid="t4_m1"]');
  await message.waitFor();
  assert.equal(await top().locator(".message-card.is-unread").count(), 2);
  assert.deepEqual(
    await top().locator(".bottom-bar .bar-btn span").allTextContents(),
    ["Message", "Refresh", "Section", "Read All"],
  );
  await message.getByText("A private message").click();
  await message.locator(".action-strip").waitFor();
  assert.deepEqual(lastWrite(), { path: "/api/read_message", body: { id: "t4_m1", uh: "fixturemodhash1", api_type: "json" } });
  assert.deepEqual(
    await message.locator(".strip-btn span").allTextContents(),
    ["User", "Reply", "Delete", "Block", "Unread"],
  );
  await settle();
  await page.screenshot({ path: resolve(out, "account-inbox.png") });
  await message.locator(".strip-btn", { hasText: "Reply" }).click();
  await app.getByRole("textbox", { name: "Reply" }).fill("Thanks!");
  await app.getByRole("button", { name: "Send" }).click();
  await app.locator(".toast", { hasText: "Reply sent" }).waitFor();
  assert.deepEqual(lastWrite().body, { thing_id: "t4_m1", text: "Thanks!", uh: "fixturemodhash1", api_type: "json" });
  await settle();
  await bar("Read All").click();
  await app.locator(".toast", { hasText: "All messages marked read" }).waitFor();
  assert.equal(lastWrite().path, "/api/read_all_messages");
  assert.equal(await top().locator(".message-card.is-unread").count(), 0);
  // Context opens the reply's thread, scrolled to and highlighting the reply.
  const reply = top().locator('[data-mid="t1_r1"]');
  await reply.getByText("A reply to you").click();
  await reply.locator(".strip-btn", { hasText: "Context" }).click();
  const target = app.locator('.comment.is-context[data-cid="t1_r1"]');
  await target.waitFor();
  await app.getByText("Single comment thread").waitFor();
  // Scrolled into view below the 80-line parent (which has scrolled away).
  await app.waitForFunction(() => {
    const box = document
      .querySelector('.comment.is-context[data-cid="t1_r1"]')
      ?.getBoundingClientRect();
    const parent = document.querySelector('[data-cid="t1_c0"]')?.getBoundingClientRect();
    return (
      box && parent && parent.top < 0 && box.top >= 0 && box.bottom <= window.innerHeight
    );
  });
  await settle();
  await page.screenshot({ path: resolve(out, "account-context.png") });
  await app.getByRole("button", { name: "View all comments" }).click();
  await app.getByText("Top-level comment 0").waitFor();
  assert.equal(await app.getByText("Single comment thread").count(), 0);
  await back(); // Post -> Inbox
  await back();

  // Moderator: queue with reports and approve/remove/spam/ignore actions.
  await drawer("Moderator");
  await top().getByText("Reported comment").waitFor();
  assert.ok(await top().getByText("2: spam").count());
  assert.deepEqual(
    await top().locator(".bottom-bar .bar-btn span").allTextContents(),
    ["Filter", "Section", "Subreddit", "Refresh"],
  );
  await settle();
  await page.screenshot({ path: resolve(out, "account-moderator.png") });
  await top().locator(".listing-post").first().locator(".strip-btn", { hasText: "Approve" }).click();
  await top().locator(".mod-state.is-approved").waitFor();
  assert.deepEqual(lastWrite(), { path: "/api/approve", body: { id: "t3_q1", uh: "fixturemodhash1", api_type: "json" } });
  await back();

  // Friends: alphabetical list; removing asks first.
  await drawer("Friends");
  await top().locator(".friend-row").first().waitFor();
  assert.deepEqual(await top().locator(".friend-main .label").allTextContents(), ["amy", "zed"]);
  await settle();
  await page.screenshot({ path: resolve(out, "account-friends.png") });
  await top().getByRole("button", { name: "Remove u/amy from friends" }).click();
  await app.getByRole("button", { name: "Remove", exact: true }).click();
  await top().locator(".friend-main", { hasText: "amy" }).waitFor({ state: "detached" });
  assert.deepEqual(lastWrite().body, { name: "amy", type: "friend", container: "t2_u1", uh: "fixturemodhash1", api_type: "json" });
  await settle();
  await back();

  // New Post: community prefilled, rules, options, then opens the new post.
  await drawer("New Post");
  assert.equal(await top().getByLabel("Subreddit").inputValue(), "test");
  await top().getByRole("button", { name: "Rules" }).click();
  await app.getByText("Be kind").waitFor();
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  await top().getByLabel("Title").fill("My new post");
  await top().getByLabel("Text (optional)").fill("Body text");
  await bar("Options").click();
  await app.getByRole("switch", { name: "Mark as Spoiler" }).click();
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  await page.screenshot({ path: resolve(out, "account-submit.png") });
  await top().getByRole("button", { name: "Post" }).click();
  await app.locator(".toast", { hasText: "Posted" }).waitFor();
  assert.deepEqual(lastWrite().body, {
    sr: "test", kind: "self", title: "My new post", text: "Body text", sendreplies: "true",
    nsfw: "false", spoiler: "true", resubmit: "false", uh: "fixturemodhash1", api_type: "json",
  });
  await app.getByText("Opened post").waitFor();

  assert.ok(writes.every((write) => write.path.startsWith("/api/")));
  assert.equal(context.pages().length, 2); // No tabs opened for these screens.
  assert.deepEqual(errors, []);
  console.log(
    "PASS: in-reader Profile (sections, karma, follows Layout), User (friend, message), Compose, Inbox (read, reply, read all, context scrolls to the comment), Moderator (reports, approve), Friends (remove), New Post (rules, options, submit); writes only to /api/*.",
  );
} finally {
  await context.close();
}
