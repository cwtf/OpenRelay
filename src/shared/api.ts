// Wire types shared by the Devvit server and the web client.

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
  distinguished?: Distinguished;
  flair?: Flair;
  authorFlair?: Flair;
  /** Plain-text excerpt of a self post body. */
  excerpt?: string;
  thumb?: ImageRef;
  media: PostMedia;
};

export type PostDetail = PostSummary & {
  /** Raw Reddit markdown body for self posts. */
  body?: string;
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
};

export type SubredditAbout = {
  name: string;
  title?: string;
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
  showThumbnails: boolean;
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
  showThumbnails: true,
};

export type InitResponse = {
  subreddit: string;
  username: string | null;
  loggedIn: boolean;
  featured: string[];
  defaultSort: FeedSort;
  prefs: Prefs | null;
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
