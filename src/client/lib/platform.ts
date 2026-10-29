import { safeUrl } from "../../extension/reddit";

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
type ExtensionApi = {
  permissions?: {
    request(permissions: { permissions: string[] }): Promise<boolean>;
  };
  downloads?: {
    download(options: { url: string; filename?: string }): Promise<number>;
  };
};

/**
 * Saves an image with `chrome.downloads`. Reddit's image hosts send no CORS
 * headers, so the reader can't fetch the file itself. `downloads` is an
 * optional permission, asked for on the first download.
 */
export async function downloadImage(value: string): Promise<void> {
  const url = safeUrl(value);
  if (!url) return;
  const api = (globalThis as { chrome?: ExtensionApi }).chrome;
  if (!api?.permissions) {
    toast("Download is not available here");
    return;
  }
  try {
    // The permission prompt needs the click's user gesture, so nothing may be
    // awaited before the request.
    const granted = await api.permissions.request({
      permissions: ["downloads"],
    });
    if (!granted || !api.downloads) {
      toast("Downloads not allowed. Right-click the image to save it");
      return;
    }
    const name = new URL(url).pathname.split("/").pop() ?? "";
    await api.downloads.download({
      url,
      ...(/^[\w.-]+\.\w+$/.test(name) ? { filename: name } : {}),
    });
  } catch {
    toast("Download is not available here");
  }
}
export const sharePost =async (_postId: string, permalink: string) =>
  copyText(redditUrl(permalink), "Link copied");
