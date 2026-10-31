import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Community } from "../../shared/api";
import { useNav } from "../app/nav";
import { compact, hueOf } from "../lib/format";
import { readJson, writeJson } from "../lib/storage";
import { recentCommunities } from "../lib/site";
import {
  ensureSubscriptions,
  isFavourite,
  refreshSubscriptions,
  toggleFavourite,
  useFavourites,
  useSubscriptions,
} from "../lib/subscriptions";
import { ensureAccount, useAccount } from "../lib/account";
import { runAction, searchCommunities, site } from "../lib/api";
import { compact as compactNumber } from "../lib/format";
import { promptLogin, toast } from "../lib/platform";
import { offlineAvailable, offlineFeed } from "../lib/offline";
import {
  addInstance,
  currentSource,
  removeInstance,
  switchSource,
  useSources,
  type Source,
} from "../lib/sources";
import { SaveFeedSheet } from "./SaveFeedSheet";
import { Avatar, useAbout, useFeedPicture } from "../screens/FeedScreen";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";
import { readerHost } from "../../hosts/reader";

const USER_RE = /^[\w-]{3,20}(?:@[a-z0-9.-]{1,253})?$/i;

const GoToUserSheet = ({
  onGo,
  onClosed,
}: {
  onGo: (name: string) => void;
  onClosed: () => void;
}) => {
  const [draft, setDraft] = useState("");
  const name = draft.trim().replace(/^\/?u(?:ser)?\/|^@/i, "");
  return (
    <Sheet title="Go to user" onClosed={onClosed}>
      {(close) => (
        <form
          className="drawer-search user-go"
          onSubmit={(event) => {
            event.preventDefault();
            if (!USER_RE.test(name)) return;
            close();
            onGo(name);
          }}
        >
          <Icon name="user" size={20} />
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="u/username"
            aria-label="Username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button
            type="submit"
            className="btn is-tonal"
            disabled={!USER_RE.test(name)}
          >
            Go
          </button>
        </form>
      )}
    </Sheet>
  );
};

const AddInstanceSheet = ({ onClosed }: { onClosed: () => void }) => {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  return (
    <Sheet title="Add Lemmy instance" onClosed={onClosed}>
      {(close) => (
        <>
          <form
            className="drawer-search user-go"
            onSubmit={(event) => {
              event.preventDefault();
              void addInstance(draft).then((added) => {
                if ("error" in added) return setError(added.error);
                close();
                toast(`Added ${added.host}`);
              });
            }}
          >
            <Icon name="globe" size={20} />
            <input
              autoFocus
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError("");
              }}
              placeholder="lemmy.world"
              aria-label="Instance address"
              aria-invalid={error ? true : undefined}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              enterKeyHint="done"
            />
            <button
              type="submit"
              className="btn is-tonal"
              disabled={!draft.trim()}
            >
              Add
            </button>
          </form>
          <p className="sub-hint source-hint" role={error ? "alert" : undefined}>
            {error ||
              (readerHost().instances
                ? "OpenRelay opens on the instance as it does on Reddit."
                : "Here the instance opens in its own web app.")}
          </p>
        </>
      )}
    </Sheet>
  );
};

/**
 * Relay's account switcher, for sites: the current source, and when opened
 * the others and "Add Lemmy instance". Switching loads the site in this tab.
 */
const SourceSwitcher = ({ onSwitch }: { onSwitch: () => void }) => {
  const nav = useNav();
  const sources = useSources();
  const current = currentSource();
  const [open, setOpen] = useState(false);
  const others = sources.filter((source) => source.id !== current?.id);
  const icon = (source: Source | null): IconName =>
    !source ? "book" : source.kind === "reddit" ? "subreddit" : "globe";
  return (
    <>
      <button
        type="button"
        className="drawer-item source-current"
        data-ripple
        aria-expanded={open}
        aria-controls="drawer-sources"
        onClick={() => setOpen(!open)}
      >
        <Icon name={icon(current)} />
        <span className="label">{current?.label ?? "Saved for offline"}</span>
        <Icon name={open ? "chevronUp" : "chevronDown"} />
      </button>
      {open ? (
        <div id="drawer-sources" role="group" aria-label="Switch source">
          {others.map((source) => (
            <div key={source.id} className="source-row">
              <button
                type="button"
                className="drawer-item"
                data-ripple
                onClick={() => {
                  onSwitch();
                  switchSource(source);
                }}
              >
                <Icon name={icon(source)} />
                <span className="label">{source.label}</span>
              </button>
              {source.kind === "lemmy" ? (
                <button
                  type="button"
                  className="icon-btn source-remove"
                  aria-label={`Remove ${source.label}`}
                  title={`Remove ${source.label}`}
                  onClick={() => void removeInstance(source.id)}
                >
                  <Icon name="close" size={20} />
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="drawer-item"
            data-ripple
            onClick={() =>
              nav.openSheet((onSheetClosed) => (
                <AddInstanceSheet onClosed={onSheetClosed} />
              ))
            }
          >
            <Icon name="addCircle" />
            <span className="label">Add Lemmy instance</span>
          </button>
        </div>
      ) : null}
      <div className="drawer-sep" />
    </>
  );
};

// ------------------------------------------------------------------ community rows
// Modelled on Relay's subscription list: full-width 48px rows with a 40px
// round icon, a 16px name and a star that keeps a community in Favourites.

const CommunityIcon = ({ name, info }: { name: string; info?: Community }) => {
  const [failed, setFailed] = useState(false);
  if (info?.icon && !failed)
    return (
      <img
        className="avatar sub-icon"
        src={info.icon}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  return (
    <span
      className="avatar sub-icon"
      style={
        info?.color
          ? { background: info.color }
          : { ["--hue" as string]: hueOf(name.toLowerCase()) }
      }
      aria-hidden
    >
      {name.slice(0, 1)}
    </span>
  );
};

const CommunityRow = ({
  name,
  info,
  active,
  onGo,
  label,
  feedIcon,
  starrable = true,
}: {
  name: string;
  info?: Community | undefined;
  active: boolean;
  onGo: (name: string) => void;
  label?: string;
  feedIcon?: IconName;
  starrable?: boolean;
}) => {
  const starred = starrable && isFavourite(name);
  return (
    <div className={`sub-row${active ? " is-active" : ""}`}>
      <button
        type="button"
        className="sub-row-main"
        data-ripple
        onClick={() => onGo(name)}
      >
        {feedIcon ? (
          <span className="avatar sub-icon is-feed" aria-hidden>
            <Icon name={feedIcon} size={22} />
          </span>
        ) : (
          <CommunityIcon name={name} {...(info ? { info } : {})} />
        )}
        <span className="label">{label ?? name}</span>
        {info?.nsfw ? <span className="sub-nsfw">NSFW</span> : null}
      </button>
      {starrable ? (
        <button
          type="button"
          className={`icon-btn sub-star${starred ? " is-on" : ""}`}
          aria-pressed={starred}
          aria-label={
            starred
              ? `Remove ${site.communityLabel(name)} from Favourites`
              : `Add ${site.communityLabel(name)} to Favourites`
          }
          onClick={() => toggleFavourite(name)}
        >
          <Icon name={starred ? "starFilled" : "star"} size={22} />
        </button>
      ) : null}
    </div>
  );
};

// ------------------------------------------------------------------ live search
// As in Relay, the search pill queries Reddit while you type and lists the
// matches in a results card, each with a subscribe button.

const searchCache = new Map<string, Community[]>();

/** Reddit's community suggestions for `text`, debounced while typing. */
const useCommunitySearch = (text: string) => {
  const key = text.trim().toLowerCase();
  const [state, setState] = useState<{
    key: string;
    results: Community[];
    loading: boolean;
    error: string;
  }>({ key: "", results: [], loading: false, error: "" });
  useEffect(() => {
    if (key.length < 2) {
      setState({ key, results: [], loading: false, error: "" });
      return;
    }
    const cached = searchCache.get(key);
    if (cached) {
      setState({ key, results: cached, loading: false, error: "" });
      return;
    }
    setState((current) => ({ ...current, key, loading: true, error: "" }));
    let live = true;
    const timer = window.setTimeout(() => {
      searchCommunities(key)
        .then((results) => {
          searchCache.set(key, results);
          if (live) setState({ key, results, loading: false, error: "" });
        })
        .catch((error: unknown) => {
          if (live)
            setState({
              key,
              results: [],
              loading: false,
              error: error instanceof Error ? error.message : "Search failed",
            });
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key]);
  // Results for an older query stay visible until the new ones arrive.
  return state;
};

/** Relay's double-line search result: icon, name, details and subscribe. */
const SearchResultRow = ({
  community,
  active,
  onGo,
  canSubscribe,
}: {
  community: Community;
  active: boolean;
  onGo: (name: string) => void;
  canSubscribe: boolean;
}) => {
  const [subscribed, setSubscribed] = useState(community.subscribed ?? false);
  const [busy, setBusy] = useState(false);
  const details = [
    community.subscribers !== undefined
      ? `${compactNumber(community.subscribers)} members`
      : "",
  ].filter(Boolean);
  const toggle = () => {
    if (busy) return;
    setBusy(true);
    runAction("subscribe", {
      action: subscribed ? "unsub" : "sub",
      sr: community.name,
    })
      .then(() => {
        community.subscribed = !subscribed;
        setSubscribed(!subscribed);
        toast(subscribed ? `Left ${site.communityLabel(community.name)}` : `Joined ${site.communityLabel(community.name)}`);
        void refreshSubscriptions();
      })
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : `${site.name} could not do that.`),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className={`sub-row is-double${active ? " is-active" : ""}`}>
      <button
        type="button"
        className="sub-row-main"
        data-ripple
        onClick={() => onGo(community.name)}
      >
        <CommunityIcon name={community.name} info={community} />
        <span className="lines">
          <span className="label">{community.name}</span>
          <span className="detail">
            {site.communityLabel(community.name)}
            {details.length ? ` · ${details.join(" · ")}` : ""}
            {community.nsfw ? <span className="sub-nsfw">NSFW</span> : null}
          </span>
        </span>
      </button>
      {canSubscribe ? (
        <button
          type="button"
          className={`icon-btn sub-star${subscribed ? " is-on" : ""}`}
          aria-pressed={subscribed}
          aria-label={
            subscribed
              ? `Unsubscribe from ${site.communityLabel(community.name)}`
              : `Subscribe to ${site.communityLabel(community.name)}`
          }
          disabled={busy}
          onClick={toggle}
        >
          <Icon name={subscribed ? "checkCircle" : "addCircle"} size={22} />
        </button>
      ) : null}
    </div>
  );
};

type SectionId = "feeds" | "favourites" | "recent" | "subscriptions";

const SectionHeader = ({
  id,
  title,
  count,
  open,
  onToggle,
  action,
}: {
  id: SectionId;
  title: string;
  count?: number;
  open: boolean;
  onToggle: (id: SectionId) => void;
  action?: ReactNode;
}) => (
  <div className="sub-header">
    <button
      type="button"
      className="sub-header-label"
      data-ripple
      aria-expanded={open}
      onClick={() => onToggle(id)}
    >
      {title}
      {count ? <span className="count">{count}</span> : null}
    </button>
    {action}
    <button
      type="button"
      className="icon-btn sub-header-chevron"
      aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
      onClick={() => onToggle(id)}
    >
      <Icon name={open ? "chevronUp" : "chevronDown"} />
    </button>
  </div>
);

const SkeletonRows = () => (
  <>
    {Array.from({ length: 6 }, (_, index) => (
      <div className="sub-row is-skeleton" key={index} aria-hidden>
        <span className="avatar sub-icon skel" />
        <span
          className="skel"
          style={{ width: `${40 + ((index * 17) % 36)}%`, height: 14 }}
        />
      </div>
    ))}
  </>
);

const FEED_ICONS: Record<string, IconName> = {
  home: "home",
  popular: "rising",
  all: "globe",
};

const feedLabel = (name: string) =>
  name.slice(0, 1).toUpperCase() + name.slice(1);

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

/** Home plus the featured feeds (Popular), which are not communities. */
const feedNames = (featured: string[]) => [...new Set(["Home", ...featured])];

/**
 * Relay's community list: the "Subreddit search…" pill, then Feeds,
 * Favourites, Recent and Subscriptions. Typing filters every known community
 * or offers to open the typed name. Used by the drawer and by the sheet that
 * opens from the feed title. `before`/`after` add rows around the sections.
 */
export const CommunityList = ({
  onGo,
  bodyClassName,
  before,
  after,
  autoFocus,
}: {
  onGo: (name: string) => void;
  bodyClassName: string;
  before?: ReactNode;
  after?: ReactNode;
  autoFocus?: boolean;
}) => {
  const { session, current } = useNav();
  const account = useAccount();
  const subscriptions = useSubscriptions();
  const favourites = useFavourites();
  const [query, setQuery] = useState("");
  const remote = useCommunitySearch(query.trim().replace(/^\/?r\//i, ""));
  const [collapsed, setCollapsed] = useState<
    Partial<Record<SectionId, boolean>>
  >(() => readJson("drawer-collapsed", {}));

  useEffect(() => ensureSubscriptions(), []);

  const toggle = (id: SectionId) =>
    setCollapsed((state) => {
      const next = { ...state, [id]: !state[id] };
      writeJson("drawer-collapsed", next);
      return next;
    });

  const known = useMemo(() => {
    const map = new Map<string, Community>();
    for (const item of subscriptions.items)
      map.set(item.name.toLowerCase(), item);
    return map;
  }, [subscriptions.items]);
  const info = (name: string) => known.get(name.toLowerCase());
  const isActive = (name: string) =>
    name.toLowerCase() === current.toLowerCase();

  const feeds = feedNames(session.featured);
  const special = new Set(feeds.map((name) => name.toLowerCase()));
  const recent = recentCommunities
    .values()
    .filter((name) => !special.has(name.toLowerCase()));

  const row = (name: string) => (
    <CommunityRow
      key={name}
      name={name}
      info={info(name)}
      active={isActive(name)}
      onGo={onGo}
    />
  );

  // Search filters every known community; a valid name can be opened directly.
  const typed = query.trim().replace(/^\/?[rc]\/|^!/i, "");
  const needle = typed.toLowerCase();
  const matches: string[] = [];
  if (needle) {
    const seen = new Set<string>(special);
    for (const name of [
      ...favourites,
      ...subscriptions.items.map((item) => item.name),
      ...recent,
    ]) {
      const key = name.toLowerCase();
      if (!key.includes(needle) || seen.has(key)) continue;
      seen.add(key);
      matches.push(name);
    }
    matches.sort(
      (a, b) =>
        Number(!a.toLowerCase().startsWith(needle)) -
          Number(!b.toLowerCase().startsWith(needle)) || byName(a, b),
    );
  }
  // Reddit's suggestions, minus communities already listed above them.
  const listed = new Set(matches.map((name) => name.toLowerCase()));
  const found = remote.results.filter(
    (community) => !listed.has(community.name.toLowerCase()),
  );
  const searching = needle.length >= 2 && (remote.loading || remote.key !== needle);
  const showTyped =
    site.validCommunityName(typed) &&
    !matches.some((name) => name.toLowerCase() === needle) &&
    !found.some((community) => community.name.toLowerCase() === needle);

  const subsOpen = !collapsed.subscriptions;
  const syncing = subscriptions.status === "loading";

  return (
    <>
      <form
        className="drawer-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          // Enter opens the first row shown.
          const target = showTyped ? typed : (matches[0] ?? found[0]?.name);
          if (target) onGo(target);
        }}
      >
        <Icon name="search" size={20} />
        <input
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !query) return;
            // Clear the search first; a second Escape closes the panel.
            event.nativeEvent.stopImmediatePropagation();
            setQuery("");
          }}
          placeholder="Subreddit search…"
          aria-label="Search or go to a community"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        {searching ? (
          <span className="spinner search-progress" aria-label="Searching" />
        ) : null}
        {query ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Clear community search"
            onClick={() => setQuery("")}
          >
            <Icon name="close" size={20} />
          </button>
        ) : null}
      </form>
      <div className={bodyClassName}>
        {needle ? (
          <>
            {showTyped ? (
              <CommunityRow
                name={typed}
                info={info(typed)}
                active={isActive(typed)}
                onGo={onGo}
                label={`Go to ${site.communityLabel(typed)}`}
                starrable={false}
              />
            ) : null}
            {matches.length ? (
              <div className="sub-label">Your communities</div>
            ) : null}
            {matches.slice(0, 60).map(row)}
            {needle.length >= 2 ? (
              <div className="search-results" aria-live="polite">
                <div className="sub-label">Communities on {site.name}</div>
                {found.map((community) => (
                  <SearchResultRow
                    key={community.name}
                    community={community}
                    active={isActive(community.name)}
                    onGo={onGo}
                    canSubscribe={site.features.writes && Boolean(account)}
                  />
                ))}
                {searching && !found.length ? <SkeletonRows /> : null}
                {!searching && remote.error ? (
                  <p className="sub-hint">{remote.error}</p>
                ) : null}
                {!searching && !remote.error && !found.length ? (
                  <p className="sub-hint">
                    {matches.length
                      ? "No other communities found."
                      : "No communities found."}
                  </p>
                ) : null}
              </div>
            ) : !showTyped && !matches.length ? (
              <p className="sub-hint">No matching communities.</p>
            ) : null}
          </>
        ) : (
          <>
            {before}

            <SectionHeader
              id="feeds"
              title="Feeds"
              open={!collapsed.feeds}
              onToggle={toggle}
            />
            {!collapsed.feeds
              ? feeds.map((name) => (
                  <CommunityRow
                    key={name}
                    name={name}
                    active={isActive(name)}
                    onGo={onGo}
                    label={feedLabel(name)}
                    feedIcon={FEED_ICONS[name.toLowerCase()] ?? "people"}
                    starrable={false}
                  />
                ))
              : null}

            {favourites.length ? (
              <>
                <SectionHeader
                  id="favourites"
                  title="Favourites"
                  count={favourites.length}
                  open={!collapsed.favourites}
                  onToggle={toggle}
                />
                {!collapsed.favourites ? favourites.map(row) : null}
              </>
            ) : null}

            {recent.length ? (
              <>
                <SectionHeader
                  id="recent"
                  title="Recent"
                  open={!collapsed.recent}
                  onToggle={toggle}
                />
                {!collapsed.recent ? recent.map(row) : null}
              </>
            ) : null}

            <SectionHeader
              id="subscriptions"
              title="Subscriptions"
              count={subscriptions.items.length}
              open={subsOpen}
              onToggle={toggle}
              action={
                subscriptions.status !== "signed-out" ? (
                  <button
                    type="button"
                    className={`icon-btn sub-sync${syncing ? " is-syncing" : ""}`}
                    aria-label="Re-sync subscriptions"
                    title="Re-sync subscriptions"
                    disabled={syncing}
                    onClick={() => void refreshSubscriptions()}
                  >
                    <Icon name="refresh" size={20} />
                  </button>
                ) : null
              }
            />
            {subsOpen ? (
              subscriptions.items.length ? (
                subscriptions.items.map((item) => row(item.name))
              ) : subscriptions.status === "loading" ||
                subscriptions.status === "idle" ? (
                <SkeletonRows />
              ) : subscriptions.status === "signed-out" ? (
                <p className="sub-hint">
                  Sign in to {site.name} in this browser to see your subscribed
                  communities here.{" "}
                  <button
                    type="button"
                    className="sub-link"
                    onClick={() => void refreshSubscriptions()}
                  >
                    Check again
                  </button>
                </p>
              ) : subscriptions.status === "error" ? (
                <p className="sub-hint">
                  {subscriptions.error ?? "Could not load subscriptions."}{" "}
                  <button
                    type="button"
                    className="sub-link"
                    onClick={() => void refreshSubscriptions()}
                  >
                    Retry
                  </button>
                </p>
              ) : (
                <p className="sub-hint">
                  You are not subscribed to any communities yet.
                </p>
              )
            ) : null}
          </>
        )}
        {after}
      </div>
    </>
  );
};

/**
 * Relay's subscriptions bottom sheet, opened by tapping the feed title:
 * the search pill on top and the community list below it.
 */
export const SubredditSheet = ({ onClosed }: { onClosed: () => void }) => {
  const nav = useNav();
  return (
    <Sheet label="Subreddit search" className="is-tall" onClosed={onClosed}>
      {(close) => (
        <CommunityList
          autoFocus
          bodyClassName="subs-sheet-body"
          onGo={(name) => {
            close();
            nav.openCommunity(name);
          }}
        />
      )}
    </Sheet>
  );
};

type DrawerProps = { onClosed: () => void };

export const Drawer = ({ onClosed }: DrawerProps) => {
  const nav = useNav();
  const { session, current } = nav;
  const about = useAbout(current);
  const picture = useFeedPicture(current, about);
  const account = useAccount();
  const [closing, setClosing] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; dx: number } | null>(null);

  const close = useCallback(() => setClosing(true), []);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClosed, 320);
    return () => window.clearTimeout(timer);
  }, [closing, onClosed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Keep the inbox count reasonably current.
  useEffect(() => ensureAccount(60 * 1000), []);

  const special = new Set(
    feedNames(session.featured).map((name) => name.toLowerCase()),
  );
  const item = (
    icon: IconName,
    label: string,
    onClick: () => void,
    extra?: ReactNode,
  ) => (
    <button
      type="button"
      className="drawer-item"
      data-ripple
      onClick={() => {
        close();
        onClick();
      }}
    >
      <Icon name={icon} />
      <span className="label">{label}</span>
      {extra}
    </button>
  );

  return (
    <div className={`layer has-drawer${closing ? " is-closing" : ""}`}>
      <div className="scrim" onClick={close} />
      <nav
        ref={panel}
        className="drawer"
        aria-label="Communities"
        style={{ ["--hue" as string]: hueOf(current.toLowerCase()) }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          drag.current = { x: event.clientX, dx: 0 };
        }}
        onPointerMove={(event) => {
          if (!drag.current || !panel.current) return;
          drag.current.dx = Math.min(0, event.clientX - drag.current.x);
          if (drag.current.dx < -12) {
            panel.current.classList.add("is-dragging");
            panel.current.style.transform = `translateX(${drag.current.dx}px)`;
          }
        }}
        onPointerUp={() => {
          const state = drag.current;
          drag.current = null;
          const el = panel.current;
          if (!state || !el) return;
          el.classList.remove("is-dragging");
          if (state.dx < -80) {
            el.style.transition = "transform 180ms var(--ease-in)";
            el.style.transform = "translateX(-100%)";
            close();
          } else {
            el.style.transition = "transform 200ms var(--ease-emph)";
            el.style.transform = "";
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          if (panel.current) panel.current.style.transform = "";
        }}
      >
        <div className="drawer-head">
          <Avatar name={current} size="large" src={picture} />
          <div className="title">{about?.title || site.communityLabel(current)}</div>
          <div className="subtitle">{site.communityLabel(current)}</div>
          <div className="numbers">
            {about?.subscribers !== undefined ? (
              <span>
                <b>{compact(about.subscribers)}</b> members
              </span>
            ) : null}
            {about?.active ? (
              <span>
                <b>{compact(about.active)}</b> online
              </span>
            ) : null}
          </div>
        </div>
        {/* Relay's navigation drawer: account destinations and Settings.
            Communities are in the sheet that opens from the feed title. */}
        <div className="drawer-body">
          <SourceSwitcher onSwitch={close} />
          {/* Account destinations, as in Relay's drawer. */}
          {account ? (
            <>
              {item("accountCircle", "Profile", () =>
                nav.openProfile(account.name),
              )}
              {site.features.inbox
                ? item(
                    "mail",
                    "Inbox",
                    nav.openInbox,
                    account.inboxCount ? (
                      <span
                        className="drawer-count"
                        aria-label={`${account.inboxCount} unread`}
                      >
                        {account.inboxCount > 99 ? "99+" : account.inboxCount}
                      </span>
                    ) : null,
                  )
                : null}
              {account.isMod && site.features.moderation
                ? item("modShield", "Moderator", nav.openModerator)
                : null}
              {site.features.writes
                ? item("postAdd", "New Post", () =>
                    nav.openSubmit(
                      special.has(current.toLowerCase()) ? undefined : current,
                    ),
                  )
                : null}
              {site.features.friends
                ? item("people", "Friends", nav.openFriends)
                : null}
            </>
          ) : (
            <button
              type="button"
              className="drawer-item"
              data-ripple
              onClick={promptLogin}
            >
              <Icon name="accountCircle" />
              <span className="label">Sign in to {site.name}</span>
            </button>
          )}
          {item("user", "User", () =>
            nav.openSheet((onSheetClosed) => (
              <GoToUserSheet
                onGo={nav.openProfile}
                onClosed={onSheetClosed}
              />
            )),
          )}
          {offlineAvailable() ? (
            <>
              <div className="drawer-sep" />
              {item("download", "Save feed for offline", () => {
                const feed = offlineFeed();
                if (feed?.sub.toLowerCase() === current.toLowerCase() && feed.posts.length)
                  nav.openSheet((onSheetClosed) => (
                    <SaveFeedSheet
                      title={
                        special.has(current.toLowerCase())
                          ? feedLabel(current)
                          : site.communityLabel(current)
                      }
                      feed={feed}
                      onClosed={onSheetClosed}
                    />
                  ));
                else toast("Load the feed first, then save it");
              })}
              {item("book", "Saved for offline", nav.openOffline)}
            </>
          ) : null}
          <div className="drawer-sep" />
          {item("tune", "Settings", nav.openSettings)}
        </div>
        <div className="drawer-foot">
          {account
            ? `Signed in as ${site.userLabel(account.name)}`
            : `Reading from your ${site.name} tab`}
          <br />
          OpenRelay · an independent reader for {site.name}
        </div>
      </nav>
    </div>
  );
};
