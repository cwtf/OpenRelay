import { apiAction, apiVote } from "./writes";
import { forwardVote, readNativeVote, isThingId } from "./votes";
import { allowedJsonPath, normalizeAccount, parseRoute } from "./reddit";
import { allowedSearchPagePath, parseSearchPage } from "./search";
import { readSnapshot } from "./snapshot";
import { sourceUrl } from "./sources";
import { pageHost } from "../hosts/page";

let host: HTMLDivElement | null = null;
let frame: HTMLIFrameElement | null = null;
let exitButton: HTMLButtonElement | null = null;
let mounted = false;
// Counts reader loads, so a reply can't reach a reader loaded after its request.
let generation = 0;
let active = false;
let originalInert = false;
let originalOverflow = "";
let mountedUrl = "";
let dismissed = new URL(location.href).searchParams.get("openrelay") === "off";
let lastUrl = location.href;
const appHost = pageHost();
// A host that shows the reader itself; otherwise the reader is our iframe.
const view = appHost.readerView;
const readerOrigin = new URL(appHost.readerUrl("")).origin;

function show(visible: boolean) {
  if (!mounted || active === visible) return;
  active = visible;
  if (visible) {
    originalInert = document.body.inert;
    originalOverflow = document.documentElement.style.overflow;
    document.body.inert = true;
    document.documentElement.style.overflow = "hidden";
    if (view) view.setVisible(true);
    else if (host) {
      host.style.display = "block";
      frame?.focus();
    }
  } else {
    document.body.inert = originalInert;
    document.documentElement.style.overflow = originalOverflow;
    if (view) view.setVisible(false);
    else if (host) host.style.display = "none";
  }
}
function unmount() {
  show(false);
  if (mounted) view?.close();
  host?.remove();
  host = null;
  frame = null;
  exitButton = null;
  mounted = false;
  generation++;
}
function exitToReddit() {
  dismissed = true;
  show(false);
}
function mount() {
  if (!parseRoute(location.href)) return;
  if (mounted && mountedUrl === location.href) {
    show(true);
    return;
  }
  unmount();
  mountedUrl = location.href;
  mounted = true;
  const hash = String(new URLSearchParams({ source: location.href }));
  if (view) {
    view.open(hash);
    show(true);
    return;
  }
  host = document.createElement("div");
  host.id = "openrelay-extension";
  host.style.cssText =
    "position:fixed!important;inset:0!important;z-index:2147483647!important;display:none";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent =
    "iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#eef0f3}button{position:absolute;bottom:12px;left:12px;border:1px solid #8494a8;border-radius:20px;background:#fff;color:#17283b;padding:8px 13px;font:12px system-ui;box-shadow:0 2px 8px #0002;cursor:pointer}button:focus-visible{outline:3px solid #1d63c4}";
  frame = document.createElement("iframe");
  frame.title = "OpenRelay Reddit reader";
  frame.allow = "clipboard-write; fullscreen";
  frame.src = appHost.readerUrl(hash);
  const exit = (exitButton = document.createElement("button"));
  exit.textContent = "Original Reddit";
  exit.title =
    "Return to the original page. Click the extension icon to reopen OpenRelay.";
  exit.addEventListener("click", exitToReddit);
  shadow.append(style, frame, exit);
  document.documentElement.append(host);
  show(true);
}
async function read(path: string, accept: string) {
  const response = await fetch(new URL(path, location.origin), {
    credentials: "same-origin",
    signal: AbortSignal.timeout(18000),
    headers: { Accept: accept },
  });
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
/** Replies to the reader that's loaded now, and to no reader loaded later. */
function replier(): (message: unknown) => void {
  if (view) {
    const requested = generation;
    return (message) => {
      if (requested === generation) view.post(message);
    };
  }
  const target = frame?.contentWindow;
  return (message) => target?.postMessage(message, readerOrigin);
}
window.addEventListener("message", (event) => {
  if (
    view ||
    event.source !== frame?.contentWindow ||
    event.origin !== readerOrigin
  )
    return;
  void receive(event.data);
});
// The host relays only the reader's messages, and checks their origin itself.
view?.onMessage((message) => void receive(message));
view?.onExit(exitToReddit);
async function receive(data: any) {
  // Keep "Original Reddit" clear of the reader's bottom app bar.
  if (data?.type === "openrelay:inset") {
    const bottom = Number(data.bottom);
    if (!Number.isFinite(bottom) || bottom < 0 || bottom > 200) return;
    if (view) view.setBottomInset(bottom);
    else if (exitButton) exitButton.style.bottom = `${12 + bottom}px`;
    return;
  }
  if (data?.type !== "openrelay:request") return;
  const { id, action, path, payload } = data;
  const reply = replier();
  if (!Number.isSafeInteger(id)) return;
  try {
    let value: unknown;
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
      value =
        clicked.status === "missing"
          ? await apiVote(
              fetch,
              location.origin,
              payload.thingId,
              current === payload.direction ? 0 : payload.direction,
            )
          : clicked;
    } else if (action === "vote-status") {
      if (
        !Array.isArray(payload?.ids) ||
        payload.ids.length > 100 ||
        !payload.ids.every(isThingId)
      )
        throw new Error("Invalid vote status request");
      value = Object.fromEntries(
        payload.ids.map((thingId: string) => [
          thingId,
          readNativeVote(document, thingId),
        ]),
      );
    } else if (action === "action") {
      if (!active) throw new Error("OpenRelay is not active");
      value = await apiAction(fetch, location.origin, payload?.op, payload?.args);
    } else if (action === "me") {
      // Only the name and picture reach the reader, never the session modhash.
      const response = await fetch(new URL("/api/me.json", location.origin), {
        credentials: "same-origin",
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json" },
      });
      value = response.ok
        ? normalizeAccount(await response.json().catch(() => null))
        : null;
    } else if (action === "navigate") {
      // The source switcher: only Reddit's or a Lemmy instance's front page.
      if (!active) throw new Error("OpenRelay is not active");
      const url = sourceUrl(path);
      if (!url) throw new Error("Invalid source");
      setTimeout(() => location.assign(url));
      value = null;
    } else if (action === "snapshot") {
      let loaded = readSnapshot(document);
      for (let i = 0; !loaded.posts.length && i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        loaded = readSnapshot(document);
      }
      value = loaded;
    } else if (action === "json" && allowedJsonPath(path)) {
      const response = await read(path, "application/json");
      if (!response.headers.get("content-type")?.includes("json"))
        throw new Error(
          "Reddit returned a sign-in or access page. Use Original Reddit to continue.",
        );
      value = await response.json();
    } else if (action === "search-page" && allowedSearchPagePath(path)) {
      // Only the post IDs and next page reach the reader, never the page.
      const response = await read(path, "text/html");
      if (!response.headers.get("content-type")?.includes("html"))
        throw new Error("Reddit did not return a search page.");
      value = parseSearchPage(await response.text());
    } else throw new Error("Unsupported request");
    reply({ type: "openrelay:response", id, value });
  } catch (error) {
    reply({
      type: "openrelay:response",
      id,
      error: error instanceof Error ? error.message : "Request failed",
    });
  }
}
appHost.onToggle(() => {
  dismissed = active;
  if (active) show(false);
  else mount();
});
// Wait briefly for client-rendered listings, without touching login, settings or mod pages.
function isGatePage() {
  return (
    !document.querySelector("shreddit-post, .thing.link") &&
    (/prove your humanity|security check|you.ve been blocked|access denied/i.test(
      document.title,
    ) ||
      Boolean(
        document.querySelector(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"]',
        ),
      ))
  );
}
function autoMount() {
  if (isGatePage()) return;
  if (
    !dismissed &&
    new URL(location.href).searchParams.get("openrelay") !== "off" &&
    parseRoute(location.href)
  )
    mount();
}
setTimeout(autoMount, 500);
setInterval(() => {
  if (isGatePage()) {
    if (mounted) unmount();
    return;
  }
  if (!mounted) autoMount();
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    unmount();
    // Native mode persists for this tab until the toolbar button is clicked.
    autoMount();
  }
}, 750);
