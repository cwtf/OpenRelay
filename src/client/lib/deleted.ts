import { useSyncExternalStore } from "react";

/**
 * Posts and comments you deleted in this session, so every listing that
 * still holds them can drop them, as Relay removes a deleted post from the
 * listing behind it.
 */
const deleted = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const markDeleted = (id: string): void => {
  if (deleted.has(id)) return;
  deleted.add(id);
  version++;
  for (const listener of listeners) listener();
};

export const isDeleted = (id: string): boolean => deleted.has(id);

/** Re-render when something is deleted; returns a changing version. */
export const useDeletedVersion = (): number =>
  useSyncExternalStore(subscribe, () => version);
