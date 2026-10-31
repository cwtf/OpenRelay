/**
 * Posts saved for offline reading, in the host's `OfflineStore`: one entry per
 * post page (`post:t3_…`, as `fetchPost` returned it) and an index of their
 * cards (`index`, newest first) for the offline list. The index is mirrored
 * in memory once loaded, so the list and "saved" marks read synchronously.
 */
import type { PostResponse, PostSummary } from "../../shared/api";
import { readerHost } from "../../hosts/reader.ts";
import type { OfflineStore } from "../../hosts/types.ts";

/** A post in the offline list: its card, and when it was saved. */
export type OfflineEntry = { post: PostSummary; savedAt: number };
/** A saved post page. */
export type OfflineCopy = Omit<PostResponse, "notice"> & { savedAt: number };

const INDEX = "index";
const fullId = (id: string) => (id.startsWith("t3_") ? id : `t3_${id}`);
const postKey = (id: string) => `post:${fullId(id)}`;

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

/** Save a post page (replacing an older copy) and list it first. */
export const writeOfflineCopy = (
  page: PostResponse,
  savedAt = Date.now(),
): Promise<void> =>
  change(async (store) => {
    const { notice: _notice, ...rest } = page;
    const copy: OfflineCopy = { ...rest, moreComments: false, savedAt };
    await store.set(postKey(page.post.id), copy);
    // Re-read the index: another reader (tab, window) may have changed it.
    const index = await readIndex(store);
    const id = fullId(page.post.id);
    const next = [
      { post: page.post, savedAt },
      ...index.filter((entry) => fullId(entry.post.id) !== id),
    ];
    await store.set(INDEX, next);
    publish(next);
  });

export const readOfflineCopy = async (id: string): Promise<OfflineCopy | null> => {
  const store = offlineStore();
  if (!store) return null;
  const copy = (await store.get(postKey(id))) as OfflineCopy | undefined;
  return copy?.post && Array.isArray(copy.comments) ? copy : null;
};

export const removeOffline = (ids: string[]): Promise<void> =>
  change(async (store) => {
    const gone = new Set(ids.map(fullId));
    await store.remove([...gone].map(postKey));
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
    await store.remove([...index.map((entry) => postKey(entry.post.id)), INDEX]);
    publish([]);
  });

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
