/**
 * The reader's data layer. Each site's requests and models are its
 * provider's (`src/providers/`); this module picks the provider for the page
 * the reader was opened from, and adds what doesn't depend on the site: the
 * copies of posts saved for offline reading and the source switcher.
 */
import type { CommentSort, PostResponse } from "../../shared/api";
import { ApiFailure } from "../../shared/api";
import { bridge, offlineMode, pageUrl } from "../../extension/bridge";
import { readerProvider } from "../../providers/reader";
import type { ReaderProvider } from "../../providers/types";
import { readOfflineCopy, withOfflineMedia } from "./offlineStore";
import { fullDate } from "./format";

export { ApiFailure };
export type {
  InboxSection,
  ModFilter,
  ModSection,
  ProfileSection,
  ProfileSort,
} from "../../shared/api";

// The bridge only accepts pages a provider reads.
const provider: ReaderProvider = readerProvider(pageUrl.href)!;

export const entryRoute = provider.parseRoute(pageUrl.href)!;
/** The site the reader is showing: its name, features and naming rules. */
export const site = {
  name: provider.name,
  features: provider.features,
  communityLabel: provider.communityLabel,
  isCommunity: provider.isCommunity,
  validCommunityName: provider.validCommunityName,
  userLabel: provider.userLabel,
  baseUrl: provider.baseUrl,
  resolveLink: provider.resolveLink,
  communityUrl: provider.communityUrl,
  loginUrl: provider.loginUrl,
};
export const {
  fetchInit,
  fetchFeed,
  fetchSearch,
  fetchContext,
  fetchReplies,
  fetchAbout,
  fetchSubscriptions,
  fetchAccount,
  fetchUserAbout,
  fetchUserListing,
  fetchInbox,
  fetchModListing,
  searchCommunities,
  fetchModerated,
  fetchFriends,
  fetchRules,
  fetchModerators,
  fetchWiki,
  runAction,
  uploadImage,
} = provider;

/** The copy saved for offline reading, with a notice saying so, or null. */
async function offlineCopy(id: string): Promise<PostResponse | null> {
  const copy = await readOfflineCopy(id).catch(() => null);
  if (!copy) return null;
  const { savedAt, media, ...saved } = copy;
  const page = await withOfflineMedia(saved, media);
  return {
    ...page,
    notice: `Saved for offline reading ${fullDate(savedAt)}. Votes, replies and more comments need Reddit.`,
  };
}
/** A post and its comments: from the site, else the copy saved for offline reading. */
export function fetchPost(
  id: string,
  sort: CommentSort,
  limit = 40,
  fresh = false,
): Promise<PostResponse> {
  if (offlineMode)
    return offlineCopy(id).then((page) => {
      if (!page) throw new ApiFailure("This post wasn't saved for offline reading.");
      return page;
    });
  return provider.fetchPost(id, sort, limit, fresh).catch(async (error: unknown) => {
    const page = await offlineCopy(id);
    if (page) return page;
    throw error;
  });
}
/** A post and its comments from the site only, as saved for offline reading. */
export const fetchPostToSave = (
  id: string,
  sort: CommentSort,
  limit: number,
): Promise<PostResponse> => provider.fetchPost(id, sort, limit, true);

/** Loads a source's front page (`sourceUrl` checks it) in the Reddit tab. */
export const openSource = (url: string): Promise<void> =>
  bridge("navigate", url);
