export type LinkTarget =
  | { kind: 'post'; id: string }
  | { kind: 'sub'; name: string }
  | { kind: 'external'; url: string };

const REDDIT_HOST = /^((www|old|new|np|m|amp|i)\.)?reddit\.com$/i;

/** Make a user supplied href absolute, rejecting unsafe schemes. */
export const normaliseHref = (href: string): string | null => {
  const trimmed = href.trim();
  if (/^\/?(r|u|user)\//i.test(trimmed)) {
    return `https://www.reddit.com/${trimmed.replace(/^\//, '')}`;
  }
  if (trimmed.startsWith('/')) return `https://www.reddit.com${trimmed}`;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

/** Decide whether a link can be opened inside the reader. */
export const resolveLink = (href: string): LinkTarget | null => {
  const absolute = normaliseHref(href);
  if (!absolute) return null;
  const url = new URL(absolute);
  if (url.hostname === 'redd.it') {
    const id = url.pathname.slice(1).split('/')[0];
    if (id && /^[a-z0-9]+$/i.test(id)) return { kind: 'post', id };
  }
  if (REDDIT_HOST.test(url.hostname)) {
    const post = url.pathname.match(/^\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)/i);
    if (post?.[1]) return { kind: 'post', id: post[1] };
    const sub = url.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})\/?$/);
    if (sub?.[1]) return { kind: 'sub', name: sub[1] };
  }
  return { kind: 'external', url: absolute };
};

const IMAGE_URL =
  /^https:\/\/(i\.redd\.it|preview\.redd\.it|i\.imgur\.com)\/[^\s]+\.(jpe?g|png|gif|webp)(\?[^\s]*)?$/i;

export const isInlineImage = (href: string): boolean => IMAGE_URL.test(href);
