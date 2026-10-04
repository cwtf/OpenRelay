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
export const sharePost = async (_postId: string, permalink: string) =>
  copyText(redditUrl(permalink), "Link copied");
