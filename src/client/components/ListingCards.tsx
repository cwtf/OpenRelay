// List items for profiles, the inbox and moderation queues, after Relay's
// listing_comments, listing_messages and report layouts.

import { useMemo, type ReactNode } from "react";
import type { InboxItem, ListingComment, ModInfo } from "../../shared/api";
import { useNav } from "../app/nav";
import { age, fullDate } from "../lib/format";
import { Markdown, MarkdownContext } from "../lib/markdown";
import { Icon, type IconName } from "./Icon";
import { ActionStrip, type BarAction } from "./Relay";
import { VoteLinks } from "./VoteLinks";

/** Markdown whose links and images open inside the reader. */
export const ReaderMarkdown = ({ source }: { source: string }) => {
  const nav = useNav();
  const actions = useMemo(
    () => ({
      onLink: nav.openLink,
      onImage: (url: string) =>
        nav.openMedia({ items: [{ kind: "image", url }], index: 0 }),
      highlight: null,
    }),
    [nav],
  );
  return (
    <MarkdownContext.Provider value={actions}>
      <Markdown source={source} />
    </MarkdownContext.Provider>
  );
};

const Time = ({ at }: { at: number }) => (
  <time dateTime={new Date(at).toISOString()} title={fullDate(at)}>
    {age(at)}
  </time>
);

/** Approval state and reports, as Relay shows them above moderated items. */
export const ModBlock = ({ mod }: { mod?: ModInfo | undefined }) =>
  mod ? (
    <div className="mod-block">
      {mod.state ? (
        <span className={`mod-state is-${mod.state}`}>
          {mod.state === "approved"
            ? "Approved"
            : mod.state === "spam"
              ? "Spam"
              : "Removed"}
        </span>
      ) : null}
      {mod.reports.length ? (
        <span className="mod-reports">
          {mod.reports.map((report, index) => (
            <span key={index}>{report}</span>
          ))}
        </span>
      ) : null}
    </div>
  ) : null;

/** A comment outside its thread; tapping opens it in context. */
export const CommentCard = ({
  comment,
  children,
}: {
  comment: ListingComment;
  children?: ReactNode;
}) => {
  const nav = useNav();
  return (
    <article
      className="list-card"
      data-cid={comment.id}
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as Element).closest("a, button, .md-spoiler")) return;
        nav.openPost(comment.postId, comment.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget)
          nav.openPost(comment.postId, comment.id);
      }}
    >
      <div className="list-title">{comment.postTitle || "Comment"}</div>
      <div className="list-info">
        <VoteLinks
          thingId={comment.id}
          permalink={comment.permalink}
          score={comment.score}
          vote={comment.vote}
          kind="comment"
          variant="inline"
        />
        <span className="accent">{comment.author}</span>
        <span className="break">in</span>
        <button
          type="button"
          className="accent link-btn"
          onClick={() => nav.openCommunity(comment.subreddit)}
        >
          r/{comment.subreddit}
        </button>
        <span className="dot">·</span>
        <Time at={comment.createdAt} />
      </div>
      <ModBlock mod={comment.mod} />
      <div className="list-body">
        <ReaderMarkdown source={comment.body} />
      </div>
      {children}
    </article>
  );
};

const INBOX_TYPE: Record<InboxItem["kind"], { label: string; icon: IconName }> = {
  message: { label: "Private Message", icon: "mail" },
  comment_reply: { label: "Comment Reply", icon: "comment" },
  post_reply: { label: "Post Reply", icon: "list" },
  mention: { label: "Username Mention", icon: "at" },
  mod_message: { label: "Mod Mail", icon: "modShield" },
};

/** An inbox entry: type line, subject, sender line and body. */
export const MessageCard = ({
  item,
  expanded,
  onToggle,
  actions,
}: {
  item: InboxItem;
  expanded: boolean;
  onToggle: () => void;
  actions: BarAction[];
}) => {
  const type = INBOX_TYPE[item.kind];
  return (
    <article
      className={`list-card message-card${item.unread ? " is-unread" : ""}`}
      data-mid={item.id}
      tabIndex={0}
      aria-expanded={expanded}
      onClick={(event) => {
        if ((event.target as Element).closest("a, button, .md-spoiler")) return;
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) onToggle();
      }}
    >
      <div className="message-type">
        <Icon name={type.icon} size={20} />
        <span>{type.label}</span>
        {item.unread ? <span className="unread-dot" aria-label="Unread" /> : null}
      </div>
      {item.subject ? <div className="list-title">{item.subject}</div> : null}
      <div className="list-info">
        <span className="accent">{item.author}</span>
        {item.recipient ? (
          <>
            <span className="break">to</span>
            <span className="accent">{item.recipient}</span>
          </>
        ) : null}
        {item.subreddit && item.kind !== "message" ? (
          <>
            <span className="break">in</span>
            <span className="accent">r/{item.subreddit}</span>
          </>
        ) : null}
        <span className="dot">·</span>
        <Time at={item.createdAt} />
        {item.replies ? (
          <span className="break">
            · {item.replies} {item.replies === 1 ? "reply" : "replies"}
          </span>
        ) : null}
      </div>
      <div className="list-body">
        <ReaderMarkdown source={item.body} />
      </div>
      {expanded ? <ActionStrip actions={actions} /> : null}
    </article>
  );
};
