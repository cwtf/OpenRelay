// OpenRelay's desktop app: a Reddit window, like a browser tab with the
// extension installed. See docs/handover-android-electron.md.
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
  webContents,
} from "electron";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const READER_ORIGIN = "openrelay://reader";
/** The reader without Reddit, showing the posts saved for offline reading. */
const OFFLINE_URL = READER_ORIGIN + "/reader.html#offline";
const PARTITION = "persist:openrelay";
const REDDIT_ORIGINS = new Set([
  "https://www.reddit.com",
  "https://old.reddit.com",
  "https://reddit.com",
]);
/** The shared build, copied in by `npm run build` (tools/copy-dist.mjs). */
const files = resolve(import.meta.dirname, "../openrelay");
if (process.platform === "win32") app.setAppUserModelId("io.github.cwtf.openrelay");

// Reddit's CSP must not stop its page from framing the reader, just as it
// can't stop the extension's frame.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "openrelay",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

// Electron's user agent names Electron and the app, and Reddit's bot filter
// can refuse JSON to that (403). Every frame and request sends the Chrome
// user agent it's built on instead.
app.userAgentFallback = app.userAgentFallback.replace(
  / (?:Electron|OpenRelay|openrelay-desktop)\/\S+/g,
  "",
);

const isReddit = (value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "reddit.com" || url.hostname.endsWith(".reddit.com"))
    );
  } catch {
    return false;
  }
};

/**
 * The Lemmy instances added in the reader (its `lemmy-instances` setting),
 * which the app treats as it treats Reddit: OpenRelay runs there, and their
 * links stay in the app. Adding one in the app is the consent; there's no
 * browser permission to ask for.
 */
const INSTANCES_KEY = "openrelay:lemmy-instances";
/** Listed until the list is changed, as DEFAULT_INSTANCES in src/extension/sources.ts. */
const DEFAULT_INSTANCES = ["lemmy.world"];
const HOST = /^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/;
let instances = new Set();
const setInstances = (list = DEFAULT_INSTANCES) => {
  instances = new Set(
    (Array.isArray(list) ? list : []).filter(
      (host) =>
        typeof host === "string" &&
        HOST.test(host) &&
        !/^\d+$/.test(host.split(".").at(-1)) &&
        !isReddit("https://" + host),
    ),
  );
};
const isInstance = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && instances.has(url.hostname);
  } catch {
    return false;
  }
};
/** A site OpenRelay reads: Reddit, or an added Lemmy instance. */
const isSite = (value) => isReddit(value) || isInstance(value);

const openExternal = (value) => {
  try {
    if (["https:", "http:"].includes(new URL(value).protocol))
      void shell.openExternal(value);
  } catch {
    // Not a URL: ignore it.
  }
};

/** The reader's native channels answer only frames from the reader's origin. */
function readerFrame(event) {
  const frame = event.senderFrame;
  if (frame?.origin !== READER_ORIGIN) throw new Error("Not allowed");
  return frame;
}

// Storage: one JSON file, mirrored in memory, written atomically.
const storePath = () => join(app.getPath("userData"), "openrelay-storage.json");
let store = null;
let saving = Promise.resolve();
const loadStore = () =>
  (store ??= readFile(storePath(), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => ({}))
    .then((data) => {
      setInstances(data[INSTANCES_KEY]);
      return data;
    }));
const saveStore = (data) =>
  (saving = saving.then(async () => {
    const temp = storePath() + ".tmp";
    await writeFile(temp, JSON.stringify(data));
    await rename(temp, storePath());
  }));

const isEntryKey = (key) => typeof key === "string" && key.startsWith("openrelay:");

/** Tells every other reader frame, in any window, what changed. */
function broadcast(sender, changes) {
  for (const contents of webContents.getAllWebContents())
    for (const frame of contents.mainFrame?.framesInSubtree ?? [])
      if (
        frame.origin === READER_ORIGIN &&
        !(frame.processId === sender.processId && frame.routingId === sender.routingId)
      )
        frame.send("openrelay:storage-changed", changes);
}

ipcMain.handle("openrelay:storage-get-all", async (event) => {
  readerFrame(event);
  return { ...(await loadStore()) };
});
ipcMain.handle("openrelay:storage-set", async (event, items) => {
  const frame = readerFrame(event);
  if (!items || typeof items !== "object") throw new Error("Invalid items");
  const data = await loadStore();
  const changes = {};
  for (const [key, value] of Object.entries(items)) {
    if (!isEntryKey(key)) continue;
    data[key] = value;
    changes[key] = { newValue: value };
  }
  setInstances(data[INSTANCES_KEY]);
  await saveStore(data);
  broadcast(frame, changes);
});
ipcMain.handle("openrelay:storage-remove", async (event, keys) => {
  const frame = readerFrame(event);
  if (!Array.isArray(keys)) throw new Error("Invalid keys");
  const data = await loadStore();
  const changes = {};
  for (const key of keys.filter(isEntryKey)) {
    delete data[key];
    changes[key] = {};
  }
  setInstances(data[INSTANCES_KEY]);
  await saveStore(data);
  broadcast(frame, changes);
});

// Posts saved for offline reading: one JSON file per key, written atomically.
// Keys get the same check as OFFLINE_KEY in src/hosts/types.ts.
const OFFLINE_KEY = /^[a-z]+(?::[A-Za-z0-9_]{1,40})?$/;
const offlinePath = (key) => {
  if (typeof key !== "string" || !OFFLINE_KEY.test(key)) throw new Error("Invalid key");
  return join(app.getPath("userData"), "offline", key.replace(":", "-") + ".json");
};
ipcMain.handle("openrelay:offline-get", async (event, key) => {
  readerFrame(event);
  const path = offlinePath(key);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
});
ipcMain.handle("openrelay:offline-set", async (event, key, value) => {
  readerFrame(event);
  const path = offlinePath(key);
  await mkdir(join(app.getPath("userData"), "offline"), { recursive: true });
  await writeFile(path + ".tmp", JSON.stringify(value));
  await rename(path + ".tmp", path);
});
ipcMain.handle("openrelay:offline-remove", async (event, keys) => {
  readerFrame(event);
  if (!Array.isArray(keys)) throw new Error("Invalid keys");
  await Promise.all(keys.map((key) => rm(offlinePath(key), { force: true })));
});

// Images for offline posts, from Reddit's image hosts only (MEDIA_HOSTS in
// src/hosts/types.ts), without cookies, as base64.
const MEDIA_HOSTS = new Set([
  "i.redd.it",
  "preview.redd.it",
  "external-preview.redd.it",
  "a.thumbs.redditmedia.com",
  "b.thumbs.redditmedia.com",
]);
const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
ipcMain.handle("openrelay:media-fetch", async (event, value) => {
  readerFrame(event);
  const url = new URL(String(value));
  if (url.protocol !== "https:" || !MEDIA_HOSTS.has(url.hostname))
    throw new Error("Not a Reddit image");
  const response = await session
    .fromPartition(PARTITION)
    .fetch(url.href, { credentials: "omit", redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MEDIA_MAX_BYTES)
    throw new Error("Too large");
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MEDIA_MAX_BYTES) throw new Error("Too large");
  const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  return { type, data: data.toString("base64") };
});

// Downloads: remote files through Chromium's download manager, bytes the
// reader built (a video with sound) through a save dialog.
const downloadNames = new Map();
ipcMain.handle("openrelay:save-url", (event, file) => {
  readerFrame(event);
  const url = new URL(String(file?.url));
  if (url.protocol !== "https:") throw new Error("Invalid download");
  if (typeof file.filename === "string")
    downloadNames.set(url.href, basename(file.filename));
  event.sender.downloadURL(url.href);
});
ipcMain.handle("openrelay:save-data", async (event, file) => {
  readerFrame(event);
  if (!(file?.data instanceof Uint8Array) || typeof file.filename !== "string")
    throw new Error("Invalid download");
  const window = BrowserWindow.fromWebContents(event.sender);
  const options = {
    defaultPath: join(app.getPath("downloads"), basename(file.filename)),
  };
  const { canceled, filePath } = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);
  if (!canceled && filePath) await writeFile(filePath, file.data);
});

// The content script, for the preload to run in the top frame of Reddit or
// an added Lemmy instance; `null` for any other page.
let pageScript = null;
ipcMain.handle("openrelay:page-script", async (event) => {
  const frame = event.senderFrame;
  if (!frame || frame.parent) throw new Error("Not allowed");
  await loadStore();
  if (!REDDIT_ORIGINS.has(frame.origin) && !isInstance(frame.origin + "/")) return null;
  return (pageScript ??= readFile(join(files, "content.js"), "utf8"));
});

function setUpSession() {
  const ses = session.fromPartition(PARTITION);
  ses.protocol.handle("openrelay", async (request) => {
    const url = new URL(request.url);
    const path = resolve(files, "." + decodeURIComponent(url.pathname));
    if (url.host !== "reader" || !path.startsWith(files + sep))
      return new Response("Not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(path).href);
    // The extension's default CSP for its own pages.
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", "script-src 'self'; object-src 'self'");
    return new Response(response.body, { status: response.status, headers });
  });
  // The reader's iframe asks for clipboard-write and fullscreen; nothing else.
  const allowed = new Set(["clipboard-sanitized-write", "fullscreen"]);
  ses.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(allowed.has(permission)),
  );
  ses.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
  ses.on("will-download", (_event, item) => {
    const name = downloadNames.get(item.getURL());
    downloadNames.delete(item.getURL());
    item.setSaveDialogOptions({
      defaultPath: join(app.getPath("downloads"), name || item.getFilename()),
    });
  });
}

function createWindow(url = "https://www.reddit.com/") {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "OpenRelay",
    icon: join(import.meta.dirname, "../resources/icon.png"),
    webPreferences: {
      partition: PARTITION,
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The preload also runs in the reader's iframe, to expose its host.
      nodeIntegrationInSubFrames: true,
    },
  });
  // Reddit didn't load (offline): show the posts saved for offline reading.
  // ERR_ABORTED is a navigation another one replaced.
  window.webContents.on("did-fail-load", (_event, code, _text, failed, isMainFrame) => {
    if (isMainFrame && code !== -3 && isSite(failed)) void window.loadURL(OFFLINE_URL);
  });
  void window.loadURL(url);
  return window;
}

app.on("web-contents-created", (_event, contents) => {
  // Reddit and instance links (sign-in included) open in another app window,
  // which shares the session; anything else opens in the system browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (isSite(url)) createWindow(url);
    else openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event) => {
    if (isSite(event.url)) return;
    event.preventDefault();
    openExternal(event.url);
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

function toggleReader(window) {
  const target =
    window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  target?.webContents.mainFrame.send("openrelay:toggle");
}

function setUpMenu() {
  const mac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu" }] : []),
      { label: "File", submenu: [mac ? { role: "close" } : { role: "quit" }] },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          {
            id: "toggle-reader",
            label: "Toggle OpenRelay / Original Reddit",
            accelerator: "CmdOrCtrl+Shift+R",
            click: (_item, window) => toggleReader(window),
          },
          {
            id: "offline-posts",
            label: "Saved for Offline",
            click: (_item, window) =>
              void (window ?? BrowserWindow.getAllWindows()[0] ?? createWindow())
                .loadURL(OFFLINE_URL),
          },
          { type: "separator" },
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    // Know the added instances before the first page loads.
    await loadStore();
    setUpSession();
    setUpMenu();
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
