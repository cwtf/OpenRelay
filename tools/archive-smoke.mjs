import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";

// Restoring removed threads from the archive (Arctic Shift), against fixture
// Reddit and fixture archive answers: nothing reaches the archive until the
// button is pressed, and then only the IDs, without cookies or referrer.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = resolve("test-results");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(resolve(out, "archive-profile-"));
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
const t1 = (id, body, extra = {}) => ({
  kind: "t1",
  data: { id, name: `t1_${id}`, author: `user_${id}`, body, score: 1, created_utc: 1700000100, ...extra },
});
// Removed by the moderators, as Reddit shows it now.
const removed = {
  id: "rem1",
  name: "t3_rem1",
  title: "[ Removed by moderator ]",
  author: "[deleted]",
  subreddit: "test",
  permalink: "/r/test/comments/rem1/removed/",
  is_self: true,
  selftext: "[removed]",
  removed_by_category: "moderator",
  score: 40,
  num_comments: 4,
  created_utc: 1700000000,
};
const removedComments = [
  t1("ca", "[removed]", { author: "[deleted]", parent_id: "t3_rem1" }),
  t1("cb", "Still visible on Reddit", { parent_id: "t3_rem1" }),
  t1("cc", "[deleted]", { author: "[deleted]", parent_id: "t3_rem1" }),
  t1("cd", "[removed]", { author: "[deleted]", parent_id: "t3_rem1" }),
];
// Reddit refuses these threads outright.
const gone = { ...removed, id: "gone1", name: "t3_gone1", title: "Gone thread", permalink: "/r/test/comments/gone1/gone/", author: "op_gone", selftext: "", removed_by_category: undefined };
const missing = { ...gone, id: "miss1", name: "t3_miss1", title: "Missing thread", permalink: "/r/test/comments/miss1/missing/" };

await context.route(/^https:\/\/(www|old)\.reddit\.com\//, (route) => {
  const url = new URL(route.request().url());
  if (/^\/(r\/test\/)?comments\/rem1\.json$/.test(url.pathname))
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { data: { children: [{ kind: "t3", data: removed }] } },
        { data: { children: removedComments } },
      ]),
    });
  if (/^\/(r\/test\/)?comments\/(gone1|miss1)\.json$/.test(url.pathname))
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  if (url.pathname.endsWith(".json"))
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        url.pathname.includes("/comments/")
          ? [{ data: { children: [] } }, { data: { children: [] } }]
          : {
              data: {
                after: null,
                children: [removed, gone, missing].map((data) => ({ kind: "t3", data })),
              },
            },
      ),
    });
  return route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Reddit fixture</title><h1>Reddit fixture</h1>",
  });
});

const archive = [];
let goneTries = 0;
await context.route(/^https:\/\/arctic-shift\.photon-reddit\.com\//, (route) => {
  const request = route.request();
  const url = new URL(request.url());
  archive.push({ path: url.pathname, params: Object.fromEntries(url.searchParams), headers: request.headers() });
  const answer = (data) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ data }),
    });
  const ids = url.searchParams.get("ids");
  if (url.pathname === "/api/posts/ids") {
    if (ids === "rem1")
      return answer([{ ...removed, title: "Original title", author: "op_user", selftext: "Original **body** text", removed_by_category: null, retrieved_on: 1700000050 }]);
    if (ids === "gone1") {
      // The first try finds the archive down; the retry gets through.
      if (++goneTries === 1) return route.abort("failed");
      return answer([{ ...gone, selftext: "The archived body", is_self: true, retrieved_on: 1700000060 }]);
    }
    return answer([]);
  }
  if (url.pathname === "/api/comments/ids")
    return answer([t1("ca", "Restored comment text", { author: "commenter" }).data]);
  if (url.pathname === "/api/comments/tree" && url.searchParams.get("parent_id") === "t1_low")
    return answer([t1("low", "Low score", { replies: { kind: "Listing", data: { children: [t1("deep", "A reply from the archive", { parent_id: "t1_low" })] } } })]);
  if (url.pathname === "/api/comments/tree")
    return answer([
      t1("low", "Low score", {
        score: 2,
        replies: { kind: "Listing", data: { children: [{ kind: "more", data: { id: "m1", children: ["deep"] } }] } },
      }),
      t1("high", "High score", { score: 50 }),
      t1("bye", "Gone later", { score: 9, _meta: { removal_type: "deleted" } }),
    ]);
  return route.fulfill({ status: 404, body: "" });
});

const page = await context.newPage();
page.on("pageerror", (err) => errors.push(err.message));
async function reader() {
  await page.waitForFunction(() => document.getElementById("openrelay-extension"));
  for (let i = 0; i < 60; i++) {
    const frame = page.frames().find((f) => f.url().startsWith("chrome-extension://"));
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
  const app = await reader();
  const detail = app.locator(".screen.is-detail");

  // A post removed by the moderators: the bar, and nothing sent yet.
  await app.getByRole("button", { name: removed.title, exact: true }).click();
  const bar = detail.locator(".archive-bar");
  await bar.getByText("Removed by the moderators · 2 comments removed").waitFor();
  await detail.getByText("Loads a saved copy from Arctic Shift, which sees this post's ID.").waitFor();
  await detail.getByText("Still visible on Reddit").waitFor();
  await detail.getByText("Deleted by its author").waitFor();
  assert.equal(await detail.locator(".post-selftext").count(), 0, "the [removed] body gives way to the bar");
  await page.waitForTimeout(300);
  assert.deepEqual(archive, [], "nothing reaches the archive before the button is pressed");

  await bar.getByRole("button", { name: "Restore from archive" }).click();
  await bar.getByText("Restored from archive · 1 of 2 comments").waitFor();
  await detail.locator(".post-title", { hasText: "Original title" }).waitFor();
  await detail.locator(".post-selftext strong", { hasText: "body" }).waitFor();
  await detail.getByText(/^Archived copy · captured /).waitFor();
  const restored = detail.locator('.comment[data-cid="t1_ca"]');
  await restored.getByText("Restored comment text").waitFor();
  await restored.locator(".badge.archive").waitFor();
  await restored.getByText("commenter", { exact: true }).waitFor();
  await detail.locator('.comment[data-cid="t1_cd"]').getByText("Not in the archive").waitFor();
  // The author's deletion stays, and was never asked for.
  await detail.locator('.comment[data-cid="t1_cc"]').getByText("Deleted by its author").waitFor();
  assert.deepEqual(
    archive.map((r) => [r.path, r.params.ids]).sort(),
    [["/api/comments/ids", "ca,cd"], ["/api/posts/ids", "rem1"]],
  );
  for (const { headers } of archive) {
    assert.equal(headers.cookie, undefined, "no cookies go to the archive");
    assert.equal(headers.referer, undefined, "no referrer goes to the archive");
  }

  // Switch back to Reddit's version and again, without asking the archive twice.
  await bar.getByRole("button", { name: "Show removed" }).click();
  await detail.locator(".post-title", { hasText: removed.title }).waitFor();
  await bar.getByText("Removed by the moderators · 2 comments removed").waitFor();
  await bar.getByRole("button", { name: "Show archive copy" }).click();
  await detail.locator(".post-title", { hasText: "Original title" }).waitFor();
  assert.equal(archive.length, 2);

  // A thread Reddit refuses: offered, the archive is down, then the retry works.
  archive.length = 0;
  await app.getByRole("button", { name: gone.title, exact: true }).click();
  const panel = detail.locator(".archive-refused");
  await panel.getByText("Reddit won't show this post. It may have been removed, or its community may be private or banned.").waitFor();
  await page.waitForTimeout(300);
  assert.deepEqual(archive, []);
  await panel.getByRole("button", { name: "Restore from archive" }).click();
  await panel.getByText("Couldn't reach the archive. Check your connection and try again.").waitFor();
  await panel.getByRole("button", { name: "Retry archive" }).click();
  await detail.getByText("Archived copy. Reddit no longer shows this thread, so voting and replying are off.").waitFor();
  await detail.getByText("The archived body").waitFor();
  await detail.getByText(/^Captured .* · score and counts as of then$/).waitFor();
  await detail.locator(".action-circle.is-score").waitFor();
  assert.equal(await detail.getByRole("button", { name: "Reply to post" }).count(), 0);
  assert.equal(await detail.locator(".comment .vote-btn").count(), 0, "no voting on an archived thread");
  // Top order, with the author's later deletion blanked again.
  assert.deepEqual(
    await detail.locator(".comment").evaluateAll((rows) => rows.map((r) => r.dataset.cid)),
    ["t1_high", "t1_bye", "t1_low"],
  );
  await detail.locator('.comment[data-cid="t1_bye"]').getByText("Deleted by its author").waitFor();
  assert.equal(await detail.getByText("Gone later").count(), 0);
  // Sorting stays here: New and Old, no Reddit-only sorts.
  await detail.getByRole("button", { name: "Sort comments" }).click();
  const sheet = app.locator(".sheet");
  await sheet.getByText("Old", { exact: true }).waitFor();
  assert.equal(await sheet.getByText("Best", { exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  // "Load more replies" asks the archive for that comment's subtree.
  await detail.getByRole("button", { name: "Load more replies" }).click();
  await detail.getByText("A reply from the archive").waitFor();
  assert.ok(archive.some((r) => r.path === "/api/comments/tree" && r.params.parent_id === "t1_low"));

  // Not in the archive: says so, and offers Reddit.
  await app.getByRole("button", { name: missing.title, exact: true }).click();
  const none = detail.locator(".archive-refused");
  await none.getByRole("button", { name: "Restore from archive" }).click();
  await none.getByText("The archive has no copy of this thread.").waitFor();
  await none.getByRole("button", { name: "Open on Reddit" }).waitFor();
  await none.getByRole("button", { name: "Retry Reddit" }).waitFor();

  assert.deepEqual(errors, []);
  console.log(
    "PASS: removed post and comments restored only on request (IDs only, no cookies or referrer), author deletions left alone, missing comments marked, Show removed toggle; refused thread rebuilt read-only from the archive (retry after unreachable, local sorts, archive replies); not-in-archive message.",
  );
} catch (error) {
  await page.screenshot({ path: resolve(out, "archive-smoke-failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context.close();
}
