const source = new URLSearchParams(location.hash.slice(1)).get("source");
export const pageUrl = new URL(source || "https://www.reddit.com/");
if (
  !["https:"].includes(pageUrl.protocol) ||
  !["www.reddit.com", "old.reddit.com", "reddit.com"].includes(pageUrl.hostname)
)
  throw new Error("Invalid Reddit page");
let nextId = 0;
const pending = new Map<
  number,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: number;
  }
>();
window.addEventListener("message", (event) => {
  if (
    event.source !== window.parent ||
    event.origin !== pageUrl.origin ||
    event.data?.type !== "openrelay:response"
  )
    return;
  const task = pending.get(event.data.id);
  if (!task) return;
  pending.delete(event.data.id);
  clearTimeout(task.timer);
  // The reader loads straight from disk, but Chrome keeps the old page script
  // until the extension is reloaded, so newer requests are rejected.
  if (event.data.error === "Unsupported request")
    task.reject(
      new Error(
        "OpenRelay was updated. Reload it in chrome://extensions, then refresh this Reddit tab.",
      ),
    );
  else if (event.data.error) task.reject(new Error(String(event.data.error)));
  else task.resolve(event.data.value);
});
/** Tell the page how much of the bottom edge the reader's chrome uses. */
export const setBottomInset = (bottom: number): void =>
  window.parent.postMessage({ type: "openrelay:inset", bottom }, pageUrl.origin);
export function bridge<T>(
  action: "snapshot" | "json" | "vote" | "vote-status" | "me" | "action",
  path?: string,
  payload?: {
    thingId?: string;
    direction?: number;
    current?: number;
    ids?: string[];
    op?: string;
    args?: Record<string, unknown>;
  },
): Promise<T> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(
        new Error("Reddit did not respond. Use Original Reddit or try again."),
      );
    }, 22000);
    pending.set(id, { resolve, reject, timer });
    window.parent.postMessage(
      { type: "openrelay:request", id, action, path, payload },
      pageUrl.origin,
    );
  });
}
