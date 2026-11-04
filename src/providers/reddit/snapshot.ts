import { normalizePost, normalizeComments, safeUrl } from "./reddit";
import { allowedHtmlPath, htmlToMarkdown, type MoreComments } from "./shreddit";
import type { PostDetail, CommentNode } from "../../shared/api";

export type Snapshot = { posts: PostDetail[]; comments: CommentNode[] };
/** A page of new Reddit's HTML, and where to load the comments it left out. */
export type HtmlPage = Snapshot & { more: MoreComments[] };

type Raw = Record<string, unknown>;
const time = (value: string | null | undefined) => (Date.parse(value || "") || Date.now()) / 1000;
/** What `el` holds itself, not a post or comment nested in it. */
const own = (el: Element, selector: string): Element[] =>
  Array.from(el.querySelectorAll(selector)).filter(
    (found) => found.parentElement?.closest(el.localName) === el,
  );
/** A body slot as Reddit Markdown: Reddit renders it as HTML from its richtext. */
const bodyOf = (slot: Element | undefined, post: string) =>
  slot ? htmlToMarkdown(slot, post) : undefined;
/** The widest picture a `srcset` offers, else `src`. */
function picture(img: Element) {
  let url = img.getAttribute("src") || img.getAttribute("data-lazy-src") || "";
  let widest = 0;
  for (const entry of (img.getAttribute("srcset") || img.getAttribute("data-lazy-srcset") || "").split(",")) {
    const [src, size] = entry.trim().split(/\s+/);
    const width = parseInt(size ?? "", 10);
    if (src && width > widest) [url, widest] = [src, width];
  }
  const width = Number(img.getAttribute("width"));
  const height = Number(img.getAttribute("height"));
  return { url, ...(width && height ? { width, height } : {}) };
}

/** A post's text; a feed wraps its preview in a link to the post. */
function textBody(el: Element, permalink: string): Element | undefined {
  const slot = own(el, '[slot="text-body"]')[0];
  const link = slot?.querySelector("a[href]");
  return link &&
    safeUrl(link.getAttribute("href")) === safeUrl(permalink) &&
    link.textContent?.trim() === slot!.textContent?.trim()
    ? link
    : slot;
}

/** A `<shreddit-post>` as Reddit's JSON describes a post. */
function shredditPost(el: Element): Raw | null {
  const attr = (name: string) => el.getAttribute(name) ?? "";
  const id = attr("id");
  if (!/^t3_[a-z0-9]+$/i.test(id) || el.hasAttribute("promoted")) return null;
  const title = attr("post-title") || el.querySelector('[slot="title"]')?.textContent?.trim();
  if (!title) return null;
  const type = attr("post-type");
  const permalink = attr("permalink");
  const raw: Raw = {
    name: id,
    id: id.slice(3),
    title,
    author: attr("author"),
    subreddit: attr("subreddit-name") || attr("subreddit-prefixed-name").replace(/^r\//, ""),
    permalink,
    url: attr("content-href") || permalink,
    domain: attr("domain"),
    created_utc: time(attr("created-timestamp") || el.querySelector("time")?.getAttribute("datetime")),
    score: Number(attr("score")),
    num_comments: Number(attr("comment-count")),
    is_self: type === "text",
    selftext: bodyOf(textBody(el, permalink), id),
    over_18: el.hasAttribute("nsfw"),
    spoiler: el.hasAttribute("spoiler"),
    post_hint: type === "image" ? "image" : undefined,
  };
  const flair = own(el, "shreddit-post-flair")[0]?.textContent?.replace(/\s+/g, " ").trim();
  if (flair) raw.link_flair_text = flair;
  // Media pictures are labelled "r/<community> - <title>"; avatars and
  // blurred backdrops aren't.
  const shown =
    own(el, "img[data-post-media-primary]")[0] ??
    own(el, "img").find((img) => /^r\/\w+ - /.test(img.getAttribute("alt") ?? ""));
  const player = own(el, "shreddit-player, shreddit-player-2")[0];
  const poster = player?.getAttribute("poster");
  const preview = poster ? { url: poster } : shown && picture(shown);
  if (preview?.url) raw.preview = { images: [{ source: preview }] };
  const hls = player?.getAttribute("src");
  if (hls) raw.media = { reddit_video: { hls_url: hls } };
  const slides = own(el, "gallery-carousel li").flatMap((slide) => {
    const sized = slide.querySelector("img[width]");
    const full = slide.querySelector("zoomable-img img") ?? sized;
    const url = full && (full.getAttribute("src") || full.getAttribute("data-lazy-src"));
    return url
      ? [{ u: url, x: Number(sized?.getAttribute("width")), y: Number(sized?.getAttribute("height")) }]
      : [];
  });
  if (slides.length) {
    raw.gallery_data = { items: slides.map((_, i) => ({ media_id: String(i) })) };
    raw.media_metadata = Object.fromEntries(slides.map((s, i) => [String(i), { s }]));
  }
  return raw;
}

/** An old Reddit `.thing.link`. */
function oldRedditPost(el: Element): Raw | null {
  const attr = (name: string) => el.getAttribute(name) ?? "";
  const id = attr("data-fullname");
  if (!/^t3_[a-z0-9]+$/i.test(id)) return null;
  const title = el.querySelector("a.title")?.textContent?.trim();
  if (!title) return null;
  const img = el.querySelector<HTMLImageElement>(
    "img.preview-img, .thumbnail img, img.media-lightbox-img",
  );
  const permalink =
    attr("data-permalink") || el.querySelector<HTMLAnchorElement>("a.comments")?.href;
  return {
    name: id,
    id: id.slice(3),
    title,
    author: attr("data-author"),
    subreddit: attr("data-subreddit"),
    permalink,
    url: attr("data-url") || permalink,
    domain: attr("data-domain"),
    created_utc: time(el.querySelector("time")?.getAttribute("datetime")),
    score: Number(attr("data-score")),
    num_comments: Number(attr("data-comments-count")),
    is_self: el.classList.contains("self"),
    selftext: el.querySelector(".usertext-body .md")?.textContent?.trim(),
    over_18: el.classList.contains("over18"),
    spoiler: el.classList.contains("spoiler"),
    thumbnail: img?.src,
    preview: img
      ? {
          images: [
            {
              source: {
                url: img.src,
                width: img.naturalWidth || 640,
                height: img.naturalHeight || 480,
              },
            },
          ],
        }
      : undefined,
  };
}

/** A `<shreddit-comment>` or old Reddit `.thing.comment`, as Reddit's JSON describes it. */
function comment(el: Element, postId: string): Raw | null {
  const attr = (name: string) => el.getAttribute(name);
  const id = attr("thingid") || attr("data-fullname") || "";
  if (!/^t1_[a-z0-9]+$/i.test(id)) return null;
  const parentEl = el.parentElement?.closest("shreddit-comment, .thing.comment");
  const author = attr("author") || attr("data-author");
  const slot = own(el, '[slot="comment"]')[0];
  return {
    name: id,
    parent_id:
      attr("parentid") ||
      parentEl?.getAttribute("thingid") ||
      parentEl?.getAttribute("data-fullname") ||
      attr("postid") ||
      postId,
    author,
    body: slot
      ? bodyOf(slot, attr("postid") || postId)
      : el.querySelector(":scope > .entry .usertext-body .md")?.textContent?.trim() ||
        (author ? "" : "[deleted]"),
    score: Number(attr("score") || attr("data-score")),
    // Old Reddit writes "[score hidden]" in place of the score.
    score_hidden: Boolean(el.querySelector(":scope > .entry .score-hidden")),
    created_utc: time(attr("created") || el.querySelector("time")?.getAttribute("datetime")),
    permalink:
      safeUrl(attr("permalink") || el.querySelector<HTMLAnchorElement>("a.bylink")?.href) ||
      "",
    is_submitter: el.hasAttribute("is-op"),
  };
}

/** Where to load the comments a page of new Reddit's HTML left out. */
function moreComments(doc: Document): MoreComments[] {
  const found: MoreComments[] = [];
  for (const el of doc.querySelectorAll('faceplate-partial[src*="/more-comments/"]')) {
    const path = el.getAttribute("src");
    const cursor = el.querySelector('input[name="cursor"]')?.getAttribute("value");
    if (allowedHtmlPath(path, cursor ?? ""))
      found.push({
        parent: el.closest("shreddit-comment")?.getAttribute("thingid") ?? "",
        path,
        cursor: cursor!,
      });
  }
  return found;
}

/**
 * A page or piece Reddit sent, read away from the page: Reddit's own script
 * would first unpack the posts and comments it defers into `<template>`s.
 */
export function readHtmlPage(doc: Document): HtmlPage {
  for (let round = 0; round < 5; round++) {
    const deferred = Array.from(doc.querySelectorAll("template")).filter((t) =>
      t.content.querySelector(
        'shreddit-post, shreddit-comment, faceplate-partial[src*="/more-comments/"]',
      ),
    );
    if (!deferred.length) break;
    for (const t of deferred) t.replaceWith(t.content);
  }
  return readSnapshot(doc);
}

/** The posts and comment tree on a page. */
export function readSnapshot(doc: Document): HtmlPage {
  const posts: PostDetail[] = [];
  const seen = new Set<string>();
  for (const el of doc.querySelectorAll("shreddit-post, .thing.link")) {
    const raw = el.localName === "shreddit-post" ? shredditPost(el) : oldRedditPost(el);
    if (!raw || seen.has(String(raw.name))) continue;
    seen.add(String(raw.name));
    posts.push(normalizePost(raw));
  }
  const more = moreComments(doc);
  const withMore = new Set(more.map((m) => m.parent));
  const comments: CommentNode[] = [];
  const byId = new Map<string, CommentNode>();
  for (const el of doc.querySelectorAll("shreddit-comment, .thing.comment")) {
    const raw = comment(el, posts[0]?.id ?? "");
    if (!raw || byId.has(String(raw.name))) continue;
    if (!raw.permalink) raw.permalink = posts[0]?.permalink ?? "";
    const [node] = normalizeComments([{ kind: "t1", data: raw }]).comments;
    if (node) byId.set(node.id, { ...node, moreReplies: withMore.has(node.id) });
  }
  for (const node of byId.values()) {
    const parent = byId.get(node.parentId);
    if (parent) parent.replies.push(node);
    else comments.push(node);
  }
  return { posts, comments, more };
}
