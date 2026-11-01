import type {
  AboutResponse,
  Account,
  Friend,
  InboxResponse,
  InboxSection,
  Moderator,
  ModFilter,
  ModSection,
  ListingResponse,
  ProfileSection,
  ProfileSort,
  SubredditRule,
  UserAbout,
  CommentNode,
  CommentSort,
  Community,
  FeedResponse,
  FeedSort,
  InitResponse,
  PostResponse,
  PostSummary,
  RepliesResponse,
  SearchSort,
  Timeframe,
} from "../../shared/api";
import { ApiFailure } from "../../shared/api";
import { bridge, pageUrl } from "../../extension/bridge";
import type { ReaderProvider } from "../types";
import { encodeImage, UPLOAD_TIMEOUT } from "../upload";
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
} from "./reddit";
import { searchPagePath, type SearchPage } from "./search";
import type { Snapshot } from "./snapshot";

/**
 * Reddit's half of the reader's data layer: listings, posts and account
 * screens from Reddit's JSON through the page bridge, seeded from (and
 * falling back to) what the Reddit page had already loaded.
 */
const entryRoute = parseRoute(pageUrl.href)!;
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
/** Reddit refuses /search.json to some sessions; its own search page works. */
let jsonSearchBlocked = false;
let infoBlocked = false;
const fetchInit = async (): Promise<InitResponse> => ({
  subreddit: entryRoute.sub,
  username: null,
  loggedIn: false,
  featured: ["popular"],
  defaultSort: entryRoute.sort,
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
async function fetchFeed(
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
async function fetchSearch(
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
  // A cursor from the HTML search is the path of its next page.
  if (after?.startsWith("/")) return searchPage(after);
  const html = () =>
    searchPage(searchPagePath(sub, q, sort, pageUrl.hostname === "old.reddit.com"));
  if (jsonSearchBlocked) return html();
  try {
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
  } catch {
    const page = await html();
    jsonSearchBlocked = true;
    return page;
  }
}
async function searchPage(path: string): Promise<FeedResponse> {
  const page = await bridge<SearchPage>("search-page", path);
  if (!page.ids.length) return { posts: [], after: null };
  const posts = await postsById(page.ids);
  if (!posts.length)
    throw new ApiFailure(
      "Reddit found results but would not load them. Try Original Reddit.",
    );
  const order = new Map(page.ids.map((id, index) => [id, index]));
  return {
    posts: posts.sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    ),
    after: page.next === path ? null : page.next,
  };
}
/** Posts by full name: one /api/info call, else each post's own page. */
async function postsById(ids: string[]): Promise<PostSummary[]> {
  if (!infoBlocked)
    try {
      return listing(await json("/api/info.json" + query({ id: ids.join(",") })))
        .posts;
    } catch {
      infoBlocked = true;
    }
  // Sessions refused /api/info can still open posts, a few at a time.
  const posts: PostSummary[] = [];
  for (let i = 0; i < ids.length; i += 5)
    for (const post of await Promise.all(
      ids.slice(i, i + 5).map((id) =>
        json(
          "/comments/" + id.replace(/^t3_/, "") + ".json" + query({ limit: 1, depth: 1 }),
        )
          .then((data) => listing(data?.[0]).posts[0])
          .catch(() => undefined),
      ),
    ))
      if (post) posts.push(post);
  return posts;
}
const memo = new Map<string, { at: number; value: Promise<PostResponse> }>();
/** A post and its comments, kept for a minute unless `fresh`. */
function redditPost(
  id: string,
  sort: CommentSort,
  limit: number,
  fresh: boolean,
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
async function fetchContext(
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
async function fetchReplies(
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
async function fetchAbout(sub: string): Promise<AboutResponse> {
  if (["Home", "popular"].includes(sub))
    return {
      about: {
        name: sub,
        title: sub === "Home" ? "Your Reddit feed" : "Popular on Reddit",
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
async function fetchSubscriptions(): Promise<Community[]> {
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
const fetchAccount = (): Promise<Account | null> =>
  bridge<Account | null>("me");
// -- profile, inbox, moderation, friends, posting

const user = (name: string) => "/user/" + encodeURIComponent(name);

async function fetchUserAbout(name: string): Promise<UserAbout> {
  const about = normalizeUserAbout(await json(user(name) + "/about.json?raw_json=1"));
  if (!about) throw new ApiFailure("This account is unavailable.");
  return about;
}
async function fetchUserListing(
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
async function fetchInbox(
  section: InboxSection,
  after?: string | null,
): Promise<InboxResponse> {
  // mark=false: opening the inbox does not mark everything read.
  const data = await json(
    "/message/" + section + ".json" + query({ mark: "false", after, limit: 25 }),
  );
  return { items: normalizeInbox(data?.data?.children), after: data?.data?.after ?? null };
}
async function fetchModListing(
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
async function searchCommunities(text: string): Promise<Community[]> {
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
async function fetchModerated(): Promise<string[]> {
  const data = await json("/subreddits/mine/moderator.json" + query({ limit: 100 }));
  const names: string[] = Array.isArray(data?.data?.children)
    ? data.data.children
        .map((child: any) => normalizeCommunity(child?.data)?.name)
        .filter(Boolean)
    : [];
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
async function fetchFriends(): Promise<Friend[]> {
  return normalizeFriends(await json("/prefs/friends.json?raw_json=1"));
}
async function fetchRules(sub: string): Promise<SubredditRule[]> {
  return normalizeRules(await json(prefix(sub) + "/about/rules.json?raw_json=1"));
}

async function fetchModerators(sub: string): Promise<Moderator[]> {
  return normalizeModerators(await json(prefix(sub) + "/about/moderators.json?raw_json=1"));
}
/** The community wiki's index page as Markdown ("" when there is none). */
async function fetchWiki(sub: string): Promise<string> {
  const data = await json(prefix(sub) + "/wiki/index.json?raw_json=1");
  return typeof data?.data?.content_md === "string" ? data.data.content_md : "";
}

/** A validated write performed by the Reddit tab with the viewer's session. */
const runAction = (
  op: string,
  args: Record<string, unknown> = {},
): Promise<{ id?: string; url?: string; comment?: CommentNode }> =>
  bridge("action", undefined, { op, args });

/** An image for a reply, uploaded by the Reddit tab: `![img](<asset id>)`. */
async function uploadImage(file: Blob): Promise<{ markdown: string; ref: string }> {
  const { id } = await bridge<{ id: string }>(
    "upload",
    undefined,
    { file: await encodeImage(file) },
    UPLOAD_TIMEOUT,
  );
  return { markdown: `![${file.type === "image/gif" ? "gif" : "img"}](${id})`, ref: id };
}

const FEEDS = ["home", "popular"];

export const redditReader: ReaderProvider = {
  name: "Reddit",
  features: {
    writes: true,
    inbox: true,
    friends: true,
    moderation: true,
    wiki: true,
    archive: true,
    // Reddit's messages are plain Markdown.
    images: { comments: true, messages: false },
  },
  communityLabel: (name) => `r/${name}`,
  isCommunity: (name) => !FEEDS.includes(name.toLowerCase()) && !name.includes("+"),
  validCommunityName: (name) => /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/.test(name),
  userLabel: (name) => `u/${name}`,
  baseUrl: "https://www.reddit.com",
  communityUrl: (name) => `https://www.reddit.com/r/${name}/`,
  loginUrl: "https://www.reddit.com/login",
  parseRoute,
  fetchInit,
  fetchFeed,
  fetchSearch,
  fetchPost: redditPost,
  fetchContext,
  fetchReplies,
  fetchAbout,
  fetchSubscriptions,
  fetchAccount,
  fetchUserAbout,
  fetchUserListing,
  fetchInbox,
  fetchModListing,
  searchCommunities,
  fetchModerated,
  fetchFriends,
  fetchRules,
  fetchModerators,
  fetchWiki,
  runAction,
  uploadImage,
};
