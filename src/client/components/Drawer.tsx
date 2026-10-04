import { useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { compact, hueOf } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { recentCommunities } from "../lib/storage";
import { Avatar, useAbout } from "../screens/FeedScreen";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

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

type DrawerProps = { onClosed: () => void };

export const Drawer = ({ onClosed }: DrawerProps) => {
  const nav = useNav();
  const { session, current } = nav;
  const about = useAbout(current);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState("");
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

  const go = (name: string) => {
    close();
    nav.openCommunity(name);
  };

  const seen = new Set([session.home.toLowerCase()]);
  const featured = session.featured.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const recent = recentCommunities.values().filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const item = (name: string) => (
    <button
      key={name}
      type="button"
      className={`drawer-item${name.toLowerCase() === current.toLowerCase() ? " is-active" : ""}`}
      data-ripple
      onClick={() => go(name)}
    >
      <Avatar name={name} size="small" />
      <span className="label">r/{name}</span>
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
          <Avatar name={current} size="large" />
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
        <div className="drawer-body">
          <button
            type="button"
            className={`drawer-item${session.home.toLowerCase() === current.toLowerCase() ? " is-active" : ""}`}
            data-ripple
            onClick={() => go(session.home)}
          >
            <Icon name="home" />
            <span className="label">r/{session.home}</span>
          </button>
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

          {featured.length ? (
            <>
              <div className="drawer-sep" />
              <div className="sheet-section">Featured</div>
              {featured.map(item)}
            </>
          ) : null}
          {recent.length ? (
            <>
              <div className="drawer-sep" />
              <div className="sheet-section">Recent</div>
              {recent.map(item)}
            </>
          ) : null}

          <div className="drawer-sep" />
          <div className="sheet-section">Go to community</div>
          <form
            className="drawer-go"
            onSubmit={(event) => {
              event.preventDefault();
              const name = draft.trim().replace(/^\/?r\//i, "");
              if (NAME_RE.test(name)) go(name);
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="r/community"
              aria-label="Community name"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="btn is-tonal"
              disabled={!NAME_RE.test(draft.trim().replace(/^\/?r\//i, ""))}
            >
              Go
            </button>
          </form>

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
          {session.username
            ? `Signed in as u/${session.username}`
            : "Reading from your Reddit tab"}
          <br />
          OpenRelay · an independent reader built on Devvit
        </div>
      </nav>
    </div>
  );
};
