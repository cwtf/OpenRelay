import type {
  CommentNode,
  CommentSort,
  PostDetail,
  PostResponse,
  RepliesResponse,
} from "../../shared/api.ts";
import { normalizeComments, normalizePost } from "../../extension/reddit.ts";

/**
 * Copies of removed threads from Arctic Shift, a community archive that saves
 * Reddit posts and comments within minutes of posting. Nothing is fetched
 * until the reader presses "Restore from archive" on a post. The reader
 * fetches from its own frame, so requests carry only the IDs: no Reddit
 * cookies and no referrer.
 */
const ARCHIVE = "https://arctic-shift.photon-reddit.com/api";
export const ARCHIVE_NAME = "Arctic Shift";

export type ArchiveFailure = "missing" | "unreachable";

export class ArchiveError extends Error {
  /** "missing": the archive answered without a copy; "unreachable": it
   *  didn't answer, refused (rate limit) or timed out. */
  kind: ArchiveFailure;
  constructor(kind: ArchiveFailure) {
    super(
      kind === "missing"
        ? "The archive has no copy of this thread."
        : "Couldn't reach the archive. Check your connection and try again.",
    );
    this.name = "ArchiveError";
    this.kind = kind;
  }
}

type Raw = Record<string, any>;
const bare = (id: string) => id.replace(/^t\d_/, "");
/** The ID lookups take at most 500 IDs per request. */
const ID_BATCH = 500;

async function get(
  path: string,
  params: Record<string, string | number>,
): Promise<Raw[]> {
  const url = new URL(ARCHIVE + path);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, String(value));
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ArchiveError("unreachable");
  }
  const body = response.ok ? await response.json().catch(() => null) : null;
  // A failed query answers `{ data: null, error: "…" }`.
  if (!Array.isArray(body?.data)) throw new ArchiveError("unreachable");
  return body.data;
}

/**
 * False when the author deleted it later (their choice, so it stays deleted)
 * or the archive only ever saw Reddit's placeholder.
 */
const usable = (raw: Raw, text: unknown) =>
  raw?._meta?.removal_type !== "deleted" &&
  text !== "[removed]" &&
  text !== "[deleted]";

/** Archived comments, with the ones their authors deleted blanked again. */
const scrub = (children: Raw[]): Raw[] =>
  children.map((child) => {
    if (child?.kind !== "t1") return child;
    const c = child.data ?? {};
    const replies = c.replies?.data?.children;
    return {
      kind: "t1",
      data: {
        ...c,
        ...(usable(c, c.body)
          ? {}
          : {
              author: "[deleted]",
              body: c.body === "[removed]" ? "[removed]" : "[deleted]",
            }),
        ...(Array.isArray(replies)
          ? {
              replies: {
                ...c.replies,
                data: { ...c.replies.data, children: scrub(replies) },
              },
            }
          : {}),
      },
    };
  });

/** The post as the archive captured it. */
export async function archivedPost(id: string): Promise<PostDetail> {
  const [raw] = await get("/posts/ids", { ids: bare(id) });
  if (!raw || !usable(raw, raw.selftext)) throw new ArchiveError("missing");
  const captured = Number(raw.retrieved_on ?? raw.retrieved_utc) * 1000;
  return {
    ...normalizePost(raw),
    ...(captured > 0 ? { capturedAt: captured } : {}),
  };
}

/** Archived copies of these comments, by fullname; absent ones are missing. */
export async function archivedComments(
  ids: string[],
): Promise<Map<string, CommentNode>> {
  const found = new Map<string, CommentNode>();
  for (let start = 0; start < ids.length; start += ID_BATCH) {
    const batch = ids.slice(start, start + ID_BATCH).map(bare).join(",");
    const raw = await get("/comments/ids", { ids: batch });
    const usableOnes = raw.filter((c) => usable(c, c?.body));
    for (const node of normalizeComments(
      usableOnes.map((data) => ({ kind: "t1", data: { ...data, replies: "" } })),
    ).comments)
      found.set(node.id, node);
  }
  return found;
}

/**
 * The whole thread from the archive, for a post Reddit no longer shows. The
 * archive collapses comments past `limit` into "more" markers, like Reddit.
 */
export async function archivedThread(
  id: string,
  limit: number,
): Promise<PostResponse> {
  const post = await archivedPost(id);
  const children = await get("/comments/tree", {
    link_id: "t3_" + bare(id),
    limit,
  });
  const tree = normalizeComments(scrub(children));
  return { post, comments: tree.comments, moreComments: tree.more };
}

/** A comment's replies from the archive (its "Load more replies"). */
export async function archivedReplies(
  postId: string,
  parentId: string,
): Promise<RepliesResponse> {
  // The tree under `parent_id` starts at the parent itself.
  const [parent] = await get("/comments/tree", {
    link_id: "t3_" + bare(postId),
    parent_id: parentId,
    limit: 200,
  });
  const children = parent?.data?.replies?.data?.children;
  const tree = normalizeComments(scrub(Array.isArray(children) ? children : []));
  return { replies: tree.comments, more: tree.more };
}

/** IDs of the comments Reddit shows as removed by moderators. */
export const removedComments = (nodes: CommentNode[]): string[] =>
  nodes.flatMap((node) => [
    ...(node.removed === "mods" ? [node.id] : []),
    ...removedComments(node.replies),
  ]);

/**
 * Reddit's comments with archived copies in place of the removed ones. Votes,
 * scores and the thread's shape stay Reddit's. Comments that were looked up
 * (`tried`) but not found are marked missing.
 */
export function withArchived(
  nodes: CommentNode[],
  found: ReadonlyMap<string, CommentNode>,
  tried: ReadonlySet<string>,
): CommentNode[] {
  return nodes.map((node) => {
    const replies = node.replies.length
      ? withArchived(node.replies, found, tried)
      : node.replies;
    if (node.removed !== "mods") return { ...node, replies };
    const copy = found.get(node.id);
    if (!copy)
      return tried.has(node.id)
        ? { ...node, replies, archive: "missing" }
        : { ...node, replies };
    const { removed: _removed, media: _media, ...live } = node;
    return {
      ...live,
      author: copy.author,
      body: copy.body,
      isSubmitter: copy.isSubmitter,
      ...(copy.media ? { media: copy.media } : {}),
      archive: "restored",
      replies,
    };
  });
}

/** Reddit's post with the archived title, author, text and media. */
export function withArchivedPost(post: PostDetail, copy: PostDetail): PostDetail {
  const { removed: _removed, ...live } = post;
  return {
    ...live,
    title: copy.title,
    author: copy.author,
    body: copy.body ?? "",
    media: copy.media,
    ...(copy.excerpt ? { excerpt: copy.excerpt } : {}),
    ...(copy.thumb ? { thumb: copy.thumb } : {}),
    ...(copy.flair ? { flair: copy.flair } : {}),
    ...(copy.capturedAt ? { capturedAt: copy.capturedAt } : {}),
  };
}

/** The sorts an archived thread offers: Reddit's Best can't be rebuilt. */
export const ARCHIVE_SORTS: CommentSort[] = ["top", "new", "old"];

/** An archived thread in the chosen order, stickied comments first. */
export function sortArchived(
  nodes: CommentNode[],
  sort: CommentSort,
): CommentNode[] {
  const order = (a: CommentNode, b: CommentNode) =>
    sort === "new"
      ? b.createdAt - a.createdAt
      : sort === "old"
        ? a.createdAt - b.createdAt
        : b.score - a.score;
  return [...nodes]
    .sort((a, b) => Number(b.stickied) - Number(a.stickied) || order(a, b))
    .map((node) =>
      node.replies.length
        ? { ...node, replies: sortArchived(node.replies, sort) }
        : node,
    );
}
