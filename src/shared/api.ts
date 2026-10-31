// Types shared by the extension's page script and the reader.

export type FeedSort = "hot" | "new" | "top" | "rising" | "controversial";
export type Timeframe = "hour" | "day" | "week" | "month" | "year" | "all";
export type CommentSort =
  "confidence" | "top" | "new" | "controversial" | "old" | "qa";
export type SearchSort = "relevance" | "hot" | "top" | "new" | "comments";

export const FEED_SORTS: readonly FeedSort[] = [
  "hot",
  "new",
  "top",
  "rising",
  "controversial",
];
export const TIMEFRAMES: readonly Timeframe[] = [
  "hour",
  "day",
  "week",
  "month",
  "year",
  "all",
];
export const COMMENT_SORTS: readonly CommentSort[] = [
  "confidence",
  "top",
  "new",
  "controversial",
  "old",
  "qa",
];

export type ImageRef = {
  url: string;
  width: number;
  height: number;
};

/**
 * An image a Markdown body refers to by ID instead of URL, such as
 * `![gif](giphy|<id>)` or an uploaded `![img](<id>)`.
 */
export type InlineMedia = ImageRef & {
  /** Silent looping MP4 of an animated image. */
  mp4?: string;
};

export type Flair = {
  text: string;
  /** Background colour as provided by Reddit (may be empty). */
  background?: string;
  /** Reddit tells us whether the flair text should be light or dark. */
  tone?: "light" | "dark";
};

export type VideoSource = {
  mp4?: string;
  hls?: string;
  width: number;
  height: number;
  duration?: number;
  isGif: boolean;
};

export type PollChoice = { text: string; votes?: number };

export type PostMedia =
  | { kind: "self" }
  | { kind: "image"; image: ImageRef; animated: boolean }
  | { kind: "gallery"; items: ImageRef[] }
  | { kind: "video"; video: VideoSource; poster?: ImageRef }
  | {
      kind: "embed";
      provider: string;
      title?: string;
      poster?: ImageRef;
      url: string;
    }
  | { kind: "link"; url: string; domain: string; poster?: ImageRef }
  | {
      kind: "poll";
      choices: PollChoice[];
      totalVotes?: number;
      endsAt?: number;
    };

export type Distinguished = "moderator" | "admin";

/** The signed-in viewer's vote: 1 up, -1 down, 0 none. */
export type ViewerVote = -1 | 0 | 1;

/** Moderation details, present only in moderator listings. */
export type ModInfo = {
  /** "n: reason" for user reports, "u/mod: reason" for moderator reports. */
  reports: string[];
  state?: "approved" | "removed" | "spam";
};

export type PostSummary = {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  permalink: string;
  url: string;
  domain: string;
  createdAt: number;
  score: number;
  comments: number;
  nsfw: boolean;
  spoiler: boolean;
  stickied: boolean;
  locked: boolean;
  archived: boolean;
  edited: boolean;
  crosspost: boolean;
  /** The crossposted original, from `crosspost_parent_list`. */
  crosspostParent?: PostSummary;
  distinguished?: Distinguished;
  flair?: Flair;
  authorFlair?: Flair;
  /** Plain-text excerpt of a self post body. */
  excerpt?: string;
  thumb?: ImageRef;
  media: PostMedia;
  /** Present when Reddit reports the signed-in viewer's vote. */
  vote?: ViewerVote;
  /** Whether the signed-in viewer saved it, when Reddit reports it. */
  saved?: boolean;
  mod?: ModInfo;
  /** Who removed it, when Reddit shows it as removed or deleted. */
  removed?: Removal;
};

/** Moderators (AutoModerator included), Reddit itself, or the author. */
export type Removal = "mods" | "reddit" | "author";

export type PostDetail = PostSummary & {
  /** Raw Reddit markdown body for self posts. */
  body?: string;
  /** When the archive captured it, on a copy restored from the archive. */
  capturedAt?: number;
};

export type CommentNode = {
  id: string;
  parentId: string;
  author: string;
  body: string;
  score: number;
  createdAt: number;
  edited: boolean;
  stickied: boolean;
  locked: boolean;
  isSubmitter: boolean;
  distinguished?: Distinguished;
  authorFlair?: Flair;
  permalink: string;
  replies: CommentNode[];
  /** True when Reddit reports more replies that were not included. */
  moreReplies: boolean;
  /** Media the body refers to by ID, keyed by that ID. */
  media?: Record<string, InlineMedia>;
  /** Present when Reddit reports the signed-in viewer's vote. */
  vote?: ViewerVote;
  /** Set when Reddit shows the body as "[removed]" or "[deleted]". */
  removed?: Removal;
  /** "restored": the body and author come from the archive; "missing": the
   *  archive has no copy. */
  archive?: "restored" | "missing";
};

/** A comment shown outside its thread (profiles, moderator queues). */
export type ListingComment = {
  id: string;
  author: string;
  body: string;
  score: number;
  createdAt: number;
  subreddit: string;
  postId: string;
  postTitle: string;
  permalink: string;
  vote?: ViewerVote;
  mod?: ModInfo;
  media?: Record<string, InlineMedia>;
};

/** A profile or moderator listing entry. */
export type ListingItem =
  | { type: "post"; post: PostSummary }
  | { type: "comment"; comment: ListingComment };

export type ListingResponse = { items: ListingItem[]; after: string | null };

export type InboxKind =
  | "message"
  | "comment_reply"
  | "post_reply"
  | "mention"
  | "mod_message";

export type InboxItem = {
  /** Fullname: `t4_` for messages, `t1_` for comment notifications. */
  id: string;
  kind: InboxKind;
  subject: string;
  body: string;
  author: string;
  recipient: string;
  createdAt: number;
  unread: boolean;
  subreddit?: string;
  /** Post the comment notification belongs to, and its context link. */
  postId?: string;
  context?: string;
  replies: number;
};

export type InboxResponse = { items: InboxItem[]; after: string | null };

export type UserAbout = {
  name: string;
  icon?: string;
  linkKarma: number;
  commentKarma: number;
  createdAt: number;
  isFriend: boolean;
  suspended: boolean;
};

export type Friend = { name: string; addedAt: number };

export type SubredditRule = { title: string; description: string };

export type Moderator = { name: string; since: number; permissions: string[] };

export type SubredditAbout = {
  name: string;
  title?: string;
  /** Community icon, when Reddit provides one. */
  icon?: string;
  /** Header banner image. */
  banner?: string;
  /** Full sidebar Markdown (old Reddit's "description"). */
  sidebar?: string;
  /** Whether the signed-in viewer subscribes; absent when unknown. */
  subscribed?: boolean;
  description?: string;
  subscribers?: number;
  active?: number;
  nsfw: boolean;
  createdAt?: number;
};

/** A community the signed-in viewer subscribes to. */
export type Community = {
  name: string;
  /** Community icon, when Reddit provides one. */
  icon?: string;
  /** Community key colour (hex), used behind the letter fallback. */
  color?: string;
  subscribers?: number;
  nsfw: boolean;
  /** Whether the viewer subscribes, when Reddit reports it (search results). */
  subscribed?: boolean;
};

/** The signed-in Reddit account, as far as the reader needs it. */
export type Account = {
  name: string;
  icon?: string;
  /** Moderates at least one community. */
  isMod?: boolean;
  /** Unread inbox items. */
  inboxCount?: number;
};

export type Prefs = {
  theme: "system" | "dark" | "black" | "light";
  layout: "cards" | "compact" | "list";
  textScale: number;
  commentColors: "muted" | "vivid" | "mono";
  commentSort: CommentSort;
  blurNsfw: boolean;
  blurSpoilers: boolean;
  reduceMotion: boolean;
  autoplayGifs: boolean;
  /** Load comment GIFs from Giphy when Reddit has no copy of them. */
  giphyGifs: boolean;
  showThumbnails: boolean;
  /** Relay's "Compact Crosspost Layout": one link to the original instead of its card. */
  compactCrossposts: boolean;
  /** Relay's tablet setting: single or dual pane, per orientation. */
  paneModePortrait: "auto" | "single" | "dual";
  paneModeLandscape: "auto" | "single" | "dual";
  /** Save images with posts saved for offline reading. */
  offlineImages: boolean;
  /** Save Reddit videos (with their sound) with posts saved for offline reading. */
  offlineVideos: boolean;
  /** How many posts "Save feed for offline" saves at a time. */
  offlineFeedCount: number;
};

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  layout: "cards",
  textScale: 1,
  commentColors: "muted",
  commentSort: "confidence",
  blurNsfw: true,
  blurSpoilers: true,
  reduceMotion: false,
  autoplayGifs: true,
  giphyGifs: true,
  showThumbnails: true,
  compactCrossposts: false,
  paneModePortrait: "auto",
  paneModeLandscape: "auto",
  offlineImages: true,
  offlineVideos: true,
  offlineFeedCount: 25,
};

export type InitResponse = {
  subreddit: string;
  username: string | null;
  loggedIn: boolean;
  featured: string[];
  defaultSort: FeedSort;
};

export type FeedResponse = {
  posts: PostSummary[];
  after: string | null;
};

export type PostResponse = {
  notice?: string;
  post: PostDetail;
  comments: CommentNode[];
  moreComments: boolean;
};

export type RepliesResponse = {
  /** Fresh replies of the requested comment (or top-level comments). */
  replies: CommentNode[];
  more: boolean;
};

export type AboutResponse = { about: SubredditAbout };

export type ReplyRequest = { parentId: string; text: string };
export type ReplyResponse = { comment: CommentNode };

export type ApiError = { status: "error"; message: string };

/** Where the reader starts for a page: its feed, post or search. */
export type PageRoute = {
  sub: string;
  sort: FeedSort;
  timeframe: Timeframe;
  postId?: string;
  commentSort?: string;
  query?: string;
  searchSort?: string;
};

export type ProfileSection =
  | "overview"
  | "comments"
  | "submitted"
  | "upvoted"
  | "downvoted"
  | "hidden"
  | "saved";
export type ProfileSort = "new" | "hot" | "top" | "controversial";
export type InboxSection =
  | "inbox"
  | "unread"
  | "messages"
  | "comments"
  | "selfreply"
  | "sent"
  | "mentions"
  | "moderator"
  | "moderator/unread";
export type ModSection = "modqueue" | "reports" | "spam" | "edited" | "unmoderated";
export type ModFilter = "all" | "links" | "comments";

/** A request the site refused or answered with something unusable. */
export class ApiFailure extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}
