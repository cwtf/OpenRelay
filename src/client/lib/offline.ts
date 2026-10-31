import { useEffect, useState, useSyncExternalStore } from "react";
import type { PostResponse, PostSummary } from "../../shared/api";
import { readerHost } from "../../hosts/reader";
import type { MediaFetcher } from "../../hosts/types";
import { loadCachedPrefs } from "../app/prefs";
import { fetchPostToSave } from "./api";
import { plural } from "./format";
import {
  clearOffline,
  isSavedOffline,
  loadOfflineIndex,
  mediaUrls,
  offlineEntries,
  offlineStore,
  offlineVersion,
  removeOffline,
  subscribeOffline,
  withOfflineMedia,
  writeOfflineCopy,
  type OfflineEntry,
  type OfflineFile,
} from "./offlineStore";
import { toast } from "./platform";

import { offlineMode } from "../../extension/bridge";

export { offlineMode };

/** Comments saved with each post: one request's worth, as Reddit returns them. */
const COMMENT_LIMIT = 200;
/** Pause between posts, to stay clear of Reddit's rate limit. */
const PAUSE_MS = 1100;
/** Posts saved from a feed at a time. */
export const FEED_SAVE_LIMIT = 25;
/** Images saved with one post (a gallery's first ones, comment images last). */
const FILE_LIMIT = 40;
const POST_BYTES_LIMIT = 40 * 1024 * 1024;
/** Images fetched at once. */
const FETCHES = 4;

/** The host's image fetcher, asked for now (in the click), or null. */
const mediaAccess = (): Promise<MediaFetcher | null> => {
  try {
    const request = readerHost().media?.();
    if (!request) return Promise.resolve(null);
    return request.then(
      (access) => (typeof access === "string" ? null : access),
      () => null,
    );
  } catch {
    return Promise.resolve(null);
  }
};

/** The images a post page shows, fetched; ones that fail are left out. */
async function fetchFiles(fetcher: MediaFetcher, page: PostResponse): Promise<OfflineFile[]> {
  const urls = mediaUrls(page).slice(0, FILE_LIMIT);
  const files: (OfflineFile | null)[] = new Array(urls.length).fill(null);
  let bytes = 0;
  let next = 0;
  const worker = async () => {
    while (next < urls.length && bytes < POST_BYTES_LIMIT) {
      const index = next++;
      const url = urls[index]!;
      try {
        const file = await fetcher.fetch(url);
        if (!file.type.startsWith("image/")) continue;
        bytes += (file.data.length * 3) / 4;
        if (bytes <= POST_BYTES_LIMIT) files[index] = { url, file };
      } catch {
        // Shown from Reddit when online, missing offline.
      }
    }
  };
  await Promise.all(Array.from({ length: FETCHES }, worker));
  return files.filter((file): file is OfflineFile => file !== null);
}

export const offlineAvailable = (): boolean => offlineStore() !== null;

const useIndex = (): number => {
  useEffect(() => {
    void loadOfflineIndex().catch(() => undefined);
  }, []);
  return useSyncExternalStore(subscribeOffline, offlineVersion);
};

export const useOfflineEntries = (): OfflineEntry[] => {
  useIndex();
  return offlineEntries();
};

/**
 * The saved posts' cards. Without Reddit, with their saved images, once
 * those are read (null until then); with Reddit, as they are.
 */
export const useOfflineCards = (entries: OfflineEntry[]): PostSummary[] | null => {
  const [cards, setCards] = useState<PostSummary[] | null>(null);
  useEffect(() => {
    if (!offlineMode) return;
    let live = true;
    void Promise.all(
      entries.map((entry) => withOfflineMedia(entry.post, entry.media)),
    ).then((posts) => {
      if (live) setCards(posts);
    });
    return () => {
      live = false;
    };
  }, [entries]);
  return offlineMode ? cards : entries.map((entry) => entry.post);
};

export const useSavedOffline = (id: string): boolean => {
  useIndex();
  return isSavedOffline(id);
};

// The feed shown now, for the drawer's "Save feed for offline".
let feed: { sub: string; posts: PostSummary[] } = { sub: "", posts: [] };
export const setOfflineFeed = (sub: string, posts: PostSummary[]): void => {
  feed = { sub, posts };
};
export const offlineFeed = () => feed;

let saving = false;

/** Save posts one after another, reporting progress in toasts. */
export async function saveOffline(posts: PostSummary[] | string[]): Promise<void> {
  const ids = posts.map((post) => (typeof post === "string" ? post : post.id));
  if (!ids.length) return;
  if (saving) {
    toast("Already saving posts for offline reading");
    return;
  }
  saving = true;
  // Before anything is awaited: the extension asks for permission in the click.
  const access = mediaAccess();
  const sort = loadCachedPrefs().commentSort;
  let saved = 0;
  let stopped = "";
  let textOnly = false;
  if (ids.length > 1) toast(`Saving ${plural(ids.length, "post")} for offline reading…`);
  try {
    const fetcher = await access;
    textOnly = !fetcher && Boolean(readerHost().media);
    for (const [index, id] of ids.entries()) {
      if (index) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      try {
        const page = await fetchPostToSave(id, sort, COMMENT_LIMIT);
        const files = fetcher ? await fetchFiles(fetcher, page) : [];
        await writeOfflineCopy(page, Date.now(), files);
        saved++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        // Reddit refusing more requests, or nowhere to keep them: stop.
        if (/rate limit|offline|storage|quota/i.test(message) || ids.length === 1) {
          stopped = message || "Reddit could not load this post.";
          break;
        }
      }
    }
  } finally {
    saving = false;
  }
  const without = textOnly && saved ? " without images (not allowed)" : "";
  if (ids.length === 1)
    toast(saved ? `Saved for offline reading${without}` : `Couldn't save: ${stopped}`);
  else if (saved === ids.length)
    toast(`Saved ${plural(saved, "post")} for offline reading${without}`);
  else
    toast(
      `Saved ${saved} of ${ids.length} posts.${stopped ? ` ${stopped}` : " Some posts couldn't be loaded."}`,
    );
}

/** Remove these saved posts, or every one (`"all"`). */
export async function removeFromOffline(ids: string[] | "all"): Promise<void> {
  try {
    if (ids === "all") await clearOffline();
    else await removeOffline(ids);
    toast(
      ids !== "all" && ids.length === 1
        ? "Removed from offline reading"
        : "Offline posts removed",
    );
  } catch (error) {
    toast(error instanceof Error ? error.message : "Couldn't remove saved posts");
  }
}
