// openRelayReaderHost for the reader's WebView: storage as a promise-based RPC,
// and the channel to the Reddit page, both over `openRelayNative`, which the
// app gives only to this origin.
(() => {
  if (
    location.origin !== "https://appassets.androidplatform.net" ||
    window.top !== window
  )
    return;
  const port = globalThis.openRelayNative;
  if (!port) return;
  const send = (message) => port.postMessage(JSON.stringify(message));
  let nextId = 0;
  const pending = new Map();
  const pageListeners = [];
  let backListener = null;
  port.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    // The app forwards the page's messages by this prefix alone, so the kind
    // comes from the prefix too, not from a key the page could repeat.
    if (event.data.startsWith('{"kind":"post",')) {
      for (const listener of pageListeners) listener(data.message);
      return;
    }
    if (data.kind === "back") {
      let handled = false;
      try {
        handled = Boolean(backListener?.());
      } catch {
        // The app goes back itself.
      }
      send({ kind: "back", handled });
      return;
    }
    const task = data.kind === "rpc" && pending.get(data.id);
    if (!task) return;
    pending.delete(data.id);
    if (data.error) task.reject(new Error(data.error));
    else task.resolve(data.value);
  });
  const call = (method, args) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      send({ kind: "rpc", id, method, args });
    });
  globalThis.openRelayReaderHost = Object.freeze({
    name: "android",
    storage: Object.freeze({
      getAll: () => call("storage.getAll"),
      set: (items) => call("storage.set", items).then(() => undefined),
      remove: (keys) => call("storage.remove", keys).then(() => undefined),
    }),
    offline: Object.freeze({
      get: (key) => call("offline.get", { key }).then((value) => value ?? undefined),
      set: (key, value) => call("offline.set", { key, value }).then(() => undefined),
      remove: (keys) => call("offline.remove", keys).then(() => undefined),
    }),
    downloads: async () => "unavailable",
    onBack: (listener) => {
      backListener = listener;
    },
    channel: Object.freeze({
      post: (message) => send({ kind: "post", message }),
      onMessage: (listener) => void pageListeners.push(listener),
    }),
  });
  send({ kind: "hello" });
})();
