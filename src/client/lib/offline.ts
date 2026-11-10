import { useEffect, useState, useSyncExternalStore } from "react";
import type { FeedSort, PostResponse, PostSummary, Timeframe } from "../../shared/api";
import { readerHost } from "../../hosts/reader";
import type { MediaFetcher } from "../../hosts/types";
import { offlineMode } from "../../extension/bridge";
import { loadCachedPrefs } from "../app/prefs";
import { fetchFeed, fetchPostToSave, site } from "./api";
import { isLemmyItem } from "./hybrid";
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
import { pickUnsaved, type FeedPage } from "./offlinePick";
import { saveState, type SaveProgress, type SaveState } from "./saveProgress";
import { redditVideo, toast } from "./platform";
import { hiddenPosts } from "./storage";

export { offlineMode };

/** Comments saved with each post: one request's worth, as Reddit returns them. */
const COMMENT_LIMIT = 200;
/** Pause between posts, to stay clear of Reddit's rate limit. */
const PAUSE_MS = 1100;
/** How many posts "Save feed for offline" can save at a time. */
export const FEED_SAVE_COUNTS = [10, 25, 50, 100] as const;
/** Images saved with one post (a gallery's first ones, comment images last). */
const FILE_LIMIT = 40;
const POST_BYTES_LIMIT = 40 * 1024 * 1024;
/** Images fetched at once. */
const FETCHES = 4;
/** A post's video, with its sound: smaller when saving a whole feed. */
const VIDEO_LIMIT = 40 * 1024 * 1024;
const FEED_VIDEO_LIMIT = 15 * 1024 * 1024;

const toBase64 = (bytes: Uint8Array): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  });

/**
 * A post's v.redd.it video joined with its sound (as the download button
 * does), or null when it has none or it's larger than `max` bytes.
 */
async function fetchVideo(page: PostResponse, max: number): Promise<OfflineFile | null> {
  const media = page.post.media;
  if (media.kind !== "video" || !media.video.mp4) return null;
  const video = await redditVideo(media.video.mp4, max).catch(() => null);
  if (!video) return null;
  return {
    url: media.video.mp4,
    file: { type: "video/mp4", data: await toBase64(video.data) },
  };
}

/**
 * The host's fetcher for Reddit's image hosts, asked for now (in the click:
 * the extension may ask for permission), or null. Also used by the reply
 * composer to upload a saved Reddit image again.
 */
export const mediaAccess = (): Promise<MediaFetcher | null> => {
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
        // Images, and the silent MP4s Reddit serves for GIFs.
        if (!/^(image|video)\//.test(file.type)) continue;
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

/** The feed shown now, for the drawer's "Save feed for offline". */
export type OfflineFeed = FeedPage & {
  sub: string;
  sort: FeedSort;
  timeframe: Timeframe;
};
let feed: OfflineFeed | null = null;
export const setOfflineFeed = (shown: OfflineFeed): void => {
  feed = shown;
};
export const offlineFeed = (): OfflineFeed | null => feed;

/** The save running now, if any. */
let progress: SaveProgress | null = null;
const progressListeners = new Set<() => void>();
const setProgress = (next: SaveProgress | null): void => {
  progress = next;
  for (const listener of progressListeners) listener();
};
const updateProgress = (change: Partial<SaveProgress>): void => {
  if (progress) setProgress({ ...progress, ...change });
};
const subscribeProgress = (listener: () => void): (() => void) => {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
};

export const useSaveProgress = (): SaveProgress | null =>
  useSyncExternalStore(subscribeProgress, () => progress);

/** Stop the save running now after the post it's on. */
export const stopSaving = (): void => updateProgress({ stopping: true });
const stopPressed = (): boolean => progress?.stopping === true;

/** A card's offline state: being saved, waiting to be, or saved. */
export const useOfflineState = (id: string): SaveState | "offline" => {
  const state = useSyncExternalStore(subscribeProgress, () => saveState(progress, id));
  const saved = useSavedOffline(id);
  return state ?? (saved ? "offline" : null);
};

/** What to save with each post's text. */
export type SaveMedia = { images: boolean; videos: boolean };
/** The images and videos chosen in the "Save feed for offline" sheet. */
export const savedMedia = (): SaveMedia => {
  const prefs = loadCachedPrefs();
  return { images: prefs.offlineImages, videos: prefs.offlineVideos };
};
export const TEXT_ONLY: SaveMedia = { images: false, videos: false };

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, PAUSE_MS));

/**
 * Save the posts `pick` chooses one after another, with the images and
 * videos `media` asks for, until done or stopped. Progress goes to
 * `useSaveProgress` (the progress bar, shown when there's a `label`, and the
 * drawer) and `useOfflineState` (the cards), the outcome to a toast.
 */
async function save(
  pick: () => Promise<string[]>,
  media: SaveMedia,
  fromFeed: boolean,
  label: string | null,
): Promise<void> {
  if (progress) {
    toast("Already saving posts for offline reading");
    return;
  }
  setProgress({ label, ids: [], done: 0, started: Date.now(), stopping: false });
  // Before anything is awaited: the extension asks for permission in the click.
  const access = media.images ? mediaAccess() : Promise.resolve(null);
  const sort = loadCachedPrefs().commentSort;
  let ids: string[] = [];
  let saved = 0;
  let stopped = "";
  let cancelled = false;
  let textOnly = false;
  try {
    ids = await pick();
    const fetcher = await access;
    textOnly = media.images && !fetcher && Boolean(readerHost().media);
    updateProgress({ ids, started: Date.now() });
    for (const [index, id] of ids.entries()) {
      if (index) await pause();
      if (stopPressed()) {
        cancelled = true;
        break;
      }
      try {
        const page = await fetchPostToSave(id, sort, COMMENT_LIMIT);
        const files = fetcher ? await fetchFiles(fetcher, page) : [];
        const video = media.videos
          ? await fetchVideo(page, fromFeed ? FEED_VIDEO_LIMIT : VIDEO_LIMIT)
          : null;
        if (video) files.push(video);
        await writeOfflineCopy(page, Date.now(), files);
        saved++;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        // The site refusing more requests, or nowhere to keep them: stop.
        if (/rate limit|offline|storage|quota/i.test(message) || ids.length === 1) {
          stopped = message || `${site.name} could not load this post.`;
          break;
        }
      }
      updateProgress({ done: index + 1 });
    }
  } finally {
    setProgress(null);
  }
  if (cancelled) {
    toast(`Stopped after saving ${saved} of ${plural(ids.length, "post")}`);
    return;
  }
  if (!ids.length) {
    toast("Nothing new to save in this feed");
    return;
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

/**
 * Save these posts (again, if saved already), with the images and videos
 * `media` asks for (by default, as last chosen when saving a feed).
 */
export const saveOffline = (
  posts: PostSummary[] | string[],
  media: SaveMedia = savedMedia(),
): Promise<void> =>
  posts.length
    ? save(
        async () => posts.map((post) => (typeof post === "string" ? post : post.id)),
        media,
        false,
        posts.length > 1 ? "posts" : null,
      )
    : Promise.resolve();

/**
 * Save the next `count` posts of `shown` that aren't saved yet (or hidden),
 * reading further pages from Reddit when the loaded ones run out. `title`
 * names the feed on the progress bar; `textPosts` keeps only text posts.
 */
export const saveFeedOffline = (
  shown: OfflineFeed,
  count: number,
  media: SaveMedia,
  { title, textPosts = false }: { title: string; textPosts?: boolean },
): Promise<void> =>
  save(
    async () => {
      await loadOfflineIndex().catch(() => undefined);
      return pickUnsaved(shown, count, {
        // The hybrid feed's Lemmy posts are saved from their instance.
        skip: (id) => isSavedOffline(id) || hiddenPosts.has(id) || isLemmyItem(id),
        ...(textPosts ? { only: (post: PostSummary) => post.media.kind === "self" } : {}),
        more: (after) => fetchFeed(shown.sub, shown.sort, shown.timeframe, after),
        beforePage: pause,
      });
    },
    media,
    true,
    title,
  );

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
