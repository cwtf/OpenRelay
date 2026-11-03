// Reply composer, after Relay's reply screen: a "Replying to" line with the
// parent's text, the editor, a Markdown format bar, a preview, and Send.
// The reply is posted with the viewer's Reddit session; drafts are kept per
// parent until sent. Images and GIFs are uploaded as soon as they're picked
// (or pasted), and the editor gets the Markdown that embeds them; not on
// Reddit for now. GIFs and images saved from comments (the viewer's Save)
// can be picked again.

import { useEffect, useRef, useState } from "react";
import { IMAGE_TYPES } from "../../providers/upload";
import type { CommentNode, InlineMedia } from "../../shared/api";
import { usePrefs } from "../app/prefs";
import { useNav } from "../app/nav";
import { useAccount } from "../lib/account";
import { isLemmyName } from "../lib/hybrid";
import { fetchAbout, runAction, site, uploadImage } from "../lib/api";
import { Markdown } from "../lib/markdown";
import { applyFormat, type FormatKind } from "../lib/markdownFormat";
import { promptLogin, toast } from "../lib/platform";
import { linkTo, redditTakes, reuseOf, savedKey, withLinks, type SavedMedia } from "../lib/savedMedia";
import { forgetSaved, useSavedMedia } from "../lib/savedMediaStore";
import { readJson, writeJson } from "../lib/storage";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./Sheet";

const DRAFTS = "reply-drafts";
const MAX_LENGTH = 10000;

const loadDraft = (parentId: string) =>
  readJson<Record<string, string>>(DRAFTS, {})[parentId] ?? "";

/** Keep the most recent drafts, keyed by the parent being replied to. */
const saveDraft = (parentId: string, text: string) => {
  const drafts = { ...readJson<Record<string, string>>(DRAFTS, {}) };
  delete drafts[parentId];
  if (text.trim()) drafts[parentId] = text;
  const keys = Object.keys(drafts);
  for (const key of keys.slice(0, Math.max(0, keys.length - 30))) delete drafts[key];
  writeJson(DRAFTS, drafts);
};

const FORMATS: { kind: FormatKind; icon: IconName; label: string }[] = [
  { kind: "bold", icon: "formatBold", label: "Bold" },
  { kind: "italic", icon: "formatItalic", label: "Italic" },
  { kind: "strike", icon: "formatStrike", label: "Strikethrough" },
  { kind: "spoiler", icon: "hide", label: "Spoiler" },
  { kind: "quote", icon: "formatQuote", label: "Quote" },
  { kind: "link", icon: "link", label: "Link" },
  { kind: "bullets", icon: "formatBullets", label: "Bulleted list" },
  { kind: "numbers", icon: "formatNumbers", label: "Numbered list" },
  { kind: "rule", icon: "formatRule", label: "Horizontal rule" },
  { kind: "code", icon: "formatCode", label: "Code" },
  { kind: "header", icon: "formatHeader", label: "Header" },
  { kind: "superscript", icon: "formatSuperscript", label: "Superscript" },
];

/** Each community's allowed comment media, once asked for (undefined: unknown). */
const commentMedia = new Map<string, Promise<string[] | undefined>>();

/**
 * What comments in `community` may embed, by its about page; undefined
 * while loading, when unknown, and off Reddit.
 */
const useCommentMedia = (community: string | undefined): string[] | undefined => {
  const [allowed, setAllowed] = useState<string[] | undefined>();
  useEffect(() => {
    if (!community || site.name !== "Reddit" || isLemmyName(community)) return;
    const key = community.toLowerCase();
    let request = commentMedia.get(key);
    if (!request) {
      request = fetchAbout(community).then(
        ({ about }) => about.commentMedia,
        () => undefined,
      );
      commentMedia.set(key, request);
    }
    let live = true;
    void request.then((value) => live && setAllowed(value));
    return () => {
      live = false;
    };
  }, [community]);
  return allowed;
};

type ReplySheetProps = {
  /** The post (`t3_`), comment (`t1_`) or message (`t4_`) replied to. */
  parentId: string;
  /** The community it's in, whose rules say which images comments may embed. */
  community?: string;
  author: string;
  quote: string;
  /** Called with the new comment when Reddit returns it. */
  /** The posted comment, or undefined when the site's answer didn't give it. */
  onPosted?: (comment: CommentNode | undefined) => void;
  /** Edit your own comment or post (`t1_`/`t3_`) instead of replying. */
  editing?: { id: string; text: string };
  onClosed: () => void;
};

export const ReplySheet = ({
  parentId,
  community,
  author,
  quote,
  onPosted,
  editing,
  onClosed,
}: ReplySheetProps) => {
  const account = useAccount();
  // Edits keep their own drafts, separate from replies to the same item.
  const draftKey = editing ? `edit:${editing.id}` : parentId;
  const [text, setText] = useState(() => loadDraft(draftKey) || editing?.text || "");
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  // What the preview shows for images uploaded here, by the ID they go by.
  const [uploads, setUploads] = useState<Record<string, InlineMedia>>({});
  // Saved items put in by ID, as links: sent instead if Reddit refuses the ID.
  const [links, setLinks] = useState<Record<string, string>>({});
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const uploadUrls = useRef<string[]>([]);
  const latestText = useRef(text);
  latestText.current = text;
  const { prefs } = usePrefs();
  const nav = useNav();
  const saved = useSavedMedia();
  const [showSaved, setShowSaved] = useState(false);
  const message = parentId.startsWith("t4_") && !editing;
  const allowed = useCommentMedia(message ? undefined : community);
  const canAttach = site.features.images[message ? "messages" : "comments"];
  // Uploading (the picker and pasting) is off on Reddit for now; saved GIFs
  // can still be picked. Also off in a community that takes neither still
  // nor animated images.
  const canUpload =
    canAttach &&
    site.name !== "Reddit" &&
    (!allowed || allowed.includes("static") || allowed.includes("animated"));
  const reuseSite = site.name === "Lemmy" ? "Lemmy" : "Reddit";
  // Reddit won't show an image it doesn't host, so those aren't offered there.
  const offered = reuseSite === "Lemmy" ? saved : saved.filter(redditTakes);

  useEffect(() => () => uploadUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(
    () => saveDraft(draftKey, text === editing?.text ? "" : text),
    [draftKey, text, editing?.text],
  );

  // Restore the selection after a format action re-renders the text.
  useEffect(() => {
    const el = field.current;
    const selection = pendingSelection.current;
    if (!el || !selection) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(...selection);
  }, [text]);

  const format = (kind: FormatKind) => {
    const el = field.current;
    if (!el) return;
    const next = applyFormat(
      { text, start: el.selectionStart, end: el.selectionEnd },
      kind,
    );
    if (next.text.length > MAX_LENGTH) return;
    pendingSelection.current = [next.start, next.end];
    setText(next.text);
  };

  const cursor = () => {
    const el = field.current;
    return [el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length] as const;
  };

  /** Puts `markdown`, on its own line, where the cursor was at `at`. */
  const insert = (markdown: string, at: readonly [number, number]) => {
    // The text as it is now; it may have changed during an upload.
    const current = latestText.current;
    const before = current.slice(0, Math.min(at[0], current.length));
    const after = current.slice(Math.min(at[1], current.length)).replace(/^\n+/, "");
    const lead = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const inserted = `${before}${lead}${markdown}\n\n`;
    if (inserted.length + after.length > MAX_LENGTH) {
      toast("The reply is too long to add the image.");
      return;
    }
    pendingSelection.current = [inserted.length, inserted.length];
    setText(inserted + after);
  };

  /** Why `allowed` refuses this file, or null. */
  const refused = (type: string): string | null => {
    if (!allowed) return null;
    const gif = type === "image/gif";
    if (gif && !allowed.includes("animated")) return "Comments here can't have GIFs.";
    if (!gif && !allowed.includes("static")) return "Comments here can only have GIFs.";
    return null;
  };

  /** Uploads a picked image file and inserts it. */
  const upload = (file: Promise<File>, at: readonly [number, number]) => {
    setUploading(true);
    file
      .then(async (picked) => {
        const reason = refused(picked.type);
        if (reason) throw new Error(reason);
        const { markdown, ref } = await uploadImage(picked);
        const url = URL.createObjectURL(picked);
        uploadUrls.current.push(url);
        setUploads((current) => ({ ...current, [ref]: { url, width: 0, height: 0 } }));
        insert(markdown, at);
      })
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : `${site.name} could not take the image.`),
      )
      .finally(() => setUploading(false));
  };

  const attach = (file: File | undefined) => {
    if (!file || uploading) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast("Attach a PNG, JPEG, GIF or WebP image.");
      return;
    }
    upload(Promise.resolve(file), cursor());
  };

  /** A saved GIF or image, inserted as Markdown (see `reuseOf`). */
  const reuse = (item: SavedMedia) => {
    if (uploading) return;
    const at = cursor();
    setShowSaved(false);
    const way = reuseOf(item, reuseSite, allowed);
    const { ref } = way;
    if (ref) {
      setUploads((current) => ({
        ...current,
        [ref]: {
          url: item.url,
          width: item.width,
          height: item.height,
          ...(item.mp4 ? { mp4: item.mp4 } : {}),
        },
      }));
      setLinks((current) => ({ ...current, [ref]: linkTo(item) }));
    }
    insert(way.markdown, at);
  };

  const send = (close: () => void) => {
    if (!text.trim() || sending || uploading) return;
    setSending(true);
    const fallback = withLinks(text, links);
    runAction(editing ? "edit" : "comment", {
      ...(editing ? { id: editing.id } : { parent: parentId }),
      text,
      ...(fallback !== text ? { fallback } : {}),
    })
      .then((result) => {
        saveDraft(draftKey, "");
        setText("");
        toast(
          result.linked
            ? `${editing ? "Edit saved" : "Reply sent"}, with the saved image as a link: ${site.name} wouldn't take it again${result.reason ? ` ("${result.reason}")` : ""}`
            : editing
              ? "Edit saved"
              : "Reply sent",
        );
        onPosted?.(result.comment);
        close();
      })
      .catch((error: unknown) => {
        // The draft stays, so nothing typed is lost.
        toast(error instanceof Error ? error.message : `${site.name} could not post the reply.`);
        setSending(false);
      });
  };

  return (
    <Sheet title={editing ? "Edit comment" : `Reply to ${author}`} onClosed={onClosed}>
      {(close) =>
        !account ? (
          <div className="composer">
            <p style={{ margin: 0, color: "var(--text-2)" }}>
              Sign in to {site.name} in this browser to reply.
            </p>
            <div className="row-actions">
              <span className="grow" />
              <button type="button" className="btn is-text" onClick={close}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={promptLogin}>
                Sign in
              </button>
            </div>
          </div>
        ) : (
          <div className="composer">
            {quote && !editing ? (
              <>
                <div className="reply-parent">Replying to {site.userLabel(author)}</div>
                <div className="quote">{quote}</div>
              </>
            ) : null}
            {preview ? (
              <div className="reply-preview">
                {text.trim() ? (
                  <Markdown source={text} media={uploads} />
                ) : (
                  <p className="sub-hint">Nothing to preview yet.</p>
                )}
              </div>
            ) : (
              <textarea
                ref={field}
                autoFocus
                value={text}
                maxLength={MAX_LENGTH}
                placeholder="Write a reply"
                aria-label={editing ? "Comment text" : "Reply"}
                onChange={(event) => setText(event.target.value)}
                onPaste={(event) => {
                  const file = event.clipboardData.files[0];
                  if (!canUpload || !file?.type.startsWith("image/")) return;
                  event.preventDefault();
                  attach(file);
                }}
                onKeyDown={(event) => {
                  // Ctrl/Cmd+Enter sends, as in most editors.
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    send(close);
                  }
                }}
              />
            )}
            {showSaved && !preview ? (
              <div className="reply-saved" role="group" aria-label="Saved GIFs and images">
                {offered.length ? (
                  <div className="reply-saved-head">
                    <span>Saved · {offered.length}</span>
                    <button
                      type="button"
                      className="btn is-text"
                      onClick={() => {
                        close();
                        nav.openSavedMedia();
                      }}
                    >
                      Manage
                    </button>
                  </div>
                ) : null}
                {offered.length ? (
                  offered.map((item) => (
                    <div className="reply-saved-item" key={savedKey(item)}>
                      <button
                        type="button"
                        className="reply-saved-pick"
                        aria-label={item.giphy ? "Add this GIF" : "Add this image"}
                        disabled={uploading}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => reuse(item)}
                      >
                        {item.giphy && !prefs.giphyGifs ? (
                          <span>GIF</span>
                        ) : (
                          <img
                            src={item.url}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </button>
                      <button
                        type="button"
                        className="reply-saved-forget"
                        aria-label="Remove from saved"
                        title="Remove from saved"
                        onClick={() => forgetSaved(item)}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="sub-hint">
                    Save GIFs and images from comments and posts with the star in the viewer.
                  </p>
                )}
              </div>
            ) : null}
            <div className="format-bar" role="toolbar" aria-label="Formatting">
              {FORMATS.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  className="icon-btn"
                  aria-label={option.label}
                  title={option.label}
                  disabled={preview}
                  // Keep the textarea's selection when pressing a format button.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format(option.kind)}
                >
                  <Icon name={option.icon} size={20} />
                </button>
              ))}
              {canAttach && offered.length ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Saved GIFs and images"
                  title="Saved GIFs and images"
                  aria-pressed={showSaved}
                  disabled={preview}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setShowSaved((value) => !value)}
                >
                  <Icon name={showSaved ? "starFilled" : "star"} size={20} />
                </button>
              ) : null}
              {canUpload ? (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Add image or GIF"
                    title="Add image or GIF"
                    disabled={preview || uploading}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => picker.current?.click()}
                  >
                    <Icon name="image" size={20} />
                  </button>
                  <input
                    ref={picker}
                    type="file"
                    accept={IMAGE_TYPES.join(",")}
                    hidden
                    onChange={(event) => {
                      attach(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </>
              ) : null}
            </div>
            <div className="row-actions">
              <button
                type="button"
                className="btn is-text"
                aria-pressed={preview}
                onClick={() => setPreview((value) => !value)}
              >
                <Icon name={preview ? "edit" : "eye"} />
                {preview ? "Edit" : "Preview"}
              </button>
              <span className="grow" role="status">
                {uploading
                  ? "Uploading image…"
                  : text.length > MAX_LENGTH - 500
                    ? `${text.length}/${MAX_LENGTH}`
                    : ""}
              </span>
              <button type="button" className="btn is-text" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={!text.trim() || sending || uploading}
                onClick={() => send(close)}
              >
                <Icon name="send" />
                {sending ? "Sending…" : editing ? "Save" : "Send"}
              </button>
            </div>
          </div>
        )
      }
    </Sheet>
  );
};
