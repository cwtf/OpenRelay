// Reply composer, after Relay's reply screen: a "Replying to" line with the
// parent's text, the editor, a Markdown format bar, a preview, and Send.
// The reply is posted with the viewer's Reddit session; drafts are kept per
// parent until sent.

import { useEffect, useRef, useState } from "react";
import type { CommentNode } from "../../shared/api";
import { useAccount } from "../lib/account";
import { runAction } from "../lib/api";
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
  onClosed: () => void;
};

export const ReplySheet = ({ parentId, author, quote, onPosted, onClosed }: ReplySheetProps) => {
  const account = useAccount();
  const [text, setText] = useState(() => loadDraft(parentId));
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);

  useEffect(() => saveDraft(parentId, text), [parentId, text]);

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

  const send = (close: () => void) => {
    if (!text.trim() || sending) return;
    setSending(true);
    runAction("comment", { parent: parentId, text })
      .then((result) => {
        saveDraft(parentId, "");
        setText("");
        toast("Reply sent");
        if (result.comment) onPosted?.(result.comment);
        close();
      })
      .catch((error: unknown) => {
        // The draft stays, so nothing typed is lost.
        toast(error instanceof Error ? error.message : "Reddit could not post the reply.");
        setSending(false);
      });
  };

  return (
    <Sheet title={`Reply to ${author}`} onClosed={onClosed}>
      {(close) =>
        !account ? (
          <div className="composer">
            <p style={{ margin: 0, color: "var(--text-2)" }}>
              Sign in to Reddit in this browser to reply.
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
            {quote ? (
              <>
                <div className="reply-parent">Replying to u/{author}</div>
                <div className="quote">{quote}</div>
              </>
            ) : null}
            {preview ? (
              <div className="reply-preview">
                {text.trim() ? (
                  <Markdown source={text} />
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
                aria-label="Reply"
                onChange={(event) => setText(event.target.value)}
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
              <span className="grow">
                {text.length > MAX_LENGTH - 500 ? `${text.length}/${MAX_LENGTH}` : ""}
              </span>
              <button type="button" className="btn is-text" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={!text.trim() || sending}
                onClick={() => send(close)}
              >
                <Icon name="send" />
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        )
      }
    </Sheet>
  );
};
