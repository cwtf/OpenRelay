// Loads the real built extension and opens images of very different shapes in
// the media viewer, checking each is scaled to fit the screen on both axes:
// never overflowing, and filling the axis that runs out first.
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve("test-results");
await mkdir(out, { recursive: true });
const viewport = { width: 1100, height: 760 };
const context = await chromium.launchPersistentContext(
  await mkdtemp(resolve(out, "media-profile-")),
  {
    channel: "chromium",
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
    viewport,
  },
);
const errors = [];
// Tall, wide and tiny images (SVG keeps fixtures dependency-free).
const shapes = { tall: [400, 2400], wide: [3000, 500], tiny: [60, 40] };
const svg = ([w, h]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#3a7"/></svg>`;
const post = (name) => {
  const [width, height] = shapes[name];
  const url = `https://www.reddit.com/img/${name}.svg`;
  return {
    kind: "t3",
    data: {
      id: name, name: "t3_" + name, title: `A ${name} image`, author: "u", subreddit: "test",
      permalink: `/r/test/comments/${name}/x/`, url, post_hint: "image", is_self: false,
      domain: "i.redd.it", score: 1, num_comments: 0, created_utc: 1700000000,
      preview: { images: [{ source: { url, width, height } }] },
    },
  };
};
// A hosted video; its file 404s, which still opens a video page in the viewer.
const videoPost = {
  kind: "t3",
  data: {
    id: "clip", name: "t3_clip", title: "A video", author: "u", subreddit: "test",
    permalink: "/r/test/comments/clip/x/", url: "https://www.reddit.com/vid/clip",
    post_hint: "hosted:video", is_self: false, domain: "v.redd.it", score: 1,
    num_comments: 0, created_utc: 1700000000,
    secure_media: {
      reddit_video: { fallback_url: "https://www.reddit.com/vid/clip.mp4", width: 640, height: 360 },
    },
  },
};
// GIF comments: Reddit's body names the media by ID and lists its URLs in
// media_metadata, or only `"status": "invalid"` when Giphy has the only copy.
// The MP4s are held back until the test lets them fail.
const gifComment = {
  kind: "t1",
  data: {
    id: "g1", name: "t1_g1", parent_id: "t3_tiny", author: "u", score: 1, created_utc: 1700000000,
    body: "Still ![gif](giphy|still) moving ![gif](giphy|moving|downsized) remote ![gif](giphy|remote)",
    media_metadata: {
      "giphy|still": { e: "AnimatedImage", s: { gif: "https://www.reddit.com/img/wide.svg", x: 3000, y: 500 } },
      "giphy|moving": {
        e: "AnimatedImage",
        s: { gif: "https://www.reddit.com/vid/moving.gif", mp4: "https://www.reddit.com/vid/moving.mp4", x: 200, y: 100 },
      },
      "giphy|remote": { status: "invalid" },
    },
  },
};
let releaseMp4;
const mp4Held = new Promise((resolve) => (releaseMp4 = resolve));
const giphyReferrers = [];
await context.route(/^https:\/\/i\.giphy\.com\//, async (route) => {
  giphyReferrers.push((await route.request().allHeaders()).referer ?? "");
  await mp4Held;
  return route.fulfill({ status: 404, body: "" });
});
await context.route(/^https:\/\/www\.reddit\.com\//, async (route) => {
  const url = new URL(route.request().url());
  const shape = url.pathname.match(/^\/img\/(\w+)\.svg$/)?.[1];
  if (shape && shapes[shape])
    return route.fulfill({ contentType: "image/svg+xml", body: svg(shapes[shape]) });
  if (url.pathname === "/vid/moving.mp4") await mp4Held;
  if (url.pathname.startsWith("/vid/")) return route.fulfill({ status: 404, body: "" });
  if (url.pathname.endsWith(".json"))
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        url.pathname === "/r/test/hot.json"
          ? { data: { after: null, children: [...Object.keys(shapes).map(post), videoPost] } }
          : url.pathname.startsWith("/comments/")
            ? [
                { data: { children: [post(url.pathname.split("/")[2].replace(".json", ""))] } },
                { data: { children: url.pathname.includes("/tiny") ? [gifComment] : [] } },
              ]
            : { data: { children: [] } },
      ),
    });
  // No posts in the page itself, so the reader loads the JSON listing.
  return route.fulfill({ contentType: "text/html", body: "<title>Reddit fixture</title>" });
});

const page = await context.newPage();
page.on("pageerror", (err) => errors.push(err.message));
try {
  await page.goto("https://www.reddit.com/r/test/");
  let app;
  for (let i = 0; i < 80 && !app; i++) {
    app = page.frames().find((f) => f.url().startsWith("chrome-extension://"));
    if (!app) await page.waitForTimeout(100);
  }
  await app.getByText("A tiny image").waitFor({ timeout: 20000 });
  for (const name of Object.keys(shapes)) {
    const card = app.locator(".post", { hasText: `A ${name} image` });
    await card.getByRole("button", { name: /Open (image|media)/ }).first().click();
    const img = app.locator(".viewer-page img.is-fit");
    await img.waitFor();
    await page.waitForTimeout(450); // Opening animation.
    const box = await img.evaluate((el) => el.getBoundingClientRect().toJSON());
    const [w, h] = shapes[name];
    // Within the screen on both axes...
    assert.ok(box.left >= -1 && box.top >= -1, `${name} starts on screen`);
    assert.ok(box.right <= viewport.width + 1, `${name} fits horizontally`);
    assert.ok(box.bottom <= viewport.height + 1, `${name} fits vertically`);
    // ...filling the limiting axis, with its shape preserved.
    const fills =
      Math.abs(box.width - viewport.width) <= 1 || Math.abs(box.height - viewport.height) <= 1;
    assert.ok(fills, `${name} fills one axis (${box.width}x${box.height})`);
    assert.ok(Math.abs(box.width / box.height - w / h) < 0.02, `${name} keeps its aspect ratio`);
    await page.screenshot({ path: resolve(out, `viewer-${name}.png`) });
    await app.locator("body").press("Escape");
    await app.locator(".viewer").waitFor({ state: "detached" });
  }
  // A vertical swipe closes images and videos alike; a short one springs back.
  const swipe = async (dy) => {
    const x = viewport.width / 2;
    const y = viewport.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 10 });
    await page.mouse.up();
  };
  for (const [title, opener] of [
    ["A tiny image", /Open (image|media)/],
    ["A video", /^(Play|Open) video$/],
  ]) {
    const card = app.locator(".post", { hasText: title });
    await card.getByRole("button", { name: opener }).first().click();
    await app.locator(".viewer-stage").first().waitFor();
    await page.waitForTimeout(450); // Opening animation.
    await swipe(60);
    await page.waitForTimeout(400);
    assert.equal(await app.locator(".viewer").count(), 1, `${title}: short swipe springs back`);
    await swipe(-220);
    await app.locator(".viewer").waitFor({ state: "detached" });
  }
  // The opened post follows the Layout setting, like the feed.
  const openPost = async (title) => {
    // In Cards the image covers the card's centre (and opens the viewer), so
    // activate the card's own open control directly.
    await app.getByRole("button", { name: title, exact: true }).dispatchEvent("click");
    const screen = app.locator(".screen").last();
    await screen.locator(".post-head").first().waitFor();
    await app.locator(".screen.is-entering").waitFor({ state: "detached" });
    return screen;
  };
  const back = async (screen) => {
    // Full-screen "Back", or "Close post" in the dual-pane layout.
    await screen.getByRole("button", { name: /^(Back|Close post)$/ }).click();
    await app.locator(".screen.is-exiting").waitFor({ state: "detached" });
  };
  // The feed's app bar hides on scroll (quick return), so press it directly.
  const switchLayout = () =>
    app.getByRole("button", { name: /Layout:/ }).dispatchEvent("click");
  let post = await openPost("A wide image");
  assert.equal(await post.locator(".post-head-media").count(), 1); // Cards: full media.
  assert.equal(await post.locator(".post-head-row").count(), 0);
  await back(post);

  await switchLayout();
  await app.locator('.feed[data-layout="compact"]').waitFor();
  post = await openPost("A wide image");
  const row = post.locator('.post-head-row[data-layout="compact"]');
  await row.locator(".thumb").waitFor();
  assert.equal(await post.locator(".post-head-media").count(), 0);
  const titleBox = await row.locator(".post-title").boundingBox();
  const thumbBox = await row.locator(".thumb").boundingBox();
  assert.ok(thumbBox.x > titleBox.x, "Compact: thumbnail on the right");
  await page.screenshot({ path: resolve(out, "post-compact.png") });
  await row.locator(".thumb").click(); // Opens the media, as in the feed.
  await app.locator(".viewer-page img.is-fit").waitFor();
  await app.locator("body").press("Escape");
  await app.locator(".viewer").waitFor({ state: "detached" });
  await back(post);

  await switchLayout();
  await app.locator('.feed[data-layout="list"]').waitFor();
  post = await openPost("A wide image");
  const listRow = post.locator('.post-head-row[data-layout="list"]');
  await listRow.locator(".thumb").waitFor();
  assert.ok(
    (await listRow.locator(".thumb").boundingBox()).x <
      (await listRow.locator(".post-title").boundingBox()).x,
    "List: thumbnail on the left",
  );
  await page.screenshot({ path: resolve(out, "post-list.png") });
  await back(post);

  // Comment GIFs render inline at their own shape instead of as a "GIF" link.
  post = await openPost("A tiny image");
  const gifs = post.locator('[data-cid="t1_g1"] .md-image');
  await gifs.first().waitFor();
  const still = gifs.nth(0).locator("img");
  assert.equal(await still.getAttribute("src"), "https://www.reddit.com/img/wide.svg");
  const stillBox = await still.boundingBox();
  assert.ok(Math.abs(stillBox.width / stillBox.height - 6) < 0.1, "GIF keeps its shape");
  assert.ok(stillBox.width <= 361, "GIF is at most 360px wide");
  // An MP4 is preferred (`giphy|<id>|downsized` is listed as `giphy|<id>`).
  const moving = gifs.nth(1).locator("video");
  await app.locator('video[src="https://www.reddit.com/vid/moving.mp4"]').waitFor();
  assert.equal(await moving.evaluate((v) => v.muted && v.loop), true);
  // One Reddit has no copy of loads from Giphy, without a referrer.
  await app.locator('video[src="https://i.giphy.com/media/remote/giphy.mp4"]').waitFor();
  assert.equal(await post.getByText("GIF", { exact: true }).count(), 0);
  await page.screenshot({ path: resolve(out, "comment-gifs.png") });
  await gifs.nth(0).click();
  await app.locator(".viewer-page img.is-fit").waitFor();
  // A comment's GIF can be saved for replies.
  await app.getByRole("button", { name: "Save for replies" }).waitFor();
  await app.locator("body").press("Escape");
  await app.locator(".viewer").waitFor({ state: "detached" });
  // A GIF that fails to load falls back to a link.
  assert.ok(giphyReferrers.length > 0, "the Giphy GIF was requested");
  assert.deepEqual(giphyReferrers.filter(Boolean), [], "Giphy gets no referrer");
  releaseMp4();
  await post.locator('[data-cid="t1_g1"] a.md-link', { hasText: "gif" }).nth(1).waitFor();
  await back(post);

  assert.deepEqual(errors, []);
  console.log(
    "PASS: viewer scales tall, wide and tiny images to fit the screen on both axes, keeping their shape; images and videos close on a vertical swipe; opened posts follow the Layout (Cards media, Compact/List thumbnail row); comment GIFs render inline (MP4 preferred; from Giphy, without a referrer, when Reddit has no copy), open in the viewer, and fall back to a link.",
  );
} finally {
  await context.close();
}
