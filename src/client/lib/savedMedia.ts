/**
 * GIFs and images saved from comments and posts, to reuse in replies.
 * Only references are kept (a Giphy ID, or the image's URL), never the files.
 */
import type { InlineMedia, PostMedia } from "../../shared/api";
import { decodeEntities, parseBlocks, type Block } from "./markdownParser.ts";

export type SavedMedia = {
  /** Giphy's ID for a Giphy GIF, which Reddit takes back as `giphy|<id>`. */
  giphy?: string;
  /**
   * Reddit's asset ID for an image uploaded to a comment (`![img](<id>)`),
   * which a reply can refer to again instead of uploading it.
   */
  asset?: string;
  /** The image, or the GIF. */
  url: string;
  /** Silent looping MP4 of an animated image. */
  mp4?: string;
  /** 0 when unknown. */
  width: number;
  height: number;
  savedAt: number;
};

/** The newest are kept. */
export const SAVED_MEDIA_MAX = 200;

const GIPHY_ID = /^[A-Za-z0-9]{1,64}$/;
/** As Reddit names uploads (`apiUpload` checks the same). */
const ASSET_ID = /^[a-z0-9]{1,30}$/i;
/**
 * A Reddit-hosted image linked by URL, as Reddit's apps write a comment's
 * image (`https://preview.redd.it/<asset id>.jpeg?width=…`): its file name
 * is the upload's ID.
 */
const REDDIT_IMAGE = /^https:\/\/(?:i|preview)\.redd\.it\/([a-z0-9]{5,30})\.(?:jpe?g|png|gif|webp)(?:\?|$)/i;
const HTTPS = /^https:\/\/[^\s"'<>()]+$/;

export const giphyGif = (id: string): string => `https://i.giphy.com/media/${id}/giphy.gif`;
export const giphyMp4 = (id: string): string => `https://i.giphy.com/media/${id}/giphy.mp4`;

/** One entry per Giphy GIF or image URL. */
export const savedKey = (item: SavedMedia): string =>
  item.giphy ? `giphy:${item.giphy}` : item.url;

/**
 * What an image in a comment would be saved as: `target` is what the body
 * refers to (`giphy|<id>|downsized`, an upload's ID or an image URL), `media`
 * what Reddit lists for it. Null for anything that can't be reused.
 */
export function savableMedia(
  target: string,
  url: string,
  media: InlineMedia | undefined,
  savedAt: number,
): SavedMedia | null {
  const size = { width: media?.width || 0, height: media?.height || 0 };
  const mp4 = media?.mp4 && HTTPS.test(media.mp4) ? { mp4: media.mp4 } : {};
  if (/^giphy\|/.test(target)) {
    const id = target.split("|")[1] ?? "";
    if (!GIPHY_ID.test(id)) return null;
    return { giphy: id, url: giphyGif(id), mp4: giphyMp4(id), ...size, savedAt };
  }
  if (!HTTPS.test(url)) return null;
  // Listed by an ID (an upload Reddit lists for the comment), or linked from
  // Reddit's image hosts under it.
  const id = media && ASSET_ID.test(target) ? target : REDDIT_IMAGE.exec(url)?.[1];
  return { ...(id ? { asset: id } : {}), url, ...mp4, ...size, savedAt };
}

/** The text of every block the renderer runs inline rules on (not code). */
const inlineText = (blocks: Block[]): string[] =>
  blocks.flatMap((block): string[] => {
    switch (block.t) {
      case "p":
      case "h":
        return [block.text];
      case "quote":
      case "spoiler":
        return inlineText(block.children);
      case "list":
        return block.items.flatMap(inlineText);
      case "table":
        return [...block.head, ...block.rows.flat()];
      default:
        return [];
    }
  });

const CODE_SPAN = /(`+)([\s\S]*?[^`])\1(?!`)/g;
/** `![alt](target)`, a plain `[text](link)` (skipped), or a bare URL. */
const BODY_MEDIA =
  /!\[[^\]]*\]\(([^)\s]+)[^)]*\)|\[(?:\\.|[^[\]\\]|\[[^\]]*\])*\]\([^)]*\)|https?:\/\/[^\s<>[\]]+/g;

export type BodyImages = {
  /** Whether `![alt](<url>)` shows the URL as an image. */
  isEmbedded: (url: string) => boolean;
  /** Whether a bare link shows as an image. */
  isInline: (url: string) => boolean;
  /** Load GIFs from Giphy: shows a Giphy GIF Reddit doesn't list. */
  giphyGifs: boolean;
};

/**
 * What a comment's body shows that can be saved, in order, as `markdown.tsx`
 * embeds it: an `![alt](<id>)` that `media` lists (or a Giphy GIF, with
 * `giphyGifs`), and image links, outside code. Each item once.
 */
export function bodyMedia(
  source: string,
  media: Record<string, InlineMedia> | undefined,
  images: BodyImages,
  savedAt: number,
): SavedMedia[] {
  const found = new Map<string, SavedMedia>();
  const add = (item: SavedMedia | null) => {
    if (item && !found.has(savedKey(item))) found.set(savedKey(item), item);
  };
  for (const text of inlineText(parseBlocks(decodeEntities(source)))) {
    for (const match of text.replace(CODE_SPAN, " ").matchAll(BODY_MEDIA)) {
      const target = match[1];
      if (target !== undefined) {
        if (/^emote\|/.test(target)) continue;
        if (images.isEmbedded(target)) {
          add(savableMedia(target, target, undefined, savedAt));
          continue;
        }
        const listed = media?.[target] ?? media?.[target.split("|").slice(0, 2).join("|")];
        if (listed) add(savableMedia(target, listed.url, listed, savedAt));
        else if (images.giphyGifs && /^giphy\|/.test(target))
          add(savableMedia(target, "", undefined, savedAt));
      } else if (!match[0].startsWith("[")) {
        const url = match[0].replace(/[.,;:!?'"*_~)]+$/, "");
        if (images.isInline(url)) add(savableMedia(url, url, undefined, savedAt));
      }
    }
  }
  return [...found.values()];
}

/** A post's link that is the image file itself (i.redd.it, Imgur, a Lemmy instance's pictrs). */
const IMAGE_FILE = /^https:\/\/[^\s"'<>()?#]+\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i;

/**
 * What the `index`th image of a post would be saved as: a gallery's image,
 * a post's image (by its own link when that is the file, so an i.redd.it
 * upload keeps its ID), or a GIF post Reddit plays as a video. Null for a
 * real video, or anything else that can't be reused.
 */
export function savablePostMedia(
  post: { url: string; media: PostMedia },
  index: number,
  savedAt: number,
): SavedMedia | null {
  const media = post.media;
  const file = IMAGE_FILE.test(post.url) ? post.url : null;
  switch (media.kind) {
    case "gallery": {
      const item = media.items[index];
      return item ? savableMedia(item.url, item.url, item, savedAt) : null;
    }
    case "image": {
      const url = file ?? media.image.url;
      return savableMedia(url, url, { ...media.image, url }, savedAt);
    }
    case "video": {
      if (!media.video.isGif || !file) return null;
      const { width, height, mp4 } = media.video;
      return savableMedia(file, file, { url: file, width, height, ...(mp4 ? { mp4 } : {}) }, savedAt);
    }
    default:
      return null;
  }
}

/** Saved media read back from storage; anything malformed is dropped. */
export function parseSavedMedia(value: unknown): SavedMedia[] {
  if (!Array.isArray(value)) return [];
  const items: SavedMedia[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const giphy = typeof entry.giphy === "string" && GIPHY_ID.test(entry.giphy) ? entry.giphy : null;
    const asset =
      !giphy && typeof entry.asset === "string" && ASSET_ID.test(entry.asset) ? entry.asset : null;
    const url = giphy ? giphyGif(giphy) : entry.url;
    if (typeof url !== "string" || !HTTPS.test(url)) continue;
    const mp4 = giphy
      ? giphyMp4(giphy)
      : typeof entry.mp4 === "string" && HTTPS.test(entry.mp4)
        ? entry.mp4
        : null;
    const number = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
    items.push({
      ...(giphy ? { giphy } : {}),
      ...(asset ? { asset } : {}),
      url,
      ...(mp4 ? { mp4 } : {}),
      width: number(entry.width),
      height: number(entry.height),
      savedAt: number(entry.savedAt),
    });
  }
  return items.slice(0, SAVED_MEDIA_MAX);
}

/** The list with `item` first (once), keeping the newest `SAVED_MEDIA_MAX`. */
export const withSaved = (list: SavedMedia[], item: SavedMedia): SavedMedia[] =>
  [item, ...list.filter((other) => savedKey(other) !== savedKey(item))].slice(0, SAVED_MEDIA_MAX);

export const withoutSaved = (list: SavedMedia[], ...keys: string[]): SavedMedia[] =>
  list.filter((item) => !keys.includes(savedKey(item)));

/** The saved list as text, one key per line (`savedKey`): what Edit as text shows. */
export const savedText = (list: SavedMedia[]): string => list.map(savedKey).join("\n");

export type SavedTextResult = {
  /** The list the text describes, at most `SAVED_MEDIA_MAX`. */
  items: SavedMedia[];
  /** Lines (from 1) that are neither an https link nor `giphy:<id>`. */
  errors: number[];
  /** Lines that repeat an earlier one, with that line: kept once. */
  repeats: [line: number, first: number][];
  /** Items past `SAVED_MEDIA_MAX`, left out. */
  dropped: number;
};

/**
 * Edit as text read back: one item per line, in order, as `savedText`
 * writes them. A line already in `list` keeps its entry (saved date, size,
 * MP4); a new one is saved `now`, a Reddit-hosted image with the asset ID in
 * its file name as when saved from a comment. Blank lines are skipped.
 */
export function parseSavedText(text: string, list: SavedMedia[], now: number): SavedTextResult {
  const known = new Map(list.map((item) => [savedKey(item), item]));
  const first = new Map<string, number>();
  const items: SavedMedia[] = [];
  const errors: number[] = [];
  const repeats: [number, number][] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const giphy = /^giphy:(.+)$/.exec(line)?.[1];
    const item =
      known.get(line) ??
      (giphy !== undefined
        ? GIPHY_ID.test(giphy)
          ? { giphy, url: giphyGif(giphy), mp4: giphyMp4(giphy), width: 0, height: 0, savedAt: now }
          : null
        : savableMedia(line, line, undefined, now));
    if (!item) return errors.push(index + 1);
    const key = savedKey(item);
    const seen = first.get(key);
    if (seen !== undefined) return repeats.push([index + 1, seen]);
    first.set(key, index + 1);
    items.push(item);
  });
  return {
    items: items.slice(0, SAVED_MEDIA_MAX),
    errors,
    repeats,
    dropped: Math.max(0, items.length - SAVED_MEDIA_MAX),
  };
}

/** What saving `after` over `before` changes, for the confirmation. */
export function savedChanges(
  before: SavedMedia[],
  after: SavedMedia[],
): { added: number; removed: number; reordered: boolean } {
  const was = before.map(savedKey);
  const now = after.map(savedKey);
  const kept = (keys: string[], other: string[]) => keys.filter((key) => other.includes(key)).join("\n");
  return {
    added: now.filter((key) => !was.includes(key)).length,
    removed: was.filter((key) => !now.includes(key)).length,
    reordered: kept(was, now) !== kept(now, was),
  };
}

export const isAnimated = (item: SavedMedia): boolean =>
  !!item.giphy || !!item.mp4 || /\.gif(?:\?|$)/i.test(item.url);

/**
 * Whether a subreddit takes this in a comment, by its
 * `allowed_media_in_comments` (`giphy`, `static`, `animated`, `expression`).
 * Unknown (undefined) allows everything; Reddit has the final say.
 */
export function allowedIn(item: SavedMedia, allowed: readonly string[] | undefined): boolean {
  if (!allowed) return true;
  if (item.giphy) return allowed.includes("giphy");
  return allowed.includes(isAnimated(item) ? "animated" : "static");
}

const REDDIT_HOST = /(?:^|\.)(?:reddit\.com|redd\.it|redditmedia\.com)$/i;

const onReddit = (url: string): boolean => {
  try {
    return REDDIT_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** Where a saved item is from, as the manage screen names it: Giphy, Reddit or the image's host. */
export function savedSource(item: SavedMedia): string {
  if (item.giphy) return "Giphy";
  if (onReddit(item.url)) return "Reddit";
  try {
    return new URL(item.url).hostname;
  } catch {
    return "the web";
  }
}

/** A saved item as a plain link, which any reply takes. */
export const linkTo = (item: SavedMedia): string =>
  `[${isAnimated(item) ? "GIF" : "Image"}](${item.url})`;

/**
 * Whether a Reddit reply offers the item: only a Giphy GIF, for now. Reddit
 * seems to show another account's image only as a link, whether it's
 * referred to by its ID, linked by its URL or uploaded again (from a
 * browser session Reddit refuses the upload), so saved images are left out.
 */
export const redditTakes = (item: SavedMedia): boolean => !!item.giphy;

/**
 * How a saved item goes into a reply, as Markdown. Reddit takes a Giphy GIF
 * back by its ID where the community takes Giphy GIFs in comments, and as a
 * link elsewhere (`allowed`, see `allowedIn`); it offers nothing else (see
 * `redditTakes`). Lemmy shows any image URL.
 */
export function reuseOf(
  item: SavedMedia,
  site: "Reddit" | "Lemmy",
  allowed?: readonly string[],
): { markdown: string; ref?: string } {
  if (site === "Lemmy") return { markdown: `![](${item.url})` };
  if (item.giphy && allowedIn(item, allowed))
    return { markdown: `![gif](giphy|${item.giphy})`, ref: `giphy|${item.giphy}` };
  return { markdown: linkTo(item) };
}

/**
 * The reply with each saved item it refers to by ID (`links`, by that ID)
 * as its link instead: what goes in when Reddit won't take an ID again.
 */
export const withLinks = (markdown: string, links: Record<string, string>): string =>
  markdown.replace(/!\[(?:img|gif)\]\(([^)\s]+)\)/g, (whole, ref: string) =>
    Object.hasOwn(links, ref) ? links[ref]! : whole,
  );
