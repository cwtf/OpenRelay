import { useEffect, useSyncExternalStore } from "react";
import type { PostSummary } from "../../shared/api";
import { loadCachedPrefs } from "../app/prefs";
import { fetchPostToSave } from "./api";
import { plural } from "./format";
import {
  isSavedOffline,
  loadOfflineIndex,
  offlineEntries,
  offlineStore,
  offlineVersion,
  removeOffline,
  subscribeOffline,
  writeOfflineCopy,
  type OfflineEntry,
} from "./offlineStore";
import { toast } from "./platform";

export { offlineMode } from "../../extension/bridge";

/** Comments saved with each post: one request's worth, as Reddit returns them. */
const COMMENT_LIMIT = 200;
/** Pause between posts, to stay clear of Reddit's rate limit. */
const PAUSE_MS = 1100;
/** Posts saved from a feed at a time. */
export const FEED_SAVE_LIMIT = 25;

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
  const sort = loadCachedPrefs().commentSort;
  let saved = 0;
  let stopped = "";
  if (ids.length > 1) toast(`Saving ${plural(ids.length, "post")} for offline reading…`);
  try {
    for (const [index, id] of ids.entries()) {
      if (index) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      try {
        await writeOfflineCopy(await fetchPostToSave(id, sort, COMMENT_LIMIT));
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
  if (ids.length === 1)
    toast(saved ? "Saved for offline reading" : `Couldn't save: ${stopped}`);
  else if (saved === ids.length)
    toast(`Saved ${plural(saved, "post")} for offline reading`);
  else
    toast(
      `Saved ${saved} of ${ids.length} posts.${stopped ? ` ${stopped}` : " Some posts couldn't be loaded."}`,
    );
}

export async function removeFromOffline(ids: string[]): Promise<void> {
  try {
    await removeOffline(ids);
    toast(ids.length === 1 ? "Removed from offline reading" : "Offline posts removed");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Couldn't remove saved posts");
  }
}
