import test from "node:test";
import assert from "node:assert/strict";
import {
  SAVED_MEDIA_MAX,
  allowedIn,
  giphyGif,
  isAnimated,
  redditReuse,
  savedSource,
  parseSavedMedia,
  reuseOf,
  savableMedia,
  savablePostMedia,
  linkTo,
  parseSavedText,
  savedChanges,
  savedText,
  withLinks,
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
    { asset: "up1", url: "https://i.redd.it/up1.gif", mp4: "https://i.redd.it/up1.gif?format=mp4", width: 10, height: 20, savedAt: 5 },
  );
  // An ID Reddit doesn't list is no upload.
  assert.equal(savableMedia("up1", "https://example.com/up1.gif", undefined, 5)?.asset, undefined);
  // A comment's image linked from Reddit's image hosts is named by its ID.
  const linked = "https://preview.redd.it/ttpkp21jjxyh1.jpeg?width=216&format=pjpg&auto=webp&s=b7e0";
  assert.equal(savableMedia(linked, linked, undefined, 5)?.asset, "ttpkp21jjxyh1");
  assert.equal(savableMedia("x", "https://i.redd.it/abc12345.gif", undefined, 5)?.asset, "abc12345");
  assert.equal(savableMedia("x", "https://i.redd.it/not-an-id.png", undefined, 5)?.asset, undefined);
  assert.equal(savableMedia("x", "https://i.imgur.com/abc12345.png", undefined, 5)?.asset, undefined);
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

test("savablePostMedia keeps a post's image, gallery image or GIF, never a video", () => {
  const preview = { url: "https://preview.redd.it/abc12345.jpeg?auto=webp&s=1", width: 800, height: 600 };
  // An i.redd.it post is saved by its own link, under its ID.
  assert.deepEqual(
    savablePostMedia({ url: "https://i.redd.it/abc12345.jpeg", media: { kind: "image", image: preview, animated: false } }, 0, 5),
    { asset: "abc12345", url: "https://i.redd.it/abc12345.jpeg", width: 800, height: 600, savedAt: 5 },
  );
  // A link to a page, not the file, keeps Reddit's preview.
  const external = { url: "https://external-preview.redd.it/Xy_9-long-hash.jpg?auto=webp&s=1", width: 10, height: 10 };
  assert.deepEqual(
    savablePostMedia({ url: "https://imgur.com/abc", media: { kind: "image", image: external, animated: false } }, 0, 5),
    { url: external.url, width: 10, height: 10, savedAt: 5 },
  );
  const gallery = {
    url: "https://www.reddit.com/gallery/xyz",
    media: {
      kind: "gallery" as const,
      items: [
        { url: "https://preview.redd.it/first1234.jpg?width=1080&format=pjpg", width: 1, height: 2 },
        { url: "https://preview.redd.it/second123.png?width=1080&format=png", width: 3, height: 4 },
      ],
    },
  };
  assert.equal(savablePostMedia(gallery, 1, 5)?.asset, "second123");
  assert.equal(savablePostMedia(gallery, 2, 5), null);
  // Reddit plays an i.redd.it GIF as a video; it's saved as the GIF, with that MP4.
  const video = (isGif: boolean) => ({
    kind: "video" as const,
    video: { mp4: "https://v.redd.it/v1/DASH_480.mp4?source=fallback", width: 480, height: 270, isGif },
  });
  assert.deepEqual(savablePostMedia({ url: "https://i.redd.it/gif12345.gif", media: video(true) }, 0, 5), {
    asset: "gif12345",
    url: "https://i.redd.it/gif12345.gif",
    mp4: "https://v.redd.it/v1/DASH_480.mp4?source=fallback",
    width: 480,
    height: 270,
    savedAt: 5,
  });
  assert.equal(savablePostMedia({ url: "https://v.redd.it/v1", media: video(true) }, 0, 5), null);
  assert.equal(savablePostMedia({ url: "https://i.redd.it/gif12345.gif", media: video(false) }, 0, 5), null);
  // A Lemmy instance's image keeps its URL.
  assert.deepEqual(
    savablePostMedia(
      { url: "https://lemmy.world/pictrs/image/a-b-c.webp", media: { kind: "image", image: { url: "https://lemmy.world/pictrs/image/a-b-c.webp", width: 5, height: 6 }, animated: false } },
      0,
      5,
    ),
    { url: "https://lemmy.world/pictrs/image/a-b-c.webp", width: 5, height: 6, savedAt: 5 },
  );
  assert.equal(savablePostMedia({ url: "https://example.com", media: { kind: "self" } }, 0, 5), null);
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
  assert.deepEqual(withoutSaved([a, b], savedKey(a), savedKey(b)), []);
  assert.deepEqual(withoutSaved([a, b]), [a, b]);
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
      { asset: "abc123", url: "https://i.redd.it/b.png" },
      { asset: "../x)", url: "https://i.redd.it/c.png" },
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
      { asset: "abc123", url: "https://i.redd.it/b.png", width: 0, height: 0, savedAt: 0 },
      { url: "https://i.redd.it/c.png", width: 0, height: 0, savedAt: 0 },
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

test("reuseOf: Giphy GIFs and uploads by ID on Reddit, others linked; any image URL on Lemmy", () => {
  const gif = image("https://i.giphy.com/media/g1/giphy.gif", { giphy: "g1" });
  const still = image("https://i.redd.it/a.png");
  const uploaded = image("https://preview.redd.it/up1.png?width=100", { asset: "up1" });
  const uploadedGif = image("https://i.redd.it/up2.gif", { asset: "up2" });
  assert.deepEqual(reuseOf(gif, "Reddit"), { markdown: "![gif](giphy|g1)", ref: "giphy|g1" });
  assert.deepEqual(reuseOf(uploaded, "Reddit"), { markdown: "![img](up1)", ref: "up1" });
  assert.deepEqual(reuseOf(uploadedGif, "Reddit"), { markdown: "![gif](up2)", ref: "up2" });
  assert.deepEqual(reuseOf(uploaded, "Lemmy"), { markdown: "![](https://preview.redd.it/up1.png?width=100)" });
  assert.deepEqual(reuseOf(still, "Reddit"), { upload: "https://i.redd.it/a.png" });
  assert.deepEqual(reuseOf(gif, "Lemmy"), { markdown: "![](https://i.giphy.com/media/g1/giphy.gif)" });
  assert.deepEqual(reuseOf(still, "Lemmy"), { markdown: "![](https://i.redd.it/a.png)" });
  // Reddit refuses a browser session's upload, so an image it doesn't host is linked.
  const lemmy = image("https://lemmy.world/pictrs/image/abc.jpeg");
  const lemmyGif = image("https://lemmy.world/pictrs/image/def.gif");
  assert.deepEqual(reuseOf(lemmy, "Reddit"), { markdown: "[Image](https://lemmy.world/pictrs/image/abc.jpeg)" });
  assert.deepEqual(reuseOf(lemmyGif, "Reddit"), { markdown: "[GIF](https://lemmy.world/pictrs/image/def.gif)" });
  assert.deepEqual(reuseOf(lemmy, "Lemmy"), { markdown: "![](https://lemmy.world/pictrs/image/abc.jpeg)" });
  assert.deepEqual(reuseOf(image("https://external-preview.redd.it/b.png"), "Reddit"), {
    upload: "https://external-preview.redd.it/b.png",
  });
  // What the subreddit doesn't take in comments goes in as a link.
  assert.deepEqual(reuseOf(uploaded, "Reddit", []), { markdown: "[Image](https://preview.redd.it/up1.png?width=100)" });
  assert.deepEqual(reuseOf(uploadedGif, "Reddit", ["static"]), { markdown: "[GIF](https://i.redd.it/up2.gif)" });
  assert.deepEqual(reuseOf(gif, "Reddit", ["static", "animated"]), { markdown: "[GIF](https://i.giphy.com/media/g1/giphy.gif)" });
  assert.deepEqual(reuseOf(still, "Reddit", ["giphy"]), { markdown: "[Image](https://i.redd.it/a.png)" });
  assert.deepEqual(reuseOf(uploaded, "Reddit", ["static"]), { markdown: "![img](up1)", ref: "up1" });
  assert.deepEqual(reuseOf(lemmy, "Reddit", []), { markdown: "[Image](https://lemmy.world/pictrs/image/abc.jpeg)" });
  assert.deepEqual(reuseOf(lemmy, "Lemmy", []), { markdown: "![](https://lemmy.world/pictrs/image/abc.jpeg)" });
});

test("withLinks swaps only the saved items' IDs for their links", () => {
  const gif = image("https://i.redd.it/up1.gif", { asset: "up1" });
  const giphy = image("https://i.giphy.com/media/abc/giphy.gif", { giphy: "abc" });
  const links = { up1: linkTo(gif), "giphy|abc": linkTo(giphy) };
  assert.equal(
    withLinks("A ![gif](up1) B ![gif](giphy|abc) C ![img](fresh9) ![img](up1)", links),
    "A [GIF](https://i.redd.it/up1.gif) B [GIF](https://i.giphy.com/media/abc/giphy.gif) C ![img](fresh9) [GIF](https://i.redd.it/up1.gif)",
  );
  assert.equal(linkTo(image("https://i.redd.it/a.png")), "[Image](https://i.redd.it/a.png)");
  assert.equal(withLinks("![img](up1)", {}), "![img](up1)");
  // An inherited key is no saved item.
  assert.equal(withLinks("![img](constructor)", {}), "![img](constructor)");
});

test("savedSource, isAnimated and redditReuse describe an item for the manage screen", () => {
  const gif = image(giphyGif("g1"), { giphy: "g1" });
  const upload = image("https://i.redd.it/abc12.png", { asset: "abc12" });
  const reddit = image("https://i.redd.it/not-an-upload.png");
  const lemmy = image("https://lemmy.world/pictrs/image/x.gif");
  assert.deepEqual(
    [gif, upload, reddit, lemmy].map((item) => [savedSource(item), isAnimated(item), redditReuse(item)]),
    [
      ["Giphy", true, "id"],
      ["Reddit", false, "id"],
      ["Reddit", false, "upload"],
      ["lemmy.world", true, "link"],
    ],
  );
});

test("savedText and parseSavedText round-trip the list, keeping each kept entry", () => {
  const gif = image(giphyGif("g1"), { giphy: "g1", mp4: "https://i.giphy.com/media/g1/giphy.mp4", width: 4, height: 3 });
  const upload = image("https://i.redd.it/abc12.png", { asset: "abc12", width: 8, height: 6 });
  const text = savedText([gif, upload]);
  assert.equal(text, "giphy:g1\nhttps://i.redd.it/abc12.png");
  assert.deepEqual(parseSavedText(text, [gif, upload], 99), { items: [gif, upload], errors: [], repeats: [], dropped: 0 });

  const edited = [
    "https://i.redd.it/abc12.png",
    "",
    "  giphy:new2  ",
    "imgur.com/x.gif",
    "giphy:bad id",
    "https://i.redd.it/def34.gif",
    "https://lemmy.world/pictrs/image/x.webp",
    "https://i.redd.it/abc12.png",
  ].join("\n");
  const result = parseSavedText(edited, [gif, upload], 99);
  assert.deepEqual(result.items, [
    upload,
    { giphy: "new2", url: giphyGif("new2"), mp4: "https://i.giphy.com/media/new2/giphy.mp4", width: 0, height: 0, savedAt: 99 },
    { asset: "def34", url: "https://i.redd.it/def34.gif", width: 0, height: 0, savedAt: 99 },
    { url: "https://lemmy.world/pictrs/image/x.webp", width: 0, height: 0, savedAt: 99 },
  ]);
  assert.deepEqual(result.errors, [4, 5]);
  assert.deepEqual(result.repeats, [[8, 1]]);

  const many = Array.from({ length: SAVED_MEDIA_MAX + 2 }, (_, i) => `https://x.example/${i}.png`).join("\n");
  const capped = parseSavedText(many, [], 1);
  assert.equal(capped.items.length, SAVED_MEDIA_MAX);
  assert.equal(capped.dropped, 2);

  assert.deepEqual(savedChanges([gif, upload], result.items), { added: 3, removed: 1, reordered: false });
  const c = image("https://x.example/c.png");
  assert.deepEqual(savedChanges([gif, upload, c], [upload, gif]), { added: 0, removed: 1, reordered: true });
  assert.deepEqual(savedChanges([gif, upload], [gif, upload]), { added: 0, removed: 0, reordered: false });
});
