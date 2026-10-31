/**
 * What OpenRelay needs from a site it reads (Reddit; later Lemmy). A provider
 * has two halves, one on each side of the page bridge:
 *
 * - a `PageProvider` in the content script, on the site's own origin, which
 *   answers the reader's bridge requests with the viewer's session, and is
 *   the only code that talks to the site; and
 * - a `ReaderProvider` in the reader frame, which turns what the screens ask
 *   for into bridge requests and the answers into the models in
 *   `shared/api.ts`.
 *
 * `hosts.ts` says which provider a page's URL belongs to.
 */
import type {
  AboutResponse,
  Account,
  CommentNode,
  CommentSort,
  Community,
  FeedResponse,
  FeedSort,
  Friend,
  InboxResponse,
  InboxSection,
  InitResponse,
  ListingResponse,
  ModFilter,
  ModSection,
  Moderator,
  PageRoute,
  PostResponse,
  ProfileSection,
  ProfileSort,
  RepliesResponse,
  SearchSort,
  SubredditRule,
  Timeframe,
  UserAbout,
} from "../shared/api.ts";

/** One request from the reader, as the bridge carries it. */
export type PageRequest = {
  action: string;
  path?: unknown;
  payload?: any;
};

export type PageProvider = {
  /** The site's name, as in the "Original Reddit" control. */
  name: string;
  /** The reader's starting point for a page, or `null` where it doesn't open. */
  parseRoute(href: string): PageRoute | null;
  /** A captcha or block page, where the reader must stay out of the way. */
  isGatePage(doc: Document): boolean;
  /**
   * Answers one bridge request. `active` says whether the reader is showing;
   * writes need it. Throws "Unsupported request" for anything else.
   */
  handle(request: PageRequest, active: boolean): Promise<unknown>;
};

export type ReaderProvider = {
  parseRoute(href: string): PageRoute | null;
  fetchInit(): Promise<InitResponse>;
  fetchFeed(
    sub: string,
    sort: FeedSort,
    t: Timeframe,
    after?: string | null,
  ): Promise<FeedResponse>;
  fetchSearch(
    sub: string,
    q: string,
    sort: SearchSort,
    after?: string | null,
  ): Promise<FeedResponse>;
  /** A post and its comments from the site (never a saved copy). */
  fetchPost(
    id: string,
    sort: CommentSort,
    limit: number,
    fresh: boolean,
  ): Promise<PostResponse>;
  fetchContext(
    id: string,
    comment: string,
    sort: CommentSort,
    context?: number,
  ): Promise<PostResponse>;
  fetchReplies(
    post: string,
    comment: string,
    sort: CommentSort,
    op: string,
  ): Promise<RepliesResponse>;
  fetchAbout(sub: string): Promise<AboutResponse>;
  fetchSubscriptions(): Promise<Community[]>;
  fetchAccount(): Promise<Account | null>;
  fetchUserAbout(name: string): Promise<UserAbout>;
  fetchUserListing(
    name: string,
    section: ProfileSection,
    sort: ProfileSort,
    t: Timeframe,
    after?: string | null,
  ): Promise<ListingResponse>;
  fetchInbox(
    section: InboxSection,
    after?: string | null,
  ): Promise<InboxResponse>;
  fetchModListing(
    sub: string,
    section: ModSection,
    filter: ModFilter,
    after?: string | null,
  ): Promise<ListingResponse>;
  searchCommunities(text: string): Promise<Community[]>;
  fetchModerated(): Promise<string[]>;
  fetchFriends(): Promise<Friend[]>;
  fetchRules(sub: string): Promise<SubredditRule[]>;
  fetchModerators(sub: string): Promise<Moderator[]>;
  fetchWiki(sub: string): Promise<string>;
  /** A validated write, performed by the page with the viewer's session. */
  runAction(
    op: string,
    args?: Record<string, unknown>,
  ): Promise<{ id?: string; url?: string; comment?: CommentNode }>;
};
