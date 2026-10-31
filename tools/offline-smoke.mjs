// Offline reading: save a post from the reader on a Reddit page, then read it
// in reader.html#offline with Reddit unreachable, and as the fallback when
// Reddit refuses the post.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = resolve("test-results");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(resolve(out, "offline-profile-"));
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
const post = {
  id: "abc123",
  name: "t3_abc123",
  title: "A post saved for later",
  author: "example_user",
  subreddit: "test",
  permalink: "/r/test/comments/abc123/example/",
  url: "https://www.reddit.com/r/test/comments/abc123/example/",
  is_self: true,
  selftext: "Body text kept **offline**.",
  score: 12,
  num_comments: 1,
  created_utc: 1700000000,
};
const comment = {
  kind: "t1",
  data: {
    id: "c1",
    name: "t1_c1",
    parent_id: post.name,
    author: "reader",
    body: "A comment read without a connection",
    score: 3,
    created_utc: 1700000100,
    permalink: post.permalink + "c1/",
    replies: "",
  },
};
const fixture = `<!doctype html><title>Reddit fixture</title><shreddit-post id="${post.name}" post-title="${post.title}" author="${post.author}" subreddit-prefixed-name="r/test" permalink="${post.permalink}" content-href="${post.url}" post-type="text" score="12" comment-count="1" created-timestamp="2023-11-14T22:13:20Z"><div slot="text-body">Loaded page text.</div></shreddit-post>`;
/** "online", "deny" (Reddit refuses JSON) or "offline" (unreachable). */
let network = "online";
const offlineRequests = [];
const commentLoads = [];
await context.route(/^https:\/\/(www|old)\.reddit\.com\//, async (route) => {
  const url = new URL(route.request().url());
  if (network === "offline") {
    offlineRequests.push(url.href);
    return route.abort("internetdisconnected");
  }
  if (url.pathname.endsWith(".json")) {
    if (network === "deny")
      return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
    if (url.pathname.includes("/comments/")) commentLoads.push(url.search);
    const body = url.pathname.includes("/comments/")
      ? [
          { data: { children: [{ kind: "t3", data: post }] } },
          { data: { children: [comment] } },
        ]
      : url.pathname.endsWith("/hot.json")
        ? { data: { children: [{ kind: "t3", data: post }], after: null } }
        : {};
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  }
  return route.fulfill({ contentType: "text/html", body: fixture });
});

const page = await context.newPage();
page.on("pageerror", (err) => errors.push(err.message));
async function reader() {
  for (let i = 0; i < 100; i++) {
    const frame = page.frames().find((f) => f.url().startsWith("chrome-extension://"));
    if (frame) {
      await frame.locator(".post-title").first().waitFor();
      return frame;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Reader iframe did not load");
}
const toast = (app, text) => app.locator(".toast", { hasText: text }).waitFor();

try {
  await page.goto("https://www.reddit.com/r/test/");
  let app = await reader();

  // Save from the card's menu; the request asks for one page of comments.
  await app.getByRole("button", { name: "More actions" }).first().click();
  await app.getByRole("button", { name: /Save for offline/ }).click();
  await toast(app, "Saved for offline reading");
  assert.match(commentLoads.at(-1), /limit=200/);
  // The menu now offers to update or remove the copy.
  await app.getByRole("button", { name: "More actions" }).first().click();
  await app.getByRole("button", { name: /Update offline copy/ }).waitFor();
  await app.getByRole("button", { name: "Remove offline copy" }).waitFor();
  await page.keyboard.press("Escape");

  // The drawer lists it.
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.getByRole("button", { name: "Saved for offline" }).click();
  await app.locator(".screen.is-list .post-title", { hasText: post.title }).waitFor();
  await app.getByRole("button", { name: "Back" }).click();

  // Reddit refusing the post: the saved copy, with a notice.
  network = "deny";
  await page.reload();
  app = await reader();
  await app.getByRole("button", { name: post.title, exact: true }).click();
  await app.getByText(comment.data.body, { exact: true }).waitFor();
  await app.getByText(/Saved for offline reading/).waitFor();

  // Reddit unreachable: the reader opened on its own reads the saved copy and
  // never asks Reddit for anything.
  const extensionId = new URL(app.url()).host;
  network = "offline";
  const offline = await context.newPage();
  offline.on("pageerror", (err) => errors.push(err.message));
  await offline.goto(`chrome-extension://${extensionId}/reader.html#offline`);
  await offline.getByText("Saved for offline", { exact: true }).waitFor();
  await offline.getByText("1 post", { exact: true }).waitFor();
  await offline.getByRole("button", { name: post.title, exact: true }).click();
  await offline.getByText(comment.data.body, { exact: true }).waitFor();
  await offline.getByText("Body text kept offline.", { exact: true }).waitFor();
  await offline.getByText(/Saved for offline reading/).waitFor();
  await offline.screenshot({ path: resolve(out, "offline-post.png") });
  // Writes fail at once instead of waiting for a page that isn't there.
  const started = Date.now();
  await offline.locator(".screen.is-detail").getByRole("button", { name: /upvote/i }).first().click();
  await toast(offline, "You're offline");
  assert.ok(Date.now() - started < 5000);

  // Removing the copy empties the list.
  await offline.getByRole("button", { name: "Post actions" }).click();
  await offline.getByRole("button", { name: "Remove offline copy" }).click();
  await offline.getByText("Nothing saved yet", { exact: true }).waitFor();
  assert.deepEqual(offlineRequests, []);
  assert.deepEqual(errors, []);
  console.log("Offline smoke test passed");
} finally {
  await context.close();
}
