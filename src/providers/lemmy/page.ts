import type { PageProvider, PageRequest } from "../types";
import { allowedApiPath, normalizeAccount, parseRoute } from "./lemmy";

/**
 * Lemmy's half of the page bridge, in the content script on the instance's
 * origin. lemmy-ui and Lemmy's API share that origin, so requests are
 * same-origin and carry lemmy-ui's sign-in cookie; the reader never sees it.
 * Read-only for now: votes and other writes are refused.
 */
async function get(path: string): Promise<any> {
  const response = await fetch(new URL(path, location.origin), {
    credentials: "same-origin",
    signal: AbortSignal.timeout(18000),
    headers: { Accept: "application/json" },
  });
  if (response.status === 429)
    throw new Error("This instance is rate limiting requests. Please wait and try again.");
  if (!response.headers.get("content-type")?.includes("json"))
    throw new Error(
      `This instance did not answer with Lemmy's API (${response.status}). Use Original Lemmy to continue.`,
    );
  const data = await response.json();
  if (!response.ok)
    // Lemmy explains refusals as `{ "error": "couldnt_find_post" }`.
    throw new Error(
      `Lemmy could not load this content (${String(data?.error ?? response.status).replaceAll("_", " ")}).`,
    );
  return data;
}

async function handle(
  { action, path, payload }: PageRequest,
  active: boolean,
): Promise<unknown> {
  if (action === "json" && allowedApiPath(path)) return get(path);
  if (action === "me") {
    // Only the name, picture, moderator flag and unread count reach the reader.
    const site = await get("/api/v3/site").catch(() => null);
    if (!site?.my_user) return null;
    const unread = await get("/api/v3/user/unread_count").catch(() => null);
    return normalizeAccount(site, unread);
  }
  // Nothing on the page to read votes from; the reader keeps Lemmy's.
  if (action === "vote-status") {
    if (!Array.isArray(payload?.ids) || payload.ids.length > 100)
      throw new Error("Invalid vote status request");
    return {};
  }
  if (action === "vote" || action === "action") {
    if (!active) throw new Error("OpenRelay is not active");
    throw new Error("OpenRelay can only read Lemmy for now. Use Original Lemmy to vote, reply or post.");
  }
  throw new Error("Unsupported request");
}

/**
 * Anything but lemmy-ui's own page: a bot check (Cloudflare's "Just a
 * moment…", Anubis) or another front end. lemmy-ui renders into `#root` and
 * hands its state over in `window.isoData`.
 */
const isGatePage = (doc: Document): boolean =>
  !doc.getElementById("root") ||
  ![...doc.scripts].some((script) => script.textContent?.includes("isoData"));

export const lemmyPage: PageProvider = {
  name: "Lemmy",
  parseRoute,
  isGatePage,
  handle,
};
