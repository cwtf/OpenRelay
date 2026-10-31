/**
 * Reddit's HTML search, for sessions that get 403 from `/search.json`. Only
 * post IDs and the next page are read from the page; the posts themselves
 * then come from `/api/info.json`, so results match every other listing.
 */
export type SearchPage = { ids: string[]; next: string | null };

/** The search page Reddit itself shows for this query, as a same-origin path. */
export function searchPagePath(
  sub: string,
  q: string,
  sort: string,
  old: boolean,
): string {
  const params = new URLSearchParams({ q, sort });
  if (sub !== "Home") params.set("restrict_sr", old ? "on" : "1");
  // Old Reddit calls posts "links"; new Reddit's search tabs say "posts".
  params.set("type", old ? "link" : "posts");
  return (
    (sub === "Home" ? "" : "/r/" + encodeURIComponent(sub)) +
    (old ? "/search" : "/search/") +
    "?" +
    params
  );
}

const SEARCH_ROUTES = [
  /^\/(?:r\/[\w+]+\/)?search\/?$/i,
  // New Reddit loads further results as HTML partials while scrolling.
  /^\/svc\/shreddit\/(?:[\w-]+\/)*[\w-]*search[\w-]*\/?$/i,
];
export function allowedSearchPagePath(path: unknown): path is string {
  if (
    typeof path !== "string" ||
    path.length > 3000 ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  )
    return false;
  const url = new URL(path, "https://www.reddit.com");
  if (url.origin !== "https://www.reddit.com") return false;
  return SEARCH_ROUTES.some((route) => route.test(url.pathname));
}

const decode = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(
    (value) => value !== undefined,
  );
/** A same-origin search path from a link on the page, or null. */
const searchLink = (href: string | undefined) => {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(decode(href), "https://www.reddit.com");
  } catch {
    return null;
  }
  if (!/^(?:www\.|old\.)?reddit\.com$/.test(url.hostname)) return null;
  const path = url.pathname + url.search;
  return allowedSearchPagePath(path) ? path : null;
};

/** Post IDs in page order, and the path of the next page of results. */
export function parseSearchPage(html: string): SearchPage {
  const unique = (values: Iterable<string>) => [...new Set(values)].slice(0, 100);
  // Result units carry the post's full name (`.search-result-link` on old
  // Reddit, the telemetry trackers on new Reddit); comment, community and
  // user results use other prefixes and are skipped.
  let ids = unique(
    Array.from(
      html.matchAll(
        /\s(?:data-fullname|data-thingid|thingid|post-id|data-post-id|id)\s*=\s*["'](t3_[a-z0-9]+)["']/gi,
      ),
      (match) => match[1]!.toLowerCase(),
    ),
  );
  // Without those, fall back to the posts the page links to.
  if (!ids.length)
    ids = unique(
      Array.from(
        html.matchAll(
          /\shref\s*=\s*["'](?:https:\/\/(?:www\.|old\.)?reddit\.com)?\/r\/[\w]+\/comments\/([a-z0-9]+)\//gi,
        ),
        (match) => "t3_" + match[1]!.toLowerCase(),
      ),
    );
  let next: string | null = null;
  if (ids.length) {
    // Old Reddit: the "next ›" link. New Reddit: the partial that loads more.
    for (const [tag] of html.matchAll(/<(?:a|link)\b[^>]*>/gi))
      if (/(?:^|\s)next(?:\s|$)/i.test(attr(tag, "rel") ?? ""))
        next = searchLink(attr(tag, "href")) ?? next;
    if (!next)
      for (const [tag] of html.matchAll(/<faceplate-partial\b[^>]*>/gi))
        next = searchLink(attr(tag, "src")) ?? next;
  }
  return { ids, next };
}
