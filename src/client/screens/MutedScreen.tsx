import { useState } from "react";
import { useNav } from "../app/nav";
import { Icon, type IconName } from "../components/Icon";
import { ScreenHeader } from "../components/Relay";
import { Sheet } from "../components/Sheet";
import { site } from "../lib/api";
import { hueOf, plural } from "../lib/format";
import { copyText, toast } from "../lib/platform";
import {
  isMuted,
  muteCommunity,
  mutedCommunities,
  replaceMuted,
  unmuteCommunity,
  useMutedCommunities,
  validMuteName,
} from "../lib/muted";
import {
  cleanMuteName,
  mutedChanges,
  mutedText,
  parseMutedText,
} from "../lib/muteState";

/** Settings → Muted communities: the list, a field to add one, and Edit as text. */
export const MutedScreen = () => {
  const nav = useNav();
  const muted = useMutedCommunities();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    const name = cleanMuteName(draft);
    if (!name) return;
    if (!validMuteName(name))
      return setError(`${site.communityLabel(name)} isn't a community name.`);
    if (isMuted(name)) return setError(`${site.communityLabel(name)} is already muted.`);
    muteCommunity(name);
    setDraft("");
    toast(`Muted ${site.communityLabel(name)}`);
  };

  return (
    <>
      <ScreenHeader
        title="Muted communities"
        subtitle={muted.length ? `${muted.length} on ${site.name}` : `None on ${site.name}`}
        actions={
          <button
            type="button"
            className="icon-btn"
            data-ripple
            aria-label="Edit as text"
            title="Edit as text"
            onClick={nav.openMutedText}
          >
            <Icon name="edit" />
          </button>
        }
      />
      <div className="scroller">
        <form
          className="drawer-search user-go muted-add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Icon name="block" size={20} />
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
            placeholder={site.communityLabel("community")}
            aria-label="Community to mute"
            aria-invalid={error ? true : undefined}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
          />
          <button type="submit" className="btn is-tonal" disabled={!cleanMuteName(draft)}>
            Mute
          </button>
        </form>
        <p className="sub-hint source-hint" role={error ? "alert" : undefined}>
          {error ||
            "Their posts are left out of every feed but their own. Kept only on this device."}
        </p>
        {muted.length ? (
          <div className="friends-list">
            {muted.map((name) => (
              <div className="friend-row" key={name}>
                <button
                  type="button"
                  className="friend-main"
                  data-ripple
                  onClick={() => nav.openCommunity(name)}
                >
                  <span
                    className="avatar"
                    style={{ ["--hue" as string]: hueOf(name.toLowerCase()) }}
                    aria-hidden
                  >
                    {name.slice(0, 1)}
                  </span>
                  <span className="label">{site.communityLabel(name)}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn friend-remove"
                  data-ripple
                  aria-label={`Unmute ${site.communityLabel(name)}`}
                  title="Unmute"
                  onClick={() => {
                    unmuteCommunity(name);
                    toast(`Unmuted ${site.communityLabel(name)}`);
                  }}
                >
                  <Icon name="removeCircle" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="feed-state">
            <div className="glyph">
              <Icon name="block" size={30} />
            </div>
            <strong>Nothing muted</strong>
            <span>
              Add a community above, or choose Mute in a post's or community's menu.
            </span>
          </div>
        )}
      </div>
    </>
  );
};

type Changes = ReturnType<typeof mutedChanges>;

/** What saving the text changes, asked before the list is replaced. */
const SaveMutedSheet = ({
  changes,
  onSave,
  onClosed,
}: {
  changes: Changes;
  onSave: () => void;
  onClosed: () => void;
}) => {
  const rows: [IconName, string, string][] = [];
  if (changes.added) rows.push(["plus", `${changes.added} muted`, "is-added"]);
  if (changes.removed) rows.push(["removeCircle", `${changes.removed} unmuted`, "is-removed"]);
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

/** The muted list as plain text, one community per line: to paste in or copy out many at once. */
export const MutedTextScreen = () => {
  const nav = useNav();
  const muted = useMutedCommunities();
  const [text, setText] = useState(() => mutedText(mutedCommunities()));
  const result = parseMutedText(text, validMuteName);
  const changes = mutedChanges(muted, result.names);
  const changed = changes.added || changes.removed;
  const summary = [
    plural(result.names.length, "community", "communities"),
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
      <SaveMutedSheet
        changes={changes}
        onSave={() => {
          replaceMuted(result.names);
          toast("Muted communities updated");
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
            One community per line, with or without <code>{site.communityLabel("")}</code> in
            front. Blank lines are skipped. Muted on {site.name} only.
          </span>
        </p>
        <textarea
          className="saved-text-field"
          aria-label="Muted communities, one per line"
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
                Line {line} isn't a community name. Fix or delete it to save.
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
            disabled={text === mutedText(muted)}
            onClick={() => setText(mutedText(muted))}
          >
            <Icon name="refresh" size={20} />
            Undo changes
          </button>
        </div>
      </div>
    </>
  );
};
