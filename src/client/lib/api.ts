import type {
  AboutResponse,
  Account,
  Friend,
  InboxResponse,
  Moderator,
  ListingResponse,
  SubredditRule,
  UserAbout,
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
  safeUrl,
  normalizeCommunity,
  normalizeFriends,
  normalizeInbox,
  normalizeListing,
  normalizeModerators,
  normalizeRules,
  normalizeUserAbout,
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
/**
 * A single comment thread: the comment with up to `context` parents above it
 * and its replies below, as Reddit's "context" links show it.
 */
export async function fetchContext(
  id: string,
  comment: string,
  sort: CommentSort,
  context = 3,
): Promise<PostResponse> {
  const result = await json(
    "/comments/" +
      id.replace(/^t3_/, "") +
      ".json" +
      query({ comment: comment.replace(/^t1_/, ""), context, sort, limit: 100 }),
  );
  if (!result?.[0]?.data?.children?.[0]?.data)
    throw new Error("This post is unavailable.");
  const tree = normalizeComments(result[1]?.data?.children);
  return {
    post: normalizePost(result[0].data.children[0].data),
    comments: tree.comments,
    moreComments: false,
  };
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
  const icon = safeUrl(d.community_icon) || safeUrl(d.icon_img);
  const banner =
    safeUrl(d.banner_background_image) || safeUrl(d.banner_img) || safeUrl(d.mobile_banner_image);
  return {
    about: {
      name: d.display_name ?? sub,
      ...(icon ? { icon } : {}),
      ...(banner ? { banner } : {}),
      ...(typeof d.description === "string" && d.description
        ? { sidebar: d.description }
        : {}),
      ...(typeof d.user_is_subscriber === "boolean"
        ? { subscribed: d.user_is_subscriber }
        : {}),
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
/** The signed-in account's name and profile picture, or null. */
export const fetchAccount = (): Promise<Account | null> =>
  bridge<Account | null>("me");
// -- profile, inbox, moderation, friends, posting

export type ProfileSection =
  | "overview"
  | "comments"
  | "submitted"
  | "upvoted"
  | "downvoted"
  | "hidden"
  | "saved";
export type ProfileSort = "new" | "hot" | "top" | "controversial";
export type InboxSection =
  | "inbox"
  | "unread"
  | "messages"
  | "comments"
  | "selfreply"
  | "sent"
  | "mentions"
  | "moderator"
  | "moderator/unread";
export type ModSection = "modqueue" | "reports" | "spam" | "edited" | "unmoderated";
export type ModFilter = "all" | "links" | "comments";

const user = (name: string) => "/user/" + encodeURIComponent(name);

export async function fetchUserAbout(name: string): Promise<UserAbout> {
  const about = normalizeUserAbout(await json(user(name) + "/about.json?raw_json=1"));
  if (!about) throw new ApiFailure("This account is unavailable.");
  return about;
}
export async function fetchUserListing(
  name: string,
  section: ProfileSection,
  sort: ProfileSort,
  t: Timeframe,
  after?: string | null,
): Promise<ListingResponse> {
  const data = await json(
    user(name) + "/" + section + ".json" + query({ sort, t, after, limit: 25 }),
  );
  return { items: normalizeListing(data?.data?.children), after: data?.data?.after ?? null };
}
export async function fetchInbox(
  section: InboxSection,
  after?: string | null,
): Promise<InboxResponse> {
  // mark=false: opening the inbox does not mark everything read.
  const data = await json(
    "/message/" + section + ".json" + query({ mark: "false", after, limit: 25 }),
  );
  return { items: normalizeInbox(data?.data?.children), after: data?.data?.after ?? null };
}
export async function fetchModListing(
  sub: string,
  section: ModSection,
  filter: ModFilter,
  after?: string | null,
): Promise<ListingResponse> {
  const data = await json(
    prefix(sub) +
      "/about/" +
      section +
      ".json" +
      query({ only: filter === "all" ? undefined : filter, after, limit: 25 }),
  );
  return { items: normalizeListing(data?.data?.children), after: data?.data?.after ?? null };
}
const communities = (data: any): Community[] =>
  Array.isArray(data?.data?.children)
    ? data.data.children
        .map((child: any) => (child?.kind === "t5" ? normalizeCommunity(child.data) : null))
        .filter((community: Community | null): community is Community => Boolean(community))
    : [];

/**
 * Communities matching a partial name, as Reddit's own search box suggests
 * them; falls back to community search if autocomplete is unavailable.
 */
export async function searchCommunities(text: string): Promise<Community[]> {
  try {
    return communities(
      await json(
        "/api/subreddit_autocomplete_v2.json" +
          query({ query: text, include_over_18: "true", include_profiles: "false", limit: 10 }),
      ),
    );
  } catch {
    return communities(
      await json("/subreddits/search.json" + query({ q: text, include_over_18: "on", limit: 10 })),
    );
  }
}

/** Communities the viewer moderates, alphabetically. */
export async function fetchModerated(): Promise<string[]> {
  const data = await json("/subreddits/mine/moderator.json" + query({ limit: 100 }));
  const names: string[] = Array.isArray(data?.data?.children)
    ? data.data.children
        .map((child: any) => normalizeCommunity(child?.data)?.name)
        .filter(Boolean)
    : [];
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
export async function fetchFriends(): Promise<Friend[]> {
  return normalizeFriends(await json("/prefs/friends.json?raw_json=1"));
}
export async function fetchRules(sub: string): Promise<SubredditRule[]> {
  return normalizeRules(await json(prefix(sub) + "/about/rules.json?raw_json=1"));
}

export async function fetchModerators(sub: string): Promise<Moderator[]> {
  return normalizeModerators(await json(prefix(sub) + "/about/moderators.json?raw_json=1"));
}
/** The community wiki's index page as Markdown ("" when there is none). */
export async function fetchWiki(sub: string): Promise<string> {
  const data = await json(prefix(sub) + "/wiki/index.json?raw_json=1");
  return typeof data?.data?.content_md === "string" ? data.data.content_md : "";
}

/** A validated write performed by the Reddit tab with the viewer's session. */
export const runAction = (
  op: string,
  args: Record<string, unknown> = {},
): Promise<{ id?: string; url?: string }> => bridge("action", undefined, { op, args });

export const savePrefsRemote = async (prefs: Prefs) => ({ prefs });
