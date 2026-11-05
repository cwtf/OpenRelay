// Loads the real built extension against Reddit fixtures and walks adding a
// second account and switching back: the reader saves one account's Reddit
// cookies, signs out, signs in as another, and puts the first one's cookies
// back. Reddit's answers depend on the reddit_session cookie each request
// carries. Nothing reaches Reddit.
//
// Chrome's prompt for the optional `cookies` permission can't be answered
// headless, so this runs a copy of dist/ that has it already.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve("test-results");
await mkdir(out, { recursive: true });
const ext = resolve(out, "accounts-dist");
await rm(ext, { recursive: true, force: true });
await cp(resolve("dist"), ext, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(ext, "manifest.json"), "utf8"));
manifest.permissions.push("cookies");
manifest.host_permissions = ["https://*.reddit.com/*"];
await writeFile(resolve(ext, "manifest.json"), JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(
  await mkdtemp(resolve(out, "accounts-profile-")),
  {
    channel: "chromium",
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport: { width: 900, height: 900 },
  },
);
const errors = [];
/** The reddit_session each /api/me.json request carried, in order. */
const meCalls = [];
const session = (cookieHeader = "") => /(?:^|;\s*)reddit_session=(\w+)/.exec(cookieHeader)?.[1] ?? null;
const listing = (children) => ({ kind: "Listing", data: { after: null, children } });
const post = {
  kind: "t3",
  data: {
    id: "p1", name: "t3_p1", title: "A post", author: "someone", subreddit: "test",
    permalink: "/r/test/comments/p1/x/", url: "https://www.reddit.com/r/test/comments/p1/x/",
    is_self: true, selftext: "", score: 5, num_comments: 0, created_utc: 1700000000,
  },
};
await context.route(/^https:\/\/www\.reddit\.com\//, async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const who = session((await request.allHeaders()).cookie);
  if (url.pathname === "/api/me.json") {
    meCalls.push(who);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(who ? { data: { name: who, id: "u_" + who, modhash: "m", inbox_count: 0 } } : {}),
    });
  }
  if (url.pathname.endsWith(".json"))
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(url.pathname.endsWith("hot.json") ? listing([post]) : listing([])),
    });
  if (url.pathname === "/login/")
    return route.fulfill({ contentType: "text/html", body: "<title>Log in</title><form id=login></form>" });
  return route.fulfill({
    contentType: "text/html",
    body: '<title>Reddit fixture</title><shreddit-post id="t3_p1" post-title="A post" author="someone" subreddit-prefixed-name="r/test" permalink="/r/test/comments/p1/x/" post-type="text"></shreddit-post>',
  });
});
const cookie = (value) => ({
  name: "reddit_session",
  value,
  domain: ".reddit.com",
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "None",
  expires: Math.floor(Date.now() / 1000) + 3600,
});
const jar = async () =>
  (await context.cookies("https://www.reddit.com/"))
    .filter((c) => c.name === "reddit_session")
    .map((c) => c.value);

const page = await context.newPage();
page.on("pageerror", (err) => errors.push(err.message));
const reader = async () => {
  let app;
  for (let i = 0; i < 80 && !app; i++) {
    app = page.frames().find((f) => f.url().startsWith("chrome-extension://"));
    if (!app) await page.waitForTimeout(100);
  }
  assert.ok(app, "the reader mounted");
  await app.locator(".post-title").first().waitFor();
  return app;
};
const openSwitcher = async (app) => {
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator(".drawer-account-name").click();
  await app.locator("#drawer-accounts").waitFor();
};

try {
  await context.addCookies([cookie("alice")]);
  await page.goto("https://www.reddit.com/r/test/");
  let app = await reader();
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator(".drawer-account-name .title", { hasText: "u/alice" }).waitFor();
  await app.locator(".drawer-account-name").click();
  await app.locator(".drawer-item", { hasText: "Add Reddit account" }).click();
  await app.getByRole("button", { name: "Continue to Reddit" }).click();

  // alice is saved and signed out; the tab is on Reddit's sign-in page.
  await page.waitForURL("https://www.reddit.com/login/");
  assert.deepEqual(await jar(), []);
  await page.screenshot({ path: resolve(out, "accounts-login.png") });

  // Signing in as bob, as Reddit's form would, then back to Reddit.
  await context.addCookies([cookie("bob")]);
  await page.goto("https://www.reddit.com/r/test/");
  app = await reader();
  await openSwitcher(app);
  await app.locator(".drawer-account-name .title", { hasText: "u/bob" }).waitFor();
  const names = () => app.locator("#drawer-accounts .account-item .label").allTextContents();
  assert.deepEqual(await names(), ["u/alice", "u/bob"]);
  await page.screenshot({ path: resolve(out, "accounts-switcher.png") });

  // Switching back to alice: the first switch explains every tab switches.
  meCalls.length = 0;
  await app.locator("#drawer-accounts .account-item", { hasText: "u/alice" }).click();
  await app.getByRole("button", { name: "Switch", exact: true }).click();
  await page.waitForURL("https://www.reddit.com/");
  assert.deepEqual(await jar(), ["alice"]);
  app = await reader();
  for (let i = 0; i < 50 && !meCalls.length; i++) await page.waitForTimeout(100);
  assert.equal(meCalls[0], "alice", "the reloaded page is signed in as alice");

  // The other account is one tap away in the header, with no notice now.
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator(".drawer-account-name .title", { hasText: "u/alice" }).waitFor();
  meCalls.length = 0;
  await app.getByRole("button", { name: "Switch to u/bob" }).click();
  // Already on the front page, so wait for the reload's own sign-in check.
  for (let i = 0; i < 80 && meCalls[0] !== "bob"; i++) await page.waitForTimeout(100);
  assert.equal(meCalls[0], "bob", "the reloaded page is signed in as bob");
  assert.deepEqual(await jar(), ["bob"]);

  // Saved sign-ins sit in chrome.storage.local apart from the settings.
  const [worker] = context.serviceWorkers();
  const keys = await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)));
  assert.deepEqual(
    keys.filter((key) => key.startsWith("openrelay-accounts:")).sort(),
    ["openrelay-accounts:reddit.com:alice", "openrelay-accounts:reddit.com:bob"],
  );
  assert.deepEqual(errors, []);
  console.log("accounts smoke: add, switch and one-tap switch passed");
} finally {
  await context.close();
}
