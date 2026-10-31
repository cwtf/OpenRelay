import { sourceUrl } from "./sources";
import { pageHost } from "../hosts/page";
import { pageProvider } from "../providers/page";
import type { PageProvider } from "../providers/types";

// The manifest runs this script only on sites a provider reads.
const found = pageProvider(location.href);
if (!found) throw new Error("OpenRelay doesn't read this site");
const provider: PageProvider = found;

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
function exitToSite() {
  dismissed = true;
  show(false);
}
function mount() {
  if (!provider.parseRoute(location.href)) return;
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
  frame.title = `OpenRelay ${provider.name} reader`;
  frame.allow = "clipboard-write; fullscreen";
  frame.src = appHost.readerUrl(hash);
  const exit = (exitButton = document.createElement("button"));
  exit.textContent = `Original ${provider.name}`;
  exit.title =
    "Return to the original page. Click the extension icon to reopen OpenRelay.";
  exit.addEventListener("click", exitToSite);
  shadow.append(style, frame, exit);
  document.documentElement.append(host);
  show(true);
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
view?.onExit(exitToSite);
async function receive(data: any) {
  // Keep the "Original …" control clear of the reader's bottom app bar.
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
    if (action === "navigate") {
      // The source switcher: only Reddit's or a Lemmy instance's front page.
      if (!active) throw new Error("OpenRelay is not active");
      const url = sourceUrl(path);
      if (!url) throw new Error("Invalid source");
      setTimeout(() => location.assign(url));
      value = null;
    } else value = await provider.handle({ action, path, payload }, active);
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
const isGatePage = () => provider.isGatePage(document);
function autoMount() {
  if (isGatePage()) return;
  if (
    !dismissed &&
    new URL(location.href).searchParams.get("openrelay") !== "off" &&
    provider.parseRoute(location.href)
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
