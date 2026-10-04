import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = resolve("test-results");
await mkdir(out, { recursive: true });
const context = await chromium.launchPersistentContext(
  await mkdtemp(resolve(out, "browser-profile-")),
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
await context.route(/^https:\/\/(www|old)\.reddit\.com\//, async (route) => {
  const url = new URL(route.request().url());
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
    const body = url.pathname.includes("/comments/")
      ? [
          { data: { children: [{ kind: "t3", data: post }] } },
          { data: { children: [comment] } },
        ]
      : url.pathname.endsWith("about.json")
        ? {
            data: {
              display_name: "test",
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
    "PASS: real extension injection, loaded-page feed, comments, direct links, native toggle, excluded routes, blocked-JSON fallback; no page errors.",
  );
} finally {
  await context.close();
}
