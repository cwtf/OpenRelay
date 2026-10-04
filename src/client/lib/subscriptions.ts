import { useSyncExternalStore } from "react";
import type { Community } from "../../shared/api";
import { fetchSubscriptions } from "./api";
import { readJson, writeJson } from "./storage";

/** Reuse saved subscriptions for this long before quietly re-syncing. */
const MAX_AGE = 30 * 60 * 1000;
const KEY = "subscriptions";
const FAVOURITES = "favourite-subs";

type Saved = { at: number; items: Community[]; signedOut?: boolean };

export type SubscriptionState = {
  items: Community[];
  status: "idle" | "loading" | "ready" | "signed-out" | "error";
  error?: string;
  /** When the list was last synced with Reddit (ms), 0 if never. */
  at: number;
};

const listeners = new Set<() => void>();
let state: SubscriptionState | null = null;
let inflight: Promise<void> | null = null;

const emit = (next: SubscriptionState) => {
  state = next;
  for (const listener of listeners) listener();
};

const current = (): SubscriptionState => {
  if (!state) {
    const saved = readJson<Saved | null>(KEY, null);
    state = saved
      ? {
          items: Array.isArray(saved.items) ? saved.items : [],
          status: saved.signedOut ? "signed-out" : "ready",
          at: Number(saved.at) || 0,
        }
      : { items: [], status: "idle", at: 0 };
  }
  return state;
};

const signedOut = (message: string) =>
  /\((?:401|403)\)|sign-in/i.test(message);

/** Re-sync subscriptions from Reddit, keeping the saved list on failure. */
export const refreshSubscriptions = (): Promise<void> =>
  (inflight ??= (async () => {
    emit({ ...current(), status: "loading" });
    try {
      const items = await fetchSubscriptions();
      const at = Date.now();
      writeJson(KEY, { at, items } satisfies Saved);
      emit({ items, status: "ready", at });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load subscriptions";
      if (signedOut(message)) {
        const at = Date.now();
        writeJson(KEY, { at, items: [], signedOut: true } satisfies Saved);
        emit({ items: [], status: "signed-out", at });
      } else {
        const previous = current();
        emit({
          ...previous,
          status: previous.items.length ? "ready" : "error",
          error: message,
        });
      }
    } finally {
      inflight = null;
    }
  })());

/** Load subscriptions on start-up unless a recent copy is saved. */
export const ensureSubscriptions = (): void => {
  const { at } = current();
  if (!at || Date.now() - at > MAX_AGE) void refreshSubscriptions();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSubscriptions = (): SubscriptionState =>
  useSyncExternalStore(subscribe, current);

// -- favourites (starred communities, shown first in the drawer)

let favourites: string[] | null = null;

const favouriteList = (): string[] => {
  if (!favourites) {
    const saved = readJson<unknown>(FAVOURITES, []);
    favourites = Array.isArray(saved)
      ? saved.filter((name): name is string => typeof name === "string")
      : [];
  }
  return favourites;
};

export const isFavourite = (name: string): boolean =>
  favouriteList().some((item) => item.toLowerCase() === name.toLowerCase());

export const toggleFavourite = (name: string): void => {
  const list = favouriteList();
  favourites = isFavourite(name)
    ? list.filter((item) => item.toLowerCase() !== name.toLowerCase())
    : [...list, name].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
  writeJson(FAVOURITES, favourites);
  for (const listener of listeners) listener();
};

export const useFavourites = (): string[] =>
  useSyncExternalStore(subscribe, favouriteList);
