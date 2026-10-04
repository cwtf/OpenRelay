import type {
  AboutResponse,
  CommentNode,
  CommentSort,
  Community,
  FeedResponse,
  FeedSort,
  InitResponse,
  PostResponse,
  Prefs,
  RepliesResponse,
  SearchSort,
  Timeframe,
} from "../../shared/api";
import { bridge, pageUrl } from "../../extension/bridge";
import {
  normalizeCommunity,
  normalizeComments,
  normalizePost,
  parseRoute,
} from "../../extension/reddit";
import type { Snapshot } from "../../extension/snapshot";

export class ApiFailure extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export const entryRoute = parseRoute(pageUrl.href)!;
const query = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams({ raw_json: "1" });
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null) search.set(key, String(value));
  return "?" + search;
};
const prefix = (sub: string) =>
  sub === "Home" ? "" : "/r/" + encodeURIComponent(sub);
const json = (path: string) => bridge<any>("json", path);
let seededFeed = false;
let seededSearch = false;
export const fetchInit = async (): Promise<InitResponse> => ({
  subreddit: entryRoute.sub,
  username: null,
  loggedIn: false,
  featured: ["popular", "all"],
  defaultSort: entryRoute.sort,
  prefs: null,
});
const snapshot = () => bridge<Snapshot>("snapshot");
const listing = (data: any): FeedResponse => {
  if (!Array.isArray(data?.data?.children))
    throw new ApiFailure(
      "Reddit did not return a post listing. Use Original Reddit to continue.",
    );
  return {
    posts: data.data.children
      .filter((c: any) => c.kind === "t3")
      .map((c: any) => normalizePost(c.data)),
    after: data.data.after ?? null,
  };
};
export async function fetchFeed(
  sub: string,
  sort: FeedSort,
  t: Timeframe,
  after?: string | null,
): Promise<FeedResponse> {
  if (
    !seededFeed &&
    !after &&
    !entryRoute.postId &&
    entryRoute.query === undefined &&
    sub === entryRoute.sub &&
    sort === entryRoute.sort &&
    t === entryRoute.timeframe
  ) {
    seededFeed = true;
    const loaded = await snapshot();
    if (loaded.posts.length)
      return { posts: loaded.posts, after: loaded.posts.at(-1)!.id };
  }
  return listing(
    await json(
      prefix(sub) + "/" + sort + ".json" + query({ t, after, limit: 25 }),
    ),
  );
}
export async function fetchSearch(
  sub: string,
  q: string,
  sort: SearchSort,
  after?: string | null,
): Promise<FeedResponse> {
  if (
    !seededSearch &&
    !after &&
    entryRoute.query === q &&
    sub === entryRoute.sub &&
    (entryRoute.searchSort ?? "relevance") === sort
  ) {
    seededSearch = true;
    const loaded = await snapshot();
    if (loaded.posts.length)
      return { posts: loaded.posts, after: loaded.posts.at(-1)!.id };
  }
  return listing(
    await json(
      prefix(sub) +
        "/search.json" +
        query({
          q,
          sort,
          after,
          limit: 25,
          restrict_sr: sub === "Home" ? 0 : 1,
        }),
    ),
  );
}
const memo = new Map<string, { at: number; value: Promise<PostResponse> }>();
export function fetchPost(
  id: string,
  sort: CommentSort,
  limit = 40,
  fresh = false,
): Promise<PostResponse> {
  const key = id + ":" + sort + ":" + limit;
  const hit = memo.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.value;
  const value = (async () => {
    try {
      const result = await json(
        "/comments/" +
          id.replace(/^t3_/, "") +
          ".json" +
          query({ sort, limit: Math.min(limit, 500) }),
      );
      if (!result?.[0]?.data?.children?.[0]?.data)
        throw new Error("This post is unavailable.");
      const tree = normalizeComments(result[1]?.data?.children);
      return {
        post: normalizePost(result[0].data.children[0].data),
        comments: tree.comments,
        moreComments: tree.more && limit < 500,
        ...(tree.more && limit >= 500
          ? {
              notice:
                "Reddit limits the comments returned here. Open the original thread to read further.",
            }
          : {}),
      };
    } catch (error) {
      if (id === entryRoute.postId && !fresh) {
        const loaded = await snapshot();
        const post = loaded.posts.find((p) => p.id === id);
        if (post)
          return {
            post,
            comments: loaded.comments,
            moreComments: false,
            notice:
              "Showing content already loaded on Reddit. Refresh and additional comments require Reddit access.",
          };
      }
      throw error;
    }
  })();
  memo.set(key, { at: Date.now(), value });
  value.catch(() => memo.delete(key));
  return value;
}
function findComment(
  nodes: CommentNode[],
  id: string,
): CommentNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findComment(node.replies, id);
    if (found) return found;
  }
}
export async function fetchReplies(
  post: string,
  comment: string,
  sort: CommentSort,
  _op: string,
): Promise<RepliesResponse> {
  const result = await json(
    "/comments/" +
      post.replace(/^t3_/, "") +
      ".json" +
      query({
        comment: comment.replace(/^t1_/, ""),
        context: 0,
        sort,
        limit: 100,
      }),
  );
  const tree = normalizeComments(result?.[1]?.data?.children);
  const parent = findComment(tree.comments, comment);
  if (!parent)
    throw new ApiFailure(
      "Reddit did not return this thread. Open it on Reddit to continue.",
    );
  return { replies: parent.replies, more: parent.moreReplies };
}
export async function fetchAbout(sub: string): Promise<AboutResponse> {
  if (["Home", "popular", "all"].includes(sub))
    return {
      about: {
        name: sub,
        title:
          sub === "Home"
            ? "Your Reddit feed"
            : sub === "all"
              ? "All communities"
              : "Popular on Reddit",
        nsfw: false,
      },
    };
  const result = await json(prefix(sub) + "/about.json?raw_json=1");
  const d = result?.data;
  if (!d) throw new ApiFailure("Community information unavailable");
  return {
    about: {
      name: d.display_name ?? sub,
      title: d.title,
      description: d.public_description,
      subscribers: d.subscribers,
      active: d.accounts_active,
      nsfw: Boolean(d.over18),
    },
  };
}
/** Every community the signed-in viewer subscribes to, alphabetically. */
export async function fetchSubscriptions(): Promise<Community[]> {
  const found = new Map<string, Community>();
  let after: string | null = null;
  // Reddit pages at 100; stop at 1,000 communities.
  for (let page = 0; page < 10; page++) {
    const data = await json(
      "/subreddits/mine/subscriber.json" + query({ limit: 100, after }),
    );
    const children = data?.data?.children;
    if (!Array.isArray(children))
      throw new ApiFailure("Reddit did not return your subscriptions.");
    for (const child of children) {
      const community = child?.kind === "t5" && normalizeCommunity(child.data);
      if (community) found.set(community.name.toLowerCase(), community);
    }
    after = typeof data.data.after === "string" ? data.data.after : null;
    if (!after) break;
  }
  return [...found.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
export const savePrefsRemote = async (prefs: Prefs) => ({ prefs });
