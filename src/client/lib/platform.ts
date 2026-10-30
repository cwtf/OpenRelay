import { safeUrl } from "../../extension/reddit";
import { audioFromPlaylist, muxAudioVideo } from "./mp4";
import { readerHost } from "../../hosts/reader";
import type { Downloads } from "../../hosts/types";

export const toast = (text: string): void => {
  window.dispatchEvent(new CustomEvent("openrelay:toast", { detail: text }));
};
export const redditUrl = (permalink: string): string => safeUrl(permalink);
export const openUrl = (value: string): void => {
  const url = safeUrl(value);
  if (!url) return;
  const target = new URL(url);
  if (
    ["www.reddit.com", "old.reddit.com", "reddit.com"].includes(target.hostname)
  ) {
    target.searchParams.set("openrelay", "off");
  }
  window.open(target.href, "_blank", "noopener,noreferrer");
};
export const promptLogin = () => openUrl("https://www.reddit.com/login");
export async function copyText(
  text: string,
  confirmation = "Copied",
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(confirmation);
  } catch {
    toast("Copy is not available here");
  }
}
/**
 * Asks the host for file saving and toasts when it can't. Call it before
 * awaiting anything else: Chrome's permission prompt needs the click's user
 * gesture.
 */
async function allowDownloads(declined: string): Promise<Downloads | null> {
  const downloads = await readerHost().downloads();
  if (downloads === "unavailable") toast("Download is not available here");
  else if (downloads === "declined") toast(declined);
  else return downloads;
  return null;
}

const fileName = (url: string): { filename?: string } => {
  const name = new URL(url).pathname.split("/").pop() ?? "";
  return /^[\w.-]+\.\w+$/.test(name) ? { filename: name } : {};
};

/**
 * Saves an image through the host, by URL. Reddit's image hosts send no CORS
 * headers, so the reader can't fetch the file itself.
 */
export async function downloadImage(value: string): Promise<void> {
  const url = safeUrl(value);
  if (!url) return;
  try {
    const downloads = await allowDownloads(
      "Downloads not allowed. Right-click the image to save it",
    );
    if (downloads) await downloads.save({ url, ...fileName(url) });
  } catch {
    toast("Download is not available here");
  }
}

const VREDDIT = /^https:\/\/v\.redd\.it\/([\w-]+)\//;

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

/**
 * A v.redd.it video with its sound. Reddit keeps the audio in a separate file
 * named in the DASH playlist; v.redd.it allows CORS, so both are fetched here
 * and joined. Returns null when the video can't be fetched.
 */
const redditVideo = async (
  url: string,
): Promise<{ data: Uint8Array; name: string; silent: boolean } | null> => {
  const id = VREDDIT.exec(url)?.[1];
  if (!id) return null;
  const base = `https://v.redd.it/${id}/`;
  const [video, audioName] = await Promise.all([
    fetchBytes(url).catch(() => null),
    fetch(`${base}DASHPlaylist.mpd`)
      .then((response) => (response.ok ? response.text() : ""))
      .then(audioFromPlaylist)
      .catch(() => null),
  ]);
  if (!video) return null;
  const name = `${id}.mp4`;
  if (!audioName) return { data: video, name, silent: false };
  try {
    const audio = await fetchBytes(base + audioName);
    return { data: muxAudioVideo(video, audio), name, silent: false };
  } catch {
    return { data: video, name, silent: true };
  }
};

const savingVideos = new Set<string>();

/** Saves a video, joining Reddit's separate audio track when there is one. */
export async function downloadVideo(value: string): Promise<void> {
  const url = safeUrl(value);
  if (!url || savingVideos.has(url)) return;
  savingVideos.add(url);
  try {
    const downloads = await allowDownloads("Downloads not allowed");
    if (!downloads) return;
    toast("Preparing video…");
    const video = await redditVideo(url);
    if (!video) {
      await downloads.save({ url, ...fileName(url) });
      return;
    }
    if (video.silent) toast("Couldn't add the sound. Saving the video alone");
    await downloads.save({
      data: video.data,
      filename: video.name,
      type: "video/mp4",
    });
  } catch {
    toast("Download is not available here");
  } finally {
    savingVideos.delete(url);
  }
}
export const sharePost = async (_postId: string, permalink: string) =>
  copyText(redditUrl(permalink), "Link copied");
