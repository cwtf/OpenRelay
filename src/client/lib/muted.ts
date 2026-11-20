import { useSyncExternalStore } from "react";
import { site } from "./api";
import { muteKey, parseMuted, withMuted, withoutMuted } from "./muteState";
import { readJson, writeJson } from "./storage";
import { siteKey } from "./site";

// Muted communities: their posts are left out of every other feed. Kept only
// on this device, per site; Reddit and Lemmy are never told.

const KEY = siteKey("muted-communities");

const listeners = new Set<() => void>();
let list: string[] | null = null;

export const mutedCommunities = (): string[] =>
  (list ??= parseMuted(readJson<unknown>(KEY, [])));

const save = (next: string[]) => {
  list = next;
  writeJson(KEY, next);
  for (const listener of listeners) listener();
};

export const isMuted = (name: string): boolean =>
  mutedCommunities().some((item) => muteKey(item) === muteKey(name));

export const muteCommunity = (name: string): void =>
  save(withMuted(mutedCommunities(), name));

export const unmuteCommunity = (name: string): void =>
  save(withoutMuted(mutedCommunities(), name));

/** The whole list, as Edit as text saves it. */
export const replaceMuted = (names: readonly string[]): void =>
  save(parseMuted(names));

// A hybrid feed's Lemmy community, as its posts name it in the Reddit tab.
const HYBRID_COMMUNITY = /^[a-z0-9_]{1,50}@[a-z0-9.-]{1,253}$/i;

/** Whether a name typed or pasted in can be muted here (not Home, Popular…). */
export const validMuteName = (name: string): boolean =>
  site.isCommunity(name) &&
  (site.validCommunityName(name) || HYBRID_COMMUNITY.test(name));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The muted names, re-rendering when the list changes. */
export const useMutedCommunities = (): string[] =>
  useSyncExternalStore(subscribe, mutedCommunities);
