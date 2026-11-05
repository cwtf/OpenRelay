/**
 * The pure parts of switching accounts by swapping a site's cookies: which
 * cookies belong to a site, and how a saved cookie is set again. The
 * extension's `chrome.cookies` and Electron's `session.cookies` share these
 * shapes.
 */

/** A cookie as `chrome.cookies.getAll` returns it (the fields kept). */
export type SavedCookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: "no_restriction" | "lax" | "strict" | "unspecified";
  session?: boolean;
  expirationDate?: number;
};

/** What `chrome.cookies.set` takes to put a saved cookie back. */
export type CookieDetails = {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: SavedCookie["sameSite"];
  expirationDate?: number;
  storeId?: string;
};

const REDDIT_HOSTS = new Set(["www.reddit.com", "old.reddit.com", "reddit.com"]);
const HOST = /^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/;

/**
 * The cookie domain and the host-permission origins for a site's sign-in:
 * all of `reddit.com` for Reddit's hosts, else the instance's own host.
 * `null` for anything that isn't a plain host name.
 */
export function cookieSite(
  site: string,
): { domain: string; origins: string[] } | null {
  if (REDDIT_HOSTS.has(site))
    return { domain: "reddit.com", origins: ["https://*.reddit.com/*"] };
  if (!HOST.test(site) || site.endsWith(".reddit.com")) return null;
  return { domain: site, origins: [`https://${site}/*`] };
}

/** Whether a cookie's domain is `domain` or one of its subdomains. */
export function inDomain(cookieDomain: string, domain: string): boolean {
  const bare = cookieDomain.replace(/^\./, "").toLowerCase();
  return bare === domain || bare.endsWith("." + domain);
}

/** The URL a cookie is set or removed through. */
export const cookieUrl = (cookie: Pick<SavedCookie, "domain" | "path" | "secure">): string =>
  `${cookie.secure ? "https" : "http"}://${cookie.domain.replace(/^\./, "")}${cookie.path || "/"}`;

/** Only the fields worth keeping, without the store it came from. */
export function keepCookie(cookie: SavedCookie): SavedCookie {
  const kept: SavedCookie = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    hostOnly: cookie.hostOnly,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
  if (cookie.sameSite) kept.sameSite = cookie.sameSite;
  if (!cookie.session && cookie.expirationDate !== undefined)
    kept.expirationDate = cookie.expirationDate;
  return kept;
}

/**
 * `chrome.cookies.set` details that recreate a saved cookie: a host-only
 * cookie leaves out `domain` (giving one would widen it to subdomains), and a
 * session cookie leaves out `expirationDate`. An expired one is dropped.
 */
export function restoreDetails(
  cookie: SavedCookie,
  storeId: string | undefined,
  now = Date.now(),
): CookieDetails | null {
  if (cookie.expirationDate !== undefined && cookie.expirationDate * 1000 <= now)
    return null;
  const details: CookieDetails = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
  if (!cookie.hostOnly) details.domain = cookie.domain;
  // Firefox refuses "unspecified"; leaving it out means the same.
  if (cookie.sameSite && cookie.sameSite !== "unspecified") details.sameSite = cookie.sameSite;
  if (cookie.expirationDate !== undefined) details.expirationDate = cookie.expirationDate;
  if (storeId) details.storeId = storeId;
  return details;
}

/** Where a site's saved sign-ins are kept, beside the settings but never read with them. */
export const ACCOUNTS_PREFIX = "openrelay-accounts:";
export const accountKey = (domain: string, name: string): string =>
  `${ACCOUNTS_PREFIX}${domain}:${name}`;
