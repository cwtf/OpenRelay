import { instanceHost } from "../extension/sources.ts";

/**
 * Which provider reads the pages of a site. The content script, the bridge
 * and the reader each pick their provider from the page's URL with this.
 * Every other public https host is taken to be a Lemmy instance: the
 * extension only runs on the instances the viewer added, and the reader
 * checks its list too (`client/lib/sources.ts`).
 */
export type ProviderId = "reddit" | "lemmy";

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
  if (REDDIT_HOSTS.includes(parsed.hostname)) return "reddit";
  return instanceHost(parsed.hostname) === parsed.hostname && !parsed.port
    ? "lemmy"
    : null;
}
