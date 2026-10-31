// Runs in every frame of an app window (sandboxed, context-isolated). The top
// frame of Reddit or an added Lemmy instance gets the content script in its
// own isolated world, as an extension's content script does; the reader
// frame gets its host. No other frame gets anything.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

const READER_ORIGIN = "openrelay://reader";
// Electron's preload world is 999; this one holds only content.js.
const CONTENT_WORLD = 1001;

if (location.origin === READER_ORIGIN) {
  contextBridge.exposeInMainWorld("openRelayReaderHost", {
    name: "electron",
    storage: {
      getAll: () => ipcRenderer.invoke("openrelay:storage-get-all"),
      set: (items) => ipcRenderer.invoke("openrelay:storage-set", items),
      remove: (keys) => ipcRenderer.invoke("openrelay:storage-remove", keys),
      onChanged: (listener) => {
        ipcRenderer.on("openrelay:storage-changed", (_event, changes) =>
          listener(changes),
        );
      },
    },
    offline: {
      get: (key) => ipcRenderer.invoke("openrelay:offline-get", key),
      set: (key, value) => ipcRenderer.invoke("openrelay:offline-set", key, value),
      remove: (keys) => ipcRenderer.invoke("openrelay:offline-remove", keys),
    },
    media: async () => ({
      fetch: (url) => ipcRenderer.invoke("openrelay:media-fetch", url),
    }),
    // Lemmy instances: the main process reads the reader's list of them,
    // and adding one in the app is the consent.
    instances: {
      allow: async () => "granted",
      forget: async () => {},
      sync: async () => {},
    },
    downloads: async () => ({
      save: (file) =>
        "url" in file
          ? ipcRenderer.invoke("openrelay:save-url", {
              url: file.url,
              filename: file.filename,
            })
          : ipcRenderer.invoke("openrelay:save-data", {
              data: file.data,
              filename: file.filename,
              type: file.type,
            }),
    }),
  });
} else if (location.protocol === "https:" && window === window.top) {
  const pageHost = `globalThis.openRelayPageHost = {
    readerUrl: (hash) => ${JSON.stringify(READER_ORIGIN + "/reader.html#")} + hash,
    onToggle: (listener) => { globalThis.openRelayToggle = listener; },
  };`;
  // With a CSP of its own, the world is exempt from Reddit's, as Chrome
  // exempts extensions: the reader's frame and its styles aren't blocked.
  // Its origin stays the page's, so its requests are same-origin with Reddit.
  webFrame.setIsolatedWorldInfo(CONTENT_WORLD, {
    name: "OpenRelay",
    securityOrigin: location.origin,
    csp: "script-src 'self'; object-src 'none'",
  });
  // The main process hands the script only to Reddit and added instances.
  const run = async () => {
    const script = await ipcRenderer.invoke("openrelay:page-script");
    if (!script) return;
    await webFrame.executeJavaScriptInIsolatedWorld(CONTENT_WORLD, [
      { code: pageHost + "\n" + script },
    ]);
  };
  // The extension runs content.js at document_idle.
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => void run(), { once: true });
  else void run();
  ipcRenderer.on("openrelay:toggle", () => {
    void webFrame.executeJavaScriptInIsolatedWorld(CONTENT_WORLD, [
      { code: "globalThis.openRelayToggle?.()" },
    ]);
  });
}
