import { safeUrl } from "../../extension/reddit";
import { audioFromPlaylist, muxAudioVideo } from "./mp4";

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
type Downloads = {
  download(options: { url: string; filename?: string }): Promise<number>;
};
type ExtensionApi = {
  permissions?: {
    request(permissions: { permissions: string[] }): Promise<boolean>;
  };
  downloads?: Downloads;
};

/**
 * Asks for the optional `downloads` permission (Chrome only prompts the first
 * time). Call it before awaiting anything else: the prompt needs the click's
 * user gesture.
 */
async function allowDownloads(declined: string): Promise<Downloads | null> {
  const api = (globalThis as { chrome?: ExtensionApi }).chrome;
  if (!api?.permissions) {
    toast("Download is not available here");
    return null;
  }
  const granted = await api.permissions.request({ permissions: ["downloads"] });
  if (!granted || !api.downloads) {
    toast(declined);
    return null;
  }
  return api.downloads;
}

const fileName = (url: string): { filename?: string } => {
  const name = new URL(url).pathname.split("/").pop() ?? "";
  return /^[\w.-]+\.\w+$/.test(name) ? { filename: name } : {};
};

/**
 * Saves an image with `chrome.downloads`. Reddit's image hosts send no CORS
 * headers, so the reader can't fetch the file itself.
 */
export async function downloadImage(value: string): Promise<void> {
  const url = safeUrl(value);
  if (!url) return;
  try {
    const downloads = await allowDownloads(
      "Downloads not allowed. Right-click the image to save it",
    );
    if (downloads) await downloads.download({ url, ...fileName(url) });
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
      await downloads.download({ url, ...fileName(url) });
      return;
    }
    if (video.silent) toast("Couldn't add the sound. Saving the video alone");
    const blobUrl = URL.createObjectURL(
      new Blob([video.data as Uint8Array<ArrayBuffer>], { type: "video/mp4" }),
    );
    try {
      await downloads.download({ url: blobUrl, filename: video.name });
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    }
  } catch {
    toast("Download is not available here");
  } finally {
    savingVideos.delete(url);
  }
}
export const sharePost = async (_postId: string, permalink: string) =>
  copyText(redditUrl(permalink), "Link copied");
