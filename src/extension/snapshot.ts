import { normalizePost, normalizeComments, safeUrl } from "./reddit";
import type { PostDetail, CommentNode } from "../shared/api";

export type Snapshot = { posts: PostDetail[]; comments: CommentNode[] };
export function readSnapshot(doc: Document): Snapshot {
  const posts: PostDetail[] = [];
  const seen = new Set<string>();
  for (const el of doc.querySelectorAll("shreddit-post, .thing.link")) {
    const attr = (name: string) => el.getAttribute(name) ?? "";
    const id = attr("id").startsWith("t3_")
      ? attr("id")
      : attr("data-fullname");
    if (!/^t3_[a-z0-9]+$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    const title =
      attr("post-title") ||
      el.querySelector('a.title, [slot="title"]')?.textContent?.trim() ||
      "";
    if (!title) continue;
    const img = el.querySelector<HTMLImageElement>(
      'img.preview-img, img[slot="image"], .thumbnail img, [slot="post-media-container"] img, img.media-lightbox-img',
    );
    const permalink =
      attr("permalink") ||
      attr("data-permalink") ||
      el.querySelector<HTMLAnchorElement>("a.comments")?.href;
    const url = attr("content-href") || attr("data-url") || permalink;
    const post = normalizePost({
      name: id,
      id: id.slice(3),
      title,
      author: attr("author") || attr("data-author"),
      subreddit:
        attr("subreddit-prefixed-name").replace(/^r\//, "") ||
        attr("data-subreddit"),
      permalink,
      url,
      domain: attr("domain") || attr("data-domain"),
      created_utc:
        (Date.parse(
          attr("created-timestamp") ||
            el.querySelector("time")?.getAttribute("datetime") ||
            "",
        ) || Date.now()) / 1000,
      score: Number(attr("score") || attr("data-score")),
      num_comments: Number(
        attr("comment-count") || attr("data-comments-count"),
      ),
      is_self: attr("post-type") === "text" || el.classList.contains("self"),
      selftext: el
        .querySelector('[slot="text-body"], .usertext-body .md')
        ?.textContent?.trim(),
      over_18: el.hasAttribute("nsfw") || el.classList.contains("over18"),
      spoiler: el.hasAttribute("spoiler") || el.classList.contains("spoiler"),
      post_hint: attr("post-type") === "image" ? "image" : undefined,
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
    });
    posts.push(post);
  }
  const comments: CommentNode[] = [];
  const byId = new Map<string, CommentNode>();
  for (const el of doc.querySelectorAll("shreddit-comment, .thing.comment")) {
    const id =
      el.getAttribute("thingid") || el.getAttribute("data-fullname") || "";
    if (!/^t1_[a-z0-9]+$/i.test(id) || byId.has(id)) continue;
    const parentEl = el.parentElement?.closest(
      "shreddit-comment, .thing.comment",
    );
    const parentId =
      el.getAttribute("parentid") ||
      parentEl?.getAttribute("thingid") ||
      parentEl?.getAttribute("data-fullname") ||
      posts[0]?.id ||
      "";
    const body =
      el
        .querySelector('[slot="comment"], :scope > .entry .usertext-body .md')
        ?.textContent?.trim() || "";
    const permalink =
      safeUrl(
        el.getAttribute("permalink") ||
          el.querySelector<HTMLAnchorElement>("a.bylink")?.href,
      ) ||
      posts[0]?.permalink ||
      "";
    const node = normalizeComments([
      {
        kind: "t1",
        data: {
          name: id,
          parent_id: parentId,
          author: el.getAttribute("author") || el.getAttribute("data-author"),
          body,
          score: Number(
            el.getAttribute("score") || el.getAttribute("data-score"),
          ),
          created_utc:
            (Date.parse(
              el.querySelector("time")?.getAttribute("datetime") || "",
            ) || Date.now()) / 1000,
          permalink,
          is_submitter: el.hasAttribute("is-op"),
        },
      },
    ]).comments[0]!;
    byId.set(id, node);
  }
  for (const node of byId.values()) {
    const parent = byId.get(node.parentId);
    if (parent) parent.replies.push(node);
    else comments.push(node);
  }
  return { posts, comments };
}
