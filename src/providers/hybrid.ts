/**
 * The hybrid feed: Reddit's front page with the listed Lemmy instances'
 * Local feeds mixed in, in the Reddit tab. These are its pure parts: the
 * merge, the paging cursor and the names; `client/lib/hybrid.ts` fetches.
 */
import type { FeedSort, PostSummary } from "../shared/api.ts";

/**
 * Where each source's next page starts: Reddit's `after`, then each
 * instance's `page_cursor`. A source that's missing or `null` has no more.
 */
export type HybridCursor = {
  reddit: string | null;
  lemmy: Record<string, string | null>;
};

const PREFIX = "hybrid:";

/** The feed's `after`: `null` once every source has run out. */
export function encodeCursor(cursor: HybridCursor): string | null {
  const lemmy = Object.fromEntries(
    Object.entries(cursor.lemmy).filter(([, after]) => after !== null),
  );
  if (cursor.reddit === null && !Object.keys(lemmy).length) return null;
  return PREFIX + JSON.stringify({ reddit: cursor.reddit, lemmy });
}

/**
 * The cursor in `after`, keeping only the `hosts` still listed; the first
 * page (no `after`) starts every source. Anything else is an error.
 */
export function decodeCursor(
  after: string | null | undefined,
  hosts: readonly string[],
): HybridCursor {
  if (!after)
    return {
      reddit: null,
      lemmy: Object.fromEntries(hosts.map((host) => [host, null])),
    };
  let raw: any;
  try {
    if (!after.startsWith(PREFIX)) throw new Error();
    raw = JSON.parse(after.slice(PREFIX.length));
  } catch {
    throw new Error("Invalid hybrid feed cursor");
  }
  const text = (value: unknown) =>
    typeof value === "string" && value.length <= 200 ? value : null;
  const lemmy: Record<string, string | null> = {};
  for (const host of hosts) {
    const next = text(raw?.lemmy?.[host]);
    if (next !== null) lemmy[host] = next;
  }
  return { reddit: text(raw?.reddit), lemmy };
}

/**
 * One page from each source as one list. New is by time. The other sorts
 * aren't comparable across sites (Reddit's scores are far larger), so each
 * source is spread evenly by its own rank: a post halfway down its page
 * lands halfway down the merged one.
 */
export function mergeFeeds(
  pages: readonly (readonly PostSummary[])[],
  sort: FeedSort,
): PostSummary[] {
  const ranked = pages.flatMap((posts, source) =>
    posts.map((post, index) => ({
      post,
      source,
      key: sort === "new" ? -post.createdAt : (index + 0.5) / posts.length,
    })),
  );
  ranked.sort((a, b) => a.key - b.key || a.source - b.source);
  return ranked.map(({ post }) => post);
}

/** `name@host` for a name `host` writes bare because it's local there. */
export const qualifiedName = (name: string, host: string): string =>
  !name || name.includes("@") || name === "[deleted]" ? name : `${name}@${host}`;

/**
 * A post from `host` as the hybrid feed shows it: its community and author
 * with their instance, so they can't be taken for Reddit's.
 */
export const hybridPost = <T extends PostSummary>(post: T, host: string): T => ({
  ...post,
  subreddit: qualifiedName(post.subreddit, host),
  author: qualifiedName(post.author, host),
});
