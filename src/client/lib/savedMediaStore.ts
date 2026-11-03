/**
 * The viewer's saved GIFs and images (see `savedMedia.ts`), one list for
 * every site.
 */
import { useSyncExternalStore } from "react";
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

/**
 * Adds Reddit's asset ID to an image saved before IDs were kept, when the
 * viewer opens it again; it keeps its place in the list.
 */
export const updateSaved = (item: SavedMedia): void => {
  if (!item.asset) return;
  const list = savedMedia();
  const index = list.findIndex((other) => savedKey(other) === savedKey(item) && !other.asset);
  if (index < 0) return;
  store(list.map((other, i) => (i === index ? { ...other, asset: item.asset! } : other)));
};

export const forgetSaved = (...items: SavedMedia[]): void =>
  store(withoutSaved(savedMedia(), ...items.map(savedKey)));

export const forgetAllSaved = (): void => store([]);

/** The whole list, as Edit as text saves it (see `parseSavedText`). */
export const replaceSaved = (list: SavedMedia[]): void => store(list);

/** Puts a saved item first, where the composer lists it first. */
export const moveSavedToFront = (item: SavedMedia): void => store(withSaved(savedMedia(), item));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The saved list, re-rendering when it changes. */
export const useSavedMedia = (): SavedMedia[] => {
  useSyncExternalStore(subscribe, () => version);
  return savedMedia();
};
