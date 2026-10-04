/**
 * Per-viewer conveniences only (read markers, recents, cached prefs).
 * Storage can be missing or throw inside embedded web views, so every access
 * is guarded and callers always get a usable fallback.
 */
const PREFIX = 'openrelay:';

export const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const writeJson = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore quota / disabled storage.
  }
};

export const removeKey = (key: string): void => {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Ignore.
  }
};

/** A capped, most-recent-first set persisted to storage. */
export class RecentSet {
  #key: string;
  #cap: number;
  #items: string[];
  #lookup: Set<string>;
  #listeners = new Set<() => void>();
  version = 0;

  constructor(key: string, cap: number) {
    this.#key = key;
    this.#cap = cap;
    this.#items = readJson<string[]>(key, []);
    this.#lookup = new Set(this.#items);
  }

  has(value: string): boolean {
    return this.#lookup.has(value);
  }

  add(value: string): void {
    if (this.#items[0] === value) return;
    this.#items = [
      value,
      ...this.#items.filter((item) => item !== value),
    ].slice(0, this.#cap);
    this.#commit();
  }

  remove(value: string): void {
    if (!this.#lookup.has(value)) return;
    this.#items = this.#items.filter((item) => item !== value);
    this.#commit();
  }

  values(): string[] {
    return [...this.#items];
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

export const readPosts = new RecentSet('read', 1500);
export const hiddenPosts = new RecentSet('hidden', 1000);
export const recentCommunities = new RecentSet('recent-subs', 12);
