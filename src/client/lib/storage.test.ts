import test from "node:test";
import assert from "node:assert/strict";

// A minimal chrome.storage.local, as available to the reader's extension frame.
const saved: Record<string, unknown> = {
  "openrelay:prefs": { theme: "black" },
  "openrelay:read": ["t3_a"],
  "unrelated:key": 1,
};
const changeListeners: ((changes: object, area: string) => void)[] = [];
(globalThis as any).chrome = {
  storage: {
    local: {
      get: async () => structuredClone(saved),
      set: async (items: Record<string, unknown>) => {
        Object.assign(saved, structuredClone(items));
      },
      remove: async (keys: string[]) => {
        for (const key of keys) delete saved[key];
      },
    },
    onChanged: { addListener: (fn: any) => changeListeners.push(fn) },
  },
};

const storage = await import("./storage.ts");

test("loads saved values from extension storage before first read", async () => {
  assert.deepEqual(storage.readJson("prefs", {}), {});
  await storage.initStorage();
  assert.deepEqual(storage.readJson("prefs", {}), { theme: "black" });
  assert.equal(storage.readJson("unrelated:key", 0), 0);
  assert.equal(storage.readPosts.has("t3_a"), true);
});

test("saves changes automatically", async () => {
  storage.writeJson("prefs", { theme: "light" });
  storage.readPosts.add("t3_b");
  assert.deepEqual(storage.readJson("prefs", {}), { theme: "light" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(saved["openrelay:prefs"], { theme: "light" });
  assert.deepEqual(saved["openrelay:read"], ["t3_b", "t3_a"]);
  storage.removeKey("prefs");
  await storage.flushStorage();
  assert.equal("openrelay:prefs" in saved, false);
});

test("follows values saved by another tab", async () => {
  const seen: unknown[] = [];
  const stop = storage.watchKey("prefs", (value) => seen.push(value));
  for (const listener of changeListeners)
    listener({ "openrelay:prefs": { newValue: { theme: "dark" } } }, "local");
  stop();
  assert.deepEqual(seen, [{ theme: "dark" }]);
  assert.deepEqual(storage.readJson("prefs", {}), { theme: "dark" });
});
