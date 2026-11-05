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

/** `siteKey` for another site's host, e.g. to read its accounts from the drawer. */
export const hostKey = (host: string, key: string): string =>
  providerOf(`https://${host}/`) === "reddit" ? key : `${key}@${host}`;

export const recentCommunities = new RecentSet(siteKey("recent-subs"), 12);
