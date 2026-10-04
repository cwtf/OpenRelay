// Community header actions, after Relay's feed header: Subscribe, the ⋮ menu
// (View Sidebar, Wiki, Rules, Mods, Message Mods, Create Post, Share) and the
// right-hand "Sidebar Info" panel.

import { useCallback, useEffect, useState } from "react";
import type { Moderator } from "../../shared/api";
import { useNav } from "../app/nav";
import { useAccount } from "../lib/account";
import { fetchModerators, fetchWiki, runAction } from "../lib/api";
import { compact } from "../lib/format";
import { copyText, toast } from "../lib/platform";
import { refreshSubscriptions } from "../lib/subscriptions";
import { RulesSheet } from "../screens/AccountScreens";
import { Avatar, updateAbout, useAbout } from "../screens/FeedScreen";
import { Icon } from "./Icon";
import { ReaderMarkdown } from "./ListingCards";
import { Sheet, SheetItem } from "./Sheet";

/** Home, Popular and All are feeds, not communities. */
export const isCommunity = (sub: string) =>
  !["home", "popular", "all"].includes(sub.toLowerCase()) && !sub.includes("+");

/** Subscribe state for a community, with a toggle that updates the drawer. */
export const useSubscribe = (sub: string) => {
  const about = useAbout(sub);
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const subscribed = about?.subscribed ?? false;
  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await runAction("subscribe", { action: subscribed ? "unsub" : "sub", sr: sub });
      updateAbout(sub, { subscribed: !subscribed });
      toast(subscribed ? `Left r/${sub}` : `Joined r/${sub}`);
      void refreshSubscriptions();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Reddit could not do that.");
    } finally {
      setBusy(false);
    }
  }, [busy, subscribed, sub]);
  return {
    // Unknown until Reddit reports it for a signed-in viewer.
    available: Boolean(account) && about?.subscribed !== undefined,
    subscribed,
    busy,
    toggle,
  };
};

/** Relay's round header button: "+" to subscribe, a check when subscribed. */
export const SubscribeButton = ({ sub }: { sub: string }) => {
  const state = useSubscribe(sub);
  if (!state.available) return null;
  return (
    <button
      type="button"
      className={`header-action${state.subscribed ? " is-on" : ""}`}
      data-ripple
      aria-pressed={state.subscribed}
      aria-label={state.subscribed ? `Unsubscribe from r/${sub}` : `Subscribe to r/${sub}`}
      title={state.subscribed ? "Subscribed" : "Subscribe"}
      disabled={state.busy}
      onClick={() => void state.toggle()}
    >
      <Icon name={state.subscribed ? "check" : "plus"} />
    </button>
  );
};

/** The ⋮ menu from Relay's feed header. */
export const CommunityMenu = ({ sub, onClosed }: { sub: string; onClosed: () => void }) => {
  const nav = useNav();
  const account = useAccount();
  const open = (render: (onClosed: () => void) => React.ReactNode) =>
    // Open after this sheet has started closing so the new one replaces it.
    window.setTimeout(() => nav.openSheet(render), 0);
  return (
    <Sheet title={`r/${sub}`} onClosed={onClosed}>
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <SheetItem
              icon="info"
              label="View Sidebar"
              onClick={run(() => open((done) => <SidebarPanel sub={sub} onClosed={done} />))}
            />
            <SheetItem
              icon="globe"
              label="View Wiki"
              onClick={run(() => open((done) => <WikiSheet sub={sub} onClosed={done} />))}
            />
            <SheetItem
              icon="book"
              label="View Rules"
              onClick={run(() => open((done) => <RulesSheet sub={sub} onClosed={done} />))}
            />
            <SheetItem
              icon="modShield"
              label="View Mods"
              onClick={run(() => open((done) => <ModeratorsSheet sub={sub} onClosed={done} />))}
            />
            {account ? (
              <>
                <SheetItem
                  icon="mail"
                  label="Message Mods"
                  onClick={run(() => nav.openCompose({ to: `/r/${sub}` }))}
                />
                <SheetItem
                  icon="text"
                  label="Create Post: Text"
                  onClick={run(() => nav.openSubmit(sub, "self"))}
                />
                <SheetItem
                  icon="link"
                  label="Create Post: Image/Link"
                  onClick={run(() => nav.openSubmit(sub, "link"))}
                />
              </>
            ) : null}
            <SheetItem
              icon="share"
              label="Share"
              onClick={run(
                () => void copyText(`https://www.reddit.com/r/${sub}/`, "Link copied"),
              )}
            />
          </>
        );
      }}
    </Sheet>
  );
};

/** Relay's right-hand "Sidebar Info" drawer (340px, rounded left edge). */
export const SidebarPanel = ({ sub, onClosed }: { sub: string; onClosed: () => void }) => {
  const about = useAbout(sub);
  const subscribe = useSubscribe(sub);
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClosed, 280);
    return () => window.clearTimeout(timer);
  }, [closing, onClosed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className={`layer has-drawer${closing ? " is-closing" : ""}`}>
      <div className="scrim" onClick={close} />
      <aside className="drawer is-right sidebar-panel" role="dialog" aria-label={`r/${sub} sidebar`}>
        <div className="sidebar-title">
          <span>Sidebar Info</span>
          <button type="button" className="icon-btn" aria-label="Close sidebar" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sidebar-body">
          <div className="sidebar-community">
            <Avatar name={sub} size="large" src={about?.icon} />
            <div className="meta">
              <div className="title">{about?.title || `r/${sub}`}</div>
              <div className="subtitle">r/{sub}</div>
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
          </div>
          {subscribe.available ? (
            <button
              type="button"
              className={`btn${subscribe.subscribed ? " is-tonal" : ""} sidebar-subscribe`}
              disabled={subscribe.busy}
              onClick={() => void subscribe.toggle()}
            >
              <Icon name={subscribe.subscribed ? "check" : "plus"} />
              {subscribe.subscribed ? "Subscribed" : "Subscribe"}
            </button>
          ) : null}
          {about?.description ? <p className="sidebar-lede">{about.description}</p> : null}
          {about === null ? (
            <div className="spinner" />
          ) : about.sidebar ? (
            <ReaderMarkdown source={about.sidebar} />
          ) : (
            <p className="sub-hint">This community has no sidebar.</p>
          )}
        </div>
      </aside>
    </div>
  );
};

const Loaded = <T,>({
  load,
  children,
}: {
  load: () => Promise<T>;
  children: (value: T) => React.ReactNode;
}) => {
  const [value, setValue] = useState<{ ok: true; value: T } | { ok: false; error: string } | null>(null);
  useEffect(() => {
    load()
      .then((result) => setValue({ ok: true, value: result }))
      .catch((error: unknown) =>
        setValue({ ok: false, error: error instanceof Error ? error.message : "Unavailable" }),
      );
    // `load` is stable for the sheet's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!value) return <div className="spinner" />;
  if (!value.ok) return <p className="sub-hint">{value.error}</p>;
  return <>{children(value.value)}</>;
};

export const WikiSheet = ({ sub, onClosed }: { sub: string; onClosed: () => void }) => (
  <Sheet title={`r/${sub} wiki`} className="is-tall" onClosed={onClosed}>
    {() => (
      <div className="about-body sheet-scroll">
        <Loaded load={() => fetchWiki(sub)}>
          {(markdown) =>
            markdown ? (
              <ReaderMarkdown source={markdown} />
            ) : (
              <p className="sub-hint">This community has no wiki.</p>
            )
          }
        </Loaded>
      </div>
    )}
  </Sheet>
);

/** Relay's moderator list: name, then how long and which permissions. */
export const ModeratorsSheet = ({ sub, onClosed }: { sub: string; onClosed: () => void }) => {
  const nav = useNav();
  const since = (at: number) => {
    const years = Math.floor((Date.now() - at) / (365.25 * 86400000));
    return years >= 1 ? `${years} ${years === 1 ? "year" : "years"}` : "Under a year";
  };
  return (
    <Sheet title={`r/${sub} moderators`} onClosed={onClosed}>
      {(close) => (
        <Loaded load={() => fetchModerators(sub)}>
          {(mods: Moderator[]) =>
            mods.length ? (
              mods.map((mod) => (
                <button
                  key={mod.name}
                  type="button"
                  className="moderator-item"
                  data-ripple
                  onClick={() => {
                    close();
                    nav.openProfile(mod.name);
                  }}
                >
                  <span className="name">{mod.name}</span>
                  <span className="info">
                    {since(mod.since)} - Permissions:{" "}
                    {mod.permissions.length
                      ? mod.permissions.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(", ")
                      : "None"}
                  </span>
                </button>
              ))
            ) : (
              <p className="sub-hint">No moderators listed.</p>
            )
          }
        </Loaded>
      )}
    </Sheet>
  );
};
