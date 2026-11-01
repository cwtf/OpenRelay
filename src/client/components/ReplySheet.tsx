// Reply composer, after Relay's reply screen: a "Replying to" line with the
// parent's text, the editor, a Markdown format bar, a preview, and Send.
// The reply is posted with the viewer's Reddit session; drafts are kept per
// parent until sent. Images and GIFs are uploaded as soon as they're picked
// (or pasted), and the editor gets the Markdown that embeds them.

import { useEffect, useRef, useState } from "react";
import { IMAGE_TYPES } from "../../providers/upload";
import type { CommentNode, InlineMedia } from "../../shared/api";
import { useAccount } from "../lib/account";
import { runAction, site, uploadImage } from "../lib/api";
import { Markdown } from "../lib/markdown";
import { applyFormat, type FormatKind } from "../lib/markdownFormat";
import { promptLogin, toast } from "../lib/platform";
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

type ReplySheetProps = {
  /** The post (`t3_`), comment (`t1_`) or message (`t4_`) replied to. */
  parentId: string;
  author: string;
  quote: string;
  /** Called with the new comment when Reddit returns it. */
  onPosted?: (comment: CommentNode) => void;
  /** Edit your own comment or post (`t1_`/`t3_`) instead of replying. */
  editing?: { id: string; text: string };
  onClosed: () => void;
};

export const ReplySheet = ({
  parentId,
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
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const uploadUrls = useRef<string[]>([]);
  const latestText = useRef(text);
  latestText.current = text;
  const canAttach = site.features.images[parentId.startsWith("t4_") && !editing ? "messages" : "comments"];

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

  /** Uploads an image and puts it, on its own line, where the cursor was. */
  const attach = (file: File | undefined) => {
    if (!file || uploading) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast("Attach a PNG, JPEG, GIF or WebP image.");
      return;
    }
    const el = field.current;
    const at = [el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length] as const;
    setUploading(true);
    uploadImage(file)
      .then(({ markdown, ref }) => {
        const url = URL.createObjectURL(file);
        uploadUrls.current.push(url);
        setUploads((current) => ({ ...current, [ref]: { url, width: 0, height: 0 } }));
        // The text as it is now; it may have changed during the upload.
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
      })
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : `${site.name} could not take the image.`),
      )
      .finally(() => setUploading(false));
  };

  const send = (close: () => void) => {
    if (!text.trim() || sending || uploading) return;
    setSending(true);
    runAction(editing ? "edit" : "comment", editing ? { id: editing.id, text } : { parent: parentId, text })
      .then((result) => {
        saveDraft(draftKey, "");
        setText("");
        toast(editing ? "Edit saved" : "Reply sent");
        if (result.comment) onPosted?.(result.comment);
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
                  if (!canAttach || !file?.type.startsWith("image/")) return;
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
              {canAttach ? (
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
