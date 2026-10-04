/**
 * Per-viewer persistence (settings, read markers, recents, subscriptions).
 *
 * The reader runs in an extension iframe on reddit.com, where Chrome denies
 * `localStorage` whenever third-party cookies are blocked (and in Incognito).
 * Values therefore live in `chrome.storage.local`, which is unaffected, and
 * are mirrored in memory so reads stay synchronous. `initStorage()` must
 * resolve before the first read. Outside the extension (tests, previews) the
 * page's own `localStorage` is used when it is available.
 */
const PREFIX = "openrelay:";
const FLUSH_DELAY = 150;

type Area = {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
};

const extensionArea = (): Area | null => {
  try {
    return (globalThis as any).chrome?.storage?.local ?? null;
  } catch {
    return null;
  }
};

const pageStorage = (): Storage | null => {
  try {
    const storage = globalThis.localStorage;
    storage.getItem(PREFIX);
    return storage;
  } catch {
    return null;
  }
};

const memory = new Map<string, unknown>();
const dirty = new Set<string>();
const watchers = new Map<string, Set<(value: unknown) => void>>();
let area: Area | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let ready: Promise<void> | null = null;

/** Load stored values into memory. Safe to call more than once. */
export const initStorage = (): Promise<void> =>
  (ready ??= (async () => {
    area = extensionArea();
    const page = pageStorage();
    if (!area) {
      if (!page) return;
      for (let i = 0; i < page.length; i++) {
        const key = page.key(i);
        if (key?.startsWith(PREFIX)) {
          try {
            memory.set(key.slice(PREFIX.length), JSON.parse(page.getItem(key)!));
          } catch {
            // Skip unreadable values.
          }
        }
      }
      return;
    }
    try {
      const stored = await area.get(null);
      for (const [key, value] of Object.entries(stored))
        if (key.startsWith(PREFIX)) memory.set(key.slice(PREFIX.length), value);
    } catch (error) {
      console.warn("OpenRelay storage unavailable", error);
    }
    // One-time import of values saved by earlier versions in localStorage.
    if (page) {
      for (let i = 0; i < page.length; i++) {
        const key = page.key(i);
        const name = key?.startsWith(PREFIX) ? key.slice(PREFIX.length) : null;
        if (!name || memory.has(name)) continue;
        try {
          memory.set(name, JSON.parse(page.getItem(key!)!));
          dirty.add(name);
        } catch {
          // Skip unreadable values.
        }
      }
      if (dirty.size) void flush();
    }
    (globalThis as any).chrome?.storage?.onChanged?.addListener(
      (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
        if (areaName !== "local") return;
        for (const [key, change] of Object.entries(changes)) {
          if (!key.startsWith(PREFIX)) continue;
          const name = key.slice(PREFIX.length);
          // Our own pending write is newer than whatever another tab saved.
          if (
            dirty.has(name) ||
            JSON.stringify(change.newValue) === JSON.stringify(memory.get(name))
          )
            continue;
          if (change.newValue === undefined) memory.delete(name);
          else memory.set(name, change.newValue);
          for (const watcher of watchers.get(name) ?? []) watcher(change.newValue);
        }
      },
    );
    globalThis.addEventListener?.("pagehide", () => void flush());
  })());

const flush = async (): Promise<void> => {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!dirty.size) return;
  const keys = [...dirty];
  dirty.clear();
  if (area) {
    const set: Record<string, unknown> = {};
    const removed: string[] = [];
    for (const key of keys) {
      if (memory.has(key)) set[PREFIX + key] = memory.get(key);
      else removed.push(PREFIX + key);
    }
    try {
      if (Object.keys(set).length) await area.set(set);
      if (removed.length) await area.remove(removed);
    } catch (error) {
      console.warn("OpenRelay could not save settings", error);
    }
    return;
  }
  const page = pageStorage();
  for (const key of keys) {
    try {
      if (memory.has(key))
        page?.setItem(PREFIX + key, JSON.stringify(memory.get(key)));
      else page?.removeItem(PREFIX + key);
    } catch {
      // Ignore quota / disabled storage.
    }
  }
};

const schedule = (key: string): void => {
  dirty.add(key);
  if (flushTimer === undefined) flushTimer = setTimeout(flush, FLUSH_DELAY);
};

export const readJson = <T>(key: string, fallback: T): T =>
  memory.has(key) ? (memory.get(key) as T) : fallback;

/** Save a value. Writes are batched and persisted automatically. */
export const writeJson = (key: string, value: unknown): void => {
  memory.set(key, JSON.parse(JSON.stringify(value)));
  schedule(key);
};

export const removeKey = (key: string): void => {
  memory.delete(key);
  schedule(key);
};

/** Persist pending writes now (used by tests and before unload). */
export const flushStorage = (): Promise<void> => flush();

/** Observe changes saved by other tabs. */
export const watchKey = (
  key: string,
  listener: (value: unknown) => void,
): (() => void) => {
  let set = watchers.get(key);
  if (!set) watchers.set(key, (set = new Set()));
  set.add(listener);
  return () => set.delete(listener);
};

/** A capped, most-recent-first set persisted to storage. */
export class RecentSet {
  #key: string;
  #cap: number;
  #items: string[] | null = null;
  #lookup = new Set<string>();
  #listeners = new Set<() => void>();
  version = 0;

  constructor(key: string, cap: number) {
    this.#key = key;
    this.#cap = cap;
  }

  // Loaded lazily: instances are created at import, before storage is ready.
  #load(): string[] {
    if (!this.#items) {
      const stored = readJson<unknown>(this.#key, []);
      this.#items = Array.isArray(stored)
        ? stored.filter((item): item is string => typeof item === "string")
        : [];
      this.#lookup = new Set(this.#items);
    }
    return this.#items;
  }

  has(value: string): boolean {
    this.#load();
    return this.#lookup.has(value);
  }

  add(value: string): void {
    const items = this.#load();
    if (items[0] === value) return;
    this.#items = [value, ...items.filter((item) => item !== value)].slice(
      0,
      this.#cap,
    );
    this.#commit();
  }

  remove(value: string): void {
    if (!this.has(value)) return;
    this.#items = this.#load().filter((item) => item !== value);
    this.#commit();
  }

  values(): string[] {
    return [...this.#load()];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  #commit(): void {
    this.#lookup = new Set(this.#items);
    this.version++;
    writeJson(this.#key, this.#items);
    for (const listener of this.#listeners) listener();
  }
}

export const readPosts = new RecentSet("read", 1500);
export const hiddenPosts = new RecentSet("hidden", 1000);
export const recentCommunities = new RecentSet("recent-subs", 12);
