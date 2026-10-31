import test from "node:test";
import assert from "node:assert/strict";
import { readerHost } from "./reader.ts";
import type { ReaderHost } from "./types.ts";

const g = globalThis as any;

test("a wrapper app's injected host replaces the extension's", () => {
  const injected: ReaderHost = {
    name: "android",
    storage: null,
    downloads: async () => "unavailable",
  };
  g.chrome = { storage: { local: {} } };
  g.openRelayReaderHost = injected;
  try {
    assert.equal(readerHost(), injected);
  } finally {
    delete g.openRelayReaderHost;
    delete g.chrome;
  }
});

test("without chrome.storage the extension host has no storage", async () => {
  const host = readerHost();
  assert.equal(host.name, "extension");
  assert.equal(host.storage, null);
  assert.equal(await host.downloads(), "unavailable");
});

test("extension storage reports only chrome.storage.local changes", () => {
  const listeners: ((changes: object, area: string) => void)[] = [];
  g.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      onChanged: { addListener: (fn: any) => listeners.push(fn) },
    },
  };
  try {
    const seen: object[] = [];
    readerHost().storage!.onChanged!((changes) => seen.push(changes));
    for (const listener of listeners) {
      listener({ a: { newValue: 1 } }, "sync");
      listener({ b: { newValue: 2 } }, "local");
    }
    assert.deepEqual(seen, [{ b: { newValue: 2 } }]);
  } finally {
    delete g.chrome;
  }
});

test("extension downloads ask for the permission and save bytes as a file", async () => {
  const requested: unknown[] = [];
  const saved: { url: string; filename?: string }[] = [];
  let granted = false;
  g.chrome = {
    permissions: {
      request: async (permissions: unknown) => {
        requested.push(permissions);
        return granted;
      },
    },
    downloads: {
      download: async (options: { url: string; filename?: string }) => {
        saved.push(options);
        return 1;
      },
    },
  };
  // The object URL is revoked a minute later; don't keep the test alive.
  const realSetTimeout = globalThis.setTimeout;
  g.setTimeout = () => 0;
  try {
    assert.equal(await readerHost().downloads(), "declined");
    granted = true;
    const downloads = await readerHost().downloads();
    assert.notEqual(typeof downloads, "string");
    if (typeof downloads === "string") return;
    await downloads.save({ url: "https://i.redd.it/a.png", filename: "a.png" });
    await downloads.save({
      data: new Uint8Array([1, 2, 3]),
      filename: "v.mp4",
      type: "video/mp4",
    });
    assert.deepEqual(requested, [
      { permissions: ["downloads"] },
      { permissions: ["downloads"] },
    ]);
    assert.deepEqual(saved[0], {
      url: "https://i.redd.it/a.png",
      filename: "a.png",
    });
    assert.equal(saved[1]!.filename, "v.mp4");
    assert.match(saved[1]!.url, /^blob:/);
  } finally {
    g.setTimeout = realSetTimeout;
    delete g.chrome;
  }
});

test("extension offline posts sit beside the settings without being read with them", async () => {
  const stored: Record<string, unknown> = { "openrelay:prefs": { theme: "dark" } };
  const pick = (keys: string[] | string | null) =>
    Object.fromEntries(
      Object.entries(stored).filter(
        ([key]) => keys === null || [keys].flat().includes(key),
      ),
    );
  const local = {
    get: async (keys: string[] | string | null) => pick(keys),
    set: async (items: Record<string, unknown>) => void Object.assign(stored, items),
    remove: async (keys: string[] | string) => {
      for (const key of [keys].flat()) delete stored[key];
    },
  };
  g.chrome = { storage: { local } };
  try {
    const host = readerHost();
    await host.offline!.set("post:t3_a", { post: { id: "t3_a" } });
    assert.deepEqual(stored["openrelay-offline:post:t3_a"], { post: { id: "t3_a" } });
    assert.deepEqual(await host.offline!.get("post:t3_a"), { post: { id: "t3_a" } });
    assert.equal(await host.offline!.get("post:t3_b"), undefined);
    // Where the browser lists keys, the settings are read alone.
    (local as any).getKeys = async () => Object.keys(stored);
    assert.deepEqual(Object.keys(await host.storage!.getAll()), ["openrelay:prefs"]);
    await host.offline!.remove(["post:t3_a"]);
    assert.deepEqual(Object.keys(stored), ["openrelay:prefs"]);
  } finally {
    delete g.chrome;
  }
});
