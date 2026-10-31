import type {
  Account,
  AboutResponse,
  CommentNode,
  CommentSort,
  Community,
  FeedSort,
  ListingItem,
  Moderator,
  PageRoute,
  PostDetail,
  PostMedia,
  SearchSort,
  Timeframe,
  UserAbout,
} from "../../shared/api.ts";
import { safeUrl } from "../reddit/reddit.ts";

/**
 * Lemmy's JSON API (v3, Lemmy 0.19) turned into the reader's models, and
 * the pages and API paths the Lemmy provider accepts.
 *
 * Lemmy's numeric IDs are only unique on one instance, and the reader keeps
 * read markers and offline copies for every site in one store. So posts and
 * comments get Reddit-shaped IDs with the instance's tag: `t3_<id>_<tag>` and
 * `t1_<id>_<tag>`. Code that checks for `t3_`/`t1_` keeps working, and they
 * can't collide with Reddit's (base 36, no underscore) or another instance's.
 */

type Raw = Record<string, any>;

/** A short tag for an instance's host name (FNV-1a, base 36). */
export function hostTag(host: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < host.length; i++) {
    hash ^= host.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
export const postId = (id: unknown, tag: string): string => `t3_${num(id)}_${tag}`;
export const commentId = (id: unknown, tag: string): string => `t1_${num(id)}_${tag}`;
/** The instance's own number for a reader ID, or a bare number; else null. */
export function lemmyNumber(id: string, kind: "t3" | "t1"): number | null {
  const match = new RegExp(`^(?:${kind}_)?(\\d{1,12})(?:_[a-z0-9]{1,8})?$`).exec(id);
  return match ? Number(match[1]) : null;
}

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
/** Lemmy's times are UTC; older servers leave out the `Z`. */
const time = (v: unknown) => {
  if (typeof v !== "string") return 0;
  const parsed = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + "Z");
  return Number.isFinite(parsed) ? parsed : 0;
};
const hostOf = (url: unknown) => {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return "";
  }
};

/**
 * A community's or person's name as this instance addresses it: bare when
 * it's local, `name@host` when it's from another instance.
 */
function qualified(actor: Raw | undefined, fallback: string): string {
  const name = String(actor?.name ?? "");
  if (!name) return fallback;
  if (actor?.local) return name;
  const host = hostOf(actor?.actor_id);
  return host ? `${name}@${host}` : name;
}
export const communityName = (c: Raw | undefined) => qualified(c, "");
const personName = (p: Raw | undefined) => qualified(p, "[deleted]");

const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?|$)/i;
const VIDEO = /\.(mp4|webm|m4v|mov)(\?|$)/i;

/** A `PostView` (`/api/v3/post/list`, `/api/v3/post`) as a post. */
export function normalizePost(view: Raw, origin: string): PostDetail {
  const p: Raw = view?.post ?? {};
  const tag = hostTag(hostOf(origin));
  const url = safeUrl(p.url);
  const thumbUrl = safeUrl(p.thumbnail_url);
  const details: Raw = view?.image_details ?? {};
  const thumb = thumbUrl
    ? {
        url: thumbUrl,
        width: num(details.width) || 640,
        height: num(details.height) || 480,
      }
    : undefined;
  const type = String(p.url_content_type ?? "");
  const video = safeUrl(p.embed_video_url) || (VIDEO.test(url) || type.startsWith("video/") ? url : "");
  let media: PostMedia;
  if (!url) media = { kind: "self" };
  else if (type.startsWith("image/") || IMAGE.test(url))
    media = {
      kind: "image",
      image: {
        url,
        width: num(details.width) || 640,
        height: num(details.height) || 480,
      },
      animated: type === "image/gif" || /\.gif(\?|$)/i.test(url),
    };
  else if (video)
    media = {
      kind: "video",
      video: { mp4: video, width: 640, height: 360, isGif: false },
      ...(thumb ? { poster: thumb } : {}),
    };
  else
    media = {
      kind: "link",
      url,
      domain: hostOf(url),
      ...(thumb ? { poster: thumb } : {}),
    };
  const body = p.deleted ? "[deleted]" : p.removed ? "[removed]" : String(p.body ?? "");
  const permalink = new URL(`/post/${num(p.id)}`, origin).href;
  const counts: Raw = view?.counts ?? {};
  const community = communityName(view?.community);
  return {
    id: postId(p.id, tag),
    title: String(p.name ?? "Untitled"),
    author: personName(view?.creator),
    subreddit: community,
    permalink,
    url: url || permalink,
    domain: url ? hostOf(url) : `self.${community}`,
    createdAt: time(p.published),
    score: num(counts.score),
    comments: num(counts.comments),
    nsfw: Boolean(p.nsfw || view?.community?.nsfw),
    spoiler: false,
    stickied: Boolean(p.featured_community || p.featured_local),
    locked: Boolean(p.locked),
    archived: false,
    edited: Boolean(p.updated),
    crosspost: false,
    body,
    excerpt: body.slice(0, 280),
    ...(thumb ? { thumb } : {}),
    ...vote(view?.my_vote),
    ...(typeof view?.saved === "boolean" ? { saved: view.saved } : {}),
    ...(p.deleted ? { removed: "author" as const } : p.removed ? { removed: "mods" as const } : {}),
    media,
  };
}

/** `my_vote`: present only when signed in. */
const vote = (v: unknown) =>
  v === 1 || v === -1 || v === 0 ? { vote: v as -1 | 0 | 1 } : {};

/**
 * Lemmy's flat `CommentView` list (`/api/v3/comment/list`) as a tree. A
 * comment's `path` is `0.<ancestor ids>.<id>`; a comment whose parent isn't
 * in the list is a root. `moreReplies` is set where Lemmy counts more
 * replies than the list holds.
 */
export function normalizeComments(
  views: Raw[] | undefined,
  origin: string,
): CommentNode[] {
  const tag = hostTag(hostOf(origin));
  const list = Array.isArray(views) ? views : [];
  const nodes = new Map<number, { node: CommentNode; parent: number; total: number }>();
  for (const view of list) {
    const c: Raw = view?.comment ?? {};
    const path = String(c.path ?? "").split(".").map(Number);
    const parent = path.length > 2 ? path[path.length - 2]! : 0;
    const body = c.deleted ? "[deleted]" : c.removed ? "[removed]" : String(c.content ?? "");
    nodes.set(num(c.id), {
      parent,
      total: num(view?.counts?.child_count),
      node: {
        id: commentId(c.id, tag),
        parentId: parent ? commentId(parent, tag) : postId(c.post_id, tag),
        author: personName(view?.creator),
        body,
        score: num(view?.counts?.score),
        createdAt: time(c.published),
        edited: Boolean(c.updated),
        stickied: false,
        locked: Boolean(view?.post?.locked),
        isSubmitter:
          view?.creator?.id !== undefined && view?.creator?.id === view?.post?.creator_id,
        permalink: new URL(`/comment/${num(c.id)}`, origin).href,
        replies: [],
        moreReplies: false,
        ...vote(view?.my_vote),
        ...(c.distinguished ? { distinguished: "moderator" as const } : {}),
        ...(c.deleted ? { removed: "author" as const } : c.removed ? { removed: "mods" as const } : {}),
      },
    });
  }
  const roots: CommentNode[] = [];
  for (const { node, parent } of nodes.values()) {
    const owner = nodes.get(parent);
    if (owner) owner.node.replies.push(node);
    else roots.push(node);
  }
  // Lemmy counts every descendant; compare with how many arrived.
  const loaded = (node: CommentNode): number =>
    node.replies.reduce((sum, reply) => sum + 1 + loaded(reply), 0);
  for (const { node, total } of nodes.values())
    node.moreReplies = total > loaded(node);
  return roots;
}

/** A `CommunityView` as a community, for lists and search. */
export function normalizeCommunity(view: Raw): Community | null {
  const c: Raw = view?.community ?? {};
  const name = communityName(c);
  if (!name) return null;
  const icon = safeUrl(c.icon);
  return {
    name,
    ...(icon ? { icon } : {}),
    ...(typeof view?.counts?.subscribers === "number"
      ? { subscribers: view.counts.subscribers }
      : {}),
    nsfw: Boolean(c.nsfw),
    ...(typeof view?.subscribed === "string"
      ? { subscribed: view.subscribed === "Subscribed" }
      : {}),
  };
}

/** `/api/v3/community` as the community header and sidebar. */
export function normalizeAbout(data: Raw, fallback: string): AboutResponse {
  const view: Raw = data?.community_view ?? {};
  const c: Raw = view.community ?? {};
  const icon = safeUrl(c.icon);
  const banner = safeUrl(c.banner);
  const sidebar = typeof c.description === "string" ? c.description : "";
  return {
    about: {
      name: communityName(c) || fallback,
      ...(icon ? { icon } : {}),
      ...(banner ? { banner } : {}),
      ...(sidebar ? { sidebar } : {}),
      ...(typeof view.subscribed === "string"
        ? { subscribed: view.subscribed === "Subscribed" }
        : {}),
      title: String(c.title || c.name || fallback),
      // The sidebar's first paragraph, as Reddit's short description.
      description: sidebar.split(/\n\s*\n/)[0]!.slice(0, 500),
      subscribers: num(view.counts?.subscribers),
      active: num(view.counts?.users_active_day),
      nsfw: Boolean(c.nsfw),
      createdAt: time(c.published),
    },
  };
}

export function normalizeModerators(data: Raw): Moderator[] {
  return Array.isArray(data?.moderators)
    ? data.moderators.map((m: Raw) => ({
        name: personName(m?.moderator),
        since: 0,
        permissions: [],
      }))
    : [];
}

/** The signed-in person from `/api/v3/site`, or null when signed out. */
export function normalizeAccount(site: Raw, unread?: Raw): Account | null {
  const person: Raw | undefined = site?.my_user?.local_user_view?.person;
  const name = String(person?.name ?? "");
  if (!name) return null;
  const icon = safeUrl(person?.avatar);
  const count =
    num(unread?.replies) + num(unread?.mentions) + num(unread?.private_messages);
  return {
    name,
    ...(icon ? { icon } : {}),
    ...(Array.isArray(site.my_user.moderates) && site.my_user.moderates.length
      ? { isMod: true }
      : {}),
    ...(count > 0 ? { inboxCount: count } : {}),
  };
}

/** The communities the signed-in person follows, from `/api/v3/site`. */
export function normalizeFollows(site: Raw): Community[] {
  const follows = site?.my_user?.follows;
  return Array.isArray(follows)
    ? follows
        .map((f: Raw) => normalizeCommunity({ community: f?.community }))
        .filter((c): c is Community => Boolean(c))
    : [];
}

/** `/api/v3/user` as a profile header. Lemmy 0.19 keeps no scores. */
export function normalizeUser(data: Raw): UserAbout | null {
  const view: Raw = data?.person_view ?? {};
  const name = personName(view.person);
  if (!view.person) return null;
  const icon = safeUrl(view.person.avatar);
  return {
    name,
    ...(icon ? { icon } : {}),
    linkKarma: num(view.counts?.post_count),
    commentKarma: num(view.counts?.comment_count),
    createdAt: time(view.person.published),
    isFriend: false,
    suspended: Boolean(view.person.banned),
  };
}

/** A profile's posts and comments (`/api/v3/user`), newest first. */
export function normalizeUserListing(data: Raw, origin: string): ListingItem[] {
  const tag = hostTag(hostOf(origin));
  const posts: ListingItem[] = (Array.isArray(data?.posts) ? data.posts : []).map(
    (view: Raw) => ({ type: "post" as const, post: normalizePost(view, origin) }),
  );
  const comments: ListingItem[] = (Array.isArray(data?.comments) ? data.comments : []).map(
    (view: Raw) => ({
      type: "comment" as const,
      comment: {
        id: commentId(view?.comment?.id, tag),
        author: personName(view?.creator),
        body: String(view?.comment?.content ?? ""),
        score: num(view?.counts?.score),
        createdAt: time(view?.comment?.published),
        subreddit: communityName(view?.community),
        postId: postId(view?.post?.id, tag),
        postTitle: String(view?.post?.name ?? ""),
        permalink: new URL(`/comment/${num(view?.comment?.id)}`, origin).href,
        ...vote(view?.my_vote),
      },
    }),
  );
  const at = (item: ListingItem) =>
    item.type === "post" ? item.post.createdAt : item.comment.createdAt;
  return [...posts, ...comments].sort((a, b) => at(b) - at(a));
}

// -- sorts

const TOP: Record<Timeframe, string> = {
  hour: "TopHour",
  day: "TopDay",
  week: "TopWeek",
  month: "TopMonth",
  year: "TopYear",
  all: "TopAll",
};
/** Reddit's feed sorts in Lemmy's terms; Rising is Lemmy's Active. */
export function feedSort(sort: FeedSort, t: Timeframe): string {
  if (sort === "top") return TOP[t] ?? "TopDay";
  return { hot: "Hot", new: "New", rising: "Active", controversial: "Controversial" }[sort];
}
export const commentSort = (sort: CommentSort): string =>
  ({ confidence: "Hot", top: "Top", new: "New", controversial: "Controversial", old: "Old", qa: "Old" })[sort] ?? "Hot";
export const searchSort = (sort: SearchSort): string =>
  ({ relevance: "TopAll", hot: "Hot", top: "TopAll", new: "New", comments: "MostComments" })[sort] ?? "TopAll";

// -- pages and API paths

/** The feeds that aren't communities: Home is the viewer's default listing. */
export const LEMMY_FEEDS = ["All", "Local"];
const COMMUNITY = /^[a-z0-9_]{1,50}(?:@[a-z0-9.-]{1,253})?$/i;
export const isCommunityName = (name: string) => COMMUNITY.test(name);

/**
 * The reader's starting point for a lemmy-ui page: the front page, a
 * community (`/c/name`, `/c/name@host`), a post (`/post/123`) or a search.
 * Anything else (settings, profiles, sign-in) stays lemmy-ui's.
 */
export function parseRoute(href: string): PageRoute | null {
  const url = new URL(href);
  const parts = url.pathname.split("/").filter(Boolean);
  const timeframe: Timeframe = "day";
  if (!parts.length)
    return { sub: "Home", sort: "hot", timeframe };
  if (parts[0] === "c" && parts.length === 2 && isCommunityName(parts[1]!))
    return { sub: parts[1]!, sort: "hot", timeframe };
  if (parts[0] === "post" && parts.length === 2 && /^\d{1,12}$/.test(parts[1]!))
    return {
      sub: "Home",
      sort: "hot",
      timeframe,
      postId: postId(parts[1], hostTag(url.hostname)),
    };
  if (parts[0] === "search" && parts.length === 1)
    return {
      sub: "Home",
      sort: "hot",
      timeframe,
      query: url.searchParams.get("q") ?? "",
      searchSort: "relevance",
    };
  return null;
}

/** Read-only API routes the page may fetch for the reader. */
const READ_ROUTES = [
  "/api/v3/site",
  "/api/v3/post",
  "/api/v3/post/list",
  "/api/v3/comment",
  "/api/v3/comment/list",
  "/api/v3/community",
  "/api/v3/search",
  "/api/v3/user",
  "/api/v3/user/unread_count",
];
export function allowedApiPath(path: unknown): path is string {
  if (
    typeof path !== "string" ||
    path.length > 2000 ||
    !path.startsWith("/") ||
    path.startsWith("//")
  )
    return false;
  const url = new URL(path, "https://lemmy.invalid");
  return url.origin === "https://lemmy.invalid" && READ_ROUTES.includes(url.pathname);
}
