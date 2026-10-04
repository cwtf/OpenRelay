import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import {
  FEED_SORTS,
  TIMEFRAMES,
  type FeedSort,
  type PostSummary,
  type SubredditAbout,
  type Timeframe,
} from "../../shared/api";
import { useNav } from "../app/nav";
import { usePrefs } from "../app/prefs";
import { Icon, type IconName } from "../components/Icon";
import { PostCard } from "../components/PostCard";
import { Sheet, SheetItem } from "../components/Sheet";
import { useAccount } from "../lib/account";
import { fetchAbout, fetchFeed } from "../lib/api";
import { compact, hueOf, sortLabel, timeframeLabel } from "../lib/format";
import {
  animateLayout,
  fadeOutRows,
  snapshotLayout,
  type LayoutSnapshot,
} from "../lib/itemAnimator";
import { hiddenPosts } from "../lib/storage";

const SORT_ICONS: Record<FeedSort, IconName> = {
  hot: "hot",
  new: "new",
  top: "top",
  rising: "rising",
  controversial: "controversial",
};

const LAYOUT_ICONS = {
  cards: "cards",
  compact: "compact",
  list: "list",
} as const;
const NEXT_LAYOUT = {
  cards: "compact",
  compact: "list",
  list: "cards",
} as const;

type FeedState = {
  posts: PostSummary[];
  after: string | null;
  status: "idle" | "loading" | "more" | "error" | "refreshing";
  error?: string;
};

type CachedFeed = {
  posts: PostSummary[];
  after: string | null;
  scrollTop: number;
  at: number;
};
const feedCache = new Map<string, CachedFeed>();
const aboutCache = new Map<string, SubredditAbout>();

/** A round picture, or the name's initial when there is none or it fails. */
export const Avatar = ({
  name,
  size,
  src,
}: {
  name: string;
  size?: "small" | "large";
  src?: string | undefined;
}) => {
  const [failed, setFailed] = useState<string | null>(null);
  const className = `avatar${size ? ` is-${size}` : ""}`;
  if (src && failed !== src)
    return (
      <img
        className={className}
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
      />
    );
  return (
    <span
      className={className}
      style={{ ["--hue" as string]: hueOf(name.toLowerCase()) }}
      aria-hidden
    >
      {name.slice(0, 1)}
    </span>
  );
};

/** Home shows the signed-in account's picture; communities their icon. */
export const useFeedPicture = (
  sub: string,
  about: SubredditAbout | null,
): string | undefined => {
  const account = useAccount();
  return sub === "Home" ? account?.icon : about?.icon;
};

export const useAbout = (sub: string): SubredditAbout | null => {
  const key = sub.toLowerCase();
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (aboutCache.has(key)) return;
    let live = true;
    fetchAbout(sub)
      .then(({ about: info }) => {
        aboutCache.set(key, info);
        if (live) setLoaded((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, sub]);
  return aboutCache.get(key) ?? null;
};

const Skeletons = ({ layout }: { layout: string }) => (
  <>
    {Array.from({ length: 4 }, (_, index) => (
      <div className="skeleton-card" key={index} aria-hidden>
        <div className="skel" style={{ width: "42%", height: 12 }} />
        <div className="skel" style={{ width: "92%", height: 16 }} />
        <div className="skel" style={{ width: "70%", height: 16 }} />
        {layout === "cards" ? (
          <div
            className="skel"
            style={{ width: "100%", height: 180, borderRadius: 10 }}
          />
        ) : null}
      </div>
    ))}
  </>
);

const FeedMessage = ({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) => (
  <div className="feed-state">
    <div className="glyph">
      <Icon name={icon} size={30} />
    </div>
    <strong>{title}</strong>
    {children}
  </div>
);

type FeedScreenProps = {
  sub: string;
  sort: FeedSort;
  timeframe: Timeframe;
  onSort: (sort: FeedSort, timeframe: Timeframe) => void;
};

export const FeedScreen = ({
  sub,
  sort,
  timeframe,
  onSort,
}: FeedScreenProps) => {
  const nav = useNav();
  const { prefs, update } = usePrefs();
  const about = useAbout(sub);
  const picture = useFeedPicture(sub, about);
  const key = `${sub.toLowerCase()}|${sort}|${timeframe}`;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const [state, setState] = useState<FeedState>(() => {
    const cached = feedCache.get(key);
    return cached
      ? { posts: cached.posts, after: cached.after, status: "idle" }
      : { posts: [], after: null, status: "loading" };
  });
  const [hidden, setHidden] = useState(() => new Set(hiddenPosts.values()));
  const [raised, setRaised] = useState(false);
  const barRef = useRef<HTMLElement>(null);
  const barOffset = useRef(0);
  const snapTimer = useRef<number | undefined>(undefined);

  /** Move the app bar by `offset` px (0 = shown, -height = hidden). */
  const placeBar = useCallback((offset: number, animate: boolean) => {
    const bar = barRef.current;
    barOffset.current = offset;
    if (!bar) return;
    bar.style.transition = animate
      ? "transform var(--dur-short) var(--ease-emph), border-color 150ms"
      : "border-color 150ms";
    bar.style.transform = offset ? `translateY(${offset}px)` : "";
  }, []);

  const load = useCallback(
    async (
      mode: "initial" | "more" | "refresh",
      after: string | null = null,
    ) => {
      const id = ++requestId.current;
      setState((current) => ({
        ...current,
        status:
          mode === "initial"
            ? "loading"
            : mode === "more"
              ? "more"
              : "refreshing",
      }));
      try {
        const page = await fetchFeed(
          sub,
          sort,
          timeframe,
          mode === "more" ? after : null,
        );
        if (id !== requestId.current) return;
        setState((current) => {
          const base = mode === "more" ? current.posts : [];
          const seen = new Set(base.map((post) => post.id));
          const posts = [
            ...base,
            ...page.posts.filter((post) => !seen.has(post.id)),
          ];
          return { posts, after: page.after, status: "idle" };
        });
        if (mode === "refresh") scrollerRef.current?.scrollTo({ top: 0 });
      } catch (error) {
        if (id !== requestId.current) return;
        setState((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof Error ? error.message : "Something went wrong",
        }));
      }
    },
    [sub, sort, timeframe],
  );

  // Switch feeds: restore from memory when we can, otherwise fetch.
  useEffect(() => {
    const cached = feedCache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60_000) {
      requestId.current++;
      setState({ posts: cached.posts, after: cached.after, status: "idle" });
      requestAnimationFrame(() =>
        scrollerRef.current?.scrollTo({ top: cached.scrollTop }),
      );
    } else {
      setState({ posts: [], after: null, status: "loading" });
      scrollerRef.current?.scrollTo({ top: 0 });
      void load("initial");
    }
    placeBar(0, true);
  }, [key, load, placeBar]);

  // Persist the feed for instant back-navigation between communities/sorts.
  useEffect(() => {
    if (state.status !== "idle" || !state.posts.length) return;
    feedCache.set(key, {
      posts: state.posts,
      after: state.after,
      scrollTop: scrollerRef.current?.scrollTop ?? 0,
      at: feedCache.get(key)?.at ?? Date.now(),
    });
  }, [key, state]);

  // Infinite scroll.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollerRef.current;
    if (!sentinel || !root || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && state.status === "idle" && state.after) {
          void load("more", state.after);
        }
      },
      { root, rootMargin: "1200px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [state.status, state.after, load]);

  // Quick-return app bar: it scrolls away with the content pixel for pixel,
  // comes back as soon as you scroll up, and snaps fully open or closed
  // once scrolling settles (like an Android "scroll|enterAlways|snap" bar).
  const lastY = useRef(0);
  const onScroll = () => {
    const el = scrollerRef.current;
    const bar = barRef.current;
    if (!el) return;
    const y = el.scrollTop;
    const delta = y - lastY.current;
    const height = bar?.offsetHeight ?? 56;
    const offset =
      y <= 0 ? 0 : Math.min(0, Math.max(-height, barOffset.current - delta));
    if (offset !== barOffset.current) placeBar(offset, false);
    window.clearTimeout(snapTimer.current);
    snapTimer.current = window.setTimeout(() => {
      const current = barOffset.current;
      if (current === 0 || current === -height) return;
      const hide =
        current < -height / 2 && (scrollerRef.current?.scrollTop ?? 0) > height;
      placeBar(hide ? -height : 0, true);
    }, 140);
    setRaised(y > 4);
    lastY.current = y;
    const cached = feedCache.get(key);
    if (cached) cached.scrollTop = y;
  };

  // Pull to refresh.
  const ptrRef = useRef<HTMLDivElement>(null);
  const pull = useRef<{ y: number; dy: number } | null>(null);
  const refreshing = state.status === "refreshing";
  const onTouchStart = (event: ReactTouchEvent) => {
    if ((scrollerRef.current?.scrollTop ?? 1) > 0 || refreshing) return;
    pull.current = { y: event.touches[0]?.clientY ?? 0, dy: 0 };
  };
  const onTouchMove = (event: ReactTouchEvent) => {
    const ptr = ptrRef.current;
    if (!pull.current || !ptr) return;
    const dy = (event.touches[0]?.clientY ?? 0) - pull.current.y;
    pull.current.dy = dy;
    if (dy <= 0 || (scrollerRef.current?.scrollTop ?? 0) > 0) {
      ptr.style.opacity = "0";
      return;
    }
    const offset = Math.min(110, dy * 0.5);
    ptr.style.transition = "none";
    ptr.style.opacity = String(Math.min(1, offset / 60));
    ptr.style.transform = `translateY(${offset}px) rotate(${offset * 4}deg)`;
  };
  const onTouchEnd = () => {
    const ptr = ptrRef.current;
    const gesture = pull.current;
    pull.current = null;
    if (!ptr || !gesture) return;
    // Settle into the refreshing slot, then shrink away when done.
    ptr.style.transition =
      "transform var(--dur-short) var(--ease-out), opacity var(--dur-short)";
    if (gesture.dy * 0.5 > 64) {
      ptr.style.transform = "translateY(64px)";
      void load("refresh").finally(() => {
        ptr.style.transition = "transform 150ms var(--ease-in), opacity 150ms";
        ptr.style.transform = "translateY(64px) scale(0)";
        ptr.style.opacity = "0";
      });
    } else {
      ptr.style.transform = "";
      ptr.style.opacity = "0";
    }
  };

  const visible = useMemo(
    () => state.posts.filter((post) => !hidden.has(post.id)),
    [state.posts, hidden],
  );
  // Hiding a post: fade the card out, then let the rest of the list close
  // the gap, as a RecyclerView removal does.
  const feedRef = useRef<HTMLDivElement>(null);
  const pendingLayout = useRef<LayoutSnapshot | null>(null);
  const onHide = useCallback((id: string) => {
    const list = feedRef.current;
    const card = list?.querySelector<HTMLElement>(
      `[data-anim-key="${CSS.escape(id)}"]`,
    );
    void fadeOutRows(card ? [card] : []).then(() => {
      if (list) pendingLayout.current = snapshotLayout(list);
      setHidden((current) => new Set(current).add(id));
    });
  }, []);
  useLayoutEffect(() => {
    const before = pendingLayout.current;
    pendingLayout.current = null;
    if (before && feedRef.current) animateLayout(feedRef.current, before);
  }, [hidden]);

  const chooseSort = (next: FeedSort) => {
    if (next === "top" || next === "controversial") {
      nav.openSheet((onClosed) => (
        <Sheet title={`${sortLabel[next]} posts from…`} onClosed={onClosed}>
          {(close) =>
            TIMEFRAMES.map((t) => (
              <SheetItem
                key={t}
                icon="clock"
                label={timeframeLabel[t]}
                selected={sort === next && timeframe === t}
                onClick={() => {
                  close();
                  onSort(next, t);
                }}
              />
            ))
          }
        </Sheet>
      ));
    } else {
      onSort(next, timeframe);
    }
  };

  const subtitle =
    sort === "top" || sort === "controversial"
      ? `${sortLabel[sort]} · ${timeframeLabel[timeframe]}`
      : sortLabel[sort];

  return (
    <>
      <header ref={barRef} className={`appbar${raised ? " is-raised" : ""}`}>
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label="Open menu"
          onClick={nav.openDrawer}
        >
          <Icon name="menu" />
        </button>
        <button
          type="button"
          className="appbar-title"
          onClick={() =>
            scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
          }
          aria-label={`r/${sub}, ${subtitle}. Scroll to top`}
        >
          <span className="name">{sub === "Home" ? "Home" : `r/${sub}`}</span>
          <span className="sub">{subtitle}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label="Search"
          onClick={nav.openSearch}
        >
          <Icon name="search" />
        </button>
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label={`Layout: ${prefs.layout}. Switch layout`}
          onClick={() => update({ layout: NEXT_LAYOUT[prefs.layout] })}
        >
          <Icon name={LAYOUT_ICONS[prefs.layout]} />
        </button>
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label="Settings"
          onClick={nav.openSettings}
        >
          <Icon name="tune" />
        </button>
      </header>
      <div className="ptr" ref={ptrRef} aria-hidden>
        <span className={refreshing ? "is-spinning" : ""}>
          <Icon name="refresh" size={22} />
        </span>
      </div>
      <div
        className="scroller"
        ref={scrollerRef}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="appbar-spacer" />
        <div className="feed" data-layout={prefs.layout} ref={feedRef}>
          <div className="feed-banner">
            <Avatar name={sub} src={picture} />
            <div className="meta">
              <div className="title">{about?.title || `r/${sub}`}</div>
              <div className="stats">
                {about?.subscribers !== undefined
                  ? `${compact(about.subscribers)} members`
                  : "Community"}
                {about?.active ? ` · ${compact(about.active)} online` : ""}
              </div>
            </div>
            {refreshing ? <div className="spinner" /> : null}
          </div>
          <nav className="sort-strip" aria-label="Sort posts">
            {FEED_SORTS.map((option) => (
              <button
                key={option}
                type="button"
                className={`filter-chip${sort === option ? " is-selected" : ""}`}
                data-ripple
                aria-pressed={sort === option}
                onClick={() => chooseSort(option)}
              >
                <Icon name={sort === option ? "check" : SORT_ICONS[option]} />
                {sortLabel[option]}
                {(option === "top" || option === "controversial") &&
                sort === option ? (
                  <>
                    {" · "}
                    {timeframeLabel[timeframe]}
                    <Icon name="chevronDown" />
                  </>
                ) : null}
              </button>
            ))}
          </nav>

          {state.status === "loading" ? (
            <Skeletons layout={prefs.layout} />
          ) : null}

          {state.status === "error" && !state.posts.length ? (
            <FeedMessage icon="info" title="Couldn't load posts">
              <span>{state.error}</span>
              <button
                type="button"
                className="btn is-tonal"
                data-ripple
                onClick={() => void load("initial")}
              >
                <Icon name="refresh" /> Try again
              </button>
            </FeedMessage>
          ) : null}

          {state.status === "idle" && !visible.length ? (
            <FeedMessage icon="new" title="Nothing here yet">
              <span>No posts match this sort. Try another view.</span>
            </FeedMessage>
          ) : null}

          {visible.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              layout={prefs.layout}
              showThumbnails={prefs.showThumbnails}
              showSub={post.subreddit.toLowerCase() !== sub.toLowerCase()}
              onHide={onHide}
            />
          ))}

          <div ref={sentinelRef} />
          {state.status === "more" ? (
            <div className="feed-end">
              <div className="spinner" />
            </div>
          ) : null}
          {state.status === "error" && state.posts.length ? (
            <div className="feed-end">
              <span>{state.error}</span>
              <button
                type="button"
                className="btn is-tonal"
                data-ripple
                onClick={() => void load("more", state.after)}
              >
                Retry
              </button>
            </div>
          ) : null}
          {state.status === "idle" && state.posts.length && !state.after ? (
            <div className="feed-end">You're all caught up</div>
          ) : null}
        </div>
      </div>
    </>
  );
};
