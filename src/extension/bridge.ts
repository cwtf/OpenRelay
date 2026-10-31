import { readerHost } from "../hosts/reader";

const params = new URLSearchParams(location.hash.slice(1));
const source = params.get("source");
/**
 * Opened without Reddit (`#offline`), by the host, to read saved posts: there
 * is no page to ask, so every request fails at once.
 */
export const offlineMode = params.has("offline");
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
// The host's channel when it shows the reader itself, otherwise the parent page.
const channel = readerHost().channel;
const toPage = (message: unknown): void => {
  if (offlineMode) return;
  if (channel) channel.post(message);
  else window.parent.postMessage(message, pageUrl.origin);
};
if (channel) channel.onMessage(receive);
else
  window.addEventListener("message", (event) => {
    if (event.source === window.parent && event.origin === pageUrl.origin)
      receive(event.data);
  });
function receive(data: any) {
  if (data?.type !== "openrelay:response") return;
  const task = pending.get(data.id);
  if (!task) return;
  pending.delete(data.id);
  clearTimeout(task.timer);
  // The reader loads straight from disk, but Chrome keeps the old page script
  // until the extension is reloaded, so newer requests are rejected.
  if (data.error === "Unsupported request")
    task.reject(
      new Error(
        "OpenRelay was updated. Reload it in chrome://extensions, then refresh this Reddit tab.",
      ),
    );
  else if (data.error) task.reject(new Error(String(data.error)));
  else task.resolve(data.value);
}
/** Tell the page how much of the bottom edge the reader's chrome uses. */
export const setBottomInset = (bottom: number): void =>
  toPage({ type: "openrelay:inset", bottom });
export function bridge<T>(
  action:
    | "snapshot"
    | "json"
    | "search-page"
    | "vote"
    | "vote-status"
    | "me"
    | "action",
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
  if (offlineMode)
    return Promise.reject(new Error("You're offline. Open Reddit to do this."));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(
        new Error("Reddit did not respond. Use Original Reddit or try again."),
      );
    }, 22000);
    pending.set(id, { resolve, reject, timer });
    toPage({ type: "openrelay:request", id, action, path, payload });
  });
}
