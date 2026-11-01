// openRelayReaderHost for the reader's WebView: storage and downloads as a
// promise-based RPC, and the channel to the Reddit page, both over
// `openRelayNative`, which the app gives only to this origin.
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
  // A video the reader built goes over in base64 pieces of this many bytes,
  // each answered before the next, not as one message of tens of MB.
  const CHUNK = 1024 * 1024;
  const base64 = (bytes) => {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };
  const save = async (file) => {
    if (!file.data) {
      await call("downloads.url", { url: file.url, filename: file.filename });
      return;
    }
    const id = await call("downloads.begin", { filename: file.filename, type: file.type });
    try {
      for (let i = 0; i < file.data.length; i += CHUNK)
        await call("downloads.chunk", { id, data: base64(file.data.subarray(i, i + CHUNK)) });
    } catch (error) {
      await call("downloads.abort", { id }).catch(() => {});
      throw error;
    }
    await call("downloads.end", { id });
  };
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
    media: async () =>
      Object.freeze({ fetch: (url) => call("media.fetch", url) }),
    downloads: async () => Object.freeze({ save }),
    // Lemmy instances: the app reads the reader's list of them, and adding
    // one in the app is the consent.
    instances: Object.freeze({
      allow: async () => "granted",
      forget: async () => {},
      sync: async () => {},
    }),
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
