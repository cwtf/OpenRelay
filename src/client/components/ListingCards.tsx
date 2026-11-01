// List items for profiles, the inbox and moderation queues, after Relay's
// listing_comments, listing_messages and report layouts.

import { useMemo, type ReactNode } from "react";
import { site } from "../lib/api";
import type {
  InboxItem,
  InlineMedia,
  ListingComment,
  ModInfo,
} from "../../shared/api";
import { useNav } from "../app/nav";
import { usePrefs } from "../app/prefs";
import { age, fullDate } from "../lib/format";
import { useLongPress } from "../lib/gestures";
import { Markdown, MarkdownContext } from "../lib/markdown";
import type { SavedMedia } from "../lib/savedMedia";
import { Icon, type IconName } from "./Icon";
import { inlineViewerItem } from "./PostParts";
import { ActionStrip, type BarAction } from "./Relay";
import { VoteLinks, useVoteToggle } from "./VoteLinks";
import { useAccount } from "../lib/account";
import { DeleteSheet, ModActionsSheet } from "./Relay";
import { ReplySheet } from "./ReplySheet";
import { Sheet, SheetItem } from "./Sheet";
import { copyText, openUrl, redditUrl } from "../lib/platform";
import { SwipeActions, type SwipeAction } from "./SwipeActions";

/** Markdown whose links and images open inside the reader. */
export const ReaderMarkdown = ({
  source,
  media,
}: {
  source: string;
  media?: Record<string, InlineMedia>;
}) => {
  const nav = useNav();
  const { prefs } = usePrefs();
  const actions = useMemo(
    () => ({
      onLink: nav.openLink,
      onImage: (url: string, inline?: InlineMedia, save?: SavedMedia) =>
        nav.openMedia({
          items: [inlineViewerItem(url, inline)],
          index: 0,
          ...(save ? { save } : {}),
        }),
      highlight: null,
      autoplayGifs: prefs.autoplayGifs,
      giphyGifs: prefs.giphyGifs,
    }),
    [nav, prefs.autoplayGifs, prefs.giphyGifs],
  );
  return (
    <MarkdownContext.Provider value={actions}>
      <Markdown source={source} media={media} />
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
  const account = useAccount();
  const vote = useVoteToggle(comment.id, comment.vote, comment.score);
  const own = account?.name.toLowerCase() === comment.author.toLowerCase();
  // Relay's listing-comment overflow menu; Delete only on your own comments.
  const more = () =>
    nav.openSheet((onClosed) => (
      <Sheet title={`${comment.author} · ${site.communityLabel(comment.subreddit)}`} label="Comment actions" onClosed={onClosed}>
        {(close) => {
          const run = (action: () => void) => () => {
            close();
            action();
          };
          return (
            <>
              <SheetItem icon="copy" label="Copy text" onClick={run(() => void copyText(comment.body, "Comment copied"))} />
              <SheetItem
                icon="link"
                label="Copy link"
                onClick={run(() => void copyText(redditUrl(comment.permalink), "Link copied"))}
              />
              <SheetItem icon="external" label="View on Reddit" onClick={run(() => openUrl(redditUrl(comment.permalink)))} />
              {own ? (
                <SheetItem
                  icon="trash"
                  label="Delete"
                  onClick={run(() =>
                    nav.openSheet((onClosed) => <DeleteSheet id={comment.id} onClosed={onClosed} />),
                  )}
                />
              ) : null}
            </>
          );
        }}
      </Sheet>
    ));
  const press = useLongPress(more);
  // Relay's listing-comment swipe actions: Up, Down, Full, Reply, Edit, Mod,
  // plus More for the overflow menu.
  const actions: SwipeAction[] = [
    { icon: "up", label: "Up", title: "Upvote", tone: "up", active: vote.current === 1, disabled: vote.pending, onClick: () => vote.cast(1) },
    { icon: "down", label: "Down", title: "Downvote", tone: "down", active: vote.current === -1, disabled: vote.pending, onClick: () => vote.cast(-1) },
    { icon: "thread", label: "Full", title: "Open the full thread", onClick: () => nav.openPost(comment.postId, comment.id) },
    {
      icon: "reply",
      label: "Reply",
      onClick: () =>
        nav.openSheet((onClosed) => (
          <ReplySheet
            parentId={comment.id}
            community={comment.subreddit}
            author={comment.author}
            quote={comment.body}
            onClosed={onClosed}
          />
        )),
    },
    ...(own
      ? [
          {
            icon: "edit",
            label: "Edit",
            title: "Edit comment",
            onClick: () =>
              nav.openSheet((onClosed) => (
                <ReplySheet
                  parentId={comment.postId}
                  community={comment.subreddit}
                  author={comment.author}
                  quote=""
                  editing={{ id: comment.id, text: comment.body }}
                  onClosed={onClosed}
                />
              )),
          } satisfies SwipeAction,
        ]
      : []),
    ...(account?.isMod && site.features.moderation
      ? [
          {
            icon: "modShield",
            label: "Mod",
            title: "Moderate",
            onClick: () => nav.openSheet((onClosed) => <ModActionsSheet id={comment.id} onClosed={onClosed} />),
          } satisfies SwipeAction,
        ]
      : []),
    { icon: "more", label: "More", title: "More actions", onClick: more },
  ];
  return (
    <SwipeActions actions={actions}>
    <article
      className="list-card"
      data-cid={comment.id}
      tabIndex={0}
      onClick={(event) => {
        if (press.consumeClick()) return;
        if ((event.target as Element).closest("a, button, .md-spoiler")) return;
        nav.openPost(comment.postId, comment.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget)
          nav.openPost(comment.postId, comment.id);
      }}
      {...press.handlers}
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
          {site.communityLabel(comment.subreddit)}
        </button>
        <span className="dot">·</span>
        <Time at={comment.createdAt} />
      </div>
      <ModBlock mod={comment.mod} />
      <div className="list-body">
        <ReaderMarkdown source={comment.body} media={comment.media} />
      </div>
      {children}
    </article>
    </SwipeActions>
  );
};

const INBOX_TYPE: Record<InboxItem["kind"], { label: string; icon: IconName }> = {
  message: { label: "Private Message", icon: "mail" },
  comment_reply: { label: "Comment Reply", icon: "comment" },
  post_reply: { label: "Post Reply", icon: "list" },
  mention: { label: "Username Mention", icon: "at" },
  mod_message: { label: "Mod Mail", icon: "modShield" },
};

/**
 * An inbox entry: type line, subject, sender line and body. Swiping left
 * reveals its actions, as on other cards.
 */
export const MessageCard = ({
  item,
  expanded,
  onToggle,
  onOpen,
  actions,
}: {
  item: InboxItem;
  expanded: boolean;
  onToggle: () => void;
  /** When set, a tap opens the item instead of expanding its actions. */
  onOpen?: () => void;
  actions: BarAction[];
}) => {
  const type = INBOX_TYPE[item.kind];
  const activate = onOpen ?? onToggle;
  return (
    <SwipeActions actions={actions}>
    <article
      className={`list-card message-card${item.unread ? " is-unread" : ""}`}
      data-mid={item.id}
      tabIndex={0}
      aria-expanded={onOpen ? undefined : expanded}
      onClick={(event) => {
        if ((event.target as Element).closest("a, button, .md-spoiler")) return;
        activate();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) activate();
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
            <span className="accent">{site.communityLabel(item.subreddit)}</span>
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
      {expanded && !onOpen ? <ActionStrip actions={actions} /> : null}
    </article>
    </SwipeActions>
  );
};
