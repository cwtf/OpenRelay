import type {
  CommentNode,
  PostDetail,
  PostMedia,
  FeedSort,
  Timeframe,
} from "../shared/api.ts";

type Raw = Record<string, any>;
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
  if (video && safeUrl(video.fallback_url)) {
    media = {
      kind: "video",
      video: {
        mp4: safeUrl(video.fallback_url),
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
  return {
    id: String(p.name ?? "t3_" + p.id),
    title: String(p.title ?? "Untitled"),
    author: String(p.author ?? "[deleted]"),
    subreddit: String(p.subreddit ?? ""),
    permalink:
      safeUrl(p.permalink) ||
      "https://www.reddit.com/comments/" + String(p.id ?? ""),
    url,
    domain: String(p.domain ?? ""),
    createdAt: num(p.created_utc) * 1000,
    score: num(p.score),
    comments: num(p.num_comments),
    nsfw: Boolean(p.over_18),
    spoiler: Boolean(p.spoiler),
    stickied: Boolean(p.stickied),
    locked: Boolean(p.locked),
    archived: Boolean(p.archived),
    edited: Boolean(p.edited),
    crosspost: Boolean(p.crosspost_parent),
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
    ...(thumb ? { thumb } : {}),
    media,
  };
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
          ...(["moderator", "admin"].includes(c.distinguished)
            ? { distinguished: c.distinguished }
            : {}),
        };
      }),
  };
}
export type PageRoute = {
  sub: string;
  sort: FeedSort;
  timeframe: Timeframe;
  postId?: string;
  commentSort?: string;
  query?: string;
  searchSort?: string;
};
export function parseRoute(href: string): PageRoute | null {
  const url = new URL(href);
  if (
    !["www.reddit.com", "old.reddit.com", "reddit.com"].includes(url.hostname)
  )
    return null;
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
  return /^\/(?:r\/[\w+]+\/)?(?:(?:hot|best|new|top|rising|controversial|search|about)\.json|comments\/[a-z0-9]+\.json)$/i.test(
    url.pathname,
  );
}
