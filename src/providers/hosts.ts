/**
 * Which provider reads the pages of a site. The content script, the bridge
 * and the reader each pick their provider from the page's URL with this.
 */
export type ProviderId = "reddit";

export const REDDIT_HOSTS: readonly string[] = [
  "www.reddit.com",
  "old.reddit.com",
  "reddit.com",
];

/** The provider for an https page on `url`'s host, or `null` for none. */
export function providerOf(url: string | URL): ProviderId | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return REDDIT_HOSTS.includes(parsed.hostname) ? "reddit" : null;
}
