/**
 * The sites the drawer's source switcher can send the tab to: Reddit, or a
 * Lemmy instance the viewer added. Switching loads that site's front page in
 * the tab; the reader can't send the tab anywhere else.
 */

export const REDDIT_HOME = "https://www.reddit.com/";

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

const isReddit = (host: string): boolean =>
  host === "reddit.com" || host.endsWith(".reddit.com");

/**
 * The host name of a Lemmy instance typed as `lemmy.world`,
 * `https://lemmy.world/c/memes` or `!memes@lemmy.world`; `null` if it isn't
 * a public https host name (no port, IP address or Reddit).
 */
export function instanceHost(input: string): string | null {
  let text = input.trim().toLowerCase();
  const handle = /^[!@][^@\s]+@([^@\s/]+)$/.exec(text);
  if (handle) text = handle[1]!;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(text) && !text.startsWith("https://"))
    return null;
  let url: URL;
  try {
    url = new URL(text.startsWith("https://") ? text : "https://" + text);
  } catch {
    return null;
  }
  const host = url.hostname;
  const labels = host.split(".");
  if (
    url.port ||
    url.username ||
    url.password ||
    host.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => LABEL.test(label)) ||
    /^\d+$/.test(labels.at(-1)!) ||
    isReddit(host)
  )
    return null;
  return host;
}

/** An instance's front page. */
export const instanceHome = (host: string): string => `https://${host}/`;

/**
 * `value` if the reader may send the tab there: Reddit's front page, or the
 * front page of a host `instanceHost` accepts. Otherwise `null`.
 */
export function sourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  )
    return null;
  if (url.href === REDDIT_HOME) return url.href;
  return instanceHost(url.hostname) === url.hostname ? url.href : null;
}
