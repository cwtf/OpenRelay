import { useSyncExternalStore } from "react";
import type { Account } from "../../shared/api";
import { fetchAccount } from "./api";
import { readJson, writeJson } from "./storage";

/** Reuse the saved account for this long before re-reading it from Reddit. */
const MAX_AGE = 30 * 60 * 1000;
const KEY = "account";

type Saved = { at: number; account: Account | null };

const listeners = new Set<() => void>();
let account: Account | null | undefined;
let loading = false;

const current = (): Account | null => {
  if (account === undefined)
    account = readJson<Saved | null>(KEY, null)?.account ?? null;
  return account;
};

/**
 * Load the signed-in account in the background unless a copy younger than
 * `maxAge` is saved. The drawer asks for a fresher copy for its inbox count.
 */
export const ensureAccount = (maxAge = MAX_AGE): void => {
  const saved = readJson<Saved | null>(KEY, null);
  if (loading || (saved && Date.now() - saved.at < maxAge)) return;
  loading = true;
  fetchAccount()
    .then((next) => {
      writeJson(KEY, { at: Date.now(), account: next } satisfies Saved);
      account = next;
      for (const listener of listeners) listener();
    })
    .catch(() => undefined) // Keep the saved account; retry on the next load.
    .finally(() => {
      loading = false;
    });
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAccount = (): Account | null =>
  useSyncExternalStore(subscribe, current);
