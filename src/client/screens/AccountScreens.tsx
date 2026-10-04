// Profile, Inbox, Moderator, Friends, New Post and Compose screens, after
// Relay's listing_fragment_profile / _messages / _moderator, friendslist,
// submit_text / submit_link and newmessage layouts.

import { useCallback, useEffect, useState } from "react";
import type {
  Friend,
  InboxItem,
  ListingItem,
  ModInfo,
  Timeframe,
  UserAbout,
} from "../../shared/api";
import { useNav } from "../app/nav";
import { usePrefs } from "../app/prefs";
import { Icon } from "../components/Icon";
import {
  CommentCard,
  MessageCard,
  ModBlock,
  ReaderMarkdown,
} from "../components/ListingCards";
import { PostCard } from "../components/PostCard";
import {
  ActionStrip,
  BottomBar,
  ChoiceSheet,
  ConfirmSheet,
  Field,
  ListFooter,
  ReplyComposer,
  ScreenHeader,
  type BarAction,
  type Choice,
} from "../components/Relay";
import { Sheet } from "../components/Sheet";
import { ensureAccount, useAccount } from "../lib/account";
import {
  fetchFriends,
  fetchInbox,
  fetchModListing,
  fetchModerated,
  fetchRules,
  fetchUserAbout,
  fetchUserListing,
  runAction,
  type InboxSection,
  type ModFilter,
  type ModSection,
  type ProfileSection,
  type ProfileSort,
} from "../lib/api";
import { compact, timeframeLabel } from "../lib/format";
import { toast } from "../lib/platform";
import { useListing } from "../lib/useListing";
import { Avatar } from "./FeedScreen";

const USER_RE = /^[\w-]{3,20}$/;
const SUB_RE = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

/** Run a write and report failures; resolves to false when it failed. */
const attempt = async (work: () => Promise<unknown>, done?: string) => {
  try {
    await work();
    if (done) toast(done);
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "Reddit could not do that.");
    return false;
  }
};

const labelOf = <T extends string>(choices: Choice<T>[], value: T) =>
  choices.find((choice) => choice.value === value)?.label ?? value;

/** Posts and comments from profile and moderator listings. */
const ListingRows = ({
  items,
  extra,
}: {
  items: ListingItem[];
  extra?: (item: ListingItem) => React.ReactNode;
}) => {
  const { prefs } = usePrefs();
  return (
    <>
      {items.map((item) =>
        item.type === "post" ? (
          <div className="listing-post" key={item.post.id}>
            <PostCard
              post={item.post}
              layout={prefs.layout}
              showThumbnails={prefs.showThumbnails}
              showSub
            />
            {extra ? extra(item) : null}
          </div>
        ) : (
          <CommentCard key={item.comment.id} comment={item.comment}>
            {extra ? extra(item) : null}
          </CommentCard>
        ),
      )}
    </>
  );
};

// ------------------------------------------------------------------ profile

const PROFILE_SECTIONS: Choice<ProfileSection>[] = [
  { value: "overview", label: "Overview", icon: "eye" },
  { value: "comments", label: "Comments", icon: "comment" },
  { value: "submitted", label: "Posts", icon: "list" },
  { value: "upvoted", label: "Upvoted", icon: "up" },
  { value: "downvoted", label: "Downvoted", icon: "down" },
  { value: "hidden", label: "Hidden", icon: "hide" },
  { value: "saved", label: "Saved", icon: "star" },
];
const PRIVATE_SECTIONS = new Set<ProfileSection>(["upvoted", "downvoted", "hidden", "saved"]);
const PROFILE_SORTS: Choice<ProfileSort>[] = [
  { value: "new", label: "New", icon: "new" },
  { value: "hot", label: "Hot", icon: "hot" },
  { value: "top", label: "Top", icon: "top" },
  { value: "controversial", label: "Controversial", icon: "controversial" },
];
const TIMES: Choice<Timeframe>[] = (
  ["hour", "day", "week", "month", "year", "all"] as const
).map((value) => ({ value, label: timeframeLabel[value] ?? value, icon: "clock" }));

export const ProfileScreen = ({ user }: { user: string }) => {
  const nav = useNav();
  const account = useAccount();
  const own = account?.name.toLowerCase() === user.toLowerCase();
  const [about, setAbout] = useState<UserAbout | null>(null);
  const [aboutError, setAboutError] = useState("");
  const [section, setSection] = useState<ProfileSection>("overview");
  const [sort, setSort] = useState<ProfileSort>("new");
  const [time, setTime] = useState<Timeframe>("all");
  const list = useListing(`${user}:${section}:${sort}:${time}`, (after) =>
    fetchUserListing(user, section, sort, time, after),
  );

  const loadAbout = useCallback(() => {
    fetchUserAbout(user)
      .then((info) => {
        setAbout(info);
        setAboutError("");
      })
      .catch((error: unknown) =>
        setAboutError(error instanceof Error ? error.message : "Unavailable"),
      );
  }, [user]);
  useEffect(loadAbout, [loadAbout]);

  const sections = PROFILE_SECTIONS.filter(
    (choice) => own || !PRIVATE_SECTIONS.has(choice.value),
  );
  const pickSection = () =>
    nav.openSheet((onClosed) => (
      <ChoiceSheet
        title="Section"
        choices={sections}
        selected={section}
        onPick={setSection}
        onClosed={onClosed}
      />
    ));
  const pickSort = () =>
    nav.openSheet((onClosed) => (
      <ChoiceSheet
        title="Sort"
        choices={PROFILE_SORTS}
        selected={sort}
        onPick={(next) => {
          if (next === "top" || next === "controversial")
            nav.openSheet((onTimeClosed) => (
              <ChoiceSheet
                title={labelOf(PROFILE_SORTS, next)}
                choices={TIMES}
                selected={time}
                onPick={(nextTime) => {
                  setTime(nextTime);
                  setSort(next);
                }}
                onClosed={onTimeClosed}
              />
            ));
          else setSort(next);
        }}
        onClosed={onClosed}
      />
    ));

  const sortText =
    sort === "top" || sort === "controversial"
      ? `${labelOf(PROFILE_SORTS, sort)} · ${timeframeLabel[time]}`
      : labelOf(PROFILE_SORTS, sort);
  const friend = about?.isFriend ?? false;
  const actions: BarAction[] = [
    { icon: "sort", label: "Sort", onClick: pickSort },
    {
      icon: "refresh",
      label: "Refresh",
      onClick: () => {
        loadAbout();
        list.reload();
      },
    },
    { icon: "category", label: "Section", onClick: pickSection },
    ...(own || !account
      ? []
      : [
          {
            icon: friend ? "personRemove" : "personAdd",
            label: friend ? "UnFriend" : "Friend",
            onClick: () =>
              void attempt(
                () => runAction(friend ? "unfriend" : "friend", { name: user }),
                friend ? `Removed u/${user} from friends` : `Added u/${user} as a friend`,
              ).then((ok) => {
                if (ok) setAbout((current) => current && { ...current, isFriend: !friend });
              }),
          } satisfies BarAction,
        ]),
  ];

  return (
    <>
      <ScreenHeader
        title={`u/${user}`}
        subtitle={`${labelOf(PROFILE_SECTIONS, section)} · ${sortText}`}
        onTitle={pickSection}
      />
      <div className="scroller">
        <div className="feed has-bottom-bar">
          <div className="profile-head">
            <Avatar name={user} size="large" src={about?.icon} />
            <div className="profile-meta">
              <div className="profile-name">{about?.name ?? user}</div>
              {about ? (
                <div className="profile-karma">
                  Karma: {compact(about.linkKarma)} / {compact(about.commentKarma)}
                  {about.createdAt
                    ? ` · Redditor since ${new Date(about.createdAt).getFullYear()}`
                    : ""}
                </div>
              ) : (
                <div className="profile-karma">{aboutError || "Loading…"}</div>
              )}
            </div>
          </div>
          <ListingRows items={list.items} />
          <ListFooter
            status={list.status}
            error={list.error}
            count={list.items.length}
            hasMore={Boolean(list.after)}
            onMore={list.more}
            onRetry={list.reload}
            empty={`Nothing in ${labelOf(PROFILE_SECTIONS, section)} yet.`}
          />
        </div>
      </div>
      <BottomBar
        actions={actions}
        fabIndex={2}
        fab={
          own || !account
            ? undefined
            : {
                icon: "mail",
                label: "Send Message",
                onClick: () => nav.openCompose({ to: user }),
              }
        }
      />
    </>
  );
};

// ------------------------------------------------------------------ inbox

const INBOX_SECTIONS: Choice<InboxSection>[] = [
  { value: "inbox", label: "Inbox All", icon: "inbox" },
  { value: "unread", label: "Unread", icon: "mail" },
  { value: "messages", label: "Messages", icon: "mailOpen" },
  { value: "comments", label: "Comment Replies", icon: "comment" },
  { value: "selfreply", label: "Post Replies", icon: "list" },
  { value: "sent", label: "Sent Messages", icon: "send" },
  { value: "mentions", label: "Username Mentions", icon: "at" },
  { value: "moderator", label: "Mod Mail", icon: "modShield" },
  { value: "moderator/unread", label: "Mod Mail Unread", icon: "shield" },
];

export const InboxScreen = () => {
  const nav = useNav();
  const account = useAccount();
  const [section, setSection] = useState<InboxSection>("inbox");
  const [open, setOpen] = useState<string | null>(null);
  const list = useListing(section, (after) => fetchInbox(section, after));

  const setUnread = (id: string, unread: boolean) =>
    list.update((items) =>
      items.map((item) => (item.id === id ? { ...item, unread } : item)),
    );
  const markRead = (item: InboxItem, unread: boolean) =>
    void attempt(() =>
      runAction(unread ? "unread_message" : "read_message", { id: item.id }),
    ).then((ok) => {
      if (!ok) return;
      setUnread(item.id, unread);
      ensureAccount(0); // Update the drawer's unread count.
    });

  const toggle = (item: InboxItem) => {
    setOpen((current) => (current === item.id ? null : item.id));
    if (item.unread) markRead(item, false);
  };

  const actionsFor = (item: InboxItem): BarAction[] => [
    ...(USER_RE.test(item.author)
      ? [{ icon: "user", label: "User", onClick: () => nav.openProfile(item.author) } as BarAction]
      : []),
    ...(item.postId
      ? [
          {
            icon: "comment",
            label: "Context",
            // Comment notifications open the thread at that comment.
            onClick: () =>
              nav.openPost(item.postId!, item.id.startsWith("t1_") ? item.id : undefined),
          } as BarAction,
        ]
      : []),
    {
      icon: "reply",
      label: "Reply",
      onClick: () =>
        nav.openSheet((onClosed) => (
          <ReplyComposer
            title={`Reply to ${item.author}`}
            quote={item.body}
            onSend={async (text) => {
              const ok = await attempt(
                () => runAction("comment", { parent: item.id, text }),
                "Reply sent",
              );
              if (!ok) throw new Error("not sent");
            }}
            onClosed={onClosed}
          />
        )),
    },
    ...(item.id.startsWith("t4_")
      ? [
          {
            icon: "trash",
            label: "Delete",
            onClick: () =>
              nav.openSheet((onClosed) => (
                <ConfirmSheet
                  title="Delete message?"
                  message="It will be removed from your inbox on Reddit."
                  confirm="Delete"
                  onConfirm={() =>
                    void attempt(() => runAction("del_msg", { id: item.id }), "Message deleted").then(
                      (ok) => {
                        if (ok) list.update((items) => items.filter((i) => i.id !== item.id));
                      },
                    )
                  }
                  onClosed={onClosed}
                />
              )),
          } as BarAction,
        ]
      : []),
    ...(USER_RE.test(item.author)
      ? [
          {
            icon: "block",
            label: "Block",
            onClick: () =>
              nav.openSheet((onClosed) => (
                <ConfirmSheet
                  title={`Block u/${item.author}?`}
                  message="You will no longer see their posts, comments or messages."
                  confirm="Block"
                  onConfirm={() =>
                    void attempt(() => runAction("block", { id: item.id }), `Blocked u/${item.author}`)
                  }
                  onClosed={onClosed}
                />
              )),
          } as BarAction,
        ]
      : []),
    {
      icon: item.unread ? "mailOpen" : "mail",
      label: item.unread ? "Read" : "Unread",
      onClick: () => markRead(item, !item.unread),
    },
  ];

  const sections = INBOX_SECTIONS.filter(
    (choice) => account?.isMod || !choice.value.startsWith("moderator"),
  );
  const pickSection = () =>
    nav.openSheet((onClosed) => (
      <ChoiceSheet
        title="Section"
        choices={sections}
        selected={section}
        onPick={(next) => {
          setOpen(null);
          setSection(next);
        }}
        onClosed={onClosed}
      />
    ));

  return (
    <>
      <ScreenHeader
        title="Inbox"
        subtitle={labelOf(INBOX_SECTIONS, section)}
        onTitle={pickSection}
      />
      <div className="scroller">
        <div className="feed has-bottom-bar">
          {list.items.map((item) => (
            <MessageCard
              key={item.id}
              item={item}
              expanded={open === item.id}
              onToggle={() => toggle(item)}
              actions={actionsFor(item)}
            />
          ))}
          <ListFooter
            status={list.status}
            error={list.error}
            count={list.items.length}
            hasMore={Boolean(list.after)}
            onMore={list.more}
            onRetry={list.reload}
            empty="No messages here."
          />
        </div>
      </div>
      <BottomBar
        actions={[
          { icon: "mail", label: "Message", onClick: () => nav.openCompose() },
          { icon: "refresh", label: "Refresh", onClick: list.reload },
          { icon: "category", label: "Section", onClick: pickSection },
          {
            icon: "doneAll",
            label: "Read All",
            onClick: () =>
              void attempt(() => runAction("read_all_messages"), "All messages marked read").then(
                (ok) => {
                  if (!ok) return;
                  list.update((items) => items.map((item) => ({ ...item, unread: false })));
                  ensureAccount(0);
                },
              ),
          },
        ]}
      />
    </>
  );
};

// ------------------------------------------------------------------ moderator

const MOD_SECTIONS: Choice<ModSection>[] = [
  { value: "modqueue", label: "Modqueue", icon: "modShield" },
  { value: "reports", label: "Reports", icon: "flag" },
  { value: "spam", label: "Spam", icon: "spam" },
  { value: "edited", label: "Edited", icon: "edit" },
  { value: "unmoderated", label: "Unmoderated", icon: "shield" },
];
const MOD_FILTERS: Choice<ModFilter>[] = [
  { value: "links", label: "Posts Only", icon: "list" },
  { value: "comments", label: "Comments Only", icon: "comment" },
  { value: "all", label: "No Filter", icon: "filter" },
];

const itemId = (item: ListingItem) =>
  item.type === "post" ? item.post.id : item.comment.id;

export const ModeratorScreen = () => {
  const nav = useNav();
  const [sub, setSub] = useState("mod");
  const [section, setSection] = useState<ModSection>("modqueue");
  const [filter, setFilter] = useState<ModFilter>("all");
  const [moderated, setModerated] = useState<string[] | null>(null);
  const list = useListing(`${sub}:${section}:${filter}`, (after) =>
    fetchModListing(sub, section, filter, after),
  );

  const setMod = (id: string, change: (mod: ModInfo) => ModInfo) =>
    list.update((items) =>
      items.map((item) => {
        if (itemId(item) !== id) return item;
        const mod = change(
          (item.type === "post" ? item.post.mod : item.comment.mod) ?? { reports: [] },
        );
        return item.type === "post"
          ? { ...item, post: { ...item.post, mod } }
          : { ...item, comment: { ...item.comment, mod } };
      }),
    );

  const modActions = (item: ListingItem): BarAction[] => {
    const id = itemId(item);
    const act = (op: string, args: Record<string, unknown>, done: string, change: (mod: ModInfo) => ModInfo) =>
      void attempt(() => runAction(op, { id, ...args }), done).then((ok) => {
        if (ok) setMod(id, change);
      });
    return [
      {
        icon: "check",
        label: "Approve",
        // Approving also clears the item's reports on Reddit.
        onClick: () => act("approve", {}, "Approved", () => ({ reports: [], state: "approved" })),
      },
      {
        icon: "removeCircle",
        label: "Remove",
        onClick: () => act("remove", { spam: false }, "Removed", (mod) => ({ ...mod, state: "removed" })),
      },
      {
        icon: "spam",
        label: "Spam",
        onClick: () => act("remove", { spam: true }, "Removed as spam", (mod) => ({ ...mod, state: "spam" })),
      },
      {
        icon: "flag",
        label: "Ignore",
        onClick: () => act("ignore_reports", {}, "Reports ignored", (mod) => ({ ...mod, reports: [] })),
      },
    ];
  };

  const pickSection = () =>
    nav.openSheet((onClosed) => (
      <ChoiceSheet title="Section" choices={MOD_SECTIONS} selected={section} onPick={setSection} onClosed={onClosed} />
    ));
  const pickFilter = () =>
    nav.openSheet((onClosed) => (
      <ChoiceSheet title="Filter" choices={MOD_FILTERS} selected={filter} onPick={setFilter} onClosed={onClosed} />
    ));
  const pickSub = () => {
    if (!moderated)
      fetchModerated()
        .then(setModerated)
        .catch(() => setModerated([]));
    nav.openSheet((onClosed) => (
      <ModSubSheet selected={sub} initial={moderated} onPick={setSub} onClosed={onClosed} />
    ));
  };

  return (
    <>
      <ScreenHeader
        title={sub === "mod" ? "Moderator" : `r/${sub}`}
        subtitle={`${labelOf(MOD_SECTIONS, section)}${filter === "all" ? "" : ` · ${labelOf(MOD_FILTERS, filter)}`}`}
        onTitle={pickSection}
      />
      <div className="scroller">
        <div className="feed has-bottom-bar">
          <ListingRows
            items={list.items}
            extra={(item) => (
              <>
                {item.type === "post" ? <ModBlock mod={item.post.mod} /> : null}
                <ActionStrip actions={modActions(item)} />
              </>
            )}
          />
          <ListFooter
            status={list.status}
            error={list.error}
            count={list.items.length}
            hasMore={Boolean(list.after)}
            onMore={list.more}
            onRetry={list.reload}
            empty={`Nothing in the ${labelOf(MOD_SECTIONS, section).toLowerCase()}.`}
          />
        </div>
      </div>
      <BottomBar
        actions={[
          { icon: "filter", label: "Filter", onClick: pickFilter },
          { icon: "category", label: "Section", onClick: pickSection },
          { icon: "subreddit", label: "Subreddit", onClick: pickSub },
          { icon: "refresh", label: "Refresh", onClick: list.reload },
        ]}
      />
    </>
  );
};

const ModSubSheet = ({
  selected,
  initial,
  onPick,
  onClosed,
}: {
  selected: string;
  initial: string[] | null;
  onPick: (sub: string) => void;
  onClosed: () => void;
}) => {
  const [subs, setSubs] = useState(initial);
  useEffect(() => {
    if (subs) return;
    fetchModerated()
      .then(setSubs)
      .catch(() => setSubs([]));
  }, [subs]);
  const choices: Choice<string>[] = [
    { value: "mod", label: "All moderated communities", icon: "modShield" },
    ...(subs ?? []).map((name) => ({ value: name, label: `r/${name}`, icon: "subreddit" as const })),
  ];
  return subs ? (
    <ChoiceSheet title="Subreddit" choices={choices} selected={selected} onPick={onPick} onClosed={onClosed} />
  ) : (
    <Sheet title="Subreddit" onClosed={onClosed}>
      {() => (
        <div className="feed-end">
          <div className="spinner" />
        </div>
      )}
    </Sheet>
  );
};

// ------------------------------------------------------------------ friends

export const FriendsScreen = () => {
  const nav = useNav();
  const list = useListing<Friend>("friends", async () => ({
    items: await fetchFriends(),
    after: null,
  }));
  return (
    <>
      <ScreenHeader
        title="Friends"
        subtitle={list.status === "idle" ? `${list.items.length} friends` : undefined}
        actions={
          <button
            type="button"
            className="icon-btn"
            data-ripple
            aria-label="Re-sync"
            title="Re-sync"
            onClick={list.reload}
          >
            <Icon name="refresh" />
          </button>
        }
      />
      <div className="scroller">
        <div className="friends-list">
          {list.items.map((friend) => (
            <div className="friend-row" key={friend.name}>
              <button
                type="button"
                className="friend-main"
                data-ripple
                onClick={() => nav.openProfile(friend.name)}
              >
                <span className="avatar friend-circle" aria-hidden>
                  {friend.name.slice(0, 1)}
                </span>
                <span className="label">{friend.name}</span>
              </button>
              <button
                type="button"
                className="icon-btn friend-remove"
                aria-label={`Remove u/${friend.name} from friends`}
                onClick={() =>
                  nav.openSheet((onClosed) => (
                    <ConfirmSheet
                      title={`Remove u/${friend.name}?`}
                      message="They will be removed from your Reddit friends."
                      confirm="Remove"
                      onConfirm={() =>
                        void attempt(
                          () => runAction("unfriend", { name: friend.name }),
                          `Removed u/${friend.name}`,
                        ).then((ok) => {
                          if (ok)
                            list.update((items) => items.filter((f) => f.name !== friend.name));
                        })
                      }
                      onClosed={onClosed}
                    />
                  ))
                }
              >
                <Icon name="removeCircle" />
              </button>
            </div>
          ))}
          <ListFooter
            status={list.status}
            error={list.error}
            count={list.items.length}
            hasMore={false}
            onMore={() => undefined}
            onRetry={list.reload}
            empty="You haven’t added any friends. Use Friend on someone’s profile."
          />
        </div>
      </div>
    </>
  );
};

// ------------------------------------------------------------------ new post

const SwitchRow = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) => (
  <button
    type="button"
    className="setting"
    role="switch"
    aria-checked={value}
    data-ripple
    onClick={() => onChange(!value)}
    style={{ width: "100%" }}
  >
    <span className="label">{label}</span>
    <span className={`switch${value ? " is-on" : ""}`} aria-hidden />
  </button>
);

type PostOptions = { sendreplies: boolean; nsfw: boolean; spoiler: boolean; resubmit: boolean };

const OptionsSheet = ({
  initial,
  onChange,
  onClosed,
}: {
  initial: PostOptions;
  onChange: (options: PostOptions) => void;
  onClosed: () => void;
}) => {
  const [options, setOptions] = useState(initial);
  const set = (key: keyof PostOptions) => (value: boolean) => {
    const next = { ...options, [key]: value };
    setOptions(next);
    onChange(next);
  };
  return (
    <Sheet title="Options" onClosed={onClosed}>
      {() => (
        <>
          <SwitchRow label="Send Replies to Inbox" value={options.sendreplies} onChange={set("sendreplies")} />
          <SwitchRow label="Mark as NSFW" value={options.nsfw} onChange={set("nsfw")} />
          <SwitchRow label="Mark as Spoiler" value={options.spoiler} onChange={set("spoiler")} />
          <SwitchRow label="Repost if already submitted?" value={options.resubmit} onChange={set("resubmit")} />
        </>
      )}
    </Sheet>
  );
};

export const SubmitScreen = ({
  sub,
  kind: initialKind = "self",
}: {
  sub?: string | undefined;
  kind?: "self" | "link" | undefined;
}) => {
  const nav = useNav();
  const [kind, setKind] = useState<"self" | "link">(initialKind);
  const [sr, setSr] = useState(sub ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [options, setOptions] = useState<PostOptions>({
    sendreplies: true,
    nsfw: false,
    spoiler: false,
    resubmit: false,
  });
  const [sending, setSending] = useState(false);
  const community = sr.trim().replace(/^\/?r\//i, "");
  const validUrl = /^https?:\/\/\S+\.\S+/i.test(url.trim());
  const ready =
    SUB_RE.test(community) && title.trim().length > 0 && (kind === "self" || validUrl);

  const showRules = () =>
    nav.openSheet((onClosed) => <RulesSheet sub={community} onClosed={onClosed} />);

  const send = () => {
    if (!ready || sending) return;
    setSending(true);
    void attempt(async () => {
      const result = await runAction("submit", {
        sr: community,
        kind,
        title: title.trim(),
        ...(kind === "self" ? { text: body } : { url: url.trim() }),
        ...options,
      });
      nav.back();
      if (result.id) window.setTimeout(() => nav.openPost(result.id!), 380);
    }, "Posted").then(() => setSending(false));
  };

  return (
    <>
      <ScreenHeader title="New Post" subtitle={kind === "self" ? "Text post" : "Link post"} />
      <div className="scroller">
        <div className="compose-form has-bottom-bar">
          <div className="segmented" role="radiogroup" aria-label="Post type">
            {(
              [
                { value: "self", label: "Text", icon: "text" },
                { value: "link", label: "Link", icon: "link" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={kind === option.value}
                className={kind === option.value ? "is-selected" : ""}
                onClick={() => setKind(option.value)}
              >
                <Icon name={kind === option.value ? "check" : option.icon} />
                {option.label}
              </button>
            ))}
          </div>
          <div className="field-row">
            <Field icon="subreddit" label="Subreddit" prefix="r/" value={sr} onChange={setSr} />
            <button
              type="button"
              className="btn is-tonal"
              disabled={!SUB_RE.test(community)}
              onClick={showRules}
            >
              <Icon name="book" />
              Rules
            </button>
          </div>
          <Field icon="text" label="Title" value={title} onChange={setTitle} max={300} />
          {kind === "self" ? (
            <Field label="Text (optional)" value={body} onChange={setBody} multiline max={40000} />
          ) : (
            <Field icon="link" label="Url" type="url" value={url} onChange={setUrl} />
          )}
        </div>
      </div>
      <BottomBar
        actions={[
          {
            icon: "tune",
            label: "Options",
            onClick: () =>
              nav.openSheet((onClosed) => (
                <OptionsSheet initial={options} onChange={setOptions} onClosed={onClosed} />
              )),
          },
        ]}
        fab={{ icon: "send", label: sending ? "Posting…" : "Post", onClick: send, disabled: !ready || sending }}
      />
    </>
  );
};

export const RulesSheet = ({ sub, onClosed }: { sub: string; onClosed: () => void }) => {
  const [rules, setRules] = useState<{ title: string; description: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetchRules(sub)
      .then(setRules)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Unavailable"));
  }, [sub]);
  return (
    <Sheet title={`r/${sub} rules`} onClosed={onClosed}>
      {() => (
        <div className="about-body">
          {error ? (
            <p style={{ color: "var(--text-3)" }}>{error}</p>
          ) : !rules ? (
            <div className="spinner" />
          ) : !rules.length ? (
            <p style={{ color: "var(--text-3)" }}>This community has no posted rules.</p>
          ) : (
            <ol className="rules">
              {rules.map((rule, index) => (
                <li key={index}>
                  <strong>{rule.title}</strong>
                  {rule.description ? <ReaderMarkdown source={rule.description} /> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Sheet>
  );
};

// ------------------------------------------------------------------ compose

export const ComposeScreen = ({
  to,
  subject,
}: {
  to?: string | undefined;
  subject?: string | undefined;
}) => {
  const nav = useNav();
  const [recipient, setRecipient] = useState(to ?? "");
  const [title, setTitle] = useState(subject ?? "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const toCommunity = /^\/?r\/([A-Za-z0-9][A-Za-z0-9_]{1,20})$/i.exec(recipient.trim());
  const name = toCommunity
    ? `/r/${toCommunity[1]}`
    : recipient.trim().replace(/^\/?u(?:ser)?\//i, "");
  const ready =
    (toCommunity || USER_RE.test(name)) && title.trim() && message.trim();

  const send = () => {
    if (!ready || sending) return;
    setSending(true);
    void attempt(async () => {
      await runAction("compose", { to: name, subject: title.trim(), text: message });
      nav.back();
    }, "Message sent").then(() => setSending(false));
  };

  return (
    <>
      <ScreenHeader title="New Message" />
      <div className="scroller">
        <div className="compose-form">
          {toCommunity ? (
            <Field icon="modShield" label="Moderators of" value={recipient} onChange={setRecipient} />
          ) : (
            <Field icon="user" label="Username" prefix="u/" value={recipient} onChange={setRecipient} autoFocus={!to} />
          )}
          <Field icon="text" label="Title" value={title} onChange={setTitle} max={100} />
          <Field icon="mail" label="Message" value={message} onChange={setMessage} multiline max={10000} autoFocus={Boolean(to)} />
        </div>
      </div>
      <button
        type="button"
        className="fab is-extended"
        data-ripple
        disabled={!ready || sending}
        onClick={send}
      >
        <Icon name="send" />
        {sending ? "Sending…" : "Send"}
      </button>
    </>
  );
};
