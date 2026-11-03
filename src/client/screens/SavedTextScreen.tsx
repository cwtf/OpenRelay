import { useState } from "react";
import { useNav } from "../app/nav";
import { Icon, type IconName } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { plural } from "../lib/format";
import { copyText, toast } from "../lib/platform";
import {
  SAVED_MEDIA_MAX,
  parseSavedText,
  savedChanges,
  savedText,
} from "../lib/savedMedia";
import { replaceSaved, savedMedia, useSavedMedia } from "../lib/savedMediaStore";

type Changes = ReturnType<typeof savedChanges>;

/** What saving the text changes, asked before the list is replaced. */
const SaveTextSheet = ({
  changes,
  dropped,
  onSave,
  onClosed,
}: {
  changes: Changes;
  dropped: number;
  onSave: () => void;
  onClosed: () => void;
}) => {
  // Icon, label and tone of each change.
  const rows: [IconName, string, string][] = [];
  if (changes.added) rows.push(["plus", `${changes.added} added`, "is-added"]);
  if (changes.removed) rows.push(["removeCircle", `${changes.removed} removed`, "is-removed"]);
  if (changes.reordered) rows.push(["collapse", "Order changed", ""]);
  if (dropped) rows.push(["info", `${plural(dropped, "line")} past the ${SAVED_MEDIA_MAX} limit left out`, ""]);
  return (
    <Sheet title="Save these changes?" onClosed={onClosed}>
      {(close) => (
        <div className="composer">
          <ul className="saved-text-changes">
            {rows.map(([icon, label, tone]) => (
              <li key={label} className={tone}>
                <span className="glyph" aria-hidden>
                  <Icon name={icon} size={16} />
                </span>
                {label}
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, color: "var(--text-2)" }}>
            {changes.removed
              ? "Removed ones come back only if you paste their links again. "
              : ""}
            Items you keep keep their saved date and size.
          </p>
          <div className="row-actions">
            <span className="grow" />
            <button type="button" className="btn is-text" onClick={close}>
              Keep editing
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                onSave();
                close();
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
};

/**
 * The saved list as plain text, one item per line (an image's link, or
 * `giphy:<id>`): to reorder, prune, paste in or copy out many at once.
 */
export const SavedTextScreen = () => {
  const nav = useNav();
  const saved = useSavedMedia();
  const [text, setText] = useState(() => savedText(savedMedia()));
  const result = parseSavedText(text, saved, Date.now());
  const changes = savedChanges(saved, result.items);
  const changed = changes.added || changes.removed || changes.reordered || result.dropped;
  const summary = [
    plural(result.items.length, "item"),
    result.errors.length
      ? `${plural(result.errors.length, "line")} to fix`
      : [changes.added ? `${changes.added} added` : "", changes.removed ? `${changes.removed} removed` : ""]
          .filter(Boolean)
          .join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

  const save = () =>
    nav.openSheet((onClosed) => (
      <SaveTextSheet
        changes={changes}
        dropped={result.dropped}
        onSave={() => {
          // Read again at save time, so what was saved meanwhile keeps its entry.
          const { items } = parseSavedText(text, savedMedia(), Date.now());
          replaceSaved(items);
          toast("Saved list updated");
          nav.back();
        }}
        onClosed={onClosed}
      />
    ));

  return (
    <>
      <header className="appbar is-static is-raised">
        <button
          type="button"
          className="icon-btn"
          data-ripple
          aria-label="Close without saving"
          onClick={nav.back}
        >
          <Icon name="close" />
        </button>
        <div className="appbar-title">
          <span className="name">Edit as text</span>
          <span className="sub">{summary}</span>
        </div>
        <button
          type="button"
          className="btn"
          disabled={!!result.errors.length || !changed}
          onClick={save}
        >
          Save
        </button>
      </header>
      <div className="scroller saved-text">
        <p className="saved-sheet-note">
          <Icon name="info" size={20} />
          <span>
            One per line: an https link to the image, or <code>giphy:ID</code> for a Giphy GIF.
            The top line comes first in the composer.
          </span>
        </p>
        <textarea
          className="saved-text-field"
          aria-label="Saved GIFs and images, one per line"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
        />
        {result.errors.length || result.repeats.length ? (
          <ul className="saved-text-problems" role="status">
            {result.errors.map((line) => (
              <li key={`e${line}`} className="is-error">
                <Icon name="spam" size={18} />
                Line {line} isn't an https link or giphy:ID. Fix or delete it to save.
              </li>
            ))}
            {result.repeats.map(([line, first]) => (
              <li key={`r${line}`}>
                <Icon name="copy" size={18} />
                Line {line} repeats line {first}; it's kept once.
              </li>
            ))}
          </ul>
        ) : null}
        <div className="saved-text-tools" role="toolbar" aria-label="Text tools">
          <button
            type="button"
            className="btn is-text"
            onClick={() => void copyText(text, "List copied")}
          >
            <Icon name="copy" size={20} />
            Copy all
          </button>
          <button
            type="button"
            className="btn is-text"
            disabled={text === savedText(saved)}
            onClick={() => setText(savedText(saved))}
          >
            <Icon name="refresh" size={20} />
            Undo changes
          </button>
        </div>
      </div>
    </>
  );
};
