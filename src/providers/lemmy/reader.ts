import type {
  AboutResponse,
  Account,
  Community,
  FeedResponse,
  ListingResponse,
  PostResponse,
  RepliesResponse,
} from "../../shared/api";
import { ApiFailure } from "../../shared/api";
import { bridge, pageUrl } from "../../extension/bridge";
import type { ReaderProvider } from "../types";
import {
  LEMMY_FEEDS,
  commentSort,
  feedSort,
  isCommunityName,
  lemmyNumber,
  normalizeAbout,
  normalizeComments,
  normalizeCommunity,
  normalizeFollows,
  normalizeModerators,
  normalizePost,
  normalizeUser,
  normalizeUserListing,
  parseRoute,
  searchSort,
} from "./lemmy";

/**
 * Lemmy's half of the reader's data layer: Lemmy's v3 API (0.19) through
 * the page bridge, on the instance the reader was opened from. Read-only:
 * writes, the inbox and moderation aren't supported yet.
 */
const origin = pageUrl.origin;
const entryRoute = parseRoute(pageUrl.href)!;
/** Lemmy pages comments and search results at most 50 at a time. */
const PAGE = 50;

const query = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  return "?" + search;
};
const json = (path: string) => bridge<any>("json", path);

/** Home is the viewer's default listing; All and Local are Lemmy's. */
const listingParams = (sub: string) =>
  sub === "Home"
    ? {}
    : LEMMY_FEEDS.includes(sub)
      ? { type_: sub }
      : { community_name: sub, type_: "All" };

const unavailable = (what: string) =>
  Promise.reject(new ApiFailure(`${what} isn't available on Lemmy in OpenRelay yet.`));

const postNumber = (id: string) => {
  const n = lemmyNumber(id, "t3");
  if (n === null) throw new ApiFailure("This post is unavailable.");
  return n;
};
const commentNumber = (id: string) => {
  const n = lemmyNumber(id, "t1");
  if (n === null) throw new ApiFailure("This comment is unavailable.");
  return n;
};

const posts = (views: unknown) =>
  (Array.isArray(views) ? views : []).map((view) => normalizePost(view, origin));

async function fetchFeed(
  sub: string,
  sort: Parameters<ReaderProvider["fetchFeed"]>[1],
  t: Parameters<ReaderProvider["fetchFeed"]>[2],
  after?: string | null,
): Promise<FeedResponse> {
  const data = await json(
    "/api/v3/post/list" +
      query({ ...listingParams(sub), sort: feedSort(sort, t), limit: 25, page_cursor: after }),
  );
  if (!Array.isArray(data?.posts))
    throw new ApiFailure("Lemmy did not return a post listing. Use Original Lemmy to continue.");
  const found = posts(data.posts);
  return { posts: found, after: found.length && typeof data.next_page === "string" ? data.next_page : null };
}

async function fetchSearch(
  sub: string,
  q: string,
  sort: Parameters<ReaderProvider["fetchSearch"]>[2],
  after?: string | null,
): Promise<FeedResponse> {
  const page = Number(after) || 1;
  const data = await json(
    "/api/v3/search" +
      query({
        q,
        type_: "Posts",
        sort: searchSort(sort),
        listing_type: "All",
        ...(isCommunityName(sub) && !LEMMY_FEEDS.includes(sub) && sub !== "Home"
          ? { community_name: sub }
          : {}),
        page,
        limit: 25,
      }),
  );
  const found = posts(data?.posts);
  return { posts: found, after: found.length >= 25 ? String(page + 1) : null };
}

/** Up to `limit` top-level comments with their replies, `PAGE` at a time. */
async function commentViews(post: number, sort: string, limit: number) {
  const views: unknown[] = [];
  let full = false;
  for (let page = 1; (page - 1) * PAGE < limit; page++) {
    const data = await json(
      "/api/v3/comment/list" +
        query({ post_id: post, sort, max_depth: 8, type_: "All", limit: PAGE, page }),
    );
    const list: any[] = Array.isArray(data?.comments) ? data.comments : [];
    views.push(...list);
    const roots = list.filter((view) => String(view?.comment?.path).split(".").length === 2);
    full = roots.length >= PAGE;
    if (!full) break;
  }
  return { views, more: full };
}

const memo = new Map<string, { at: number; value: Promise<PostResponse> }>();
/** A post and its comments, kept for a minute unless `fresh`. */
function fetchPost(
  id: string,
  sort: Parameters<ReaderProvider["fetchPost"]>[1],
  limit: number,
  fresh: boolean,
): Promise<PostResponse> {
  const key = id + ":" + sort + ":" + limit;
  const hit = memo.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.value;
  const value = (async () => {
    const n = postNumber(id);
    const [data, comments] = await Promise.all([
      json("/api/v3/post" + query({ id: n })),
      commentViews(n, commentSort(sort), Math.max(limit, 1)),
    ]);
    if (!data?.post_view) throw new ApiFailure("This post is unavailable.");
    return {
      post: normalizePost(data.post_view, origin),
      comments: normalizeComments(comments.views as any[], origin),
      moreComments: comments.more,
    };
  })();
  memo.set(key, { at: Date.now(), value });
  value.catch(() => memo.delete(key));
  return value;
}

/** A comment with up to `context` parents above it and its replies below. */
async function fetchContext(
  id: string,
  comment: string,
  sort: Parameters<ReaderProvider["fetchContext"]>[2],
  context = 3,
): Promise<PostResponse> {
  const c = commentNumber(comment);
  const [data, below] = await Promise.all([
    json("/api/v3/post" + query({ id: postNumber(id) })),
    json("/api/v3/comment/list" + query({ parent_id: c, sort: commentSort(sort), max_depth: 8, type_: "All" })),
  ]);
  if (!data?.post_view) throw new ApiFailure("This post is unavailable.");
  const views: any[] = Array.isArray(below?.comments) ? below.comments : [];
  const own = views.find((view) => view?.comment?.id === c);
  const ancestors = String(own?.comment?.path ?? "")
    .split(".")
    .map(Number)
    .filter((n) => n && n !== c)
    .slice(-context);
  const above = await Promise.all(
    ancestors.map((n) =>
      json("/api/v3/comment" + query({ id: n }))
        .then((reply) => reply?.comment_view)
        .catch(() => null),
    ),
  );
  return {
    post: normalizePost(data.post_view, origin),
    comments: normalizeComments([...above.filter(Boolean), ...views], origin),
    moreComments: false,
  };
}

async function fetchReplies(
  _post: string,
  comment: string,
  sort: Parameters<ReaderProvider["fetchReplies"]>[2],
): Promise<RepliesResponse> {
  const data = await json(
    "/api/v3/comment/list" +
      query({ parent_id: commentNumber(comment), sort: commentSort(sort), max_depth: 8, type_: "All" }),
  );
  // The list starts at the comment itself.
  const tree = normalizeComments(data?.comments, origin);
  const parent = tree.find((node) => node.id === comment) ?? tree[0];
  if (!parent)
    throw new ApiFailure("Lemmy did not return this thread. Open it on Lemmy to continue.");
  return { replies: parent.replies, more: parent.moreReplies };
}

const FEED_TITLES: Record<string, string> = {
  Home: "Your Lemmy feed",
  All: "Everything this instance knows",
  Local: `Posts on ${pageUrl.hostname}`,
};
async function fetchAbout(sub: string): Promise<AboutResponse> {
  if (FEED_TITLES[sub]) return { about: { name: sub, title: FEED_TITLES[sub], nsfw: false } };
  return normalizeAbout(await json("/api/v3/community" + query({ name: sub })), sub);
}

async function fetchSubscriptions(): Promise<Community[]> {
  const data = await json("/api/v3/site");
  // The wording matches what `subscriptions.ts` reads as signed out.
  if (!data?.my_user) throw new ApiFailure("Sign in to Lemmy to see your communities (401).");
  return normalizeFollows(data).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

const fetchAccount = (): Promise<Account | null> => bridge<Account | null>("me");

async function fetchUserAbout(name: string) {
  const about = normalizeUser(await json("/api/v3/user" + query({ username: name, limit: 1 })));
  if (!about) throw new ApiFailure("This account is unavailable.");
  return about;
}

async function fetchUserListing(
  name: string,
  section: Parameters<ReaderProvider["fetchUserListing"]>[1],
  sort: Parameters<ReaderProvider["fetchUserListing"]>[2],
  t: Parameters<ReaderProvider["fetchUserListing"]>[3],
  after?: string | null,
): Promise<ListingResponse> {
  // Lemmy shows a profile's posts and comments together; voted, hidden
  // and saved lists aren't public.
  if (!["overview", "comments", "submitted"].includes(section))
    return { items: [], after: null };
  const page = Number(after) || 1;
  const data = await json(
    "/api/v3/user" + query({ username: name, sort: feedSort(sort, t), page, limit: 20 }),
  );
  const items = normalizeUserListing(data, origin).filter(
    (item) =>
      section === "overview" ||
      (section === "comments" ? item.type === "comment" : item.type === "post"),
  );
  const more =
    (Array.isArray(data?.posts) && data.posts.length >= 20) ||
    (Array.isArray(data?.comments) && data.comments.length >= 20);
  return { items, after: more ? String(page + 1) : null };
}

async function searchCommunities(text: string): Promise<Community[]> {
  const data = await json(
    "/api/v3/search" + query({ q: text, type_: "Communities", sort: "TopAll", listing_type: "All", limit: 10 }),
  );
  return (Array.isArray(data?.communities) ? data.communities : [])
    .map(normalizeCommunity)
    .filter((c: Community | null): c is Community => Boolean(c));
}

export const lemmyReader: ReaderProvider = {
  name: "Lemmy",
  features: {
    writes: false,
    inbox: false,
    friends: false,
    moderation: false,
    wiki: false,
    archive: false,
  },
  communityLabel: (name) => (name === "Home" || LEMMY_FEEDS.includes(name) ? name : `c/${name}`),
  isCommunity: (name) => name !== "Home" && !LEMMY_FEEDS.includes(name),
  validCommunityName: isCommunityName,
  communityUrl: (name) => new URL(`/c/${name}`, origin).href,
  loginUrl: new URL("/login", origin).href,
  parseRoute,
  fetchInit: async () => ({
    subreddit: entryRoute.sub,
    username: null,
    loggedIn: false,
    featured: LEMMY_FEEDS,
    defaultSort: entryRoute.sort,
  }),
  fetchFeed,
  fetchSearch,
  fetchPost,
  fetchContext,
  fetchReplies,
  fetchAbout,
  fetchSubscriptions,
  fetchAccount,
  fetchUserAbout,
  fetchUserListing,
  fetchInbox: () => unavailable("The inbox"),
  fetchModListing: () => unavailable("Moderation"),
  searchCommunities,
  fetchModerated: async () => [],
  fetchFriends: async () => [],
  // A Lemmy community's rules are part of its sidebar.
  fetchRules: async () => [],
  fetchModerators: async (sub) =>
    normalizeModerators(await json("/api/v3/community" + query({ name: sub }))),
  fetchWiki: async () => "",
  runAction: () =>
    Promise.reject(
      new ApiFailure("OpenRelay can only read Lemmy for now. Use Original Lemmy to vote, reply or post."),
    ),
};
