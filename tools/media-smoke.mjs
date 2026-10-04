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
await context.route(/^https:\/\/www\.reddit\.com\//, (route) => {
  const url = new URL(route.request().url());
  const shape = url.pathname.match(/^\/img\/(\w+)\.svg$/)?.[1];
  if (shape && shapes[shape])
    return route.fulfill({ contentType: "image/svg+xml", body: svg(shapes[shape]) });
  if (url.pathname.endsWith(".json"))
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        url.pathname === "/r/test/hot.json"
          ? { data: { after: null, children: Object.keys(shapes).map(post) } }
          : url.pathname.startsWith("/comments/")
            ? [
                { data: { children: [post(url.pathname.split("/")[2].replace(".json", ""))] } },
                { data: { children: [] } },
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
    await screen.getByRole("button", { name: "Back", exact: true }).click();
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

  assert.deepEqual(errors, []);
  console.log(
    "PASS: viewer scales tall, wide and tiny images to fit the screen on both axes, keeping their shape; opened posts follow the Layout (Cards media, Compact/List thumbnail row).",
  );
} finally {
  await context.close();
}
