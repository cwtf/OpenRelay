/**
 * The viewer's saved GIFs and images (see `savedMedia.ts`), one list for
 * every site, and fetching one to upload it again in a reply.
 */
import { useSyncExternalStore } from "react";
import { readerHost } from "../../hosts/reader";
import { MEDIA_HOSTS, type MediaFetcher } from "../../hosts/types";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "../../providers/upload";
import {
  parseSavedMedia,
  savedKey,
  withSaved,
  withoutSaved,
  type SavedMedia,
} from "./savedMedia";
import { readJson, watchKey, writeJson } from "./storage";

const KEY = "saved-media";

let cache: SavedMedia[] | null = null;
let version = 0;
const listeners = new Set<() => void>();

const changed = () => {
  version++;
  listeners.forEach((listener) => listener());
};

watchKey(KEY, () => {
  cache = null;
  changed();
});

export const savedMedia = (): SavedMedia[] =>
  (cache ??= parseSavedMedia(readJson<unknown>(KEY, [])));

const store = (list: SavedMedia[]) => {
  cache = list;
  writeJson(KEY, list);
  changed();
};

export const isSaved = (item: SavedMedia): boolean =>
  savedMedia().some((other) => savedKey(other) === savedKey(item));

/** Saves `item`, or forgets it when it's saved already; returns whether it's saved now. */
export const toggleSaved = (item: SavedMedia): boolean => {
  const saved = isSaved(item);
  store(saved ? withoutSaved(savedMedia(), savedKey(item)) : withSaved(savedMedia(), item));
  return !saved;
};

export const forgetSaved = (item: SavedMedia): void =>
  store(withoutSaved(savedMedia(), savedKey(item)));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The saved list, re-rendering when it changes. */
export const useSavedMedia = (): SavedMedia[] => {
  useSyncExternalStore(subscribe, () => version);
  return savedMedia();
};

const isMediaHost = (url: string): boolean => {
  try {
    return MEDIA_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * A saved image as a file to upload. Reddit's image hosts don't let the
 * reader fetch them, so the host does, as for offline posts (in the
 * extension that asks for access the first time: call this straight from
 * the click); others are fetched here, without cookies or referrer.
 */
export function savedMediaFile(url: string): Promise<File> {
  const access: Promise<MediaFetcher | string> | null = isMediaHost(url)
    ? (readerHost().media?.() ?? Promise.resolve("unavailable"))
    : null;
  return (async () => {
    let blob: Blob;
    if (access) {
      const fetcher = await access;
      if (typeof fetcher === "string")
        throw new Error(
          fetcher === "declined"
            ? "OpenRelay needs access to Reddit's image hosts to post this again."
            : "This image can't be posted again here.",
        );
      const file = await fetcher.fetch(url);
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      blob = new Blob([bytes], { type: file.type });
    } else {
      const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("The saved image is no longer available.");
      blob = await response.blob();
    }
    if (!IMAGE_TYPES.includes(blob.type)) throw new Error("The saved image isn't a PNG, JPEG, GIF or WebP.");
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("The saved image is too large to post again.");
    return new File([blob], `image.${blob.type.slice(6)}`, { type: blob.type });
  })();
}
