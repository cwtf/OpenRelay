import test from "node:test";
import assert from "node:assert/strict";
import type { PostResponse } from "../../shared/api";
import type { OfflineStore, ReaderHost } from "../../hosts/types.ts";
import { OFFLINE_KEY } from "../../hosts/types.ts";
import {
  clearOffline,
  isSavedOffline,
  loadOfflineIndex,
  offlineEntries,
  readOfflineCopy,
  removeOffline,
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
