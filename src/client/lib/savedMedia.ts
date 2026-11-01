/**
 * GIFs and images saved from other people's comments, to reuse in replies.
 * Only references are kept (a Giphy ID, or the image's URL), never the files.
 */
import type { InlineMedia } from "../../shared/api";

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

export const withoutSaved = (list: SavedMedia[], key: string): SavedMedia[] =>
  list.filter((item) => savedKey(item) !== key);

const isAnimated = (item: SavedMedia): boolean =>
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

/**
 * How a saved item goes into a reply: Markdown to insert as it is, or an
 * image to fetch and upload first. Reddit takes a Giphy GIF or an image
 * uploaded to a comment back by its ID, and shows other images only once
 * they're uploaded to it; Lemmy shows any image URL.
 */
export function reuseOf(
  item: SavedMedia,
  site: "Reddit" | "Lemmy",
): { markdown: string; ref?: string } | { upload: string } {
  if (site === "Lemmy") return { markdown: `![](${item.url})` };
  if (item.giphy) return { markdown: `![gif](giphy|${item.giphy})`, ref: `giphy|${item.giphy}` };
  if (item.asset)
    return { markdown: `![${isAnimated(item) ? "gif" : "img"}](${item.asset})`, ref: item.asset };
  return { upload: item.url };
}
