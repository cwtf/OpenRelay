import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  FeedSort,
  InitResponse,
  PostSummary,
  Timeframe,
} from "../../shared/api";
import { Drawer } from "../components/Drawer";
import { Icon } from "../components/Icon";
import { MediaViewer } from "../components/MediaViewer";
import { SettingsSheet } from "../components/SettingsSheet";
import { fetchInit, entryRoute } from "../lib/api";
import { useSwipeBack } from "../lib/gestures";
import { resolveLink } from "../lib/links";
import { openUrl } from "../lib/platform";
import { paneLayout, setSelectedPost, useWindowSize } from "../lib/panes";
import { installRipple } from "../lib/ripple";
import { recentCommunities } from "../lib/storage";
import { ensureAccount } from "../lib/account";
import { ensureSubscriptions } from "../lib/subscriptions";
import { FeedScreen } from "../screens/FeedScreen";
import { PostScreen } from "../screens/PostScreen";
import { SearchScreen } from "../screens/SearchScreen";
import {
  ComposeScreen,
  FriendsScreen,
  InboxScreen,
  ModeratorScreen,
  ProfileScreen,
  SubmitScreen,
} from "../screens/AccountScreens";
import {
  NavContext,
  PaneContext,
  type Nav,
  type Session,
  type SheetRenderer,
  type ViewerSpec,
} from "./nav";
import { PrefsProvider, usePrefs } from "./prefs";

type Route =
  | {
      kind: "post";
      id: string;
      seed?: PostSummary | undefined;
      focus?: string | undefined;
    }
  | { kind: "search"; sub: string }
  | { kind: "profile"; user: string }
  | { kind: "inbox" }
  | { kind: "moderator" }
  | { kind: "friends" }
  | { kind: "submit"; sub?: string | undefined; post?: "self" | "link" | undefined }
  | { kind: "compose"; to?: string | undefined; subject?: string | undefined };
type Entry = {
  key: string;
  route: Route;
  phase: "entering" | "idle" | "exiting";
};

let keySeed = 0;
const nextKey = () => `s${++keySeed}`;

/** Deep link from the inline splash ("open this post"), consumed once. */
const initialStack = (): Entry[] => {
  if (entryRoute.postId)
    return [
      {
        key: nextKey(),
        route: { kind: "post", id: entryRoute.postId },
        phase: "idle",
      },
    ];
  if (entryRoute.query !== undefined)
    return [
      {
        key: nextKey(),
        route: { kind: "search", sub: entryRoute.sub },
        phase: "idle",
      },
    ];
  return [];
};

// ------------------------------------------------------------------ screen frame

type FrameProps = {
  entry: Entry;
  /** Shown in the right-hand pane of the dual-pane layout. */
  detail: boolean;
  covered: boolean;
  top: boolean;
  onEntered: (key: string) => void;
  onExited: (key: string) => void;
  onSwiped: (key: string) => void;
  children: ReactNode;
};

const ScreenFrame = ({
  entry,
  detail,
  covered,
  top,
  onEntered,
  onExited,
  onSwiped,
  children,
}: FrameProps) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useSwipeBack(ref, {
    enabled: top && !detail && entry.phase === "idle",
    onCommit: () => onSwiped(entry.key),
  });

  useEffect(() => {
    if (entry.phase === "idle") return;
    // Safety net if animationend is skipped (hidden document, reduced motion).
    const timer = window.setTimeout(
      () =>
        entry.phase === "exiting" ? onExited(entry.key) : onEntered(entry.key),
      800,
    );
    return () => window.clearTimeout(timer);
  }, [entry.phase, entry.key, onEntered, onExited]);

  const className = [
    "screen",
    detail ? "is-detail" : "screen-shadow",
    entry.phase === "entering" ? "is-entering" : "",
    entry.phase === "exiting" ? "is-exiting" : "",
    covered ? "is-covered" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className={className}
      aria-hidden={covered || undefined}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (entry.phase === "exiting") onExited(entry.key);
        else if (entry.phase === "entering") onEntered(entry.key);
      }}
    >
      <PaneContext.Provider value={detail ? "detail" : "screen"}>
        {children}
      </PaneContext.Provider>
    </div>
  );
};

// ------------------------------------------------------------------ reader

const Reader = ({ init }: { init: InitResponse }) => {
  const { prefs, hydrate } = usePrefs();
  const windowSize = useWindowSize();
  const panes = paneLayout(windowSize.width, windowSize.height, {
    portrait: prefs.paneModePortrait,
    landscape: prefs.paneModeLandscape,
  });
  const session = useMemo<Session>(
    () => ({
      home: init.subreddit,
      username: init.username,
      loggedIn: init.loggedIn,
      featured: init.featured,
      defaultSort: init.defaultSort,
    }),
    [init],
  );
  const [current, setCurrent] = useState(init.subreddit);
  const [sort, setSort] = useState<FeedSort>(init.defaultSort);
  const [timeframe, setTimeframe] = useState<Timeframe>(entryRoute.timeframe);
  const [stack, setStack] = useState<Entry[]>(initialStack);
  /** The post in the right-hand pane while the layout is dual pane. */
  const [detail, setDetail] = useState<Entry | null>(null);
  const [sheet, setSheet] = useState<{
    key: number;
    render: SheetRenderer;
  } | null>(null);
  const [viewer, setViewer] = useState<ViewerSpec | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [localToast, setLocalToast] = useState<{
    id: number;
    text: string;
  } | null>(null);

  const stackRef = useRef(stack);
  const detailRef = useRef(detail);
  const dualRef = useRef(panes.dual);
  const overlayRef = useRef({ sheet, viewer, drawer });
  useLayoutEffect(() => {
    stackRef.current = stack;
    detailRef.current = detail;
    dualRef.current = panes.dual;
    overlayRef.current = { sheet, viewer, drawer };
  });
  const pushedStates = useRef(0);
  const pendingBack = useRef<number | null>(null);
  const ignorePops = useRef(0);

  useEffect(() => {
    if (init.prefs) hydrate(init.prefs);
  }, [init.prefs, hydrate]);

  useEffect(() => installRipple(), []);

  // Load the viewer's subscribed communities in the background for the drawer.
  useEffect(() => {
    ensureAccount();
    ensureSubscriptions();
  }, []);

  useEffect(() => {
    const onToast = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      setLocalToast({ id: Date.now(), text });
    };
    window.addEventListener("openrelay:toast", onToast);
    return () => window.removeEventListener("openrelay:toast", onToast);
  }, []);

  useEffect(() => {
    if (!localToast) return;
    const timer = window.setTimeout(() => setLocalToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [localToast]);

  // -- stack primitives

  const pushState = () => {
    try {
      window.history.pushState({ openrelay: true }, "");
      pushedStates.current++;
    } catch {
      // History may be unavailable in some embeds; in-app back still works.
    }
  };

  const push = useCallback((route: Route) => {
    setStack((current) => [
      ...current,
      { key: nextKey(), route, phase: "entering" },
    ]);
    pushState();
  }, []);

  const popScreen = useCallback(() => {
    // With no full-screen page open, back closes the right-hand pane.
    if (
      detailRef.current &&
      !stackRef.current.some((entry) => entry.phase !== "exiting")
    ) {
      detailRef.current = null;
      setDetail(null);
      return;
    }
    setStack((current) => {
      const index = current.map((entry) => entry.phase).lastIndexOf("idle");
      const alt =
        index === -1
          ? current.map((entry) => entry.phase).lastIndexOf("entering")
          : index;
      if (alt === -1) return current;
      return current.map((entry, i) =>
        i === alt ? { ...entry, phase: "exiting" } : entry,
      );
    });
  }, []);

  /** Close the top-most thing: viewer, sheet, drawer, then screens. */
  const dismissTop = useCallback((): boolean => {
    const overlays = overlayRef.current;
    if (overlays.viewer) {
      setViewer(null);
      return true;
    }
    if (overlays.sheet) {
      setSheet(null);
      return true;
    }
    if (overlays.drawer) {
      setDrawer(false);
      return true;
    }
    if (
      detailRef.current ||
      stackRef.current.some((entry) => entry.phase !== "exiting")
    ) {
      popScreen();
      return true;
    }
    return false;
  }, [popScreen]);

  useEffect(() => {
    const onPop = () => {
      if (ignorePops.current > 0) {
        ignorePops.current--;
        return;
      }
      pushedStates.current = Math.max(0, pushedStates.current - 1);
      if (pendingBack.current !== null) {
        window.clearTimeout(pendingBack.current);
        pendingBack.current = null;
        popScreen();
        return;
      }
      // Hardware / browser back: close overlays first, keeping history in sync.
      const overlays = overlayRef.current;
      if (overlays.viewer || overlays.sheet || overlays.drawer) {
        dismissTop();
        pushState();
        return;
      }
      popScreen();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [dismissTop, popScreen]);

  const back = useCallback(() => {
    if (pushedStates.current > 0) {
      try {
        pendingBack.current = window.setTimeout(() => {
          // popstate never arrived; fall back to an in-app pop.
          pendingBack.current = null;
          pushedStates.current = Math.max(0, pushedStates.current - 1);
          popScreen();
        }, 350);
        window.history.back();
        return;
      } catch {
        // fall through
      }
    }
    popScreen();
  }, [popScreen]);

  const onEntered = useCallback((key: string) => {
    setStack((current) =>
      current.map((entry) =>
        entry.key === key && entry.phase === "entering"
          ? { ...entry, phase: "idle" }
          : entry,
      ),
    );
  }, []);

  const onExited = useCallback((key: string) => {
    setStack((current) => current.filter((entry) => entry.key !== key));
  }, []);

  const onSwiped = useCallback((key: string) => {
    setStack((entries) => entries.filter((entry) => entry.key !== key));
    if (pushedStates.current > 0) {
      ignorePops.current++;
      pushedStates.current--;
      try {
        window.history.back();
      } catch {
        ignorePops.current--;
      }
    }
  }, []);

  // -- navigation API

  const openCommunity = useCallback(
    (name: string) => {
      setCurrent(name);
      if (name.toLowerCase() !== init.subreddit.toLowerCase())
        recentCommunities.add(name);
      setStack((entries) => {
        const live = entries.filter((entry) => entry.phase !== "exiting");
        const top = live[live.length - 1];
        return top ? [{ ...top, phase: "exiting" }] : [];
      });
    },
    [init.subreddit],
  );

  const openPost = useCallback(
    (post: PostSummary | string, focus?: string) => {
      const route: Route =
        typeof post === "string"
          ? {
              kind: "post",
              id: post.startsWith("t3_") ? post : `t3_${post}`,
              focus,
            }
          : { kind: "post", id: post.id, seed: post, focus };
      const fullScreen = stackRef.current.some(
        (entry) => entry.phase !== "exiting",
      );
      if (!dualRef.current || fullScreen) {
        push(route);
        return;
      }
      // Dual pane: the post replaces whatever the right-hand pane shows. Only
      // the first one adds a history entry, so back closes the pane.
      const shown = detailRef.current;
      if (shown?.route.kind === "post" && shown.route.id === route.id && !focus)
        return;
      if (!shown) pushState();
      const entry: Entry = { key: nextKey(), route, phase: "idle" };
      detailRef.current = entry;
      setDetail(entry);
    },
    [push],
  );

  // Moving between single and dual pane keeps the open post: it becomes the
  // right-hand pane, or the bottom full-screen page, under the same key.
  useLayoutEffect(() => {
    if (panes.dual) {
      const first = stackRef.current[0];
      if (
        detailRef.current ||
        first?.route.kind !== "post" ||
        first.phase === "exiting"
      )
        return;
      const entry: Entry = { ...first, phase: "idle" };
      detailRef.current = entry;
      setDetail(entry);
      setStack((entries) => entries.filter((other) => other.key !== first.key));
    } else {
      const shown = detailRef.current;
      if (!shown) return;
      detailRef.current = null;
      setDetail(null);
      setStack((entries) => [shown, ...entries]);
    }
  }, [panes.dual]);

  useEffect(() => {
    setSelectedPost(
      panes.dual && detail?.route.kind === "post" ? detail.route.id : null,
    );
  }, [panes.dual, detail]);

  const openLink = useCallback(
    (href: string) => {
      const target = resolveLink(href);
      if (!target) return;
      if (target.kind === "post") openPost(target.id);
      else if (target.kind === "sub") openCommunity(target.name);
      else openUrl(target.url);
    },
    [openPost, openCommunity],
  );

  const openSheet = useCallback((render: SheetRenderer) => {
    setSheet({ key: Date.now() + Math.random(), render });
  }, []);

  const nav = useMemo<Nav>(
    () => ({
      session,
      current,
      openPost,
      openCommunity,
      openSearch: () => push({ kind: "search", sub: current }),
      back,
      openLink,
      openProfile: (user) => push({ kind: "profile", user }),
      openInbox: () => push({ kind: "inbox" }),
      openModerator: () => push({ kind: "moderator" }),
      openFriends: () => push({ kind: "friends" }),
      openSubmit: (sub, post) => push({ kind: "submit", sub, post }),
      openCompose: (draft) => push({ kind: "compose", ...draft }),
      openMedia: (spec) => setViewer(spec),
      openSheet,
      openDrawer: () => setDrawer(true),
      openSettings: () =>
        openSheet((onClosed) => (
          <SettingsSheet onClosed={onClosed} synced={session.loggedIn} />
        )),
    }),
    [
      session,
      current,
      openPost,
      openCommunity,
      push,
      back,
      openLink,
      openSheet,
    ],
  );

  // Give a deep-linked first screen a history entry so back returns to the feed.
  useEffect(() => {
    if (stackRef.current.length || detailRef.current) pushState();
  }, []);

  const live = stack.filter((entry) => entry.phase !== "exiting");
  const feedCovered = live.length > 0;
  // The right-hand pane renders in the same keyed list as the full-screen
  // pages, so moving a post between them keeps it mounted.
  const frames = detail ? [detail, ...stack] : stack;

  return (
    <NavContext.Provider value={nav}>
      <div
        className={[
          "app",
          panes.dual ? "is-dual" : "",
          panes.dual && panes.wide ? "is-wide" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          className={`screen is-feed${feedCovered ? " is-covered" : ""}`}
          aria-hidden={feedCovered || undefined}
        >
          <FeedScreen
            sub={current}
            sort={sort}
            timeframe={timeframe}
            onSort={(nextSort, nextTime) => {
              setSort(nextSort);
              setTimeframe(nextTime);
            }}
          />
        </div>
        {panes.dual && !detail ? (
          <div
            className={`pane-empty${feedCovered ? " is-covered" : ""}`}
            aria-hidden={feedCovered || undefined}
          >
            <Icon name="comment" size={40} />
            <span>Select a post to read it here</span>
          </div>
        ) : null}
        {frames.map((entry, index) => {
          const covered = frames
            .slice(index + 1)
            .some((other) => other.phase !== "exiting");
          const isTop = !covered && entry.phase !== "exiting";
          return (
            <ScreenFrame
              key={entry.key}
              entry={entry}
              detail={entry === detail}
              covered={covered}
              top={isTop}
              onEntered={onEntered}
              onExited={onExited}
              onSwiped={onSwiped}
            >
              {entry.route.kind === "post" ? (
                <PostScreen
                  postId={entry.route.id}
                  seed={entry.route.seed}
                  focus={entry.route.focus}
                />
              ) : entry.route.kind === "search" ? (
                <SearchScreen sub={entry.route.sub} />
              ) : entry.route.kind === "profile" ? (
                <ProfileScreen user={entry.route.user} />
              ) : entry.route.kind === "inbox" ? (
                <InboxScreen />
              ) : entry.route.kind === "moderator" ? (
                <ModeratorScreen />
              ) : entry.route.kind === "friends" ? (
                <FriendsScreen />
              ) : entry.route.kind === "submit" ? (
                <SubmitScreen sub={entry.route.sub} kind={entry.route.post} />
              ) : (
                <ComposeScreen to={entry.route.to} subject={entry.route.subject} />
              )}
            </ScreenFrame>
          );
        })}
        {drawer ? <Drawer onClosed={() => setDrawer(false)} /> : null}
        {sheet ? (
          <Fragment key={sheet.key}>
            {sheet.render(() =>
              setSheet((currentSheet) =>
                currentSheet?.key === sheet.key ? null : currentSheet,
              ),
            )}
          </Fragment>
        ) : null}
        {viewer ? (
          <MediaViewer spec={viewer} onClosed={() => setViewer(null)} />
        ) : null}
        {localToast ? (
          <div className="toast" key={localToast.id} role="status">
            {localToast.text}
          </div>
        ) : null}
      </div>
    </NavContext.Provider>
  );
};

// ------------------------------------------------------------------ root

const BootScreen = ({
  error,
  onRetry,
}: {
  error?: string;
  onRetry: () => void;
}) => (
  <div className="app">
    <div className="screen">
      <header className="appbar is-static">
        <span className="icon-btn" />
        <div className="appbar-title">
          <span className="skel" style={{ width: 140, height: 16 }} />
        </div>
      </header>
      <div className="scroller">
        {error ? (
          <div className="feed-state">
            <strong>OpenRelay couldn't start</strong>
            <span>{error}</span>
            <button type="button" className="btn is-tonal" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : (
          <div className="feed" data-layout="cards">
            {Array.from({ length: 3 }, (_, index) => (
              <div className="skeleton-card" key={index}>
                <div className="skel" style={{ width: "40%", height: 12 }} />
                <div className="skel" style={{ width: "90%", height: 16 }} />
                <div
                  className="skel"
                  style={{ width: "100%", height: 160, borderRadius: 10 }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);

export const Root = () => {
  const [init, setInit] = useState<InitResponse | null>(null);
  const [error, setError] = useState<string | undefined>();

  const boot = useCallback(() => {
    fetchInit()
      .then(setInit)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unknown error");
      });
  }, []);

  useEffect(boot, [boot]);

  return (
    <PrefsProvider canSync={Boolean(init?.loggedIn)}>
      {init ? (
        <Reader init={init} />
      ) : (
        <BootScreen
          onRetry={() => {
            setError(undefined);
            boot();
          }}
          {...(error ? { error } : {})}
        />
      )}
    </PrefsProvider>
  );
};
