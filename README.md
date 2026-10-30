# OpenRelay for Reddit — Chrome extension

A project inspired by **Relay for Reddit**, the Android app by DBrandy. It replaces Reddit's interface with a Relay-style reader: React screens, design tokens, cards, compact/list layouts, themes, comment rails, sheets, drawer, Markdown renderer, gestures, and media viewer.

<img width="1645" height="990" alt="image" src="https://github.com/user-attachments/assets/86a7fe14-74a2-4cf4-9aed-b81fe559c4f6" />

## Install

The built extension is in **dist/**.

1. Open **chrome://extensions** in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this project's **dist** folder.
4. Open or refresh a Reddit page. Existing tabs need a refresh after installation.
5. Pin **OpenRelay for Reddit** if you want a toolbar toggle.

Click **Original Reddit** at the bottom left to restore the loaded page. Click the extension toolbar icon to reopen the reader. Native mode persists during navigation in that document; Reddit links opened through voting/reply actions include `openrelay=off` to keep their controls visible.

## Install on Android (Edge Canary)

Microsoft Edge Canary for Android can sideload extensions from a `.crx` file.

1. Build the extension (see **Development**), then pack it on a desktop: in **chrome://extensions** with **Developer mode** on, click **Pack extension**, choose the **dist** folder and click **Pack extension**. Chrome writes **dist.crx** and a private key, **dist.pem**, next to the folder. Keep the key to sign later updates, and don't share it.
2. Copy **dist.crx** to your phone.
3. Install **Microsoft Edge Canary** from Google Play.
4. In Edge Canary, open **Settings → About Microsoft Edge** and tap the build number repeatedly until developer options are enabled.
5. Go back to **Settings**, open **Developer options** and tap **Extension install by crx**. Pick **dist.crx** and confirm the install.
6. Open or refresh a Reddit page. The extension appears in Edge's **Extensions** menu, where you can toggle the reader.

To update, repack **dist** with the same **dist.pem** (Chrome's **Pack extension** dialog has a **Private key file** field) and install the new **dist.crx** the same way.

## Install on Firefox

`npm run build` also writes a Firefox copy of the extension to **dist-firefox/** (Firefox 140 or later).

1. Open **about:debugging#/runtime/this-firefox** in Firefox.
2. Click **Load Temporary Add-on…** and select **dist-firefox/manifest.json**.
3. Open or refresh a Reddit page.

Firefox removes temporary add-ons when it restarts. To keep it installed, have Mozilla sign it, for example with `web-ext sign` as an unlisted add-on on addons.mozilla.org. Firefox for Android (142 or later) also installs only signed add-ons. The add-on ID, `openrelay-reddit@cwtf`, is set in `tools/build.mjs`; keep it unchanged once the add-on is published, or updates won't reach existing installs.

## Desktop app (Windows, macOS, Linux)

**apps/desktop/** wraps OpenRelay in Electron: a Reddit window with the reader on top, as in a browser tab with the extension. To run it from source:

```sh
npm ci
cd apps/desktop
npm ci
npm run build
npm start
```

`npm run build` builds the shared code at the repository root and copies `reader.html`, `assets/` and `content.js` into **apps/desktop/openrelay/**.

To package it, run `npm run dist` in **apps/desktop/**. It uses electron-builder to build for the platform you run it on. On Windows that is an installer, **release/OpenRelay-0.1.0-setup.exe** (per user, no administrator rights needed), and a single-file **release/OpenRelay-0.1.0-portable.exe**. On macOS it is a `.dmg`, and on Linux an AppImage. The builds aren't code-signed, so Windows SmartScreen warns on first run (**More info → Run anyway**), and macOS needs right-click → **Open**. The app uses OpenRelay's blue Open Thread icon. Packaged builds turn on Electron's security fuses. They can't be run as Node or debugged through Node's inspector, they load the app only from its integrity-checked `app.asar`, and they encrypt the cookie store with the operating system's key store. [docs/packaging-desktop.md](docs/packaging-desktop.md) walks through packaging step by step, including `.deb` packages, building for macOS and Linux, signing, icons and troubleshooting.

Sign in to Reddit inside the app, with your Reddit username and password. Google and Apple sign-in refuse to run in embedded browsers such as Electron. **View → Toggle OpenRelay / Original Reddit** (Ctrl+Shift+R, or Cmd+Shift+R on macOS) replaces the extension's toolbar button. Reddit links, including the login page, open in another app window with the same session; other links open in your default browser.

## Data and permissions

A Manifest V3 content script runs only on www.reddit.com, reddit.com and old.reddit.com. It embeds the bundled reader in an extension-origin iframe, keeping the reader's styles separate from Reddit's. The page bridge accepts messages only from that reader frame and permits only a narrow list of read-only JSON routes, read-only vote-state queries, and a validated vote for a specific post/comment ID and direction (a forwarded click, or `/api/vote` when no control is on the page). Page-origin messages cannot invoke these operations.

No API key, server, extra host permissions, browsing-history permission, or third-party analytics are needed. The only permission is `storage`. The media viewer's download button asks for the optional `downloads` permission the first time you use it, because Reddit's image hosts don't let the reader fetch images itself. Declining it leaves the button unused; right-click → **Save image as…** still works for images without it. Reddit keeps a video's sound in a separate file, so a video download fetches both from v.redd.it and joins them into one MP4 in the reader, without re-encoding. Requests use the Reddit tab's normal same-origin session; the subscription list, profiles, inbox, moderation queues, friends and community rules come from Reddit's read-only JSON listings and need you to be signed in to Reddit. The inbox is read with `mark=false`, so opening it does not mark messages read. If Reddit refuses its JSON search, the reader loads Reddit's own search page with the tab's session, keeps only the post IDs, and loads those posts from `/api/info.json`, or from each post's own page if that is refused too. Nothing is sent to any server other than Reddit, with one exception: Reddit often has no copy of a Giphy GIF posted in a comment, so the reader loads that GIF from `i.giphy.com`, which sees your IP address but no referrer or Reddit data. Turn off **Load GIFs from Giphy** in Settings to show those GIFs as links instead. Preferences, favourites, the cached subscription list and read/hidden markers are kept in `chrome.storage.local`, because Chrome denies `localStorage` to the reader frame when third-party cookies are blocked. Values saved in `localStorage` by earlier versions are imported on first run.

Chrome's content-script model is documented at:
[Content scripts — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

### Desktop app

The desktop app runs the same reader and content script, with the same bridge, allowlists and Giphy exception, and sends nothing anywhere else: no analytics, no update checks. Reddit's cookies live in the app's own session, separate from your browsers, in the app's user-data folder (`%APPDATA%\OpenRelay` on Windows, `~/Library/Application Support/OpenRelay` on macOS, `~/.config/OpenRelay` on Linux). Preferences, favourites, the cached subscription list and read/hidden markers are kept in `openrelay-storage.json` in the same folder.

The content script runs in its own isolated JavaScript world in the Reddit window, as an extension's does, so Reddit's scripts can't reach it, and the session modhash stays inside it. The reader is served from the app's own `openrelay://reader` origin. Only that origin gets the app's storage and download channels; the main process checks the sender's origin for each request. Reddit pages get only the content script. Pages in the app may write to the clipboard (the reader's Copy) and go fullscreen (videos); every other permission request is refused. Downloads open a save dialog and go where you choose.

## Limits

Reddit can block or rate-limit its JSON endpoints. Reading the currently loaded feed still works when its markup is available; direct post pages fall back to loaded text/comments with a notice. Fresh feeds, search, more comments, and full media details require Reddit to return data. DOM fallback contains only loaded material and may lose Markdown formatting or media details.

Reddit-hosted videos use HLS streaming to play their separate audio and video tracks together. If streaming fails, the viewer falls back to the MP4 and shows **Audio unavailable**; that fallback may have no sound. Videos without a playlist use their MP4 directly. Account/profile/moderation screens remain native. The address bar keeps the original Reddit URL while navigating inside the reader; use Share/Copy link for the selected post. Original Reddit returns to the original page.

The reader has its own in-frame back stack; complete browser forward-history restoration across reader screens is not implemented.

## Development

Requires Node 24+.

```sh
npm ci
npm run check
```

This runs TypeScript, 70 unit tests, and the production build (**dist/** for Chrome, **dist-firefox/** for Firefox). Reload the extension in Chrome after rebuilding.

An additional Chromium test loads the **real built extension** into an isolated browser profile and uses deterministic Reddit HTML/JSON fixtures. With Playwright and its Chromium installed:

```sh
npm run test:browser
```

Set `PLAYWRIGHT_MODULE` to a Playwright module URL or `CHROMIUM_PATH` to an installed Chromium executable when using shared tooling. Test profiles/screenshots are written under ignored `test-results/`.

Vote tests additionally cover initial selection, undo/switch, rapid-click suppression, exact nested-comment ownership, API votes for reader-fetched comments (request body, modhash, reported vote, counts), signed-out handling, disabled controls, unconfirmed changes, delayed rollbacks, and rejection of page-origin spoofed messages, and check that `/api/vote` is the only write. All vote tests use instrumented fixtures; they cast no votes on Reddit.

The account test (`tools/account-smoke.mjs`) walks Profile, User, Compose, Inbox, Moderator, Friends and New Post against fixtures, checks each write's exact request body, and checks that only `/api/*` endpoints are written to and no tabs open.

The browser test profile blocks third-party cookies, to check that settings and favourites survive a reload.

The video test (`tools/video-smoke.mjs`) uses a generated HLS clip with a separate audio playlist and verifies a decoded, non-silent audio signal, seeking, cleanup and reopening, silent video, GIF playback, and MP4 fallback after playlist/audio errors. The streaming library is bundled with the reader and loaded only for streamed videos. The desktop tests run the same video checks with `--desktop`.

The desktop app has its own port of the browser test, `apps/desktop/test/smoke.mjs`, which drives the real app through Playwright's Electron launcher against the same fixtures. A test-only hook gives it a throwaway profile under `test-results/` and cancels every request until the fixtures are in place. The port also checks that the content script's requests carry the page's session and origin, that bridge messages come from `openrelay://reader`, that neither host leaks into Reddit's page, that the reader can't read Reddit itself, the new-window rules, and that settings survive a restart. Build first, then:

```sh
cd apps/desktop
npm test
```

After `npm run dist` on Windows, `npm run test:packaged` checks the packaged build. It first starts the real **OpenRelay.exe** with a throwaway profile and its network sent to a dead proxy, connects over CDP, and checks against fixtures that the reader loads from `app.asar` and a vote is posted with the modhash. It then runs the full desktop test on the packaged `app.asar`.

Validated: injection, loaded-page feeds, settings persistence, the subscriptions drawer, nested comments, direct posts, layouts, themes, toolbar restore/reopen, excluded pages, JSON-denied fallback. A live public Reddit check reached Reddit's humanity challenge, so live signed-in behavior has not been verified.

## Source layout

- `src/client/` — the reader UI.
- `src/shared/api.ts` — the reader's presentation models.
- `src/extension/` — Reddit normalization, DOM extraction, message bridge, content script and toolbar worker.
- `src/hosts/` — what the reader and content script need from the app running them (storage, downloads, reader URL, toggle), with the browser-extension implementation.
- `public/manifest.json` — extension manifest.
- `tools/build.mjs` — extension build, for Chrome and Firefox.
- `tools/browser-smoke.mjs` and `tools/vote-smoke.mjs` — browser integration checks.
- `apps/desktop/` — the Electron desktop app (`src/main.js`, `src/preload.cjs`) and its smoke test.
