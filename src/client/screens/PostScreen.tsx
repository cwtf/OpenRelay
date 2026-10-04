import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  COMMENT_SORTS,
  type CommentNode,
  type CommentSort,
  type PostDetail,
  type PostSummary,
} from "../../shared/api";
import { useNav } from "../app/nav";
import { usePrefs } from "../app/prefs";
import { CommentRow, MoreRow } from "../components/CommentRow";
import { Icon, type IconName } from "../components/Icon";
import { openPostActions } from "../components/PostActions";
import { MediaFrame, PostFlags, PostMeta } from "../components/PostParts";
import { ReplySheet } from "../components/ReplySheet";
import { Sheet, SheetItem } from "../components/Sheet";
import { VoteLinks } from "../components/VoteLinks";
import { fetchPost, fetchReplies, entryRoute } from "../lib/api";
import {
  animateLayout,
  fadeOutRows,
  snapshotLayout,
  subtreeRows,
  type LayoutSnapshot,
} from "../lib/itemAnimator";
import { compact, plural, sortLabel } from "../lib/format";
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
};

export const PostScreen = ({ postId, seed }: PostScreenProps) => {
  const nav = useNav();
  const { prefs } = usePrefs();
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
      return fetchPost(postId, nextSort, nextLimit, fresh).then(
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
    [postId, captureLayout],
  );

  useEffect(() => {
    void load(sort, 40, false);
  }, [load, sort]);

  const loadMoreRoot = () => {
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
        const result = await fetchReplies(
          post.id,
          parent.id,
          sort,
          post.author,
        );
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
    [post, sort, captureLayout],
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
    if (tree) walk(tree, 0);
    return out;
  }, [tree, collapsed]);

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
      !row.collapsed &&
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
    el.classList.remove("is-focus");
    void el.offsetWidth;
    el.classList.add("is-focus");
    window.setTimeout(() => el.classList.remove("is-focus"), 1200);
  }, []);

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

  const openReply = (
    parentId: string,
    author: string,
    quote: string,
    permalink?: string,
  ) => {
    nav.openSheet((onClosed) => (
      <ReplySheet
        parentId={parentId}
                permalink={permalink || post?.permalink || ""}
        author={author}
        quote={quote}
        loggedIn={nav.session.loggedIn}
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

  const commentActions = useCallback(
    (node: CommentNode) => {
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
                {!node.locked && !post?.locked ? (
                  <SheetItem
                    icon="reply"
                    label="Reply"
                    onClick={run(() =>
                      openReply(node.id, node.author, snippet, node.permalink),
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
                  label="View on Reddit"
                  onClick={run(() => openUrl(redditUrl(node.permalink)))}
                />
              </>
            );
          }}
        </Sheet>
      ));
    },
    // openReply/scrollToComment are stable enough for sheet lifetimes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, post, nav],
  );

  const openSortSheet = () =>
    nav.openSheet((onClosed) => (
      <Sheet title="Sort comments" onClosed={onClosed}>
        {(close) =>
          COMMENT_SORTS.map((option) => (
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
      onImage: (url: string) =>
        nav.openMedia({
          items: [{ kind: "image", url }],
          index: 0,
          sourceUrl: url,
        }),
      highlight,
    }),
    [nav, highlight],
  );

  const body = post && "body" in post ? post.body : undefined;
  const commentCount = post?.comments ?? 0;

  return (
    <MarkdownContext.Provider value={markdownActions}>
      <header className="appbar is-static is-raised">
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label="Back"
          onClick={nav.back}
        >
          <Icon name="back" />
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
              <span className="name">r/{post?.subreddit ?? "…"}</span>
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
              onClick={() => post && openPostActions(nav, post)}
            >
              <Icon name="more" size={20} />
            </button>
          </>
        )}
      </header>

      <div className="scroller post-page" ref={scrollerRef}>
        {post ? (
          <>
            <section className="post-head">
              <PostMeta post={post} showSub />
              <h1 className="post-title">{post.title}</h1>
              <PostFlags post={post} />
            </section>
            {post.media.kind !== "self" ? (
              <section className="post-head-media">
                <MediaFrame post={post} variant="detail" />
              </section>
            ) : null}
            {body ? (
              <section className="post-selftext">
                <Markdown source={body} />
              </section>
            ) : post.media.kind === "self" && !bodyLoaded && post.excerpt ? (
              <section className="post-selftext">
                <div className="md">
                  <p style={{ color: "var(--text-2)" }}>{post.excerpt}</p>
                </div>
              </section>
            ) : null}
            <div className="post-toolbar">
              <VoteLinks
                thingId={post.id}
        permalink={post.permalink}
                score={post.score}
                vote={post.vote}
                kind="post"
                variant="stat"
              />
              <span className="stat">
                <Icon name="comment" />
                {compact(post.comments)}
              </span>
              <span className="grow" />
              {!post.locked && !post.archived ? (
                <button
                  type="button"
                  className="icon-btn"
                  data-ripple
                  aria-label="Reply to post"
                  onClick={() => openReply(post.id, post.author, post.title)}
                >
                  <Icon name="reply" />
                </button>
              ) : null}
              <button
                type="button"
                className="icon-btn"
                data-ripple
                aria-label="Share"
                onClick={() => void sharePost(post.id, post.permalink)}
              >
                <Icon name="share" />
              </button>
              <button
                type="button"
                className="icon-btn"
                data-ripple
                aria-label="View on Reddit"
                onClick={() => nav.openLink(redditUrl(post.permalink))}
              >
                <Icon name="external" />
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
                setCollapsed(new Set(tree.map((node) => node.id)));
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
          {notice ? (
            <div className="feed-end" role="status">
              {notice}
            </div>
          ) : null}
          {status === "error" ? (
            <div className="comments-empty">
              <p>{error}</p>
              <button type="button" className="btn is-tonal" onClick={retry}>
                <Icon name="refresh" /> Retry
              </button>
            </div>
          ) : null}
          {tree && !tree.length ? (
            <div className="comments-empty">
              No comments yet. Start the conversation.
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
                onToggle={toggle}
                onActions={commentActions}
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
              label="Load more comments"
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
