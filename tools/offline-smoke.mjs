// Offline reading: save posts from the reader on a Reddit page, then read them
// in reader.html#offline with Reddit unreachable, and as the fallback when
// Reddit refuses the post. Images, and videos joined with their sound, are
// saved with them and shown from the device.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
const pic = {
  id: "pic456",
  name: "t3_pic456",
  title: "A picture saved for later",
  author: "example_user",
  subreddit: "test",
  permalink: "/r/test/comments/pic456/picture/",
  url: "https://i.redd.it/pic.png",
  post_hint: "image",
  is_self: false,
  domain: "i.redd.it",
  thumbnail: "https://b.thumbs.redditmedia.com/thumb.png",
  preview: {
    images: [{ source: { url: "https://preview.redd.it/pic.png?width=640&amp;s=abc", width: 640, height: 480 } }],
  },
  score: 5,
  num_comments: 0,
  created_utc: 1700000000,
};
const vid = {
  id: "vid789",
  name: "t3_vid789",
  title: "A video saved for later",
  author: "example_user",
  subreddit: "test",
  permalink: "/r/test/comments/vid789/video/",
  url: "https://v.redd.it/vid789",
  post_hint: "hosted:video",
  is_self: false,
  domain: "v.redd.it",
  secure_media: {
    reddit_video: {
      fallback_url: "https://v.redd.it/vid789/DASH_360.mp4?source=fallback",
      hls_url: "https://v.redd.it/vid789/HLSPlaylist.m3u8",
      width: 160,
      height: 90,
      is_gif: false,
    },
  },
  preview: {
    images: [{ source: { url: "https://preview.redd.it/vid.png?s=def", width: 160, height: 90 } }],
  },
  score: 3,
  num_comments: 0,
  created_utc: 1700000000,
};
const posts = { [post.id]: post, [pic.id]: pic, [vid.id]: vid };
// The generated test video (tools/fixtures/video): fragmented video and audio
// files, as v.redd.it serves them, and the DASH playlist naming the audio.
const fragments = (track, parts) =>
  Promise.all(
    [`init_${track}.mp4`, ...Array.from({ length: parts }, (_, i) => `part_${track}_${i}.m4s`)].map(
      (name) => readFile(resolve("tools/fixtures/video", name)),
    ),
  ).then(Buffer.concat);
const vreddit = {
  "/vid789/DASH_360.mp4": { type: "video/mp4", body: await fragments(0, 3) },
  "/vid789/DASH_AUDIO_128.mp4": { type: "audio/mp4", body: await fragments(1, 4) },
  "/vid789/DASHPlaylist.mpd": {
    type: "application/dash+xml",
    body: `<MPD><Period><AdaptationSet contentType="video"><Representation bandwidth="1"><BaseURL>DASH_360.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation bandwidth="128000"><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`,
  },
};
const fixture = `<!doctype html><title>Reddit fixture</title><shreddit-post id="${post.name}" post-title="${post.title}" author="${post.author}" subreddit-prefixed-name="r/test" permalink="${post.permalink}" content-href="${post.url}" post-type="text" score="12" comment-count="1" created-timestamp="2023-11-14T22:13:20Z"><div slot="text-body">Loaded page text.</div></shreddit-post><shreddit-post id="${pic.name}" post-title="${pic.title}" author="${pic.author}" subreddit-prefixed-name="r/test" permalink="${pic.permalink}" content-href="${pic.url}" post-type="image" score="5" comment-count="0" created-timestamp="2023-11-14T22:13:20Z"></shreddit-post><shreddit-post id="${vid.name}" post-title="${vid.title}" author="${vid.author}" subreddit-prefixed-name="r/test" permalink="${vid.permalink}" content-href="${vid.url}" post-type="video" score="3" comment-count="0" created-timestamp="2023-11-14T22:13:20Z"></shreddit-post>`;
// 1x1 PNG served for every image.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
/** "online", "deny" (Reddit refuses JSON) or "offline" (unreachable). */
let network = "online";
const offlineRequests = [];
const commentLoads = [];
const mediaLoads = [];
const videoLoads = [];
await context.route(/^https:\/\/v\.redd\.it\//, async (route) => {
  const url = new URL(route.request().url());
  if (network === "offline") {
    offlineRequests.push(url.href);
    return route.abort("internetdisconnected");
  }
  videoLoads.push(url.pathname);
  const file = vreddit[url.pathname];
  return file
    ? route.fulfill({
        contentType: file.type,
        body: file.body,
        headers: { "Access-Control-Allow-Origin": "*" },
      })
    : route.fulfill({ status: 404, body: "" });
});
await context.route(/^https:\/\/(i|preview|b\.thumbs)\.(redd\.it|redditmedia\.com)\//, async (route) => {
  const url = route.request().url();
  if (network === "offline") {
    offlineRequests.push(url);
    return route.abort("internetdisconnected");
  }
  // Saving fetches them; the feed's own images are "image" requests.
  if (route.request().resourceType() === "fetch") mediaLoads.push(url);
  return route.fulfill({ contentType: "image/png", body: png });
});
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
    const shown = posts[url.pathname.match(/\/comments\/(\w+)/)?.[1]] ?? post;
    const body = url.pathname.includes("/comments/")
      ? [
          { data: { children: [{ kind: "t3", data: shown }] } },
          { data: { children: shown === post ? [comment] : [] } },
        ]
      : url.pathname.endsWith("/hot.json")
        ? { data: { children: [post, pic, vid].map((data) => ({ kind: "t3", data })), after: null } }
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
/** Save the feed's nth post from its menu, once the last toast is gone. */
const save = async (app, nth) => {
  await app.locator(".toast").waitFor({ state: "detached" });
  await app.getByRole("button", { name: "More actions" }).nth(nth).click();
  await app.getByRole("button", { name: /Save for offline|Update offline copy/ }).click();
  await toast(app, "Saved for offline reading");
};
/** Choose `option` in the drawer's "Save feed for offline" sheet. */
const saveFeed = async (app, option, done) => {
  await app.locator(".toast").waitFor({ state: "detached" });
  await app.locator(".screen.is-feed .scroller").evaluate((el) => el.scrollTo(0, 0));
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.getByRole("button", { name: "Save feed for offline" }).click();
  await app.getByRole("button", { name: /^Text only/ }).waitFor();
  await page.waitForTimeout(400); // Let the sheet finish sliding in.
  await page.screenshot({ path: resolve(out, "offline-save-feed.png") });
  await app.getByRole("button", { name: option }).click();
  await toast(app, done);
};
/** Set Settings' offline images and videos switches. */
const offlineSettings = async (app, on) => {
  await app.locator(".screen.is-feed .scroller").evaluate((el) => el.scrollTo(0, 0));
  await app.locator(".has-drawer").waitFor({ state: "detached" });
  await app.locator(".screen.is-feed").getByRole("button", { name: "Settings", exact: true }).click();
  for (const name of [/^Save images/, /^Save videos/]) {
    const toggle = app.getByRole("switch", { name });
    if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
  }
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });
};
const forget = () => {
  commentLoads.length = mediaLoads.length = videoLoads.length = 0;
};

try {
  await page.goto("https://www.reddit.com/r/test/");
  let app = await reader();
  const extensionId = new URL(app.url()).host;
  // Chrome's prompt for the image hosts can't be answered here; grant them as
  // the Site access control on chrome://extensions does, so the reader's
  // permissions.request() resolves without one.
  const extensions = await context.newPage();
  await extensions.goto("chrome://extensions/");
  await extensions.evaluate(async (id) => {
    for (const host of [
      "i.redd.it",
      "preview.redd.it",
      "external-preview.redd.it",
      "a.thumbs.redditmedia.com",
      "b.thumbs.redditmedia.com",
    ])
      await chrome.developerPrivate.addHostPermission(id, `https://${host}/*`);
  }, extensionId);
  await extensions.close();

  // Save from the card's menu; the request asks for one page of comments.
  await save(app, 0);
  assert.match(commentLoads.at(-1), /limit=200/);
  // The menu now offers to update or remove the copy.
  await app.getByRole("button", { name: "More actions" }).first().click();
  await app.getByRole("button", { name: /Update offline copy/ }).waitFor();
  await app.getByRole("button", { name: "Remove offline copy" }).waitFor();
  await page.keyboard.press("Escape");

  // From the feed, text posts only: just the text post, nothing else fetched.
  forget();
  await saveFeed(app, /^Text posts only/, "Saved for offline reading");
  assert.deepEqual(commentLoads.length, 1);
  assert.deepEqual([...mediaLoads, ...videoLoads], []);
  // Text only: every post, without their images or videos.
  forget();
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  await saveFeed(app, /^Text only/, "Saved 3 posts for offline reading");
  assert.equal(commentLoads.length, 3);
  assert.deepEqual([...mediaLoads, ...videoLoads], []);
  // With images and videos off in Settings, a post's own save fetches neither,
  // and the feed sheet has no "with media" choice.
  await offlineSettings(app, false);
  forget();
  await save(app, 2);
  assert.equal(commentLoads.length, 1);
  assert.deepEqual([...mediaLoads, ...videoLoads], []);
  await app.locator(".toast").waitFor({ state: "detached" });
  await app.locator(".screen.is-feed .scroller").evaluate((el) => el.scrollTo(0, 0));
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.getByRole("button", { name: "Save feed for offline" }).click();
  await app.getByRole("button", { name: /^Text only/ }).waitFor();
  assert.equal(await app.getByRole("button", { name: /^With / }).count(), 0);
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  await offlineSettings(app, true);

  // The picture is saved with its images.
  forget();
  await save(app, 1);
  assert.deepEqual(mediaLoads.sort(), [
    "https://i.redd.it/pic.png",
    "https://preview.redd.it/pic.png?width=640&s=abc",
  ]);

  // The video is saved joined with its sound, as the download button does it.
  await app.locator(".screen.is-feed .scroller").evaluate((el) => el.scrollTo(0, 0));
  await save(app, 2);
  assert.deepEqual(videoLoads.sort(), [
    "/vid789/DASHPlaylist.mpd",
    "/vid789/DASH_360.mp4",
    "/vid789/DASH_AUDIO_128.mp4",
  ]);

  // The drawer lists them. (Back at the top, where the app bar shows again.)
  await app.locator(".screen.is-feed .scroller").evaluate((el) => el.scrollTo(0, 0));
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
  network = "offline";
  const offline = await context.newPage();
  offline.on("pageerror", (err) => errors.push(err.message));
  await offline.goto(`chrome-extension://${extensionId}/reader.html#offline`);
  await offline.getByText("Saved for offline", { exact: true }).waitFor();
  await offline.getByText("3 posts", { exact: true }).waitFor();
  // The picture's card and page show its saved image, from this device.
  const loaded = (img) =>
    img.evaluate((el) => el.decode().then(() => [el.src.slice(0, 5), el.naturalWidth]));
  assert.deepEqual(await loaded(offline.locator(".post", { hasText: pic.title }).locator("img").first()), ["blob:", 1]);
  // Its title row: the image above the middle opens the viewer.
  await offline
    .getByRole("button", { name: pic.title, exact: true })
    .click({ position: { x: 100, y: 45 } });
  assert.deepEqual(await loaded(offline.locator(".screen.is-detail img").first()), ["blob:", 1]);
  // The video plays from the device, with both tracks, and no stream is asked for.
  await offline
    .getByRole("button", { name: vid.title, exact: true })
    .click({ position: { x: 100, y: 45 } });
  await offline.locator(".screen.is-detail").getByRole("button", { name: "Play video" }).click();
  const player = offline.locator("video").last();
  await player.evaluate((el) =>
    el.readyState >= 1 ? null : new Promise((r) => el.addEventListener("loadedmetadata", r, { once: true })),
  );
  const played = await player.evaluate((el) => ({ src: el.src.slice(0, 5), duration: Math.round(el.duration) }));
  assert.deepEqual(played, { src: "blob:", duration: 6 });
  const tracks = await offline.evaluate(async () => {
    const stored = await chrome.storage.local.get(null);
    const file = Object.entries(stored).find(
      ([key, value]) => key.startsWith("openrelay-offline:media:vid789_") && value.type === "video/mp4",
    )?.[1];
    return file ? atob(file.data).split("trak").length - 1 : 0;
  });
  assert.equal(tracks, 2);
  await offline.keyboard.press("Escape");
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

  // Removing the copies empties the list, files and all.
  await offline.getByRole("button", { name: "Post actions" }).click();
  await offline.getByRole("button", { name: "Remove offline copy" }).click();
  await offline.getByText("2 posts", { exact: true }).waitFor();
  await offline.getByRole("button", { name: "Remove all offline posts" }).click();
  await offline.getByRole("button", { name: "Remove all", exact: true }).click();
  await offline.getByText("Nothing saved yet", { exact: true }).waitFor();
  assert.deepEqual(
    await offline.evaluate(async () =>
      Object.keys(await chrome.storage.local.get(null)).filter((key) => key.startsWith("openrelay-offline:")),
    ),
    [],
  );
  assert.deepEqual(offlineRequests, []);
  assert.deepEqual(errors, []);
  console.log("Offline smoke test passed");
} finally {
  await context.close();
}
