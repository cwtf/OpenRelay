import { allowedJsonPath, parseRoute } from "./reddit";
import { readSnapshot } from "./snapshot";

let host: HTMLDivElement | null = null;
let frame: HTMLIFrameElement | null = null;
let active = false;
let originalInert = false;
let originalOverflow = "";
let mountedUrl = "";
let dismissed = new URL(location.href).searchParams.get("openrelay") === "off";
let lastUrl = location.href;
const extensionOrigin = new URL(chrome.runtime.getURL("reader.html")).origin;

function show(visible: boolean) {
  if (!host || active === visible) return;
  active = visible;
  if (visible) {
    originalInert = document.body.inert;
    originalOverflow = document.documentElement.style.overflow;
    document.body.inert = true;
    document.documentElement.style.overflow = "hidden";
    host.style.display = "block";
    frame?.focus();
  } else {
    document.body.inert = originalInert;
    document.documentElement.style.overflow = originalOverflow;
    host.style.display = "none";
  }
}
function mount() {
  if (!parseRoute(location.href)) return;
  if (host && mountedUrl === location.href) {
    show(true);
    return;
  }
  show(false);
  host?.remove();
  mountedUrl = location.href;
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
  frame.src =
    chrome.runtime.getURL("reader.html") +
    "#" +
    new URLSearchParams({ source: location.href });
  const exit = document.createElement("button");
  exit.textContent = "Original Reddit";
  exit.title =
    "Return to the original page. Click the extension icon to reopen OpenRelay.";
  exit.addEventListener("click", () => {
    dismissed = true;
    show(false);
  });
  shadow.append(style, frame, exit);
  document.documentElement.append(host);
  show(true);
}
window.addEventListener("message", async (event) => {
  if (
    event.source !== frame?.contentWindow ||
    event.origin !== extensionOrigin ||
    event.data?.type !== "openrelay:request"
  )
    return;
  const { id, action, path } = event.data;
  const target = frame.contentWindow;
  if (!Number.isSafeInteger(id)) return;
  try {
    let value: unknown;
    if (action === "snapshot") {
      let loaded = readSnapshot(document);
      for (let i = 0; !loaded.posts.length && i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        loaded = readSnapshot(document);
      }
      value = loaded;
    } else if (action === "json" && allowedJsonPath(path)) {
      const response = await fetch(new URL(path, location.origin), {
        credentials: "same-origin",
        signal: AbortSignal.timeout(18000),
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Reddit is rate limiting requests. Please wait and try again."
            : "Reddit could not load this content (" +
                response.status +
                "). Try Original Reddit.",
        );
      if (!response.headers.get("content-type")?.includes("json"))
        throw new Error(
          "Reddit returned a sign-in or access page. Use Original Reddit to continue.",
        );
      value = await response.json();
    } else throw new Error("Unsupported request");
    target?.postMessage(
      { type: "openrelay:response", id, value },
      extensionOrigin,
    );
  } catch (error) {
    target?.postMessage(
      {
        type: "openrelay:response",
        id,
        error: error instanceof Error ? error.message : "Request failed",
      },
      extensionOrigin,
    );
  }
});
chrome.runtime.onMessage.addListener((message) => {
  if ((message as { type?: string })?.type !== "openrelay:toggle") return;
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
    show(false);
    host?.remove();
    host = null;
    frame = null;
    return;
  }
  if (!host) autoMount();
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    show(false);
    host?.remove();
    host = null;
    frame = null;
    // Native mode persists for this tab until the toolbar button is clicked.
    autoMount();
  }
}, 750);
