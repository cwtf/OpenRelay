// openRelayPageHost for Reddit's top frame, then content.js once the DOM is
// ready. Reddit's CSP (frame-src) blocks the reader as an iframe, so the app
// shows it in a second WebView and relays messages through `openRelayPage`.
//
// Without an isolated world this runs in Reddit's own world, at document start
// so it's ahead of Reddit's scripts: it takes the channel off the global object
// and defines openRelayPageHost so it can't be replaced.
(() => {
  if (window.top !== window || Object.hasOwn(globalThis, "openRelayPageHost"))
    return;
  const port = globalThis.openRelayPage;
  if (!port) return;
  delete globalThis.openRelayPage;
  const post = port.postMessage.bind(port);
  const send = (message) => post(JSON.stringify(message));
  const POST = '{"kind":"post",';
  const listeners = { post: [], exit: [], toggle: [] };
  port.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    // The app forwards the reader's messages by this prefix alone, so the kind
    // comes from the prefix too, not from a key the reader could repeat.
    const kind = event.data.startsWith(POST) ? "post" : data?.kind;
    if (kind === "post" || kind === "exit" || kind === "toggle")
      for (const listener of listeners[kind]) listener(data.message);
  });
  const readerView = Object.freeze({
    open: (hash) => send({ kind: "open", hash: String(hash) }),
    setVisible: (visible) => send({ kind: "visible", visible: Boolean(visible) }),
    close: () => send({ kind: "close" }),
    setBottomInset: (bottom) => send({ kind: "inset", bottom: Number(bottom) }),
    post: (message) => send({ kind: "post", message }),
    onMessage: (listener) => void listeners.post.push(listener),
    onExit: (listener) => void listeners.exit.push(listener),
  });
  Object.defineProperty(globalThis, "openRelayPageHost", {
    value: Object.freeze({
      readerUrl: (hash) => /*READER_URL*/ + "#" + hash,
      onToggle: (listener) => void listeners.toggle.push(listener),
      readerView,
    }),
  });
  send({ kind: "hello" });
  const run = () => {
/*CONTENT_JS*/
  };
  if (document.readyState === "loading")
    addEventListener("DOMContentLoaded", run, { once: true });
  else run();
})();
