import type { PageProvider, PageRequest } from "../types";
import { allowedApiPath, normalizeAccount, parseRoute } from "./lemmy";
import { call, lemmyAction, lemmyVote, sessionToken } from "./writes";

/**
 * Lemmy's half of the page bridge, in the content script on the instance's
 * origin. lemmy-ui and Lemmy's API share that origin, so requests are
 * same-origin and carry lemmy-ui's sign-in; the reader never sees it.
 */
const token = () => sessionToken(document.cookie);
const get = (path: string) => call(fetch, location.origin, token(), "GET", path);

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
  if (action === "vote") {
    if (!active) throw new Error("OpenRelay is not active");
    const current = payload?.current;
    if (current !== 1 && current !== 0 && current !== -1)
      throw new Error("Invalid vote request");
    return lemmyVote(
      fetch,
      location.origin,
      token(),
      payload?.thingId,
      current === payload?.direction ? 0 : payload?.direction,
    );
  }
  if (action === "action") {
    if (!active) throw new Error("OpenRelay is not active");
    return lemmyAction(fetch, location.origin, token(), payload?.op, payload?.args);
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
