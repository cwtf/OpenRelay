import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = resolve("test-results");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(resolve(out, "browser-profile-"));
// Block third-party cookies: Chrome then denies localStorage to the reader's
// extension frame, so settings must persist through chrome.storage.
await mkdir(resolve(profile, "Default"));
await writeFile(
  resolve(profile, "Default/Preferences"),
  JSON.stringify({
    profile: { cookie_controls_mode: 1, block_third_party_cookies: true },
  }),
);
const context = await chromium.launchPersistentContext(
  profile,
  {
    channel: "chromium",
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
    viewport: { width: 1280, height: 900 },
  },
);
const errors = [];
const post = {
  id: "abc123",
  name: "t3_abc123",
  title: "A loaded Reddit post in OpenRelay",
  author: "example_user",
  subreddit: "test",
  permalink: "/r/test/comments/abc123/example/",
  url: "https://www.reddit.com/r/test/comments/abc123/example/",
  is_self: true,
  selftext: "This is **Markdown** from Reddit.",
  score: 123,
  num_comments: 2,
  created_utc: 1700000000,
};
const comment = {
  kind: "t1",
  data: {
    id: "c1",
    name: "t1_c1",
    parent_id: post.name,
    author: "reader",
    body: "An actual nested comment fixture",
    score: 7,
    created_utc: 1700000100,
    permalink: post.permalink + "c1/",
    replies: {
      data: {
        children: [
          {
            kind: "t1",
            data: {
              id: "c2",
              parent_id: "t1_c1",
              author: "example_user",
              body: "A nested reply",
              score: 3,
              created_utc: 1700000200,
              is_submitter: true,
            },
          },
        ],
      },
    },
  },
};
const fixture = `<!doctype html><html><head><title>Reddit fixture</title></head><body><h1>Original Reddit fixture</h1><shreddit-post id="t3_abc123" post-title="${post.title}" author="example_user" subreddit-prefixed-name="r/test" permalink="${post.permalink}" content-href="${post.url}" post-type="text" score="123" comment-count="2" created-timestamp="2023-11-14T22:13:20Z"><div slot="text-body">Loaded page text.</div></shreddit-post></body></html>`;
let deny = false;
// 1x1 PNG served for profile and community pictures.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
await context.route(/^https:\/\/(www|old)\.reddit\.com\//, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith("/img/"))
    return url.pathname === "/img/broken.png"
      ? route.fulfill({ status: 404, body: "" })
      : route.fulfill({ contentType: "image/png", body: png });
  if (url.pathname === "/api/me.json")
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          name: "fixture_user",
          modhash: "fixturemodhash1",
          is_mod: true,
          inbox_count: 3,
          icon_img: "https://www.reddit.com/img/me.png",
        },
      }),
    });
  if (url.pathname === "/r/challenge/")
    return route.fulfill({
      contentType: "text/html",
      body: "<title>Reddit - Prove your humanity</title><h1>Complete the challenge</h1>",
    });
  if (url.hostname === "old.reddit.com" && !url.pathname.endsWith(".json"))
    return route.fulfill({
      contentType: "text/html",
      body:
        '<title>Old Reddit fixture</title><div class="thing link self" data-fullname="t3_abc123" data-author="old_user" data-subreddit="test" data-score="123" data-comments-count="2" data-permalink="' +
        post.permalink +
        '"><a class="title">' +
        post.title +
        '</a><time datetime="2023-11-14T22:13:20Z"></time></div>',
    });
  if (url.pathname.endsWith(".json")) {
    if (deny)
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: "{}",
      });
    const body = url.pathname === "/subreddits/mine/subscriber.json"
      ? {
          data: {
            after: null,
            children: [
              { kind: "t5", data: { display_name: "zebra", over18: false } },
              {
                kind: "t5",
                data: { display_name: "Apple", primary_color: "#336699" },
              },
              {
                kind: "t5",
                data: { display_name: "u_someone", subreddit_type: "user" },
              },
            ],
          },
        }
      : url.pathname.includes("/comments/")
      ? [
          { data: { children: [{ kind: "t3", data: post }] } },
          { data: { children: [comment] } },
        ]
      : url.pathname.endsWith("about.json")
        ? {
            data: {
              display_name: url.pathname.startsWith("/r/broken/")
                ? "broken"
                : "test",
              community_icon: url.pathname.startsWith("/r/broken/")
                ? "https://www.reddit.com/img/broken.png"
                : "https://www.reddit.com/img/test.png",
              title: "Test community",
              subscribers: 1000,
            },
          }
        : { data: { children: [{ kind: "t3", data: post }], after: null } };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  }
  return route.fulfill({
    contentType: "text/html",
    body: fixture,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; frame-src 'self'; script-src 'self'",
    },
  });
});
const page = await context.newPage();
page.on("pageerror", (err) => errors.push(err.message));
async function reader() {
  await page.waitForFunction(() =>
    document.getElementById("openrelay-extension"),
  );
  for (let i = 0; i < 60; i++) {
    const frame = page
      .frames()
      .find((f) => f.url().startsWith("chrome-extension://"));
    if (frame) {
      await frame.locator(".post-title").first().waitFor();
      return frame;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Reader iframe did not load");
}
try {
  await page.goto("https://www.reddit.com/r/test/");
  let app = await reader();
  assert.equal(await page.locator("body").evaluate((el) => el.inert), true);
  await app.getByRole("button", { name: post.title, exact: true }).click();
  await app
    .getByText("An actual nested comment fixture", { exact: true })
    .waitFor();
  await app.getByText("A nested reply", { exact: true }).waitFor();
  await app.locator(".screen.is-entering").waitFor({ state: "detached" });
  // Collapsing hides only the replies; the comment itself stays, like Relay.
  await app.getByText("A nested reply", { exact: true }).click(); // Leaf: no-op.
  await app.getByText("A nested reply", { exact: true }).waitFor();
  await app.getByText("An actual nested comment fixture", { exact: true }).click();
  await app
    .getByText("A nested reply", { exact: true })
    .waitFor({ state: "detached" });
  await app.getByText("An actual nested comment fixture", { exact: true }).waitFor();
  assert.equal(
    await app.locator('[data-cid="t1_c1"] .collapsed-count').textContent(),
    "+1",
  );
  assert.equal(
    await app.locator('[data-cid="t1_c1"] .vote[data-thing-id="t1_c1"]').count(),
    1,
  );
  await page.screenshot({ path: resolve(out, "collapsed.png") });
  await app.getByText("An actual nested comment fixture", { exact: true }).click();
  await app.getByText("A nested reply", { exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, "comments.png") });
  await app.getByRole("button", { name: "Back", exact: true }).click();
  await app
    .locator(".screen.is-entering,.screen.is-exiting")
    .waitFor({ state: "detached" });
  await page.screenshot({ path: resolve(out, "feed.png") });
  await app.getByRole("button", { name: /Layout:/ }).click();
  await app.locator('.feed[data-layout="compact"]').waitFor();
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  await app.getByRole("radio", { name: "Dark", exact: true }).click();
  assert.equal(await app.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({ path: resolve(out, "settings.png") });
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  // Subscriptions load automatically, alphabetically, without user profiles.
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator(".sub-row-main", { hasText: "zebra" }).waitFor();
  assert.deepEqual(
    await app
      .locator(".sub-row-main .label")
      .evaluateAll((els) => els.map((el) => el.textContent)),
    ["Home", "Popular", "All", "Apple", "zebra"],
  );
  // Community icon in the drawer header and feed banner; account in the footer.
  assert.equal(
    await app.locator(".drawer-head img.avatar").getAttribute("src"),
    "https://www.reddit.com/img/test.png",
  );
  assert.equal(
    await app.locator(".feed-banner img.avatar").getAttribute("src"),
    "https://www.reddit.com/img/test.png",
  );
  await app.getByText("Signed in as u/fixture_user").waitFor();
  // Relay's account destinations, in order, with the unread inbox count.
  assert.deepEqual(
    await app
      .locator(".drawer-body > .drawer-item .label")
      .evaluateAll((els) => els.slice(0, 6).map((el) => el.textContent)),
    ["Profile", "Inbox", "Moderator", "New Post", "Friends", "User"],
  );
  assert.equal(await app.locator(".drawer-count").textContent(), "3");
  await page.waitForTimeout(400); // Let the drawer finish sliding in.
  await page.screenshot({ path: resolve(out, "drawer-top.png") });
  await app.getByRole("button", { name: "Add r/zebra to Favourites" }).click();
  await app.getByRole("button", { name: "Collapse Favourites" }).waitFor();
  await page.screenshot({ path: resolve(out, "drawer.png") });
  await app.getByLabel("Search or go to a community").fill("zeb");
  assert.deepEqual(
    await app
      .locator(".sub-row-main .label")
      .evaluateAll((els) => els.map((el) => el.textContent)),
    ["Go to r/zeb", "zebra"],
  );
  await page.screenshot({ path: resolve(out, "drawer-search.png") });
  await app.getByLabel("Search or go to a community").press("Escape");
  await app.locator("body").press("Escape");
  await app.locator(".has-drawer").waitFor({ state: "detached" });
  // Settings and favourites survive a reload with third-party storage blocked.
  await page.reload();
  app = await reader();
  assert.equal(await app.locator("html").getAttribute("data-theme"), "dark");
  assert.ok(await app.locator('.feed[data-layout="compact"]').count());
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.getByRole("button", { name: "Remove r/zebra from Favourites" }).first().waitFor();
  await app.locator("body").press("Escape");
  await app.locator(".has-drawer").waitFor({ state: "detached" });
  // Toggle through the real service worker, as a toolbar click does.
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.active);
    await chrome.tabs.sendMessage(tab.id, { type: "openrelay:toggle" });
  });
  assert.equal(await page.locator("body").evaluate((el) => el.inert), false);
  assert.equal(await page.locator("#openrelay-extension").isVisible(), false);
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.active);
    await chrome.tabs.sendMessage(tab.id, { type: "openrelay:toggle" });
  });
  assert.equal(await page.locator("body").evaluate((el) => el.inert), true);
  // Home shows the signed-in account's profile picture.
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator(".sub-row-main", { hasText: "Home" }).click();
  await app.locator(".has-drawer").waitFor({ state: "detached" });
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator('.drawer-head img.avatar[src="https://www.reddit.com/img/me.png"]').waitFor();
  assert.equal(
    await app.locator(".drawer-head img.avatar").evaluate((img) => img.naturalWidth),
    1,
  );
  await page.screenshot({ path: resolve(out, "drawer-home.png") });
  await app.locator("body").press("Escape");
  await app.locator(".has-drawer").waitFor({ state: "detached" });
  // A picture that fails to load falls back to the initial.
  await page.goto("https://www.reddit.com/r/broken/");
  app = await reader();
  await app.locator(".feed-banner span.avatar", { hasText: "b" }).waitFor();
  await page.goto("https://www.reddit.com/r/test/comments/abc123/example/");
  app = await reader();
  await app
    .getByText("An actual nested comment fixture", { exact: true })
    .waitFor();
  await page.goto("https://www.reddit.com/settings/");
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("#openrelay-extension").count(), 0);
  await page.goto("https://www.reddit.com/r/test/?openrelay=off");
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("#openrelay-extension").count(), 0);
  deny = true;
  await page.goto("https://www.reddit.com/r/test/comments/abc123/example/");
  app = await reader();
  await app.getByText(/Showing content already loaded/).waitFor();
  await page.goto("https://old.reddit.com/r/test/");
  app = await reader();
  assert.ok(await app.getByText("u/old_user", { exact: true }).count());
  await page.goto("https://www.reddit.com/r/challenge/");
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("#openrelay-extension").count(), 0);
  assert.equal(await page.locator("body").evaluate((el) => el.inert), false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real extension injection, loaded-page feed, comments, Relay-style collapse, settings persistence with third-party storage blocked, subscriptions drawer, account menu, profile and community pictures, direct links, native toggle, excluded routes, blocked-JSON fallback; no page errors.",
  );
} finally {
  await context.close();
}
