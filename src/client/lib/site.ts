import { pageUrl } from "../../extension/bridge";
import { providerOf } from "../../providers/hosts";
import { RecentSet } from "./storage";

/**
 * The storage key for data that belongs to the site the reader is showing
 * (the account, subscriptions, favourites, recent communities, searches), so
 * Reddit's and each Lemmy instance's stay apart. Reddit's keep their names.
 */
export const siteKey = (key: string): string =>
  providerOf(pageUrl) === "reddit" ? key : `${key}@${pageUrl.hostname}`;

export const recentCommunities = new RecentSet(siteKey("recent-subs"), 12);
