import { readJson, readPosts, writeJson } from "./storage";
import { siteKey } from "./site";

// Read posts: opening a post marks it read (PostScreen), and so can the post
// menu or, with "Mark read on scroll", scrolling past it. Feeds can hide them.

const markedListeners = new Set<(id: string) => void>();

/** Mark a post read from its menu; an open feed that hides read posts drops it. */
export const markRead = (id: string): void => {
  readPosts.add(id);
  for (const listener of markedListeners) listener(id);
};

export const markUnread = (id: string): void => readPosts.remove(id);

export const onMarkedRead = (listener: (id: string) => void): (() => void) => {
  markedListeners.add(listener);
  return () => {
    markedListeners.delete(listener);
  };
};

/** The IDs among `posts` that are read now. */
export const readAmong = (posts: readonly { id: string }[]): Set<string> =>
  new Set(posts.filter((post) => readPosts.has(post.id)).map((post) => post.id));

// Feeds whose "Hide read" chip differs from the Settings default, by name.
const overridesKey = () => siteKey("hide-read-feeds");

const overrides = (): Record<string, boolean> => {
  const stored = readJson<unknown>(overridesKey(), {});
  return stored && typeof stored === "object" && !Array.isArray(stored)
    ? (stored as Record<string, boolean>)
    : {};
};

export const feedHidesRead = (feed: string, fallback: boolean): boolean => {
  const value = overrides()[feed.toLowerCase()];
  return typeof value === "boolean" ? value : fallback;
};

export const setFeedHidesRead = (
  feed: string,
  value: boolean,
  fallback: boolean,
): void => {
  const next = { ...overrides() };
  const name = feed.toLowerCase();
  if (value === fallback) delete next[name];
  else next[name] = value;
  writeJson(overridesKey(), next);
};
