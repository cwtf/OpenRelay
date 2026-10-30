// Starts the packaged OpenRelay.exe itself, fuses and all, with a throwaway
// profile and every request sent to a dead proxy, so it never reaches the
// internet. Playwright connects over CDP (the fuses refuse Node's inspector)
// and answers Reddit from fixtures: the reader loads from app.asar, the bridge
// reads JSON and a vote is posted with the modhash. Run `npm run dist` first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const exe = resolve(
  import.meta.dirname,
  "..",
  process.argv[2] || "release/win-unpacked/OpenRelay.exe",
);
const out = resolve(import.meta.dirname, "../../../test-results");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(resolve(out, "packaged-profile-"));
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
  num_comments: 0,
  created_utc: 1700000000,
};
const writes = [];
const userAgents = new Set();

const child = spawn(
  exe,
  [
    `--user-data-dir=${profile}`,
    "--proxy-server=http://127.0.0.1:9",
    "--proxy-bypass-list=<-loopback>",
    "--remote-debugging-port=0",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const endpoint = await new Promise((done, fail) => {
  let log = "";
  child.stderr.on("data", (chunk) => {
    log += chunk;
    const found = /DevTools listening on (ws:\/\/\S+)/.exec(log);
    if (found) done(found[1]);
  });
  child.on("exit", (code) => fail(new Error(`OpenRelay.exe exited (${code}):\n${log}`)));
  setTimeout(() => fail(new Error("No DevTools endpoint:\n" + log)), 30000);
});
const browser = await chromium.connectOverCDP(endpoint);
try {
  const fixtures = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    userAgents.add((await request.allHeaders())["user-agent"]);
    if (request.method() !== "GET") {
      writes.push({
        path: url.pathname,
        body: Object.fromEntries(new URLSearchParams(request.postData())),
      });
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
    if (url.pathname === "/api/me.json")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { name: "fixture_user", modhash: "fixturemodhash1" } }),
      });
    if (url.pathname.endsWith(".json"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { children: [{ kind: "t3", data: post }], after: null } }),
      });
    return route.fulfill({
      contentType: "text/html",
      headers: {
        "Content-Security-Policy": "default-src 'self'; frame-src 'self'; script-src 'self'",
      },
      body: `<!doctype html><title>Reddit fixture</title><shreddit-post id="${post.name}" post-title="${post.title}" author="example_user" subreddit-prefixed-name="r/test" permalink="${post.permalink}" content-href="${post.url}" post-type="text" score="123" comment-count="0" created-timestamp="2023-11-14T22:13:20Z"></shreddit-post>`,
    });
  };
  // The app's window lives in its persist:openrelay session's context.
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    page = browser.contexts().flatMap((context) => context.pages())[0];
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page, "The app opened no window");
  await page.context().route(/^https:\/\/(www|old)\.reddit\.com\//, fixtures);
  await page.goto("https://www.reddit.com/r/test/");
  await page.waitForFunction(() => document.getElementById("openrelay-extension"));
  let app;
  for (let i = 0; i < 100 && !app; i++) {
    app = page.frames().find((f) => f.url().startsWith("openrelay://reader/"));
    if (!app) await page.waitForTimeout(100);
  }
  assert.ok(app, "Reader iframe did not load");
  await app.getByRole("button", { name: post.title, exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.openRelayReaderHost?.name), "electron");
  assert.equal(await page.evaluate(() => typeof globalThis.openRelayReaderHost), "undefined");
  await app.locator(`.vote[data-thing-id="${post.name}"] .is-up`).first().click();
  await app.locator(`.vote[data-thing-id="${post.name}"] .is-up[aria-pressed="true"]`).first().waitFor();
  assert.deepEqual(writes, [
    {
      path: "/api/vote",
      body: { id: post.name, dir: "1", uh: "fixturemodhash1", api_type: "json" },
    },
  ]);
  // Reddit sees a plain Chrome (its bot filter refuses JSON to Electron's).
  assert.equal(userAgents.size, 1);
  assert.doesNotMatch([...userAgents][0], /Electron|OpenRelay|openrelay/i);
  // The throwaway profile was used (--user-data-dir), not the real one.
  assert.ok((await readdir(profile)).includes("Partitions"));
  console.log(
    "PASS (packaged): OpenRelay.exe starts with its fuses, serves the reader from app.asar, injects content.js, loads fixtures through the bridge and posts a vote with the modhash.",
  );
} finally {
  await browser.close().catch(() => {});
  child.kill();
}
