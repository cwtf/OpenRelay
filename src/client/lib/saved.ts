import { useSyncExternalStore } from "react";
import { runAction } from "./api";
import { toast } from "./platform";

/**
 * Saved state for posts and comments, changed from swipe actions. Starts from
 * what Reddit reported and remembers changes made in this session.
 */
const overrides = new Map<string, boolean>();
const listeners = new Set<() => void>();
let version = 0;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const set = (id: string, saved: boolean) => {
  overrides.set(id, saved);
  version++;
  for (const listener of listeners) listener();
};

export const useSaved = (id: string, initial: boolean | undefined): boolean => {
  useSyncExternalStore(subscribe, () => version);
  return overrides.get(id) ?? initial ?? false;
};

/** Toggle immediately; restore and explain if Reddit refuses. */
export const toggleSaved = (id: string, saved: boolean): void => {
  set(id, !saved);
  runAction(saved ? "unsave" : "save", { id })
    .then(() => toast(saved ? "Removed from saved" : "Saved"))
    .catch((error: unknown) => {
      set(id, saved);
      toast(error instanceof Error ? error.message : "Reddit could not do that.");
    });
};
