import { useNav } from "../app/nav";
import { usePrefs } from "../app/prefs";
import { Icon } from "../components/Icon";
import { PostCard } from "../components/PostCard";
import { ConfirmSheet, ScreenHeader } from "../components/Relay";
import { plural } from "../lib/format";
import {
  removeFromOffline,
  useOfflineCards,
  useOfflineEntries,
} from "../lib/offline";

/**
 * Posts saved for offline reading, newest first. Opened without Reddit
 * (`base`), it is the first screen, in place of the feed.
 */
export const OfflineScreen = ({ base = false }: { base?: boolean }) => {
  const nav = useNav();
  const { prefs } = usePrefs();
  const entries = useOfflineEntries();
  const cards = useOfflineCards(entries);
  const title = "Saved for offline";
  const subtitle = plural(entries.length, "post");
  const clear = entries.length ? (
    <button
      type="button"
      className="icon-btn"
      data-ripple
      aria-label="Remove all offline posts"
      title="Remove all"
      onClick={() =>
        nav.openSheet((onClosed) => (
          <ConfirmSheet
            title="Remove all offline posts?"
            message={`${subtitle} saved on this device will be removed.`}
            confirm="Remove all"
            onConfirm={() => void removeFromOffline("all")}
            onClosed={onClosed}
          />
        ))
      }
    >
      <Icon name="trash" />
    </button>
  ) : null;

  return (
    <>
      {base ? (
        <header className="appbar is-static is-raised">
          <span className="icon-btn" aria-hidden />
          <div className="appbar-title">
            <span className="name">{title}</span>
            <span className="sub">{subtitle}</span>
          </div>
          {clear}
          <button
            type="button"
            className="icon-btn"
            data-ripple
            aria-label="Open Reddit"
            title="Open Reddit"
            onClick={() => window.location.assign("https://www.reddit.com/")}
          >
            <Icon name="globe" />
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
      ) : (
        <ScreenHeader title={title} subtitle={subtitle} actions={clear} />
      )}
      <div className="scroller">
        <div className="feed" data-layout={prefs.layout}>
          {entries.length ? (
            cards?.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                layout={prefs.layout}
                showThumbnails={prefs.showThumbnails}
                showSub
              />
            ))
          ) : (
            <div className="feed-state">
              <div className="glyph">
                <Icon name="download" size={30} />
              </div>
              <strong>Nothing saved yet</strong>
              <span>
                Choose Save for offline in a post's menu, or Save feed for
                offline in the main menu, to read posts here without a
                connection.
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
