import { useState } from "react";
import { useNav } from "../app/nav";
import { usePrefs } from "../app/prefs";
import { Icon } from "../components/Icon";
import { inlineViewerItem } from "../components/PostParts";
import { ConfirmSheet, ScreenHeader } from "../components/Relay";
import { Sheet, SheetItem } from "../components/Sheet";
import { site } from "../lib/api";
import { age, plural } from "../lib/format";
import { useLongPress } from "../lib/gestures";
import { copyText } from "../lib/platform";
import {
  isAnimated,
  redditReuse,
  savedKey,
  savedSource,
  type SavedMedia,
} from "../lib/savedMedia";
import {
  forgetAllSaved,
  forgetSaved,
  isSaved,
  moveSavedToFront,
  toggleSaved,
  useSavedMedia,
} from "../lib/savedMediaStore";
import { toast } from "../lib/platform";

type Show = "all" | "gifs" | "images";

const SHOWS: { value: Show; label: string }[] = [
  { value: "all", label: "All" },
  { value: "gifs", label: "GIFs" },
  { value: "images", label: "Images" },
];

const shows = (item: SavedMedia, show: Show): boolean =>
  show === "all" || isAnimated(item) === (show === "gifs");

const kindOf = (item: SavedMedia): string => (isAnimated(item) ? "GIF" : "Image");

/** What a reply on this site does with the item, for its sheet. */
const reuseNote = (item: SavedMedia): string => {
  if (site.name === "Lemmy") return "Lemmy replies show it inline.";
  const kind = isAnimated(item) ? "GIFs" : "images";
  switch (redditReuse(item)) {
    case "id":
      return `Reddit replies show it inline where the community takes ${kind} in comments, and link to it elsewhere.`;
    case "upload":
      return `Reddit replies upload it again where the community takes ${kind} in comments, and link to it elsewhere.`;
    case "none":
      return "Reddit replies don't offer it: Reddit shows only images it hosts.";
  }
};

/** A Giphy GIF shows only with Load GIFs from Giphy on, as in the composer. */
const Thumb = ({ item }: { item: SavedMedia }) => {
  const { prefs } = usePrefs();
  return item.giphy && !prefs.giphyGifs ? (
    <span className="saved-tile-text">GIF</span>
  ) : (
    <img src={item.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
  );
};

const SavedItemSheet = ({ item, onClosed }: { item: SavedMedia; onClosed: () => void }) => {
  const nav = useNav();
  const { prefs } = usePrefs();
  const meta = [
    item.savedAt ? `Saved ${age(item.savedAt)} ago` : "",
    item.width && item.height ? `${item.width} × ${item.height}` : "",
  ].filter(Boolean);
  return (
    <Sheet title={`${kindOf(item)} from ${savedSource(item)}`} onClosed={onClosed}>
      {(close) => (
        <>
          <div className="saved-sheet-preview">
            <Thumb item={item} />
          </div>
          {meta.length ? <p className="saved-sheet-meta">{meta.join(" · ")}</p> : null}
          <p className="saved-sheet-note">
            <Icon name="info" size={20} />
            <span>{reuseNote(item)}</span>
          </p>
          {!item.giphy || prefs.giphyGifs ? (
            <SheetItem
              icon="zoom"
              label="View full size"
              onClick={() => {
                close();
                const media = item.mp4
                  ? { url: item.url, mp4: item.mp4, width: item.width, height: item.height }
                  : undefined;
                nav.openMedia({
                  items: [inlineViewerItem(item.url, media, item)],
                  index: 0,
                  sourceUrl: item.url,
                });
              }}
            />
          ) : null}
          <SheetItem
            icon="copy"
            label="Copy link"
            onClick={() => {
              close();
              void copyText(item.url, "Link copied");
            }}
          />
          <SheetItem
            icon="top"
            label="Move to front"
            hint="First in the composer's list"
            onClick={() => {
              close();
              moveSavedToFront(item);
            }}
          />
          <SheetItem
            icon="trash"
            label="Remove from saved"
            onClick={() => {
              close();
              forgetSaved(item);
            }}
          />
        </>
      )}
    </Sheet>
  );
};

const SavedTile = ({
  item,
  selected,
  onOpen,
  onSelect,
}: {
  item: SavedMedia;
  /** Undefined unless selecting. */
  selected: boolean | undefined;
  onOpen: () => void;
  onSelect: () => void;
}) => {
  const { prefs } = usePrefs();
  const press = useLongPress(selected === undefined ? onSelect : undefined);
  const hidden = site.name === "Reddit" && redditReuse(item) === "none";
  const kind = kindOf(item);
  return (
    <button
      type="button"
      className={`saved-tile${selected ? " is-selected" : ""}`}
      aria-label={`${kind} from ${savedSource(item)}${hidden ? ", not offered in Reddit replies" : ""}`}
      aria-pressed={selected}
      {...press.handlers}
      onClick={() => {
        if (press.consumeClick()) return;
        if (selected === undefined) onOpen();
        else onSelect();
      }}
    >
      <Thumb item={item} />
      {selected !== undefined ? (
        <span className="saved-tile-check" aria-hidden>
          {selected ? <Icon name="check" size={16} /> : null}
        </span>
      ) : null}
      {isAnimated(item) && (!item.giphy || prefs.giphyGifs) ? (
        <span className="saved-tile-badge">GIF</span>
      ) : null}
      {hidden ? (
        <span className="saved-tile-hidden" title="Not offered in Reddit replies" aria-hidden>
          <Icon name="block" size={14} />
        </span>
      ) : null}
    </button>
  );
};

/**
 * A comment's GIFs and images (its More sheet's Save for replies, when it
 * has several): tap one to save it, or to remove it again.
 */
export const SaveBodyMediaSheet = ({
  items,
  onClosed,
}: {
  items: SavedMedia[];
  onClosed: () => void;
}) => {
  const { prefs } = usePrefs();
  useSavedMedia();
  return (
    <Sheet title="Save for replies" onClosed={onClosed}>
      {() => (
        <div className="saved-grid saved-grid-sheet">
          {items.map((item) => {
            const saved = isSaved(item);
            const kind = kindOf(item);
            return (
              <button
                key={savedKey(item)}
                type="button"
                className={`saved-tile${saved ? " is-selected" : ""}`}
                aria-label={`${kind} from ${savedSource(item)}`}
                aria-pressed={saved}
                onClick={() =>
                  toast(
                    toggleSaved({ ...item, savedAt: Date.now() })
                      ? "Saved for replies"
                      : "Removed from saved",
                  )
                }
              >
                <Thumb item={item} />
                <span className="saved-tile-check" aria-hidden>
                  {saved ? <Icon name="check" size={16} /> : null}
                </span>
                {isAnimated(item) && (!item.giphy || prefs.giphyGifs) ? (
                  <span className="saved-tile-badge">GIF</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
};

/**
 * The GIFs and images saved for replies (the viewer's star), in the order
 * the composer lists them: open one for its actions, or press and hold
 * (or Select) to remove several.
 */
export const SavedMediaScreen = () => {
  const nav = useNav();
  const saved = useSavedMedia();
  const [show, setShow] = useState<Show>("all");
  // The keys picked while selecting; null when not selecting.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const shown = saved.filter((item) => shows(item, show));
  const count = (value: Show) => saved.filter((item) => shows(item, value)).length;

  const toggle = (item: SavedMedia) =>
    setPicked((current) => {
      const next = new Set(current ?? []);
      const key = savedKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const confirm = (title: string, message: string, onConfirm: () => void) =>
    nav.openSheet((onClosed) => (
      <ConfirmSheet
        title={title}
        message={message}
        confirm="Remove"
        onConfirm={onConfirm}
        onClosed={onClosed}
      />
    ));

  const header = picked ? (
    <header className="appbar is-static is-raised is-selecting">
      <button
        type="button"
        className="icon-btn"
        data-ripple
        aria-label="Done selecting"
        onClick={() => setPicked(null)}
      >
        <Icon name="close" />
      </button>
      <div className="appbar-title">
        <span className="name">{picked.size} selected</span>
      </div>
      <button
        type="button"
        className="icon-btn"
        data-ripple
        aria-label="Select all"
        title="Select all"
        onClick={() => setPicked(new Set(shown.map(savedKey)))}
      >
        <Icon name="doneAll" />
      </button>
      <button
        type="button"
        className="icon-btn"
        data-ripple
        aria-label="Remove selected from saved"
        title="Remove from saved"
        disabled={!picked.size}
        onClick={() => {
          const items = saved.filter((item) => picked.has(savedKey(item)));
          confirm(
            `Remove ${plural(items.length, "item")} from saved?`,
            "They stay wherever they were posted; only your saved list changes.",
            () => {
              forgetSaved(...items);
              setPicked(null);
            },
          );
        }}
      >
        <Icon name="trash" />
      </button>
    </header>
  ) : (
    <ScreenHeader
      title="Saved GIFs & images"
      subtitle={saved.length ? `${saved.length} saved` : "None saved"}
      actions={
        <>
          {saved.length ? (
            <button
              type="button"
              className="icon-btn"
              data-ripple
              aria-label="Select"
              title="Select"
              onClick={() => setPicked(new Set())}
            >
              <Icon name="checkCircle" />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            data-ripple
            aria-label="Edit as text"
            title="Edit as text"
            onClick={nav.openSavedMediaText}
          >
            <Icon name="edit" />
          </button>
          {saved.length ? (
            <button
              type="button"
              className="icon-btn"
              data-ripple
              aria-label="Remove all saved GIFs and images"
              title="Remove all"
              onClick={() =>
                confirm(
                  "Remove all saved GIFs and images?",
                  `${plural(saved.length, "item")} will be removed from your saved list. They stay wherever they were posted.`,
                  forgetAllSaved,
                )
              }
            >
              <Icon name="trash" />
            </button>
          ) : null}
        </>
      }
    />
  );

  return (
    <>
      {header}
      <div className="scroller">
        {saved.length ? (
          <>
            <nav className="sort-strip saved-filters" aria-label="Show">
              {SHOWS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`filter-chip${show === option.value ? " is-selected" : ""}`}
                  data-ripple
                  aria-pressed={show === option.value}
                  onClick={() => setShow(option.value)}
                >
                  {show === option.value ? <Icon name="check" /> : null}
                  {option.label} · {count(option.value)}
                </button>
              ))}
            </nav>
            <div className="saved-grid">
              {shown.map((item) => (
                <SavedTile
                  key={savedKey(item)}
                  item={item}
                  selected={picked ? picked.has(savedKey(item)) : undefined}
                  onOpen={() =>
                    nav.openSheet((onClosed) => <SavedItemSheet item={item} onClosed={onClosed} />)
                  }
                  onSelect={() => {
                    if (!picked) setPicked(new Set([savedKey(item)]));
                    else toggle(item);
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="feed-state">
            <div className="glyph">
              <Icon name="star" size={30} />
            </div>
            <strong>Nothing saved yet</strong>
            <span>
              Open a GIF or image in a comment or post and tap the star to keep it here for your
              replies.
            </span>
          </div>
        )}
      </div>
    </>
  );
};
