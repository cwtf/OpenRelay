# Handover: OpenRelay as an Android app and a desktop app

This document starts two separate pieces of work: an **Android app** that wraps OpenRelay in a WebView, and a **desktop app** that wraps it in Electron. Read the shared sections first, then the section for your app. CLAUDE.md and README.md describe the extension itself; this document covers only what is new for the wrapper apps.

## Where things stand (2026-10-30)

- Unmerged work sits on local branches that haven't been pushed:
  - `feat/firefox-build`: `npm run build` also writes `dist-firefox/`.
  - `feat/host-adapter`, built on top of it: adds `src/hosts/`, the seam the wrapper apps plug into.

  Start from `feat/host-adapter`, or from `master` once both branches are merged.
- Decision: both apps live in **this repository**, under `apps/android/` and `apps/desktop/`. They share `src/`, so a fix to Reddit parsing, votes or writes reaches every app at once. Don't copy `src/` into the apps. Each app's build takes the built files from `dist/`.
- Verified on `feat/host-adapter`:
  - `npm run check` passes (69 unit tests).
  - All four Chrome browser suites pass.
  - A fixture smoke run in Firefox 145 passes: the reader mounts, JSON loads through the bridge, and a vote is sent with the modhash.
  - The Android app doesn't exist yet. The desktop app is on `master` (see its section). `npm run dist` packages it with electron-builder, unsigned and with Electron's default icon.

## How a wrapper app runs OpenRelay

The extension has three parts, and each wrapper must provide all three.

| Part | In the extension | What a wrapper provides |
|---|---|---|
| Reddit page | A normal reddit.com tab, which holds the user's session | A WebView or BrowserWindow loading `https://www.reddit.com/`, with its own persistent cookie store. The user signs in to Reddit inside the app. |
| Content script (`dist/content.js`) | Injected by Chrome into an isolated world on reddit.com | Injected by the app into reddit.com pages, after `openRelayPageHost` is defined (see below) |
| Reader (`dist/reader.html` + `dist/assets/`) | Served from the `chrome-extension://…` origin into an iframe | Served by the app from **its own origin**, which must not be reddit.com |

All Reddit traffic still goes through the content script. It makes same-origin requests with the page's session. The reader never contacts Reddit directly, so the wrapper must not give the reader network access to Reddit or cookies.

`dist/` is already host-agnostic, so the apps don't need a separate build of the shared code. Run `npm run build`, then copy `reader.html`, `assets/` and `content.js` into the app. The manifest and `background.js` are only for the extension.

### The host contract (`src/hosts/`)

`src/hosts/types.ts` is the specification. Read it, plus `reader.ts` and `page.ts`, which implement it for the extension. A wrapper defines two globals:

- **`globalThis.openRelayPageHost: PageHost`**, in the Reddit page, before `content.js` runs:
  - `readerUrl(hash)` returns the URL of the app's `reader.html` with `#` and `hash` appended. The content script trusts `postMessage` only from **the origin of this URL**, so it must be the exact origin that serves the reader.
  - `onToggle(listener)`: the content script registers a callback here. Call it when the user taps the app's "toggle reader" control, which replaces the extension's toolbar button.
- **`globalThis.openRelayReaderHost: ReaderHost`**, in the reader frame only, before the reader's module script runs. `initStorage()` reads it at startup.
  - `storage`: `getAll`, `set`, `remove`, and an optional `onChanged`. Keys already carry the `openrelay:` prefix, and values are JSON-compatible. Writes are batched about 150 ms apart and flushed on `pagehide`.
  - `downloads()` resolves to `"unavailable"`, `"declined"`, or an object with `save(file)`. `file` is either `{ url, filename? }`, for an image on i.redd.it or similar, or `{ data: Uint8Array, filename, type }`, for an MP4 the reader built by joining a v.redd.it video with its audio track.

Every method is async, so either app can answer over a message channel or IPC. If you add a capability, such as a native share sheet, back navigation or copy to clipboard, add it to `types.ts` with an extension implementation. Then use it from the reader through `readerHost()`, never through a global check scattered in components.

### Rules each wrapper must keep

These come from the extension's security model; see "The bridge is a security boundary" in CLAUDE.md.

1. **Serve the reader from a different origin than reddit.com.** The bridge's protection depends on Reddit's page being unable to impersonate the reader.
2. **Expose `openRelayReaderHost` and the native storage and download channels only to the reader's origin.** Never expose them to reddit.com or any other frame, and validate the sender's origin on the native side too.
3. **Keep the modhash inside `content.js`.** Don't add native APIs that hand Reddit's session or cookies to the reader.
4. **Don't change the allowlists for a wrapper.** `READ_ROUTES` and `ACTIONS` stay the only things the bridge does.
5. **Keep the README's data promise:** no third-party hosts apart from the existing optional Giphy GIFs, no analytics, and the inbox read with `mark=false`. Each app gets its own "Data and permissions" section in the README, covering where storage lives and what the app keeps.

### Reader behaviour the wrappers must handle

- **New windows:** `openUrl()` and `promptLogin()` in `src/client/lib/platform.ts` call `window.open(url, "_blank")`.
  - Reddit links carry `?openrelay=off`. The app should open them in its own Reddit view, which shares the session.
  - Other links should open in the system browser.
  - **The Reddit login page must load inside the app's own Reddit view.** A system browser or Custom Tab has a different cookie store.
- **Google and Apple sign-in** refuse to run in WebViews and Electron. Users sign in with their Reddit username and password. Say so in the app's README section.
- **Clipboard:** `copyText()` uses `navigator.clipboard` from inside an iframe. It may be refused in a WebView, which shows the "Copy is not available here" toast. If so, add a host capability.
- **Back navigation:** the reader keeps its own back stack, and nothing outside the frame can pop it yet. The Android back button needs a new host-to-reader event. Design it in `types.ts`, for example `ReaderHost.onBack(listener): void` returning whether the press was handled.
- **The reader's own UI** (iframe `allow="clipboard-write; fullscreen"`, the "Original Reddit" button, and `setBottomInset`) runs inside the page and keeps working unchanged.
- **The content script expects to run once the page has loaded** (`document_idle` in the extension). If you inject it at document start, wrap it so it runs on `DOMContentLoaded`.

## Android app (WebView)

Target: `apps/android/`, a Gradle project in Kotlin using `androidx.webkit`. It'll be distributed by sideloading the APK. Google Play's policies on apps that wrap another company's website make a listing unlikely. `APK/` is already git-ignored, so keep build outputs out of the repository.

Suggested design:

1. **One activity with one `WebView`** loading `https://www.reddit.com/`.
   - Enable JavaScript and DOM storage.
   - Use `CookieManager.setAcceptCookie(true)` and persist cookies, since they are the Reddit session.
   - Set `setSupportMultipleWindows(true)` and handle `onCreateWindow` according to the new-window rules above.
   - Implement `onShowCustomView` so videos can go fullscreen.
2. **Serve the reader** with `WebViewAssetLoader` (`AssetsPathHandler`) at `https://appassets.androidplatform.net/assets/openrelay/`.
   - The Gradle build copies `dist/reader.html`, `dist/assets/` and `dist/content.js` there, after running `npm run build` from the repo root.
   - Route these requests in `shouldInterceptRequest`.
   - The reader origin is then `https://appassets.androidplatform.net`. Vite already emits relative asset paths (`base: "./"`).
3. **Inject into Reddit** with `WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("https://www.reddit.com", "https://old.reddit.com", "https://reddit.com"))`. Check `WebViewFeature.DOCUMENT_START_SCRIPT` first.
   - `script` defines `openRelayPageHost`, then runs `content.js` on `DOMContentLoaded`.
   - `readerUrl(hash)` returns `"https://appassets.androidplatform.net/assets/openrelay/reader.html#" + hash`.
   - `onToggle` keeps the listener so the app's toolbar or menu can call it with `evaluateJavascript`.
4. **Expose native storage and downloads to the reader only** with `WebViewCompat.addWebMessageListener(webView, "openRelayNative", setOf("https://appassets.androidplatform.net"), listener)`. Never use `addJavascriptInterface`, which exposes the object to every frame, including Reddit's.
   - A second document-start script, limited to the appassets origin, defines `openRelayReaderHost` as a small promise-based RPC over `openRelayNative.postMessage` and its `onmessage`.
   - **Storage:** a single JSON file or DataStore in app-private storage.
   - **`save({url})`:** `DownloadManager` into Downloads.
   - **`save({data})`:** write through MediaStore Downloads (API 29+). Videos can be tens of MB, so send them as ArrayBuffer web messages (`WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER`) or in chunks, not base64 in one message.
5. **Android is less isolated than the browsers.** Its content script runs in the page's main JavaScript world; Android has no isolated world. Reddit's own scripts share the globals, though not `content.js`'s private state. Reddit already holds the session, so this exposes nothing new. State it in the README's Android data section anyway.
6. **Back button:** `OnBackPressedDispatcher` should ask the reader to go back first, through the new host event, then fall back to `webView.goBack()`.

Verify in your session:

- `addDocumentStartJavaScript` also covers Reddit's SPA navigations. The content script itself polls `location.href` to remount.
- The appassets reader can use the web-message channel from inside a cross-origin iframe.
- `postMessage` origins come through as expected.

The test plan is a sideloaded debug build on a device or emulator against real Reddit, with your own account. Keep all Reddit actions to your own test content. Optionally, unit-test the JS shim in Node.

## Desktop app (Electron)

Target: `apps/desktop/`, with its own `package.json` and Electron as a dependency. Package it with Electron Forge or electron-builder.

Suggested design:

1. **Main window** loads `https://www.reddit.com/` in the persistent session `session.fromPartition("persist:openrelay")`. Use `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `nodeIntegrationInSubFrames: true`, so the preload also runs in the reader iframe.
2. **Serve the reader** from a privileged custom scheme. Call `protocol.registerSchemesAsPrivileged([{ scheme: "openrelay", privileges: { standard: true, secure: true, supportFetchAPI: true } }])` before `ready`. Then, in the partition's protocol, use `protocol.handle("openrelay", …)` to serve the copied `dist/` files. The reader origin is `openrelay://reader`, so `readerUrl(hash)` returns `"openrelay://reader/reader.html#" + hash`.
3. **Preload script** (one file, which branches on `location.origin`):
   - **On reddit.com frames:** after `DOMContentLoaded`, run `pageHostShim + content.js` in an isolated world, using `webFrame.executeJavaScriptInIsolatedWorld(<worldId>, [{ code }])`. This matches the extension's isolation. The page-host shim forwards the toggle from `ipcRenderer`.
   - **On the `openrelay://reader` frame only:** use `contextBridge.exposeInMainWorld("openRelayReaderHost", …)`, backed by `ipcRenderer.invoke`. Don't expose `ipcRenderer` itself.
4. **Main-process handlers** check `event.senderFrame.origin === "openrelay://reader"` and reject anything else.
   - **Storage:** a JSON file in `app.getPath("userData")`. Broadcast `onChanged` to other windows.
   - **`save({url})`:** `webContents.downloadURL(url)`, with a `will-download` handler to choose a save path.
   - **`save({data})`:** `dialog.showSaveDialog`, then `fs.writeFile`. A `Uint8Array` crosses IPC by structured clone.
5. **Toggle** is an application menu item with a shortcut (for example Ctrl/Cmd+Shift+R) that sends to the focused window's reddit frame.
6. **`setWindowOpenHandler`:**
   - Reddit URLs, including login, open in a new `BrowserWindow` in the same partition.
   - Anything else goes through `shell.openExternal`.
   - Deny everything else.

Verify in your session:

- Fetches from the isolated world are same-origin with the page and carry its cookies. Watch for `sec-fetch-site: same-origin` and votes reaching `/api/vote` with the modhash. If they aren't, run `content.js` in the main world as Android does, and document it.
- `postMessage` from `openrelay://reader` arrives with that exact origin.

Results (branch `feat/desktop-app`, Electron 45, against fixtures):

- The content script's requests carry the page's cookies, and its POSTs carry `Origin: https://www.reddit.com`. A vote reached `/api/vote` with the modhash. `sec-fetch-site` can't be observed: Playwright fulfils routed requests before the network stack adds it. The isolated world needs `setIsolatedWorldInfo` with a CSP of its own and `securityOrigin: location.origin`. Without its own CSP, Reddit's CSP blocks the content script's shadow-DOM `<style>`, which Chrome allows for extensions.
- Bridge messages reach the page with origin `openrelay://reader`, and responses are accepted by the reader.
- Not settled: the reader's own requests to reddit.com (images) carry Reddit's `SameSite=None` cookies, as an extension frame's do when third-party cookies are allowed. CORS still keeps the reader from reading Reddit's responses, and the smoke test checks that.

Testing: Playwright can launch Electron (`_electron.launch`). The existing suites in `tools/*-smoke.mjs` serve fixture Reddit pages and assert on exact write requests. Port `browser-smoke.mjs` first, so the desktop app gets the same guarantees without ever contacting real Reddit.

## When you finish a piece

- Add the app's commands to CLAUDE.md's Commands section and its layout to Architecture.
- Add install steps and a "Data and permissions" section for the app to the README.
- Keep `npm run check` passing. New unit tests go in a folder covered by the `test` script in `package.json`, and the README's test count changes with them.
- Don't commit build outputs, signing keys or keystores. Add their paths to `.gitignore`.

## Starting prompts

Paste one of these into a new chat opened in this repository. If both chats run at the same time, give each its own git worktree so their branch switches don't collide.

> Read `docs/handover-android-electron.md` and CLAUDE.md, then start the **Android app** in `apps/android/` following the Android section. Begin by creating a branch `feat/android-app` from `feat/host-adapter` (or `master` if it's merged) and confirming `npm run check` passes.

> Read `docs/handover-android-electron.md` and CLAUDE.md, then start the **desktop app** in `apps/desktop/` following the Electron section. Begin by creating a branch `feat/desktop-app` from `feat/host-adapter` (or `master` if it's merged) and confirming `npm run check` passes.
