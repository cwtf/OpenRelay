import type { PageProvider, PageRequest } from "../types";
import { apiAction, apiUpload, apiVote, csrfToken } from "./writes";
import { decodeImage } from "../upload";
import { forwardVote, readNativeVote, isThingId } from "./votes";
import { allowedJsonPath, normalizeAccount, parseRoute } from "./reddit";
import { allowedSearchPagePath, parseSearchPage } from "./search";
import { readHtmlPage, readSnapshot } from "./snapshot";
import { allowedHtmlPath } from "./shreddit";

/**
 * Reddit's half of the page bridge, in the content script on Reddit's
 * origin. Requests run same-origin with the tab's session; the session
 * modhash stays in `writes.ts` and never reaches the reader.
 */
async function read(path: string, accept: string, form?: URLSearchParams) {
  const response = await fetch(new URL(path, location.origin), {
    credentials: "same-origin",
    signal: AbortSignal.timeout(18000),
    headers: { Accept: accept },
    ...(form ? { method: "POST", body: form } : {}),
  });
  if (response.status === 403) {
    // A community that is private or quarantined says why; a session Reddit
    // won't serve at all (signed out, it refuses all JSON) gets a block page.
    const reason = await response.json().then((body) => body?.reason, () => undefined);
    if (typeof reason !== "string")
      throw new Error("Reddit blocked this request (403). Try Original Reddit.");
  }
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Reddit is rate limiting requests. Please wait and try again."
        : "Reddit could not load this content (" +
            response.status +
            "). Try Original Reddit.",
    );
  return response;
}
/** The form new Reddit posts for more comments, with its CSRF cookie if set. */
function moreCommentsForm(cursor: string) {
  const form = new URLSearchParams({ cursor });
  const csrf = csrfToken(document.cookie);
  if (csrf) form.set("csrf_token", csrf);
  return form;
}

async function handle(
  { action, path, payload }: PageRequest,
  active: boolean,
): Promise<unknown> {
  if (action === "vote") {
    if (!active) throw new Error("OpenRelay is not active");
    const current = payload?.current;
    if (current !== 1 && current !== 0 && current !== -1)
      throw new Error("Invalid vote request");
    const clicked = await forwardVote(
      document,
      payload?.thingId,
      payload?.direction,
    );
    // Reader-fetched content has no buttons on the page; vote via the API.
    return clicked.status === "missing"
      ? await apiVote(
          fetch,
          location.origin,
          payload.thingId,
          current === payload.direction ? 0 : payload.direction,
        )
      : clicked;
  }
  if (action === "vote-status") {
    if (
      !Array.isArray(payload?.ids) ||
      payload.ids.length > 100 ||
      !payload.ids.every(isThingId)
    )
      throw new Error("Invalid vote status request");
    return Object.fromEntries(
      payload.ids.map((thingId: string) => [
        thingId,
        readNativeVote(document, thingId),
      ]),
    );
  }
  if (action === "action") {
    if (!active) throw new Error("OpenRelay is not active");
    return apiAction(fetch, location.origin, payload?.op, payload?.args);
  }
  if (action === "upload") {
    if (!active) throw new Error("OpenRelay is not active");
    // The CSRF token, like the modhash, stays in the content script.
    return apiUpload(fetch, location.origin, decodeImage(payload?.file), csrfToken(document.cookie));
  }
  if (action === "me") {
    // Only the name and picture reach the reader, never the session modhash.
    const response = await fetch(new URL("/api/me.json", location.origin), {
      credentials: "same-origin",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json" },
    });
    return response.ok
      ? normalizeAccount(await response.json().catch(() => null))
      : null;
  }
  if (action === "snapshot") {
    let loaded = readSnapshot(document);
    for (let i = 0; !loaded.posts.length && i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      loaded = readSnapshot(document);
    }
    return loaded;
  }
  if (action === "json" && allowedJsonPath(path)) {
    const response = await read(path, "application/json");
    if (!response.headers.get("content-type")?.includes("json"))
      throw new Error(
        "Reddit returned a sign-in or access page. Use Original Reddit to continue.",
      );
    return response.json();
  }
  if (action === "search-page" && allowedSearchPagePath(path)) {
    // Only the post IDs and next page reach the reader, never the page.
    const response = await read(path, "text/html");
    if (!response.headers.get("content-type")?.includes("html"))
      throw new Error("Reddit did not return a search page.");
    return parseSearchPage(await response.text());
  }
  if (action === "html" && allowedHtmlPath(path, payload?.cursor)) {
    // Only the posts and comments reach the reader, never the page.
    const cursor: string | undefined = payload?.cursor;
    const response = await read(
      path,
      "text/html",
      cursor === undefined ? undefined : moreCommentsForm(cursor),
    );
    if (!response.headers.get("content-type")?.includes("html"))
      throw new Error("Reddit did not return a page.");
    return readHtmlPage(
      new DOMParser().parseFromString(await response.text(), "text/html"),
    );
  }
  throw new Error("Unsupported request");
}

// Wait briefly for client-rendered listings, without touching login, settings or mod pages.
const isGatePage = (doc: Document): boolean =>
  !doc.querySelector("shreddit-post, .thing.link") &&
  (/prove your humanity|security check|you.ve been blocked|access denied/i.test(
    doc.title,
  ) ||
    Boolean(
      doc.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]'),
    ));

export const redditPage: PageProvider = {
  name: "Reddit",
  parseRoute,
  isGatePage,
  handle,
};
