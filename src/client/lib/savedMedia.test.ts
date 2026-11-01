import test from "node:test";
import assert from "node:assert/strict";
import {
  SAVED_MEDIA_MAX,
  allowedIn,
  parseSavedMedia,
  reuseOf,
  savableMedia,
  savedKey,
  withSaved,
  withoutSaved,
  type SavedMedia,
} from "./savedMedia.ts";

const image = (url: string, extra: Partial<SavedMedia> = {}): SavedMedia => ({
  url,
  width: 0,
  height: 0,
  savedAt: 1,
  ...extra,
});

test("savableMedia keeps a Giphy GIF by its ID and an image by its URL", () => {
  assert.deepEqual(
    savableMedia("giphy|abc123|downsized", "https://external-preview.redd.it/x.gif", { url: "", width: 200, height: 100 }, 5),
    {
      giphy: "abc123",
      url: "https://i.giphy.com/media/abc123/giphy.gif",
      mp4: "https://i.giphy.com/media/abc123/giphy.mp4",
      width: 200,
      height: 100,
      savedAt: 5,
    },
  );
  assert.deepEqual(
    savableMedia("up1", "https://i.redd.it/up1.gif", { url: "", width: 10, height: 20, mp4: "https://i.redd.it/up1.gif?format=mp4" }, 5),
    { url: "https://i.redd.it/up1.gif", mp4: "https://i.redd.it/up1.gif?format=mp4", width: 10, height: 20, savedAt: 5 },
  );
  assert.deepEqual(savableMedia("https://i.imgur.com/a.png", "https://i.imgur.com/a.png", undefined, 5), {
    url: "https://i.imgur.com/a.png",
    width: 0,
    height: 0,
    savedAt: 5,
  });
  assert.equal(savableMedia("giphy|bad id", "", undefined, 5), null);
  assert.equal(savableMedia("x", "http://example.com/a.png", undefined, 5), null);
  assert.equal(savableMedia("x", "javascript:alert(1)", undefined, 5), null);
});

test("withSaved puts the item first once and keeps the newest", () => {
  const a = image("https://i.redd.it/a.png");
  const b = image("https://i.redd.it/b.png");
  assert.deepEqual(withSaved([a, b], { ...b, savedAt: 9 }), [{ ...b, savedAt: 9 }, a]);
  const full = Array.from({ length: SAVED_MEDIA_MAX }, (_, i) => image(`https://i.redd.it/${i}.png`));
  const next = withSaved(full, b);
  assert.equal(next.length, SAVED_MEDIA_MAX);
  assert.equal(next[0], b);
  assert.equal(next.at(-1)!.url, `https://i.redd.it/${SAVED_MEDIA_MAX - 2}.png`);
  assert.deepEqual(withoutSaved([a, b], savedKey(a)), [b]);
  assert.equal(savedKey(image("https://x/y", { giphy: "g1" })), "giphy:g1");
});

test("parseSavedMedia drops malformed entries and rebuilds Giphy URLs", () => {
  assert.deepEqual(parseSavedMedia("nope"), []);
  assert.deepEqual(
    parseSavedMedia([
      null,
      { url: "http://insecure/a.png" },
      { url: "https://i.redd.it/a.png", width: -4, height: "2", savedAt: 3, mp4: "javascript:x" },
      { giphy: "g1", url: "https://evil.example/x.gif", mp4: "https://evil.example/x.mp4" },
    ]),
    [
      { url: "https://i.redd.it/a.png", width: 0, height: 0, savedAt: 3 },
      {
        giphy: "g1",
        url: "https://i.giphy.com/media/g1/giphy.gif",
        mp4: "https://i.giphy.com/media/g1/giphy.mp4",
        width: 0,
        height: 0,
        savedAt: 0,
      },
    ],
  );
});

test("allowedIn follows the subreddit's allowed comment media", () => {
  const gif = image("https://i.giphy.com/media/g1/giphy.gif", { giphy: "g1" });
  const still = image("https://preview.redd.it/a.png?width=100");
  const animated = image("https://i.redd.it/a.gif");
  assert.equal(allowedIn(gif, undefined), true);
  assert.equal(allowedIn(gif, ["static", "animated"]), false);
  assert.equal(allowedIn(gif, ["giphy"]), true);
  assert.equal(allowedIn(still, ["static"]), true);
  assert.equal(allowedIn(animated, ["static"]), false);
  assert.equal(allowedIn(animated, ["animated"]), true);
  assert.equal(allowedIn(still, []), false);
});

test("reuseOf: Giphy by ID and uploads on Reddit, any image URL on Lemmy", () => {
  const gif = image("https://i.giphy.com/media/g1/giphy.gif", { giphy: "g1" });
  const still = image("https://i.redd.it/a.png");
  assert.deepEqual(reuseOf(gif, "Reddit"), { markdown: "![gif](giphy|g1)", ref: "giphy|g1" });
  assert.deepEqual(reuseOf(still, "Reddit"), { upload: "https://i.redd.it/a.png" });
  assert.deepEqual(reuseOf(gif, "Lemmy"), { markdown: "![](https://i.giphy.com/media/g1/giphy.gif)" });
  assert.deepEqual(reuseOf(still, "Lemmy"), { markdown: "![](https://i.redd.it/a.png)" });
});
