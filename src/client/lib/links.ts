import type { LinkTarget } from '../../shared/api.ts';

export type { LinkTarget };

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

/** Reddit's image hosts (`external-preview` keeps its copies of other sites' pictures and GIFs) and Imgur's. */
const IMAGE_URL =
  /^https:\/\/(i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|i\.imgur\.com)\/[^\s]+\.(jpe?g|png|gif|webp)(\?[^\s]*)?$/i;

export const isInlineImage = (href: string): boolean => IMAGE_URL.test(href);

/**
 * A URL as Markdown text wrote it, without the `\` Reddit's editor escapes its
 * `_` and other marks with: no working URL has one.
 */
export const unescapeUrl = (url: string): string =>
  url.replace(/\\([\\`*_{}[\]()#+\-.!>~^|<])/g, '$1');

const COMMENT_VIDEO_URL =
  /^https:\/\/(?:www\.)?reddit\.com\/link\/[a-z0-9]+\/video\/([a-z0-9]+)\/player\/?$/i;

/**
 * The media ID of a video posted in a comment, which the body only links to
 * (`reddit.com/link/<id>/video/<media id>/player`).
 */
export const commentVideoId = (href: string): string | null =>
  COMMENT_VIDEO_URL.exec(href)?.[1] ?? null;

/** Its stream, which v.redd.it serves without a session and with CORS. */
export const commentVideoStream = (id: string): string =>
  `https://v.redd.it/${id}/HLSPlaylist.m3u8`;
