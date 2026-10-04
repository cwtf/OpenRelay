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
import { Markdown } from "../lib/markdown";
import { readJson, recentCommunities, writeJson } from "../lib/storage";
import {
  ensureSubscriptions,
  isFavourite,
  refreshSubscriptions,
  toggleFavourite,
  useFavourites,
  useSubscriptions,
} from "../lib/subscriptions";
import { ensureAccount, useAccount } from "../lib/account";
import { promptLogin } from "../lib/platform";
import { Avatar, useAbout, useFeedPicture } from "../screens/FeedScreen";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;
const USER_RE = /^[\w-]{3,20}$/;

const GoToUserSheet = ({
  onGo,
  onClosed,
}: {
  onGo: (name: string) => void;
  onClosed: () => void;
}) => {
  const [draft, setDraft] = useState("");
  const name = draft.trim().replace(/^\/?u(?:ser)?\//i, "");
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

export const AboutSheet = ({
  sub,
  onClosed,
}: {
  sub: string;
  onClosed: () => void;
}) => {
  const about = useAbout(sub);
  return (
    <Sheet title={about?.title || `r/${sub}`} onClosed={onClosed}>
      {() => (
        <div className="about-body">
          <p style={{ color: "var(--text-2)", marginTop: 0, fontSize: 13.5 }}>
            r/{sub}
            {about?.subscribers !== undefined
              ? ` · ${compact(about.subscribers)} members`
              : ""}
            {about?.createdAt
              ? ` · since ${new Date(about.createdAt).getFullYear()}`
              : ""}
          </p>
          {about?.description ? (
            <Markdown source={about.description} />
          ) : about ? (
            <p style={{ color: "var(--text-3)" }}>
              This community has no description.
            </p>
          ) : (
            <div className="spinner" />
          )}
        </div>
      )}
    </Sheet>
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
              ? `Remove r/${name} from Favourites`
              : `Add r/${name} to Favourites`
          }
          onClick={() => toggleFavourite(name)}
        >
          <Icon name={starred ? "starFilled" : "star"} size={22} />
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

type DrawerProps = { onClosed: () => void };

export const Drawer = ({ onClosed }: DrawerProps) => {
  const nav = useNav();
  const { session, current } = nav;
  const about = useAbout(current);
  const picture = useFeedPicture(current, about);
  const account = useAccount();
  const subscriptions = useSubscriptions();
  const favourites = useFavourites();
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<
    Partial<Record<SectionId, boolean>>
  >(() => readJson("drawer-collapsed", {}));
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

  useEffect(() => {
    ensureSubscriptions();
    ensureAccount(60 * 1000); // Keep the inbox count reasonably current.
  }, []);

  const go = (name: string) => {
    close();
    nav.openCommunity(name);
  };

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

  const feeds = [...new Set(["Home", ...session.featured])];
  const special = new Set(feeds.map((name) => name.toLowerCase()));
  const recent = recentCommunities
    .values()
    .filter((name) => !special.has(name.toLowerCase()));
  const entry = special.has(session.home.toLowerCase()) ? null : session.home;

  const row = (name: string) => (
    <CommunityRow
      key={name}
      name={name}
      info={info(name)}
      active={isActive(name)}
      onGo={go}
    />
  );

  // Search filters every known community; a valid name can be opened directly.
  const typed = query.trim().replace(/^\/?r\//i, "");
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
  const showTyped =
    NAME_RE.test(typed) &&
    !matches.some((name) => name.toLowerCase() === needle);

  const subsOpen = !collapsed.subscriptions;
  const syncing = subscriptions.status === "loading";

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
          <div className="title">{about?.title || `r/${current}`}</div>
          <div className="subtitle">r/{current}</div>
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
        <form
          className="drawer-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const target = showTyped ? typed : matches[0];
            if (target) go(target);
          }}
        >
          <Icon name="search" size={20} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !query) return;
              // Clear the search first; a second Escape closes the drawer.
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
        <div className="drawer-body">
          {needle ? (
            <>
              {showTyped ? (
                <CommunityRow
                  name={typed}
                  info={info(typed)}
                  active={isActive(typed)}
                  onGo={go}
                  label={`Go to r/${typed}`}
                  starrable={false}
                />
              ) : null}
              {matches.slice(0, 60).map(row)}
              {!showTyped && !matches.length ? (
                <p className="sub-hint">No matching communities.</p>
              ) : null}
            </>
          ) : (
            <>
              {/* Account destinations, as in Relay's drawer. */}
              {account ? (
                <>
                  <button
                    type="button"
                    className="drawer-item"
                    data-ripple
                    onClick={() => {
                      close();
                      nav.openProfile(account.name);
                    }}
                  >
                    <Icon name="accountCircle" />
                    <span className="label">Profile</span>
                  </button>
                  <button
                    type="button"
                    className="drawer-item"
                    data-ripple
                    onClick={() => {
                      close();
                      nav.openInbox();
                    }}
                  >
                    <Icon name="mail" />
                    <span className="label">Inbox</span>
                    {account.inboxCount ? (
                      <span
                        className="drawer-count"
                        aria-label={`${account.inboxCount} unread`}
                      >
                        {account.inboxCount > 99 ? "99+" : account.inboxCount}
                      </span>
                    ) : null}
                  </button>
                  {account.isMod ? (
                    <button
                      type="button"
                      className="drawer-item"
                      data-ripple
                      onClick={() => {
                        close();
                        nav.openModerator();
                      }}
                    >
                      <Icon name="modShield" />
                      <span className="label">Moderator</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="drawer-item"
                    data-ripple
                    onClick={() => {
                      close();
                      nav.openSubmit(
                        special.has(current.toLowerCase()) ? undefined : current,
                      );
                    }}
                  >
                    <Icon name="postAdd" />
                    <span className="label">New Post</span>
                  </button>
                  <button
                    type="button"
                    className="drawer-item"
                    data-ripple
                    onClick={() => {
                      close();
                      nav.openFriends();
                    }}
                  >
                    <Icon name="people" />
                    <span className="label">Friends</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="drawer-item"
                  data-ripple
                  onClick={promptLogin}
                >
                  <Icon name="accountCircle" />
                  <span className="label">Sign in to Reddit</span>
                </button>
              )}
              <button
                type="button"
                className="drawer-item"
                data-ripple
                onClick={() => {
                  close();
                  nav.openSheet((onSheetClosed) => (
                    <GoToUserSheet
                      onGo={nav.openProfile}
                      onClosed={onSheetClosed}
                    />
                  ));
                }}
              >
                <Icon name="user" />
                <span className="label">User</span>
              </button>
              <div className="drawer-sep" />

              {entry ? (
                <button
                  type="button"
                  className={`drawer-item${isActive(entry) ? " is-active" : ""}`}
                  data-ripple
                  onClick={() => go(entry)}
                >
                  <Avatar name={entry} size="small" />
                  <span className="label">r/{entry}</span>
                </button>
              ) : null}
              <button
                type="button"
                className="drawer-item"
                data-ripple
                onClick={() => {
                  close();
                  nav.openSheet((onSheetClosed) => (
                    <AboutSheet sub={current} onClosed={onSheetClosed} />
                  ));
                }}
              >
                <Icon name="info" />
                <span className="label">About r/{current}</span>
              </button>
              <button
                type="button"
                className="drawer-item"
                data-ripple
                onClick={() => {
                  close();
                  nav.openSearch();
                }}
              >
                <Icon name="search" />
                <span className="label">Search r/{current}</span>
              </button>

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
                      onGo={go}
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
                    Sign in to Reddit in this browser to see your subscribed
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

          <div className="drawer-sep" />
          <button
            type="button"
            className="drawer-item"
            data-ripple
            onClick={() => {
              close();
              nav.openSettings();
            }}
          >
            <Icon name="tune" />
            <span className="label">Settings</span>
          </button>
        </div>
        <div className="drawer-foot">
          {account
            ? `Signed in as u/${account.name}`
            : "Reading from your Reddit tab"}
          <br />
          OpenRelay · an independent reader built on Devvit
        </div>
      </nav>
    </div>
  );
};
