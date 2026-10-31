import type {
  Account,
  Community,
  CommentNode,
  Friend,
  InboxItem,
  ListingComment,
  ListingItem,
  ModInfo,
  Moderator,
  SubredditRule,
  UserAbout,
  PostDetail,
  PostMedia,
  Removal,
  FeedSort,
  InlineMedia,
  PageRoute,
  Timeframe,
} from "../../shared/api.ts";
import { providerOf } from "../hosts.ts";

type Raw = Record<string, any>;
/** Reddit's `likes`: true up, false down, null none; absent when signed out. */
const viewerVote = (likes: unknown) =>
  likes === true
    ? { vote: 1 as const }
    : likes === false
      ? { vote: -1 as const }
      : likes === null
        ? { vote: 0 as const }
        : {};
export const safeUrl = (
  value: unknown,
  base = "https://www.reddit.com",
): string => {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value.replaceAll("&amp;", "&"), base);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
const image = (v: Raw | undefined) => {
  const url = safeUrl(v?.url ?? v?.u);
  return url
    ? {
        url,
        width: num(v?.width ?? v?.x) || 640,
        height: num(v?.height ?? v?.y) || 480,
      }
    : undefined;
};
export function normalizePost(p: Raw): PostDetail {
  const preview = image(p.preview?.images?.[0]?.source);
  const thumbUrl =
    typeof p.thumbnail === "string" && /^https?:/.test(p.thumbnail)
      ? safeUrl(p.thumbnail)
      : "";
  const thumb =
    preview ??
    (thumbUrl
      ? {
          url: thumbUrl,
          width: num(p.thumbnail_width) || 140,
          height: num(p.thumbnail_height) || 140,
        }
      : undefined);
  const url = safeUrl(p.url_overridden_by_dest ?? p.url);
  let media: PostMedia = p.is_self
    ? { kind: "self" }
    : {
        kind: "link",
        url,
        domain: String(p.domain ?? ""),
        ...(preview ? { poster: preview } : {}),
      };
  const video =
    p.secure_media?.reddit_video ??
    p.media?.reddit_video ??
    p.preview?.reddit_video_preview;
  const gallery = (p.gallery_data?.items ?? [])
    .map((item: Raw) => image(p.media_metadata?.[item.media_id]?.s))
    .filter(Boolean);
  const mp4 = safeUrl(video?.fallback_url);
  const hls = safeUrl(video?.hls_url);
  if (video && (mp4 || hls)) {
    media = {
      kind: "video",
      video: {
        ...(mp4 ? { mp4 } : {}),
        ...(hls ? { hls } : {}),
        width: num(video.width) || 640,
        height: num(video.height) || 360,
        isGif: Boolean(video.is_gif),
      },
      ...(preview ? { poster: preview } : {}),
    };
  } else if (gallery.length) media = { kind: "gallery", items: gallery };
  else if (
    p.post_hint === "image" ||
    /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url)
  ) {
    const source =
      preview ?? (url ? { url, width: 640, height: 480 } : undefined);
    if (source)
      media = {
        kind: "image",
        image: source,
        animated: /\.gif(\?|$)/i.test(url),
      };
  } else if (p.poll_data?.options)
    media = {
      kind: "poll",
      choices: p.poll_data.options.map((o: Raw) => ({
        text: String(o.text ?? ""),
        votes: num(o.vote_count),
      })),
      totalVotes: num(p.poll_data.total_vote_count),
    };
  const parentRaw = Array.isArray(p.crosspost_parent_list)
    ? p.crosspost_parent_list[0]
    : undefined;
  const parent =
    parentRaw && typeof parentRaw === "object"
      ? normalizePost(parentRaw)
      : undefined;
  let ownUrl = url;
  // Relay's crosspost rules: a crosspost of a self post opens as a self post
  // at its own permalink, and it takes the original's gallery. Relay plays a
  // crossposted v.redd.it link in its own player; a crosspost carries no
  // video data of its own, so the reader takes the original's video (and
  // poll) the same way.
  if (parent?.media.kind === "self") {
    media = { kind: "self" };
    ownUrl = safeUrl(p.permalink) || parent.permalink;
  } else if (parent && media.kind === "link" && parent.media.kind !== "link")
    media = parent.media;
  const shownThumb = thumb ?? parent?.thumb;
  return {
    id: String(p.name ?? "t3_" + p.id),
    title: String(p.title ?? "Untitled"),
    author: String(p.author ?? "[deleted]"),
    subreddit: String(p.subreddit ?? ""),
    permalink:
      safeUrl(p.permalink) ||
      "https://www.reddit.com/comments/" + String(p.id ?? ""),
    url: ownUrl,
    domain: String(p.domain || parent?.domain || ""),
    createdAt: num(p.created_utc) * 1000,
    score: num(p.score),
    comments: num(p.num_comments),
    nsfw: Boolean(p.over_18),
    spoiler: Boolean(p.spoiler),
    stickied: Boolean(p.stickied),
    locked: Boolean(p.locked),
    archived: Boolean(p.archived),
    edited: Boolean(p.edited),
    crosspost: Boolean(p.crosspost_parent || parent),
    ...(parent ? { crosspostParent: parent } : {}),
    body: String(p.selftext ?? ""),
    excerpt: String(p.selftext ?? "").slice(0, 280),
    ...(p.link_flair_text
      ? {
          flair: {
            text: String(p.link_flair_text),
            background: String(p.link_flair_background_color ?? ""),
          },
        }
      : {}),
    ...(shownThumb ? { thumb: shownThumb } : {}),
    ...viewerVote(p.likes),
    ...(typeof p.saved === "boolean" ? { saved: p.saved } : {}),
    ...modInfo(p),
    ...removal(p.removed_by_category, p.selftext),
    media,
  };
}
const REMOVED_BY: Record<string, Removal> = {
  moderator: "mods",
  automod_filtered: "mods",
  community_ops: "mods",
  deleted: "author",
  author: "author",
};
/**
 * Who removed a post or comment. Posts carry `removed_by_category`; any other
 * category (`reddit`, `anti_evil_ops`, `content_takedown`, …) is Reddit's own.
 * Comments only show Reddit's placeholder body.
 */
function removal(category: unknown, text: unknown): { removed?: Removal } {
  if (typeof category === "string" && category)
    return { removed: REMOVED_BY[category] ?? "reddit" };
  return text === "[removed]"
    ? { removed: "mods" }
    : text === "[deleted]"
      ? { removed: "author" }
      : {};
}
/**
 * Media a comment body refers to by ID (`![gif](giphy|<id>)`, `![img](<id>)`),
 * from the comment's `media_metadata`. Only entries the body uses are kept.
 */
function inlineMedia(c: Raw): { media?: Record<string, InlineMedia> } {
  const meta = c.media_metadata;
  const body = String(c.body ?? "");
  if (!meta || typeof meta !== "object") return {};
  const media: Record<string, InlineMedia> = {};
  for (const [id, entry] of Object.entries(meta as Raw)) {
    if (!body.includes(`(${id}`)) continue;
    if (entry?.e !== "Image" && entry?.e !== "AnimatedImage") continue;
    const url = safeUrl(entry.s?.gif ?? entry.s?.u);
    if (!url) continue;
    const mp4 = safeUrl(entry.s?.mp4);
    media[id] = {
      url,
      width: num(entry.s?.x) || 240,
      height: num(entry.s?.y) || 240,
      ...(mp4 ? { mp4 } : {}),
    };
  }
  return Object.keys(media).length ? { media } : {};
}
/** Reports and approval state, present only for moderators. */
function modInfo(t: Raw): { mod?: ModInfo } {
  const reports: string[] = [];
  for (const [reason, mod] of Array.isArray(t.mod_reports) ? t.mod_reports : [])
    reports.push(`u/${String(mod ?? "mod")}: ${String(reason ?? "")}`);
  for (const [reason, count] of Array.isArray(t.user_reports) ? t.user_reports : [])
    reports.push(`${num(count) || 1}: ${String(reason ?? "")}`);
  const state = t.spam
    ? "spam"
    : t.removed || t.banned_by
      ? "removed"
      : t.approved || t.approved_by
        ? "approved"
        : undefined;
  return reports.length || state
    ? { mod: { reports, ...(state ? { state } : {}) } }
    : {};
}
const NAME = /^[\w-]{3,20}$/;
const fullname = (value: unknown, prefix: string) =>
  typeof value === "string" && /^t\d_[a-z0-9]+$/i.test(value)
    ? value
    : prefix + String(value ?? "");
export function normalizeListingComment(c: Raw): ListingComment {
  return {
    id: fullname(c.name ?? c.id, "t1_"),
    author: String(c.author ?? "[deleted]"),
    body: String(c.body ?? ""),
    score: num(c.score),
    createdAt: num(c.created_utc) * 1000,
    subreddit: String(c.subreddit ?? ""),
    postId: fullname(c.link_id, "t3_"),
    postTitle: String(c.link_title ?? ""),
    permalink: safeUrl(c.permalink),
    ...viewerVote(c.likes),
    ...modInfo(c),
    ...inlineMedia(c),
  };
}
/** Posts and comments from profile and moderator listings. */
export function normalizeListing(children: unknown): ListingItem[] {
  if (!Array.isArray(children)) return [];
  return children.flatMap((child: Raw): ListingItem[] =>
    child?.kind === "t3"
      ? [{ type: "post", post: normalizePost(child.data) }]
      : child?.kind === "t1"
        ? [{ type: "comment", comment: normalizeListingComment(child.data) }]
        : [],
  );
}
export function normalizeInbox(children: unknown): InboxItem[] {
  if (!Array.isArray(children)) return [];
  return children.flatMap((child: Raw): InboxItem[] => {
    const d = child?.data;
    if (!d || (child.kind !== "t4" && child.kind !== "t1")) return [];
    const kind =
      child.kind === "t4"
        ? d.subreddit && !d.author
          ? "mod_message"
          : d.distinguished === "moderator" && d.subreddit
            ? "mod_message"
            : "message"
        : d.type === "post_reply"
          ? "post_reply"
          : d.type === "username_mention"
            ? "mention"
            : "comment_reply";
    const replies = d.replies?.data?.children;
    return [
      {
        id: fullname(d.name ?? d.id, child.kind + "_"),
        kind,
        subject:
          child.kind === "t1"
            ? String(d.link_title ?? d.subject ?? "")
            : String(d.subject ?? ""),
        body: String(d.body ?? ""),
        author: String(d.author ?? (d.subreddit ? `r/${d.subreddit}` : "[deleted]")),
        recipient: String(d.dest ?? ""),
        createdAt: num(d.created_utc) * 1000,
        unread: Boolean(d.new),
        ...(d.subreddit ? { subreddit: String(d.subreddit) } : {}),
        ...(child.kind === "t1" && d.link_id
          ? { postId: fullname(d.link_id, "t3_") }
          : child.kind === "t1" && typeof d.context === "string"
            ? {
                postId:
                  "t3_" + (d.context.match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? ""),
              }
            : {}),
        ...(typeof d.context === "string" && d.context
          ? { context: safeUrl(d.context) }
          : {}),
        replies: Array.isArray(replies) ? replies.length : 0,
      },
    ];
  });
}
export function normalizeUserAbout(raw: Raw): UserAbout | null {
  const d = raw?.data;
  const name = String(d?.name ?? "");
  if (!NAME.test(name)) return null;
  const icon = safeUrl(d.snoovatar_img) || safeUrl(d.icon_img);
  return {
    name,
    ...(icon ? { icon } : {}),
    linkKarma: num(d.link_karma),
    commentKarma: num(d.comment_karma),
    createdAt: num(d.created_utc) * 1000,
    isFriend: Boolean(d.is_friend),
    suspended: Boolean(d.is_suspended),
  };
}
/** `/prefs/friends.json` returns one or more `UserList` listings. */
export function normalizeFriends(raw: unknown): Friend[] {
  const lists = Array.isArray(raw) ? raw : [raw];
  const list = lists.find((entry: Raw) => entry?.kind === "UserList") ?? lists[0];
  const children = (list as Raw)?.data?.children;
  if (!Array.isArray(children)) return [];
  return children
    .filter((f: Raw) => NAME.test(String(f?.name ?? "")))
    .map((f: Raw) => ({ name: String(f.name), addedAt: num(f.date) * 1000 }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
export function normalizeModerators(raw: Raw): Moderator[] {
  const children = raw?.data?.children;
  return Array.isArray(children)
    ? children
        .filter((m: Raw) => NAME.test(String(m?.name ?? "")))
        .map((m: Raw) => ({
          name: String(m.name),
          since: num(m.date) * 1000,
          permissions: Array.isArray(m.mod_permissions)
            ? m.mod_permissions.map(String)
            : [],
        }))
    : [];
}
export function normalizeRules(raw: Raw): SubredditRule[] {
  return Array.isArray(raw?.rules)
    ? raw.rules.map((r: Raw) => ({
        title: String(r.short_name ?? ""),
        description: String(r.description ?? ""),
      }))
    : [];
}
export function normalizeComments(children: Raw[] = []): {
  comments: CommentNode[];
  more: boolean;
} {
  return {
    more: children.some((c) => c.kind === "more"),
    comments: children
      .filter((c) => c.kind === "t1")
      .map(({ data: c }) => {
        const nested = normalizeComments(c.replies?.data?.children ?? []);
        return {
          id: String(c.name ?? "t1_" + c.id),
          parentId: String(c.parent_id ?? ""),
          author: String(c.author ?? "[deleted]"),
          body: String(c.body ?? ""),
          score: num(c.score),
          createdAt: num(c.created_utc) * 1000,
          edited: Boolean(c.edited),
          stickied: Boolean(c.stickied),
          locked: Boolean(c.locked),
          isSubmitter: Boolean(c.is_submitter),
          permalink: safeUrl(c.permalink),
          replies: nested.comments,
          moreReplies: nested.more,
          ...viewerVote(c.likes),
          ...inlineMedia(c),
          ...(["moderator", "admin"].includes(c.distinguished)
            ? { distinguished: c.distinguished }
            : {}),
          ...removal(undefined, c.body),
        };
      }),
  };
}
/** Normalize a `t5` subreddit from a subscription listing; skips user profiles. */
export function normalizeCommunity(s: Raw): Community | null {
  const name = String(s?.display_name ?? "");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/.test(name) ||
    s.subreddit_type === "user" ||
    name.startsWith("u_")
  )
    return null;
  const icon = safeUrl(s.community_icon) || safeUrl(s.icon_img);
  const color = [s.primary_color, s.key_color].find(
    (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value),
  );
  return {
    name,
    ...(icon ? { icon } : {}),
    ...(color ? { color } : {}),
    ...(typeof s.subscribers === "number" ? { subscribers: s.subscribers } : {}),
    nsfw: Boolean(s.over18),
    ...(typeof s.user_is_subscriber === "boolean"
      ? { subscribed: s.user_is_subscriber }
      : {}),
  };
}
/** Name and profile picture from `/api/me.json`; null when signed out. */
export function normalizeAccount(me: Raw): Account | null {
  const d = me?.data;
  const name = String(d?.name ?? "");
  if (!/^[\w-]{3,20}$/.test(name)) return null;
  const icon = safeUrl(d.icon_img) || safeUrl(d.snoovatar_img);
  const unread = num(d.inbox_count);
  return {
    name,
    ...(icon ? { icon } : {}),
    ...(d.is_mod === true ? { isMod: true } : {}),
    ...(unread > 0 ? { inboxCount: Math.floor(unread) } : {}),
  };
}
export function parseRoute(href: string): PageRoute | null {
  if (providerOf(href) !== "reddit") return null;
  const url = new URL(href);
  const parts = url.pathname.split("/").filter(Boolean);
  let sub = "Home";
  if (parts[0] === "r" && /^[\w+]+$/.test(parts[1] ?? "")) {
    sub = parts[1]!;
    parts.splice(0, 2);
  }
  const allowed: FeedSort[] = ["hot", "new", "top", "rising", "controversial"];
  const times: Timeframe[] = ["hour", "day", "week", "month", "year", "all"];
  const timeframe = times.includes(url.searchParams.get("t") as Timeframe)
    ? (url.searchParams.get("t") as Timeframe)
    : "day";
  if (parts[0] === "comments" && /^[a-z0-9]+$/i.test(parts[1] ?? ""))
    return {
      sub,
      sort: "hot",
      timeframe,
      postId: "t3_" + parts[1],
      commentSort: url.searchParams.get("sort") ?? undefined,
    };
  if (parts[0] === "search" && parts.length === 1)
    return {
      sub,
      sort: "hot",
      timeframe,
      query: url.searchParams.get("q") ?? "",
      searchSort: url.searchParams.get("sort") ?? "relevance",
    };
  if (
    parts.length > 1 ||
    (parts[0] && parts[0] !== "best" && !allowed.includes(parts[0] as FeedSort))
  )
    return null;
  return {
    sub,
    sort: allowed.includes(parts[0] as FeedSort)
      ? (parts[0] as FeedSort)
      : "hot",
    timeframe,
  };
}
/** Read-only listings the reader may request through the page bridge. */
const READ_ROUTES = [
  /^\/(?:r\/[\w+]+\/)?(?:(?:hot|best|new|top|rising|controversial|search|about)\.json|comments\/[a-z0-9]+\.json)$/i,
  /^\/subreddits\/mine\/(?:subscriber|moderator)\.json$/i,
  /^\/user\/[\w-]{3,20}\/(?:about|overview|comments|submitted|upvoted|downvoted|hidden|saved)\.json$/i,
  /^\/message\/(?:inbox|unread|messages|comments|selfreply|sent|mentions|moderator|moderator\/unread)\.json$/i,
  /^\/r\/[\w+]+\/about\/(?:modqueue|reports|spam|edited|unmoderated|rules|moderators)\.json$/i,
  /^\/r\/\w+\/wiki\/index\.json$/i,
  // Community search while typing (Relay's autocomplete), with a fallback.
  /^\/api\/subreddit_autocomplete_v2\.json$/i,
  /^\/subreddits\/search\.json$/i,
  /^\/prefs\/friends\.json$/i,
  // Posts found by the HTML search when Reddit refuses /search.json.
  /^\/api\/info\.json$/i,
];
export function allowedJsonPath(path: unknown): path is string {
  if (
    typeof path !== "string" ||
    path.length > 3000 ||
    !path.startsWith("/") ||
    path.startsWith("//")
  )
    return false;
  const url = new URL(path, "https://www.reddit.com");
  if (url.origin !== "https://www.reddit.com") return false;
  return READ_ROUTES.some((route) => route.test(url.pathname));
}
