import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  COMMENT_SORTS,
  type CommentNode,
  type CommentSort,
  type InlineMedia,
  type PostDetail,
  type PostSummary,
} from "../../shared/api";
import { useNav, usePane } from "../app/nav";
import { usePrefs } from "../app/prefs";
import { CommentRow, MoreRow, type CommentSwipe } from "../components/CommentRow";
import { DeleteSheet, ModActionsSheet } from "../components/Relay";
import { Icon, type IconName } from "../components/Icon";
import { openPostActions } from "../components/PostActions";
import {
  inlineViewerItem,
  MediaFrame,
  PostFlags,
  PostMeta,
  Thumb,
  wantsThumb,
} from "../components/PostParts";
import { ReplySheet } from "../components/ReplySheet";
import { Sheet, SheetItem } from "../components/Sheet";
import { VoteLinks } from "../components/VoteLinks";
import { currentAccount } from "../lib/account";
import { fetchContext, fetchPost, fetchReplies, entryRoute, site } from "../lib/api";
import {
  ARCHIVE_NAME,
  ARCHIVE_SORTS,
  ArchiveError,
  archivedComments,
  archivedPost,
  archivedReplies,
  archivedThread,
  removedComments,
  sortArchived,
  withArchived,
  withArchivedPost,
  type ArchiveFailure,
} from "../lib/archive";
import {
  animateLayout,
  fadeOutRows,
  snapshotLayout,
  subtreeRows,
  type LayoutSnapshot,
} from "../lib/itemAnimator";
import { compact, fullDate, plural, sortLabel } from "../lib/format";
import { Markdown, MarkdownContext, decodeEntities } from "../lib/markdown";
import {
  openUrl,
  copyText,
  redditUrl,
  sharePost,
  toast,
} from "../lib/platform";
import { readPosts } from "../lib/storage";

type Row =
  | {
      type: "comment";
      node: CommentNode;
      depth: number;
      collapsed: boolean;
      hidden: number;
    }
  | { type: "more"; parent: CommentNode; depth: number };

type NavMode = "top" | "op" | "search";

const NAV_MODES: { mode: NavMode; label: string; icon: IconName }[] = [
  { mode: "top", label: "Threads", icon: "comment" },
  { mode: "op", label: "OP", icon: "op" },
];

const SORT_ICONS: Record<CommentSort, IconName> = {
  confidence: "rising",
  top: "top",
  new: "new",
  controversial: "controversial",
  old: "clock",
  qa: "comment",
};

const countDescendants = (() => {
  const memo = new WeakMap<CommentNode, number>();
  const count = (node: CommentNode): number => {
    const hit = memo.get(node);
    if (hit !== undefined) return hit;
    const total = node.replies.reduce(
      (sum, child) => sum + 1 + count(child),
      0,
    );
    memo.set(node, total);
    return total;
  };
  return count;
})();

const mapTree = (
  nodes: CommentNode[],
  id: string,
  fn: (node: CommentNode) => CommentNode,
): CommentNode[] =>
  nodes.map((node) =>
    node.id === id
      ? fn(node)
      : node.replies.length
        ? { ...node, replies: mapTree(node.replies, id, fn) }
        : node,
  );

const dropFromTree = (nodes: CommentNode[], id: string): CommentNode[] =>
  nodes
    .filter((node) => node.id !== id)
    .map((node) =>
      node.replies.length
        ? { ...node, replies: dropFromTree(node.replies, id) }
        : node,
    );

const findPath = (
  nodes: CommentNode[],
  id: string,
  path: CommentNode[] = [],
): CommentNode[] | null => {
  for (const node of nodes) {
    if (node.id === id) return [...path, node];
    const found = findPath(node.replies, id, [...path, node]);
    if (found) return found;
  }
  return null;
};

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type PostScreenProps = {
  postId: string;
  seed?: PostSummary | undefined;
  /** A `t1_` comment to show in context, scroll to and highlight. */
  focus?: string | undefined;
};

/** True when `id` is anywhere in the loaded comment tree. */
const inTree = (nodes: CommentNode[], id: string): boolean =>
  nodes.some((node) => node.id === id || inTree(node.replies, id));

/**
 * Archived copies of a removed post and its removed comments, loaded only
 * when the reader presses "Restore from archive". `tried` holds the comments
 * already looked up; `show` switches between them and Reddit's version.
 */
type Restore = {
  status: "idle" | "loading" | "done" | ArchiveFailure;
  post?: PostDetail;
  postTried: boolean;
  comments: ReadonlyMap<string, CommentNode>;
  tried: ReadonlySet<string>;
  show: boolean;
};
const NO_RESTORE: Restore = {
  status: "idle",
  postTried: false,
  comments: new Map(),
  tried: new Set(),
  show: true,
};
/** Comments asked of the archive at first, and how many more each time. */
const ARCHIVE_LIMIT = 100;
const ARCHIVE_MORE = 200;
const ARCHIVE_NOTE = `Loads a saved copy from ${ARCHIVE_NAME}, which sees this post's ID.`;
const archiveMessage = (error: unknown) =>
  error instanceof ArchiveError
    ? error.message
    : new ArchiveError("unreachable").message;

export const PostScreen = ({ postId, seed, focus }: PostScreenProps) => {
  const nav = useNav();
  /** In the dual-pane layout, the post pane closes instead of going back. */
  const inPane = usePane() === "detail";
  const { prefs } = usePrefs();
  /** Compact and List show the feed's thumbnail row instead of full media. */
  const asRow = (p: PostSummary) =>
    prefs.layout !== "cards" &&
    prefs.showThumbnails &&
    wantsThumb(p) &&
    p.media.kind !== "poll";
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [post, setPost] = useState<PostDetail | PostSummary | null>(
    seed ?? null,
  );
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [tree, setTree] = useState<CommentNode[] | null>(null);
  const [moreRoot, setMoreRoot] = useState(false);
  const [sort, setSort] = useState<CommentSort>(
    postId === entryRoute.postId &&
      COMMENT_SORTS.includes(entryRoute.commentSort as CommentSort)
      ? (entryRoute.commentSort as CommentSort)
      : prefs.commentSort,
  );
  const [limit, setLimit] = useState(40);
  const [status, setStatus] = useState<"loading" | "idle" | "error" | "more">(
    "loading",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());
  const [navMode, setNavMode] = useState<NavMode>("top");
  const [search, setSearch] = useState<{ open: boolean; query: string }>({
    open: false,
    query: "",
  });
  const [matchIndex, setMatchIndex] = useState(-1);
  // Context mode: only the focused comment's thread, until "View all".
  const [thread, setThread] = useState(focus ?? null);
  const focused = useRef(false);
  const [restore, setRestore] = useState<Restore>(NO_RESTORE);
  // Reddit refused the thread and it was rebuilt from the archive: read-only,
  // sorted here, and "more" loads from the archive. The ref stops the sort
  // effect from going back to Reddit.
  const [archiveOnly, setArchiveOnly] = useState(false);
  const archiveOnlyRef = useRef(false);
  const [archiveLimit, setArchiveLimit] = useState(ARCHIVE_LIMIT);

  // List animations: snapshot row positions before a tree change, then play
  // fade/move animations once React has committed the new rows.
  const listRef = useRef<HTMLDivElement>(null);
  const pendingLayout = useRef<LayoutSnapshot | null>(null);
  const collapsedRef = useRef(collapsed);
  const removing = useRef(false);
  const captureLayout = useCallback(() => {
    if (listRef.current)
      pendingLayout.current = snapshotLayout(listRef.current);
  }, []);

  useEffect(() => {
    readPosts.add(postId.startsWith("t3_") ? postId : `t3_${postId}`);
  }, [postId]);

  const requestId = useRef(0);
  const load = useCallback(
    (nextSort: CommentSort, nextLimit: number, fresh: boolean) => {
      const id = ++requestId.current;
      const request = thread
        ? fetchContext(postId, thread, nextSort).catch(() => {
            // Context unavailable (deleted parent etc.): use the full thread.
            setThread(null);
            return fetchPost(postId, nextSort, nextLimit, fresh);
          })
        : fetchPost(postId, nextSort, nextLimit, fresh);
      return request.then(
        (data) => {
          if (id !== requestId.current) return;
          setPost(data.post);
          setBodyLoaded(true);
          captureLayout();
          setTree(data.comments);
          setMoreRoot(data.moreComments);
          setNotice(data.notice ?? "");
          setStatus("idle");
        },
        (err: unknown) => {
          if (id !== requestId.current) return;
          setError(
            err instanceof Error ? err.message : "Could not load comments",
          );
          setStatus("error");
        },
      );
    },
    [postId, thread, captureLayout],
  );

  useEffect(() => {
    if (archiveOnlyRef.current) return;
    void load(sort, 40, false);
  }, [load, sort]);

  /** Rebuilds the thread from the archive, for a post Reddit refuses. */
  const restoreThread = async (nextLimit: number) => {
    const first = !archiveOnlyRef.current;
    if (first) setRestore((current) => ({ ...current, status: "loading" }));
    else setStatus("more");
    try {
      const page = await archivedThread(postId, nextLimit);
      requestId.current++; // Drop any Reddit request still on its way.
      archiveOnlyRef.current = true;
      setArchiveOnly(true);
      setArchiveLimit(nextLimit);
      if (!ARCHIVE_SORTS.includes(sort)) setSort("top");
      setPost(page.post);
      setBodyLoaded(true);
      captureLayout();
      setTree(page.comments);
      setMoreRoot(page.moreComments);
      setNotice("");
      setStatus("idle");
      setRestore((current) => ({ ...current, status: "done" }));
    } catch (err) {
      if (first)
        setRestore((current) => ({
          ...current,
          status: err instanceof ArchiveError ? err.kind : "unreachable",
        }));
      else {
        toast(archiveMessage(err));
        setStatus("idle");
      }
    }
  };

  /** Fills in the removed post and comments Reddit still shows. */
  const restoreRemoved = async (postIsRemoved: boolean, ids: string[]) => {
    if (!post) return;
    const wantPost = postIsRemoved && !restore.postTried;
    setRestore((current) => ({ ...current, status: "loading" }));
    try {
      const [copy, found] = await Promise.all([
        wantPost
          ? archivedPost(post.id).catch((err: unknown) => {
              if (err instanceof ArchiveError && err.kind === "missing")
                return undefined;
              throw err;
            })
          : undefined,
        ids.length
          ? archivedComments(ids)
          : new Map<string, CommentNode>(),
      ]);
      captureLayout();
      setRestore((current) => {
        const comments = new Map([...current.comments, ...found]);
        const kept = copy ?? current.post;
        return {
          status: kept || comments.size ? "done" : "missing",
          ...(kept ? { post: kept } : {}),
          postTried: current.postTried || wantPost,
          comments,
          tried: new Set([...current.tried, ...ids]),
          show: true,
        };
      });
    } catch {
      setRestore((current) => ({ ...current, status: "unreachable" }));
    }
  };

  const loadMoreRoot = () => {
    if (archiveOnly) {
      void restoreThread(archiveLimit + ARCHIVE_MORE);
      return;
    }
    const next = limit + 60;
    setLimit(next);
    setStatus("more");
    void load(sort, next, true);
  };

  const retry = () => {
    setStatus("loading");
    void load(sort, limit, true);
  };

  const changeSort = (next: CommentSort) => {
    if (next === sort) return;
    if (archiveOnly) {
      // An archived thread is sorted here, so nothing reloads.
      setSort(next);
      scrollerRef.current?.scrollTo({ top: 0 });
      return;
    }
    setTree(null);
    setStatus("loading");
    setLimit(40);
    setSort(next);
    scrollerRef.current?.scrollTo({ top: 0 });
  };

  const toggle = useCallback(
    (id: string) => {
      if (removing.current) return;
      const commit = () => {
        captureLayout();
        setCollapsed((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };
      const list = listRef.current;
      const collapsing = !collapsedRef.current.has(id);
      const doomed = collapsing && list ? subtreeRows(list, id) : [];
      if (!doomed.length) {
        commit();
        return;
      }
      // Fade the subtree out first, then let the rows below slide up.
      removing.current = true;
      void fadeOutRows(doomed).then(() => {
        removing.current = false;
        commit();
      });
    },
    [captureLayout],
  );

  const loadReplies = useCallback(
    async (parent: CommentNode) => {
      if (!post) return;
      setLoadingIds((current) => new Set(current).add(parent.id));
      try {
        const result = archiveOnly
          ? await archivedReplies(post.id, parent.id)
          : await fetchReplies(post.id, parent.id, sort, post.author);
        captureLayout();
        setTree((current) =>
          current
            ? mapTree(current, parent.id, (node) => ({
                ...node,
                replies: result.replies,
                moreReplies:
                  result.more && result.replies.length > node.replies.length,
              }))
            : current,
        );
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not load replies");
      } finally {
        setLoadingIds((current) => {
          const next = new Set(current);
          next.delete(parent.id);
          return next;
        });
      }
    },
    [post, sort, captureLayout, archiveOnly],
  );

  // What the archive can restore in a thread Reddit still shows. Removals by
  // their authors are left alone. The archive only has Reddit's posts.
  const postRemoved =
    site.features.archive &&
    !archiveOnly && bodyLoaded && post?.removed && post.removed !== "author"
      ? post.removed
      : undefined;
  const removedIds = useMemo(
    () => (tree && !archiveOnly && site.features.archive ? removedComments(tree) : []),
    [tree, archiveOnly],
  );
  const untried = removedIds.filter((id) => !restore.tried.has(id));
  const shownTree = useMemo(
    () =>
      !tree
        ? tree
        : archiveOnly
          ? sortArchived(tree, sort)
          : restore.show && restore.tried.size
            ? withArchived(tree, restore.comments, restore.tried)
            : tree,
    [tree, archiveOnly, sort, restore],
  );

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (nodes: CommentNode[], depth: number) => {
      for (const node of nodes) {
        const isCollapsed = collapsed.has(node.id);
        out.push({
          type: "comment",
          node,
          depth,
          collapsed: isCollapsed,
          hidden: isCollapsed ? countDescendants(node) : 0,
        });
        if (isCollapsed) continue;
        walk(node.replies, depth + 1);
        if (node.moreReplies)
          out.push({ type: "more", parent: node, depth: depth + 1 });
      }
    };
    if (shownTree) walk(shownTree, 0);
    return out;
  }, [shownTree, collapsed]);

  useLayoutEffect(() => {
    collapsedRef.current = collapsed;
    const before = pendingLayout.current;
    pendingLayout.current = null;
    if (before && listRef.current) animateLayout(listRef.current, before);
  }, [rows, collapsed]);

  const query = search.open ? search.query.trim() : "";
  const highlight = useMemo(
    () =>
      query.length >= 2 ? new RegExp(`(${escapeRegExp(query)})`, "gi") : null,
    [query],
  );
  const matches = useMemo(() => {
    if (!highlight) return [];
    const test = new RegExp(escapeRegExp(query), "i");
    return rows.flatMap((row) =>
      row.type === "comment" &&
      test.test(decodeEntities(row.node.body))
        ? [row.node.id]
        : [],
    );
  }, [rows, highlight, query]);

  const targets = useMemo(() => {
    if (search.open && highlight) return matches;
    return rows.flatMap((row) => {
      if (row.type !== "comment") return [];
      if (navMode === "op") return row.node.isSubmitter ? [row.node.id] : [];
      return row.depth === 0 ? [row.node.id] : [];
    });
  }, [rows, navMode, matches, search.open, highlight]);

  const scrollToComment = useCallback((id: string) => {
    const scroller = scrollerRef.current;
    const el = scroller?.querySelector<HTMLElement>(`[data-cid="${id}"]`);
    if (!scroller || !el) return;
    const top =
      el.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop -
      44;
    const reduced = document.documentElement.dataset.motion === "reduced";
    scroller.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    // Comments off screen use estimated heights (content-visibility), so the
    // target moves as they render. Once the scroll ends, re-measure and
    // correct until it holds (bounded, e.g. at the end of the thread).
    const offset = () =>
      el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 44;
    const correct = (attempt: number) => {
      const delta = offset();
      if (Math.abs(delta) <= 2 || attempt >= 8) return;
      const before = scroller.scrollTop;
      scroller.scrollBy({ top: delta });
      if (scroller.scrollTop === before) return; // Cannot scroll any further.
      requestAnimationFrame(() => correct(attempt + 1));
    };
    window.setTimeout(() => correct(0), reduced ? 0 : 500);
    el.classList.remove("is-focus");
    void el.offsetWidth;
    el.classList.add("is-focus");
    window.setTimeout(() => el.classList.remove("is-focus"), 1200);
  }, []);

  // Opened from Inbox "Context" (or a profile comment): bring the comment
  // into view once it has rendered and the screen has slid in.
  useEffect(() => {
    if (!focus || focused.current || !tree || !inTree(tree, focus)) return;
    focused.current = true;
    const timer = window.setTimeout(() => scrollToComment(focus), 380);
    return () => window.clearTimeout(timer);
  }, [tree, focus, scrollToComment]);

  const jump = (direction: 1 | -1) => {
    const scroller = scrollerRef.current;
    if (!scroller || !targets.length) {
      toast(
        navMode === "op" ? "No comments from OP" : "No comments to jump to",
      );
      return;
    }
    if (search.open && highlight) {
      const next = (matchIndex + direction + targets.length) % targets.length;
      setMatchIndex(next);
      const id = targets[next];
      if (id) scrollToComment(id);
      return;
    }
    const base = scroller.getBoundingClientRect().top;
    const viewTop = scroller.scrollTop + 44;
    const offsets = targets.map((id) => {
      const el = scroller.querySelector<HTMLElement>(`[data-cid="${id}"]`);
      return el
        ? el.getBoundingClientRect().top - base + scroller.scrollTop
        : 0;
    });
    let index = -1;
    if (direction === 1) {
      index = offsets.findIndex((offset) => offset > viewTop + 6);
    } else {
      for (let i = offsets.length - 1; i >= 0; i--) {
        if ((offsets[i] ?? 0) < viewTop - 6) {
          index = i;
          break;
        }
      }
      if (index === -1) {
        scroller.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }
    const id = index >= 0 ? targets[index] : undefined;
    if (id) scrollToComment(id);
    else toast("End of comments");
  };

  const openReply = (parentId: string, author: string, quote: string) => {
    nav.openSheet((onClosed) => (
      <ReplySheet
        parentId={parentId}
        author={author}
        quote={quote}
        onClosed={onClosed}
        onPosted={(posted) => {
          const comment = {
            ...posted,
            isSubmitter: Boolean(post && posted.author === post.author),
          };
          captureLayout();
          if (parentId.startsWith("t3_")) {
            setTree((current) => [comment, ...(current ?? [])]);
            requestAnimationFrame(() => scrollToComment(comment.id));
          } else {
            setTree((current) =>
              current
                ? mapTree(current, parentId, (node) => ({
                    ...node,
                    replies: [comment, ...node.replies],
                  }))
                : current,
            );
            setCollapsed((current) => {
              const next = new Set(current);
              next.delete(parentId);
              return next;
            });
            requestAnimationFrame(() => scrollToComment(comment.id));
          }
        }}
      />
    ));
  };

  // Swipe actions need the latest thread state but must stay stable so the
  // memoized rows do not all re-render.
  const swipeLatest = useRef({
    reply: (_node: CommentNode) => {},
    edit: (_node: CommentNode) => {},
  });
  swipeLatest.current = {
    reply: (node) =>
      openReply(
        node.id,
        node.author,
        decodeEntities(node.body).replace(/\s+/g, " ").slice(0, 220),
      ),
    edit: (node) =>
      nav.openSheet((onClosed) => (
        <ReplySheet
          parentId={node.parentId}
          author={node.author}
          quote=""
          editing={{ id: node.id, text: decodeEntities(node.body) }}
          onClosed={onClosed}
          onPosted={(updated) =>
            setTree((current) =>
              current
                ? mapTree(current, node.id, (n) => ({ ...n, body: updated.body, edited: true }))
                : current,
            )
          }
        />
      )),
  };
  const locked = Boolean(post?.locked || post?.archived);
  const commentSwipe = useMemo<CommentSwipe>(
    () => ({
      ...(locked ? {} : { reply: (node: CommentNode) => swipeLatest.current.reply(node) }),
      parent: (node) => scrollToComment(node.parentId),
      edit: (node) => swipeLatest.current.edit(node),
      moderate: (node) =>
        nav.openSheet((onClosed) => <ModActionsSheet id={node.id} onClosed={onClosed} />),
    }),
    [locked, scrollToComment, nav],
  );

  // Relay drops a deleted comment's row and leaves its replies in the list.
  // In the tree, a comment with replies stays as "[deleted]" to hold them.
  const removeComment = (node: CommentNode) => {
    if (node.replies.length || node.moreReplies) {
      setTree((current) =>
        current
          ? mapTree(current, node.id, (n) => ({ ...n, author: "[deleted]", body: "[deleted]" }))
          : current,
      );
      return;
    }
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-cid="${CSS.escape(node.id)}"]`,
    );
    void fadeOutRows(row ? [row] : []).then(() => {
      captureLayout();
      setTree((current) => (current ? dropFromTree(current, node.id) : current));
    });
  };

  const commentActions = useCallback(
    (node: CommentNode) => {
      const own =
        currentAccount()?.name.toLowerCase() === node.author.toLowerCase();
      const path = tree ? findPath(tree, node.id) : null;
      const root = path?.[0];
      const parent =
        path && path.length > 1 ? path[path.length - 2] : undefined;
      const snippet = decodeEntities(node.body)
        .replace(/\s+/g, " ")
        .slice(0, 220);
      nav.openSheet((onClosed) => (
        <Sheet
          title={`${node.author} · ${compact(node.score)} points`}
          onClosed={onClosed}
        >
          {(close) => {
            const run = (action: () => void) => () => {
              close();
              action();
            };
            return (
              <>
                {!node.locked && !post?.locked && !archiveOnly ? (
                  <SheetItem
                    icon="reply"
                    label="Reply"
                    onClick={run(() =>
                      openReply(node.id, node.author, snippet),
                    )}
                  />
                ) : null}
                {parent ? (
                  <SheetItem
                    icon="up"
                    label="Go to parent"
                    onClick={run(() => scrollToComment(parent.id))}
                  />
                ) : null}
                {root && root.id !== node.id ? (
                  <SheetItem
                    icon="collapse"
                    label="Collapse thread"
                    onClick={run(() => {
                      captureLayout();
                      setCollapsed((current) => new Set(current).add(root.id));
                      requestAnimationFrame(() => scrollToComment(root.id));
                    })}
                  />
                ) : null}
                <SheetItem
                  icon="copy"
                  label="Copy text"
                  onClick={run(
                    () =>
                      void copyText(
                        decodeEntities(node.body),
                        "Comment copied",
                      ),
                  )}
                />
                <SheetItem
                  icon="link"
                  label="Copy link"
                  onClick={run(
                    () =>
                      void copyText(redditUrl(node.permalink), "Link copied"),
                  )}
                />
                <SheetItem
                  icon="external"
                  label={`View on ${site.name}`}
                  onClick={run(() => openUrl(redditUrl(node.permalink)))}
                />
                {own && !archiveOnly ? (
                  <SheetItem
                    icon="trash"
                    label="Delete"
                    onClick={run(() =>
                      nav.openSheet((onClosed) => (
                        <DeleteSheet
                          id={node.id}
                          onDeleted={() => removeComment(node)}
                          onClosed={onClosed}
                        />
                      )),
                    )}
                  />
                ) : null}
              </>
            );
          }}
        </Sheet>
      ));
    },
    // openReply/scrollToComment/removeComment are stable enough for sheet lifetimes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, post, nav, archiveOnly],
  );

  const openSortSheet = () =>
    nav.openSheet((onClosed) => (
      <Sheet title="Sort comments" onClosed={onClosed}>
        {(close) =>
          (archiveOnly ? ARCHIVE_SORTS : COMMENT_SORTS).map((option) => (
            <SheetItem
              key={option}
              icon={SORT_ICONS[option]}
              label={sortLabel[option]}
              selected={option === sort}
              onClick={() => {
                close();
                changeSort(option);
              }}
            />
          ))
        }
      </Sheet>
    ));

  const markdownActions = useMemo(
    () => ({
      onLink: nav.openLink,
      onImage: (url: string, media?: InlineMedia) =>
        nav.openMedia({
          items: [inlineViewerItem(url, media)],
          index: 0,
          sourceUrl: url,
        }),
      highlight,
      autoplayGifs: prefs.autoplayGifs,
      giphyGifs: prefs.giphyGifs,
    }),
    [nav, highlight, prefs.autoplayGifs, prefs.giphyGifs],
  );

  const shown: PostDetail | null =
    post && restore.show && restore.post && !archiveOnly
      ? withArchivedPost(post, restore.post)
      : post;
  // A removed post's "[removed]" body gives way to the restore bar.
  const body = postRemoved && shown === post ? undefined : shown?.body;
  const capturedAt = shown?.capturedAt;
  const captured = capturedAt ? (
    <p className="archive-captured">
      {archiveOnly
        ? `Captured ${fullDate(capturedAt)} · score and counts as of then`
        : `Archived copy · captured ${fullDate(capturedAt)}`}
    </p>
  ) : null;

  /** The bar on a removed post, or above removed comments, that restores
   *  them from the archive when pressed, and reports what it found. */
  const restoreBar = () => {
    const removedCount = plural(removedIds.length, "comment");
    const lead = postRemoved
      ? `Removed by ${postRemoved === "reddit" ? "Reddit" : "the moderators"}${
          removedIds.length ? ` · ${removedCount} removed` : ""
        }`
      : `${removedCount} removed by the moderators`;
    const button = (label: string, onClick: () => void) => (
      <button type="button" className="btn is-text" onClick={onClick}>
        {label}
      </button>
    );
    const restoreButton = (label: string) =>
      button(label, () => void restoreRemoved(Boolean(postRemoved), untried));
    let icon: IconName = "shield";
    let message = lead;
    let failed = false;
    let actions: ReactNode = null;
    switch (restore.status) {
      case "idle":
        actions = restoreButton("Restore from archive");
        break;
      case "loading":
        message = "Looking in the archive…";
        break;
      case "unreachable":
        icon = "info";
        message = new ArchiveError("unreachable").message;
        failed = true;
        actions = restoreButton("Retry");
        break;
      case "missing":
        icon = "info";
        message = `The archive has no copy of ${
          !postRemoved
            ? "these comments"
            : restore.tried.size
              ? "this post or its comments"
              : "this post"
        }.`;
        failed = true;
        if (untried.length) actions = restoreButton(`Restore ${untried.length} more`);
        break;
      case "done":
        if (!restore.show) {
          actions = button("Show archive copy", () => {
            captureLayout();
            setRestore((current) => ({ ...current, show: true }));
          });
          break;
        }
        icon = "archive";
        message = [
          restore.post || !restore.postTried
            ? "Restored from archive"
            : "No archived copy of the post",
          restore.tried.size
            ? `${[...restore.tried].filter((id) => restore.comments.has(id)).length} of ${plural(restore.tried.size, "comment")}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
        actions = (
          <>
            {untried.length ? restoreButton(`Restore ${untried.length} more`) : null}
            {button("Show removed", () => {
              captureLayout();
              setRestore((current) => ({ ...current, show: false }));
            })}
          </>
        );
    }
    return (
      <div className="archive-restore">
        <div className={`archive-bar${failed ? " is-error" : ""}`} role="status">
          {restore.status === "loading" ? (
            <span className="spinner" aria-hidden />
          ) : (
            <Icon name={icon} />
          )}
          <span className="grow">{message}</span>
          {actions}
        </div>
        {restore.status === "idle" || restore.status === "loading" ? (
          <p className="archive-note">{ARCHIVE_NOTE}</p>
        ) : null}
      </div>
    );
  };

  /** In place of the comments when Reddit refuses the whole thread. */
  const refusedPanel = () => {
    const removedBy = post?.removed && post.removed !== "author" ? post.removed : undefined;
    const failed = restore.status === "missing" || restore.status === "unreachable";
    const message = failed
      ? new ArchiveError(restore.status as ArchiveFailure).message
      : removedBy
        ? `This post was removed by ${removedBy === "reddit" ? "Reddit" : "the moderators"}, and Reddit no longer shows the thread.`
        : /\((403|404)\)|unavailable/.test(error)
          ? "Reddit won't show this post. It may have been removed, or its community may be private or banned."
          : error;
    const loading = restore.status === "loading";
    return (
      <div className="comments-empty archive-refused">
        <Icon name={failed ? "info" : "shield"} />
        <p className={failed ? "is-error" : undefined}>{message}</p>
        <div className="archive-refused-actions">
          {restore.status === "missing" ? (
            <button
              type="button"
              className="btn is-tonal"
              onClick={() =>
                openUrl(
                  redditUrl(
                    post?.permalink ??
                      `https://www.reddit.com/comments/${postId.replace(/^t3_/, "")}/`,
                  ),
                )
              }
            >
              <Icon name="external" /> Open on Reddit
            </button>
          ) : (
            <button
              type="button"
              className="btn is-tonal"
              disabled={loading}
              onClick={() => void restoreThread(ARCHIVE_LIMIT)}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden /> Looking in the archive…
                </>
              ) : (
                <>
                  <Icon name="archive" />
                  {restore.status === "unreachable" ? "Retry archive" : "Restore from archive"}
                </>
              )}
            </button>
          )}
          {loading ? null : (
            <button
              type="button"
              className="btn is-text"
              onClick={() => {
                setRestore(NO_RESTORE);
                retry();
              }}
            >
              <Icon name="refresh" /> Retry Reddit
            </button>
          )}
        </div>
        {failed ? null : <p className="archive-note">{ARCHIVE_NOTE}</p>}
      </div>
    );
  };
  const commentCount = post?.comments ?? 0;

  return (
    <MarkdownContext.Provider value={markdownActions}>
      <header className="appbar is-static is-raised">
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label={inPane ? "Close post" : "Back"}
          onClick={nav.back}
        >
          <Icon name={inPane ? "close" : "back"} />
        </button>
        {search.open ? (
          <>
            <input
              className="appbar-search"
              autoFocus
              placeholder="Find in comments"
              value={search.query}
              aria-label="Find in comments"
              onChange={(event) => {
                setSearch({ open: true, query: event.target.value });
                setMatchIndex(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") jump(event.shiftKey ? -1 : 1);
                if (event.key === "Escape")
                  setSearch({ open: false, query: "" });
              }}
            />
            {highlight ? (
              <span className="appbar-count">
                {matches.length
                  ? `${Math.max(0, matchIndex) + 1}/${matches.length}`
                  : "0"}
              </span>
            ) : null}
            <button
              type="button"
              className="icon-btn"
              data-ripple
              aria-label="Close search"
              onClick={() => setSearch({ open: false, query: "" })}
            >
              <Icon name="close" />
            </button>
          </>
        ) : (
          <>
            <div className="appbar-title">
              <span className="name">{site.communityLabel(post?.subreddit ?? "…")}</span>
              <span className="sub">
                {plural(commentCount, "comment")} · {sortLabel[sort]}
              </span>
            </div>
            <button
              type="button"
              className="icon-btn"
              data-ripple
              aria-label="Find in comments"
              onClick={() => setSearch({ open: true, query: "" })}
            >
              <Icon name="search" />
            </button>
            <button
              type="button"
              className="icon-btn"
              data-ripple
              aria-label="Sort comments"
              onClick={openSortSheet}
            >
              <Icon name="sort" />
            </button>
            <button
              type="button"
              className="icon-btn"
              data-ripple
              aria-label="Post actions"
              disabled={!post}
              onClick={() => post && openPostActions(nav, post, undefined, nav.back)}
            >
              <Icon name="more" size={20} />
            </button>
          </>
        )}
      </header>

      <div className="scroller post-page" ref={scrollerRef}>
        {archiveOnly ? (
          <div className="archive-banner" role="status">
            <Icon name="archive" />
            <span>
              Archived copy. Reddit no longer shows this thread, so voting and
              replying are off.
            </span>
          </div>
        ) : null}
        {post && shown ? (
          <>
            {/* Like Relay's comments header (its feed row plus the post text),
                the post follows the Layout setting: full media for Cards, the
                feed's thumbnail row for Compact and List. */}
            {asRow(shown) ? (
              <section
                className="post-head post-head-row"
                data-layout={prefs.layout}
              >
                <div className="row-main">
                  <PostMeta post={shown} showSub />
                  <h1 className="post-title">{shown.title}</h1>
                  <PostFlags post={shown} />
                  {captured}
                </div>
                <Thumb post={shown} />
              </section>
            ) : (
              <section className="post-head">
                <PostMeta post={shown} showSub />
                <h1 className="post-title">{shown.title}</h1>
                <PostFlags post={shown} />
                {captured}
              </section>
            )}
            {shown.media.kind !== "self" && !asRow(shown) ? (
              <section className="post-head-media">
                <MediaFrame post={shown} variant="detail" />
              </section>
            ) : null}
            {body ? (
              <section className="post-selftext">
                <Markdown source={body} />
              </section>
            ) : shown.media.kind === "self" && !bodyLoaded && shown.excerpt ? (
              <section className="post-selftext">
                <div className="md">
                  <p style={{ color: "var(--text-2)" }}>{shown.excerpt}</p>
                </div>
              </section>
            ) : null}
            {postRemoved ? restoreBar() : null}
            {/* Relay's row of circles under the post: score, comments, reply,
                share. View on Reddit lives in the post actions sheet. */}
            <div className="post-actions">
              {archiveOnly ? (
                <span className="post-action" title="Score when archived">
                  <span
                    className={`action-circle is-score${compact(post.score).length > 3 ? " is-long" : ""}`}
                  >
                    {compact(post.score)}
                  </span>
                  <span className="action-label">Score</span>
                </span>
              ) : (
                <VoteLinks
                  thingId={post.id}
                  permalink={post.permalink}
                  score={post.score}
                  vote={post.vote}
                  kind="post"
                  variant="pill"
                />
              )}
              <span className="post-action">
                <span
                  className={`action-circle is-comments${compact(post.comments).length > 3 ? " is-long" : ""}`}
                >
                  {compact(post.comments)}
                </span>
                <span className="action-label">Comments</span>
              </span>
              {!post.locked && !post.archived && !archiveOnly ? (
                <button
                  type="button"
                  className="post-action"
                  aria-label="Reply to post"
                  onClick={() => openReply(post.id, shown.author, shown.title)}
                >
                  <span className="action-circle is-reply" data-ripple>
                    <Icon name="reply" />
                  </span>
                  <span className="action-label">Reply</span>
                </button>
              ) : null}
              <button
                type="button"
                className="post-action"
                aria-label="Share"
                onClick={() => void sharePost(post.id, post.permalink)}
              >
                <span className="action-circle is-share" data-ripple>
                  <Icon name="share" />
                </span>
                <span className="action-label">Share</span>
              </button>
            </div>
          </>
        ) : (
          <section className="post-head" aria-busy>
            <div className="skel" style={{ width: "40%", height: 12 }} />
            <div className="skel" style={{ width: "95%", height: 20 }} />
            <div className="skel" style={{ width: "60%", height: 20 }} />
          </section>
        )}

        <div className="comments-bar">
          <span className="label">Comments</span>
          <button type="button" className="sort-btn" onClick={openSortSheet}>
            {sortLabel[sort]}
            <Icon name="chevronDown" size={18} />
          </button>
          <span className="grow" />
          {collapsed.size ? (
            <button
              type="button"
              className="btn is-text"
              onClick={() => {
                captureLayout();
                setCollapsed(new Set());
              }}
            >
              Expand all
            </button>
          ) : tree && tree.length > 1 ? (
            <button
              type="button"
              className="btn is-text"
              onClick={() => {
                captureLayout();
                setCollapsed(
                  new Set(
                    tree
                      .filter((node) => node.replies.length || node.moreReplies)
                      .map((node) => node.id),
                  ),
                );
              }}
            >
              Collapse all
            </button>
          ) : null}
        </div>

        <div className="comments" aria-live="polite" ref={listRef}>
          {status === "loading" && !tree
            ? Array.from({ length: 5 }, (_, index) => (
                <div className="comment-skeleton" key={index} aria-hidden>
                  <div className="skel" style={{ width: "30%", height: 11 }} />
                  <div className="skel" style={{ width: "94%", height: 13 }} />
                  <div className="skel" style={{ width: "76%", height: 13 }} />
                </div>
              ))
            : null}
          {thread && tree ? (
            <div className="context-bar" role="status">
              <Icon name="thread" />
              <span className="grow">Single comment thread</span>
              <button
                type="button"
                className="btn is-text"
                onClick={() => {
                  focused.current = false; // Find the comment again in the full thread.
                  setThread(null);
                  setStatus("loading");
                }}
              >
                View all comments
              </button>
            </div>
          ) : null}
          {!postRemoved && removedIds.length ? restoreBar() : null}
          {notice ? (
            <div className="feed-end" role="status">
              {notice}
            </div>
          ) : null}
          {status === "error" && !bodyLoaded && site.features.archive ? (
            refusedPanel()
          ) : status === "error" ? (
            <div className="comments-empty">
              <p>{error}</p>
              <button type="button" className="btn is-tonal" onClick={retry}>
                <Icon name="refresh" /> Retry
              </button>
            </div>
          ) : null}
          {tree && !tree.length ? (
            <div className="comments-empty">
              {archiveOnly
                ? "The archive has no comments for this post."
                : "No comments yet. Start the conversation."}
            </div>
          ) : null}
          {rows.map((row) =>
            row.type === "comment" ? (
              <CommentRow
                key={row.node.id}
                node={row.node}
                depth={row.depth}
                collapsed={row.collapsed}
                hiddenCount={row.hidden}
                focused={row.node.id === focus}
                onToggle={toggle}
                onActions={commentActions}
                swipe={commentSwipe}
                readOnly={archiveOnly}
              />
            ) : (
              <MoreRow
                key={`more-${row.parent.id}`}
                animKey={`more-${row.parent.id}`}
                depth={row.depth}
                label={
                  row.depth >= 8 ? "Continue this thread" : "Load more replies"
                }
                loading={loadingIds.has(row.parent.id)}
                onClick={() => void loadReplies(row.parent)}
              />
            ),
          )}
          {tree && moreRoot ? (
            <MoreRow
              root
              animKey="more-root"
              depth={0}
              label={archiveOnly ? "Load more from archive" : "Load more comments"}
              loading={status === "more"}
              onClick={loadMoreRoot}
            />
          ) : null}
        </div>
      </div>

      <div
        className={`comment-nav${tree && tree.length ? "" : " is-hidden"}`}
        role="toolbar"
        aria-label="Comment navigation"
      >
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label="Previous"
          onClick={() => jump(-1)}
        >
          <Icon name="chevronUp" />
        </button>
        {search.open && highlight ? (
          <span className="mode">
            <Icon name="search" /> Match
          </span>
        ) : (
          <button
            type="button"
            className="mode"
            data-ripple
            aria-label={`Navigation mode: ${navMode === "op" ? "OP comments" : "top-level threads"}. Tap to switch`}
            onClick={() => {
              const next = navMode === "top" ? "op" : "top";
              setNavMode(next);
              toast(
                next === "op"
                  ? "Jumping between OP comments"
                  : "Jumping between threads",
              );
            }}
          >
            <Icon
              name={
                NAV_MODES.find((entry) => entry.mode === navMode)?.icon ??
                "comment"
              }
            />
            {NAV_MODES.find((entry) => entry.mode === navMode)?.label}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label="Next"
          onClick={() => jump(1)}
        >
          <Icon name="chevronDown" />
        </button>
      </div>
    </MarkdownContext.Provider>
  );
};
