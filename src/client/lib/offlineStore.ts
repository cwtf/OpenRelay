/**
 * Posts saved for offline reading, in the host's `OfflineStore`: one entry per
 * post page (`post:t3_…`, as `fetchPost` returned it), one per file saved
 * with it (`media:<post>_<n>`), and an index of their cards (`index`, newest
 * first) for the offline list. The index is mirrored in memory once loaded,
 * so the list and "saved" marks read synchronously.
 *
 * A saved page keeps Reddit's media URLs; `media` maps each saved one to its
 * entry, and `withOfflineMedia` swaps them for local `blob:` URLs to show.
 */
import type { PostResponse, PostSummary } from "../../shared/api";
import { readerHost } from "../../hosts/reader.ts";
import { MEDIA_HOSTS } from "../../hosts/types.ts";
import type { MediaFile, OfflineStore } from "../../hosts/types.ts";

/** Saved media URL → its `media:` key. */
export type OfflineMedia = Record<string, string>;
/** A post in the offline list: its card, when it was saved, and its card's files. */
export type OfflineEntry = { post: PostSummary; savedAt: number; media?: OfflineMedia };
/** A saved post page. */
export type OfflineCopy = Omit<PostResponse, "notice"> & {
  savedAt: number;
  media?: OfflineMedia;
};
/** A file saved with a post, under the URL it came from. */
export type OfflineFile = { url: string; file: MediaFile };

const INDEX = "index";
const fullId = (id: string) => (id.startsWith("t3_") ? id : `t3_${id}`);
const postKey = (id: string) => `post:${fullId(id)}`;
const mediaKey = (id: string, n: number) => `media:${fullId(id).slice(3)}_${n}`;

/** Every string in `value` that is a URL on one of `MEDIA_HOSTS`, in order, once. */
export const mediaUrls = (value: unknown): string[] => {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      if (!node.startsWith("https://")) return;
      try {
        if (MEDIA_HOSTS.includes(new URL(node).hostname)) found.add(node);
      } catch {
        // Not a URL.
      }
    } else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(value);
  return [...found];
};

/** `value` with every string that is a key of `map` replaced by its value. */
export const replaceStrings = <T>(value: T, map: Map<string, string>): T => {
  if (!map.size) return value;
  const walk = (node: unknown): unknown =>
    typeof node === "string"
      ? (map.get(node) ?? node)
      : Array.isArray(node)
        ? node.map(walk)
        : node && typeof node === "object"
          ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]))
          : node;
  return walk(value) as T;
};

/** The strings in `value`, to find which saved files it shows. */
const stringsIn = (value: unknown): Set<string> => {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === "string") found.add(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(value);
  return found;
};

/** Only the entries of `media` whose URLs appear in `value`. */
const mediaIn = (value: unknown, media: OfflineMedia): OfflineMedia => {
  const used = stringsIn(value);
  return Object.fromEntries(Object.entries(media).filter(([url]) => used.has(url)));
};

let entries: OfflineEntry[] | null = null;
let loading: Promise<OfflineEntry[]> | null = null;
// Changes run one at a time, so two saves can't each drop the other's entry.
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
let version = 0;

/** The host's store, or `null` when it can't keep posts offline. */
export const offlineStore = (): OfflineStore | null => readerHost().offline ?? null;

const readIndex = async (store: OfflineStore): Promise<OfflineEntry[]> => {
  const stored = await store.get(INDEX);
  return Array.isArray(stored)
    ? stored.filter(
        (entry): entry is OfflineEntry =>
          typeof entry?.post?.id === "string" && typeof entry.savedAt === "number",
      )
    : [];
};

const readCopy = async (store: OfflineStore, id: string): Promise<OfflineCopy | null> => {
  const copy = (await store.get(postKey(id))) as OfflineCopy | undefined;
  return copy?.post && Array.isArray(copy.comments) ? copy : null;
};

const publish = (next: OfflineEntry[]) => {
  entries = next;
  version++;
  for (const listener of listeners) listener();
};

/** Load the index into memory. Safe to call more than once. */
export const loadOfflineIndex = (): Promise<OfflineEntry[]> => {
  const store = offlineStore();
  if (!store) return Promise.resolve([]);
  return (loading ??= readIndex(store).then(
    (stored) => {
      if (!entries) publish(stored);
      return entries!;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  ));
};

const change = <T>(task: (store: OfflineStore) => Promise<T>): Promise<T> => {
  const store = offlineStore();
  if (!store) return Promise.reject(new Error("Offline reading isn't available here."));
  const run = queue.then(() => task(store));
  queue = run.catch(() => undefined);
  return run;
};

// Local URLs of the files shown so far, by `media:` key.
const shown = new Map<string, string>();
const forget = (keys: string[]) => {
  for (const key of keys) {
    const url = shown.get(key);
    if (url) URL.revokeObjectURL(url);
    shown.delete(key);
  }
};

/**
 * Save a post page and its files (replacing an older copy and its files)
 * and list it first.
 */
export const writeOfflineCopy = (
  page: PostResponse,
  savedAt = Date.now(),
  files: OfflineFile[] = [],
): Promise<void> =>
  change(async (store) => {
    const { notice: _notice, ...rest } = page;
    const old = await readCopy(store, page.post.id);
    const media: OfflineMedia = {};
    for (const [n, { url, file }] of files.entries()) {
      const key = mediaKey(page.post.id, n);
      await store.set(key, file);
      media[url] = key;
    }
    const oldKeys = Object.values(old?.media ?? {});
    const kept = new Set(Object.values(media));
    const stale = oldKeys.filter((key) => !kept.has(key));
    if (stale.length) await store.remove(stale);
    forget(oldKeys);
    const copy: OfflineCopy = { ...rest, moreComments: false, savedAt, media };
    await store.set(postKey(page.post.id), copy);
    // Re-read the index: another reader (tab, window) may have changed it.
    const index = await readIndex(store);
    const id = fullId(page.post.id);
    const next = [
      { post: page.post, savedAt, media: mediaIn(page.post, media) },
      ...index.filter((entry) => fullId(entry.post.id) !== id),
    ];
    await store.set(INDEX, next);
    publish(next);
  });

export const readOfflineCopy = async (id: string): Promise<OfflineCopy | null> => {
  const store = offlineStore();
  return store ? readCopy(store, id) : null;
};

/** The post copies' keys and their files' keys. */
const keysOf = async (store: OfflineStore, ids: string[]): Promise<string[]> => {
  const keys: string[] = [];
  for (const id of ids) {
    const copy = await readCopy(store, id).catch(() => null);
    keys.push(postKey(id), ...Object.values(copy?.media ?? {}));
  }
  return keys;
};

export const removeOffline = (ids: string[]): Promise<void> =>
  change(async (store) => {
    const gone = new Set(ids.map(fullId));
    const keys = await keysOf(store, [...gone]);
    await store.remove(keys);
    forget(keys);
    const next = (await readIndex(store)).filter(
      (entry) => !gone.has(fullId(entry.post.id)),
    );
    await store.set(INDEX, next);
    publish(next);
  });

/** Remove every saved post. */
export const clearOffline = (): Promise<void> =>
  change(async (store) => {
    const index = await readIndex(store);
    const keys = await keysOf(store, index.map((entry) => entry.post.id));
    await store.remove([...keys, INDEX]);
    forget(keys);
    publish([]);
  });

const toBlob = ({ type, data }: MediaFile): Blob => {
  const bytes = atob(data);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type });
};

/**
 * `value` with the files in `media` shown from this device: their URLs
 * become `blob:` URLs. Files that can't be read keep their URLs.
 */
export const withOfflineMedia = async <T>(
  value: T,
  media: OfflineMedia | undefined,
): Promise<T> => {
  const store = offlineStore();
  if (!store || !media) return value;
  const map = new Map<string, string>();
  for (const [url, key] of Object.entries(mediaIn(value, media))) {
    let local = shown.get(key);
    if (!local) {
      const file = (await store.get(key).catch(() => undefined)) as MediaFile | undefined;
      if (typeof file?.data !== "string" || typeof file.type !== "string") continue;
      local = URL.createObjectURL(toBlob(file));
      shown.set(key, local);
    }
    map.set(url, local);
  }
  return replaceStrings(value, map);
};

/** The loaded index (empty until `loadOfflineIndex` resolves). */
export const offlineEntries = (): OfflineEntry[] => entries ?? [];

export const isSavedOffline = (id: string): boolean => {
  const wanted = fullId(id);
  return offlineEntries().some((entry) => fullId(entry.post.id) === wanted);
};

export const subscribeOffline = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const offlineVersion = (): number => version;
