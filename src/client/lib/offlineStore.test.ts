import test from "node:test";
import assert from "node:assert/strict";
import type { PostResponse } from "../../shared/api";
import type { OfflineStore, ReaderHost } from "../../hosts/types.ts";
import { OFFLINE_KEY } from "../../hosts/types.ts";
import {
  clearOffline,
  isSavedOffline,
  loadOfflineIndex,
  mediaUrls,
  offlineEntries,
  readOfflineCopy,
  removeOffline,
  replaceStrings,
  withOfflineMedia,
  writeOfflineCopy,
} from "./offlineStore.ts";

const g = globalThis as any;
const data = new Map<string, unknown>();
const store: OfflineStore = {
  get: async (key) => structuredClone(data.get(key)),
  set: async (key, value) => {
    assert.match(key, OFFLINE_KEY);
    data.set(key, structuredClone(value));
  },
  remove: async (keys) => {
    for (const key of keys) data.delete(key);
  },
};
g.openRelayReaderHost = {
  name: "test",
  storage: null,
  offline: store,
  downloads: async () => "unavailable",
} satisfies ReaderHost;

const page = (id: string, comments = 0): PostResponse =>
  ({
    post: { id: `t3_${id}`, title: id },
    comments: Array.from({ length: comments }, (_, i) => ({ id: `t1_${i}` })),
    moreComments: true,
    notice: "from the snapshot",
  }) as unknown as PostResponse;

test("saved posts are listed newest first and read back without a notice", async () => {
  data.set("index", [{ post: { id: "t3_old", title: "old" }, savedAt: 1 }]);
  assert.equal((await loadOfflineIndex()).length, 1);
  await writeOfflineCopy(page("a", 2), 10);
  await writeOfflineCopy(page("b"), 20);
  assert.deepEqual(
    offlineEntries().map((entry) => entry.post.id),
    ["t3_b", "t3_a", "t3_old"],
  );
  const copy = await readOfflineCopy("a");
  assert.equal(copy?.comments.length, 2);
  assert.equal(copy?.savedAt, 10);
  assert.equal(copy?.moreComments, false);
  assert.equal("notice" in copy!, false);
  assert.equal(isSavedOffline("t3_a"), true);
  assert.equal(isSavedOffline("zzz"), false);
});

test("saving a post again replaces its copy and moves it to the top", async () => {
  await writeOfflineCopy(page("a", 5), 30);
  assert.deepEqual(
    offlineEntries().map((entry) => entry.post.id),
    ["t3_a", "t3_b", "t3_old"],
  );
  assert.equal((await readOfflineCopy("t3_a"))?.comments.length, 5);
});

test("removing and clearing delete the copies and their entries", async () => {
  await removeOffline(["b"]);
  assert.equal(await readOfflineCopy("b"), null);
  assert.deepEqual(
    offlineEntries().map((entry) => entry.post.id),
    ["t3_a", "t3_old"],
  );
  await clearOffline();
  assert.deepEqual(offlineEntries(), []);
  assert.deepEqual([...data.keys()], []);
});

test("concurrent saves both reach the index", async () => {
  await Promise.all([writeOfflineCopy(page("x")), writeOfflineCopy(page("y"))]);
  assert.deepEqual(
    (data.get("index") as { post: { id: string } }[]).map((entry) => entry.post.id).sort(),
    ["t3_x", "t3_y"],
  );
});

test("media URLs are Reddit's image hosts only, once each, in order", () => {
  const page = {
    post: {
      url: "https://i.redd.it/a.png",
      thumb: { url: "https://preview.redd.it/a.png?width=140" },
      permalink: "https://www.reddit.com/r/x/comments/1/",
      media: { kind: "image", image: { url: "https://i.redd.it/a.png" } },
    },
    comments: [
      { body: "see https://i.redd.it/b.png", media: { m1: { url: "https://preview.redd.it/c.gif" } } },
      { media: { m2: { url: "https://i.giphy.com/media/x/giphy.gif" } } },
    ],
  };
  assert.deepEqual(mediaUrls(page), [
    "https://i.redd.it/a.png",
    "https://preview.redd.it/a.png?width=140",
    "https://preview.redd.it/c.gif",
  ]);
  const replaced = replaceStrings(page, new Map([["https://i.redd.it/a.png", "blob:a"]]));
  assert.equal(replaced.post.url, "blob:a");
  assert.equal(replaced.post.media.image.url, "blob:a");
  assert.equal(page.post.url, "https://i.redd.it/a.png");
});

test("files saved with a post are shown from the device and removed with it", async () => {
  const file = (text: string) => ({ type: "image/png", data: btoa(text) });
  const withImages = {
    ...page("img"),
    post: {
      id: "t3_img",
      title: "img",
      thumb: { url: "https://preview.redd.it/t.png" },
    },
    comments: [{ id: "t1_1", media: { m: { url: "https://i.redd.it/c.png" } } }],
  } as unknown as PostResponse;
  await writeOfflineCopy(withImages, 1, [
    { url: "https://preview.redd.it/t.png", file: file("thumb") },
    { url: "https://i.redd.it/c.png", file: file("comment") },
  ]);
  assert.deepEqual(data.get("media:img_0"), file("thumb"));
  // The list entry knows only its card's files.
  assert.deepEqual(offlineEntries()[0]!.media, { "https://preview.redd.it/t.png": "media:img_0" });
  const copy = (await readOfflineCopy("img"))!;
  const shown = await withOfflineMedia(copy, copy.media);
  const local = (shown.post as any).thumb.url as string;
  assert.match(local, /^blob:/);
  assert.equal(await (await fetch(local)).text(), "thumb");
  assert.match((shown.comments[0] as any).media.m.url, /^blob:/);

  // Saved again with one file: the other one goes.
  await writeOfflineCopy(withImages, 2, [
    { url: "https://i.redd.it/c.png", file: file("comment") },
  ]);
  assert.equal(data.has("media:img_1"), false);
  assert.deepEqual(data.get("media:img_0"), file("comment"));
  await removeOffline(["img"]);
  assert.deepEqual([...data.keys()].filter((key) => key !== "index"), ["post:t3_x", "post:t3_y"]);
});

test("a saved video plays from the device without its stream", async () => {
  const mp4 = "https://v.redd.it/v1/DASH_360.mp4";
  const video = {
    ...page("vid"),
    post: {
      id: "t3_vid",
      title: "vid",
      media: { kind: "video", video: { mp4, hls: "https://v.redd.it/v1/HLSPlaylist.m3u8" } },
    },
  } as unknown as PostResponse;
  await writeOfflineCopy(video, 1, [{ url: mp4, file: { type: "video/mp4", data: btoa("mp4") } }]);
  const copy = (await readOfflineCopy("vid"))!;
  const shown = (await withOfflineMedia(copy, copy.media)).post.media as any;
  assert.match(shown.video.mp4, /^blob:/);
  assert.equal("hls" in shown.video, false);
  // Without a saved file, the stream stays.
  const unsaved = (await withOfflineMedia(copy, {})).post.media as any;
  assert.equal(unsaved.video.hls, "https://v.redd.it/v1/HLSPlaylist.m3u8");
  await removeOffline(["vid"]);
});
