// Muted communities: the pure parts (see muted.ts for the stored list).
// Names are kept as first written, compared without case. A hybrid feed's
// Lemmy community is `name@host`, so it can't match a Reddit one.

/** How a community name is compared. */
export const muteKey = (name: string): string => name.trim().toLowerCase();

const sorted = (list: string[]): string[] =>
  list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

/** The stored list, whatever storage held: names only, once each, sorted. */
export const parseMuted = (stored: unknown): string[] => {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of stored) {
    if (typeof item !== "string" || !item.trim()) continue;
    const key = muteKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(item.trim());
  }
  return sorted(names);
};

export const withMuted = (list: readonly string[], name: string): string[] =>
  parseMuted([...list, name]);

export const withoutMuted = (list: readonly string[], name: string): string[] =>
  list.filter((item) => muteKey(item) !== muteKey(name));

/** The lookup set for `hidesPost`. */
export const mutedSet = (list: readonly string[]): Set<string> =>
  new Set(list.map(muteKey));

/**
 * Whether a feed leaves out a post from `community`. Every feed does, except
 * that community's own, so a muted community can still be visited.
 */
export const hidesPost = (
  muted: ReadonlySet<string>,
  community: string,
  feed: string,
): boolean => {
  const key = muteKey(community);
  return muted.has(key) && key !== muteKey(feed);
};

/**
 * A community name as typed or pasted: without the `r/`, `/r/`, `c/` or
 * `!` in front, or a trailing `/`. Whether it's valid is the site's call.
 */
export const cleanMuteName = (input: string): string =>
  input
    .trim()
    .replace(/^\/?(?:r|c)\//i, "")
    .replace(/^!/, "")
    .replace(/\/$/, "");

/** The list as Edit as text shows it, one name per line. */
export const mutedText = (list: readonly string[]): string => list.join("\n");

export type MutedTextResult = {
  /** The names to keep, once each, sorted. */
  names: string[];
  /** Line numbers (from 1) that aren't a valid community name. */
  errors: number[];
  /** [line, first line] for a name written twice; it's kept once. */
  repeats: [number, number][];
};

/**
 * Edit as text read back: one name per line, blank lines skipped, each
 * cleaned by `cleanMuteName` and checked with `valid`.
 */
export const parseMutedText = (
  text: string,
  valid: (name: string) => boolean,
): MutedTextResult => {
  const errors: number[] = [];
  const repeats: [number, number][] = [];
  const first = new Map<string, number>();
  const names: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const name = cleanMuteName(line);
    if (!name) return;
    if (!valid(name)) return void errors.push(index + 1);
    const seen = first.get(muteKey(name));
    if (seen !== undefined) return void repeats.push([index + 1, seen]);
    first.set(muteKey(name), index + 1);
    names.push(name);
  });
  return { names: sorted(names), errors, repeats };
};

/** How many names saving `after` over `before` adds and removes. */
export const mutedChanges = (
  before: readonly string[],
  after: readonly string[],
): { added: number; removed: number } => {
  const was = mutedSet(before);
  const now = mutedSet(after);
  return {
    added: [...now].filter((key) => !was.has(key)).length,
    removed: [...was].filter((key) => !now.has(key)).length,
  };
};
