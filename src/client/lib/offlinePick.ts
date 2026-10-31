/** Choosing which of a feed's posts "Save feed for offline" saves. */
import type { PostSummary } from "../../shared/api";

export type FeedPage = { posts: PostSummary[]; after: string | null };

export type PickOptions = {
  /** Posts already saved, or hidden: skipped. */
  skip: (id: string) => boolean;
  /** Narrows the posts further (text posts only). */
  only?: (post: PostSummary) => boolean;
  /** The feed's next page after this cursor. */
  more: (after: string) => Promise<FeedPage>;
  /** Called before each further page, e.g. to pause for the rate limit. */
  beforePage?: (page: number) => Promise<void> | void;
  /** Further pages read at most. */
  maxPages?: number;
};

/**
 * The ids of the next `count` posts of a feed that `skip` doesn't skip, from
 * the posts already loaded, then from further pages while there are any.
 * A page that fails ends the search with what was found.
 */
export async function pickUnsaved(
  loaded: FeedPage,
  count: number,
  { skip, only = () => true, more, beforePage, maxPages = 20 }: PickOptions,
): Promise<string[]> {
  const seen = new Set<string>();
  const found: string[] = [];
  const take = (posts: PostSummary[]) => {
    for (const post of posts) {
      if (found.length >= count) return;
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      if (!skip(post.id) && only(post)) found.push(post.id);
    }
  };
  take(loaded.posts);
  let after = loaded.after;
  for (let page = 0; found.length < count && after && page < maxPages; page++) {
    await beforePage?.(page);
    let next: FeedPage;
    try {
      next = await more(after);
    } catch {
      break;
    }
    take(next.posts);
    after = next.after === after ? null : next.after;
  }
  return found;
}
