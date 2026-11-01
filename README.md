# OpenRelay for Reddit/Lemmy

A project inspired by **Relay for Reddit**, the Android app by DBrandy. It replaces Reddit's interface with a Relay-style reader: React screens, design tokens, cards, compact/list layouts, themes, comment rails, sheets, drawer, Markdown renderer, gestures, and media viewer.

OpenRelay runs as:

- a **browser extension** for Chrome and Firefox, which also installs in Edge Canary on Android;
- a **desktop app** for Windows, macOS and Linux;
- an **Android app**.

All of them run the same reader and the same code for talking to Reddit. Each one shows Reddit's own site with the reader on top, and uses your Reddit session from that site. There's no OpenRelay server and no API key.

<img width="1645" height="990" alt="image" src="https://github.com/user-attachments/assets/86a7fe14-74a2-4cf4-9aed-b81fe559c4f6" />

## Downloads

Release packages are on the [Releases page](https://github.com/cwtf/OpenRelay/releases): the Windows installer and portable exe, the Android APK, the Chrome extension (`.zip` and signed `.crx`) and the Firefox add-on. All but the exes, which are too large for the repository, are also in **releases/**: **releases/chrome/**, **releases/firefox/** and **releases/android/**. `npm run build:apps` rebuilds all of them (`-- chrome`, `-- firefox`, `-- exe` or `-- apk` for some), and `-- --publish` uploads them to the release for the current version.

## Install in Chrome

The built extension is in **dist/**, or unzip **releases/chrome/OpenRelay-*-chrome.zip** and use that folder.

1. Open **chrome://extensions** in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this project's **dist** folder.
4. Open or refresh a Reddit page. Existing tabs need a refresh after installation.
5. Pin **OpenRelay for Reddit/Lemmy** if you want a toolbar toggle.

Click **Original Reddit** at the bottom left to restore the loaded page. Click the extension toolbar icon to reopen the reader. Native mode persists during navigation in that document; Reddit links opened through voting/reply actions include `openrelay=off` to keep their controls visible.

## Install in Firefox

`npm run build` also writes a Firefox copy of the extension to **dist-firefox/** (Firefox 140 or later).

1. Open **about:debugging#/runtime/this-firefox** in Firefox.
2. Click **Load Temporary Add-on…** and select **dist-firefox/manifest.json**.
3. Open or refresh a Reddit page.

**releases/firefox/OpenRelay-*-unsigned.xpi** is the same add-on packed for signing or for **Load Temporary Add-on…**. Firefox removes temporary add-ons when it restarts. To keep it installed, have Mozilla sign it, for example with `web-ext sign` as an unlisted add-on on addons.mozilla.org. Firefox for Android (142 or later) also installs only signed add-ons. The add-on ID, `openrelay-reddit@cwtf`, is set in `tools/build.mjs`; keep it unchanged once the add-on is published, or updates won't reach existing installs.

## Install in Edge Canary on Android

Microsoft Edge Canary for Android can sideload extensions from a `.crx` file, so the extension also runs on Android, as an alternative to the [Android app](#android-app).

1. Use **releases/chrome/OpenRelay-*.crx**. To pack it yourself, `npm run build:apps -- chrome` signs it with **dist.pem** in the repo root. Without that key, pack **dist** in **chrome://extensions** with **Developer mode** on (**Pack extension**); Chrome writes **dist.crx** and a new private key, **dist.pem**, next to the folder. Keep the key to sign later updates, and don't share it.
2. Copy the `.crx` to your phone.
3. Install **Microsoft Edge Canary** from Google Play.
4. In Edge Canary, open **Settings → About Microsoft Edge** and tap the build number repeatedly until developer options are enabled.
5. Go back to **Settings**, open **Developer options** and tap **Extension install by crx**. Pick the `.crx` and confirm the install.
6. Open or refresh a Reddit page. The extension appears in Edge's **Extensions** menu, where you can toggle the reader.

To update, install the new `.crx` the same way. It must be signed with the same **dist.pem** (`build:apps` does that; Chrome's **Pack extension** dialog has a **Private key file** field).

## Desktop app (Windows, macOS, Linux)

**apps/desktop/** wraps OpenRelay in Electron: a Reddit window with the reader on top, as in a browser tab with the extension.

On Windows, download **OpenRelay-*-setup.exe** or the single-file **OpenRelay-*-portable.exe** from the [Releases page](https://github.com/cwtf/OpenRelay/releases). Builds for macOS and Linux aren't published, so build those yourself, as described below.

To run it from source:

```sh
npm ci
cd apps/desktop
npm ci
npm run build
npm start
```

`npm run build` builds the shared code at the repository root and copies `reader.html`, `assets/` and `content.js` into **apps/desktop/openrelay/**.

To package it, run `npm run dist` in **apps/desktop/**. It uses electron-builder to build for the platform you run it on. On Windows that is an installer, **release/OpenRelay-0.3.0-setup.exe** (per user, no administrator rights needed), and a single-file **release/OpenRelay-0.3.0-portable.exe**. On macOS it is a `.dmg`, and on Linux an AppImage. The builds aren't code-signed, so Windows SmartScreen warns on first run (**More info → Run anyway**), and macOS needs right-click → **Open**. The app uses OpenRelay's blue Rounded Tail icon. Packaged builds turn on Electron's security fuses. They can't be run as Node or debugged through Node's inspector, they load the app only from its integrity-checked `app.asar`, and they encrypt the cookie store with the operating system's key store. [docs/packaging-desktop.md](docs/packaging-desktop.md) walks through packaging step by step, including `.deb` packages, building for macOS and Linux, signing, icons and troubleshooting.

Sign in to Reddit inside the app, with your Reddit username and password. Google and Apple sign-in refuse to run in embedded browsers such as Electron. **View → Toggle OpenRelay / Original Reddit** (Ctrl+Shift+R, or Cmd+Shift+R on macOS) replaces the extension's toolbar button. Reddit links, including the login page, open in another app window with the same session; other links open in your default browser.

## Android app

**apps/android/** wraps OpenRelay in an Android app (Android 10 or later): Reddit in one WebView, with the reader in a second WebView over it. Reddit's CSP doesn't allow the reader's origin as an iframe, so the app shows the reader itself and relays the bridge's messages between the two views.

To install it, copy **releases/android/OpenRelay-*.apk** to your phone and open it. Android asks you to allow installs from the app you opened it with (your file manager or browser). The app isn't on Google Play.

A button at the bottom left switches between **OpenRelay** and **Original Reddit**. Sign in to Reddit inside the app, with your Reddit username and password; Google and Apple sign-in refuse to run in WebViews. Reddit links load in the app, with the same session; other links open in your default browser.

The Android app is newer than the others, and not everything works yet:

- The back button goes back in Reddit's history, not the reader's own back stack.
- Videos can't go fullscreen.
- It has been checked against real Reddit signed out only.

To build it from source you need the Android SDK and a JDK. Build the shared code first; the Gradle build copies `reader.html`, `assets/` and `content.js` from **dist/** into the app:

```sh
npm ci
npm run build
cd apps/android
./gradlew assembleDebug
```

The debug APK is **apps/android/app/build/outputs/apk/debug/app-debug.apk**. `npm run build:apps -- apk` builds the signed release APK into **releases/android/** instead. It needs **apps/android/keystore.properties** (copy **keystore.properties.example**; neither it nor the `.jks` keystore goes in git), or add `-- --debug` for a debug APK.

## Removed threads

A post removed by its community's moderators (or by Reddit) shows a **Restore from archive** bar in place of its text, and a thread whose comments were removed shows the bar above the comments. Nothing is fetched until you press it: it then loads the post and the removed comments from [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift), a community archive that saves Reddit posts and comments within minutes of posting, and shows them in place with an **ARCHIVE** badge. Votes, scores and replies stay Reddit's, and **Show removed** switches back. Posts and comments deleted by their authors are left as they are. When Reddit won't show a thread at all (removed by Reddit, or a private or banned community), the post screen offers the same button and rebuilds the whole thread from the archive as a read-only copy, sorted by Top, New or Old, with scores as they were when archived. If the archive has no copy, or can't be reached, the post screen says so.

## Saved GIFs and images

Tap a GIF or image in a comment or post to open it, then press the star to save it for your own replies. The composer's star button lists what you saved; pick one to add it to the reply, and the × on a tile removes it. On Reddit, a Giphy GIF goes back in by its Giphy ID, as Reddit's own GIF picker sends it, and an image or GIF on Reddit's image hosts by Reddit's ID for it (taken from the comment, or from the file name of an i.redd.it or preview.redd.it link, as Reddit's apps write a comment's image), so nothing is uploaded again. Images linked from anywhere else (Imgur, for example) are fetched again and uploaded as a new attachment, which Reddit may refuse. On Lemmy, the reply links the image itself. A community's rules can turn off GIFs or images in comments: the composer offers only what the community takes, and hides the image button when it takes neither. Only the list of links is saved, on this device (up to 200), shared between Reddit and your Lemmy instances. An image deleted from its original comment can't be posted again.

## Offline reading

Posts can be saved to read later without a connection. Choose **Save for offline** in a post's menu (⋮, or a long press on its card), or **Save feed for offline** in the main menu to save posts from the feed you're looking at. It saves the next 10, 25, 50 or 100 posts you haven't saved yet (your choice is remembered), skipping hidden ones and reading further down the feed when the posts already loaded run out, so saving again continues where the last save stopped. Choose **With images and videos** (as set in Settings), **Text only** (posts and comments, no images or videos), or **Text posts only** (only the feed's text posts, as text). Each post is saved with its first 200 comments, one post a second to stay within Reddit's rate limit, and with the images it shows from Reddit's image hosts (i.redd.it, preview.redd.it, external-preview.redd.it and Reddit's thumbnail hosts): the post's own pictures and gallery, link previews, and images in comments, up to 40 images, 10 MB each and 40 MB a post. The extension asks for access to those hosts the first time you save; without it, posts are saved without images. A Reddit-hosted video is saved too, joined with its sound as the download button does it, up to 40 MB when you save a single post or 15 MB per video when you save a feed; larger videos are left out. Offline, the saved video plays without streaming. **Save images** and **Save videos** under **Offline reading** in Settings turn either off for every save; with images off, the extension never asks for the image hosts. **Saved for offline** in the main menu lists them. A saved post's menu can update (save again) or remove its copy, and the list's trash button removes them all.

Without a connection, OpenRelay opens the saved list on its own:

- **Extension:** click the toolbar icon on a tab where Reddit didn't load, or on any other site. The list opens in a new tab.
- **Desktop app:** when Reddit doesn't load, the window shows the list. **View → Saved for Offline** opens it at any time.
- **Android app:** when Reddit doesn't load, the app shows the list. **Try Reddit** reloads Reddit.

The list's globe button opens Reddit again. When Reddit is reachable but refuses a post you saved, the post screen shows the saved copy. Videos and images hosted elsewhere (YouTube, Imgur, Giphy), "more comments" and voting or replying still need Reddit.

## Lemmy

OpenRelay can also read [Lemmy](https://join-lemmy.org/) instances (Lemmy 0.19's API), with the same cards, comment threads, media viewer and dual-pane layout. The top of the main menu shows the site you're reading; tap it for your other sources: Reddit, lemmy.world (listed from the start; remove it if you don't use it), and any other Lemmy instances you add with **Add Lemmy instance** (an address like `lemmy.ml`, a link to one of its pages, or a `!community@instance` handle). The extension asks for access to an instance the first time you open it (the desktop and Android apps don't need to ask), then opens on its front page, its communities (`/c/name`, `/c/name@instance`), its posts and its search, as it does on Reddit; **Original Lemmy** and the toolbar icon switch back to the instance's own pages. Choosing a source loads its front page in the same tab; the × next to an instance removes it and gives up the access.

On Lemmy you use the account you're signed in with on the instance's own site: its Home feed, All and Local, your followed communities, community sidebars and moderators, profiles, and post and community search. You can vote, reply (with images and GIFs), edit and delete your comments, save, follow communities and post. The inbox shows replies to your posts and comments, mentions and private messages; opening it marks nothing read, and you can answer, send and delete messages. Communities are shown as `c/name` and people as `@name` (with `@instance` when they're from another one); Lemmy's `::: spoiler` sections are folded, and `!community@instance` and `@user@instance` are links. Links to the instance's own posts and communities open in the reader; other links open as usual. Posts can be saved for offline reading. Moderation isn't supported yet, and the menu leaves out what isn't. **Restore from archive** is Reddit-only.

**Hybrid** (Reddit's front page with each listed instance's Local feed mixed in) is turned off for now and isn't offered in the source list: its Lemmy posts could only be read signed out from Reddit, so opening one left Reddit for the instance.

## Data and permissions

### Browser extension

A Manifest V3 content script runs only on www.reddit.com, reddit.com and old.reddit.com, and on the Lemmy instances you add. It embeds the bundled reader in an extension-origin iframe, keeping the reader's styles separate from Reddit's. The page bridge accepts messages only from that reader frame and permits only a narrow list of read-only JSON routes, read-only vote-state queries, and a validated vote for a specific post/comment ID and direction (a forwarded click, or `/api/vote` when no control is on the page). The source switcher can send the tab only to Reddit's front page, or to the front page of an https host name or one of its `/post/<n>`, `/comment/<n>`, `/c/<name>` or `/u/<name>` pages (where the hybrid feed's Lemmy posts, communities and people open), never to another page. Page-origin messages cannot invoke these operations.

No API key, server, browsing-history permission, or third-party analytics are needed. The permissions are `storage`, `unlimitedStorage` so that posts saved for offline reading aren't limited to Chrome's 10 MB (Chrome shows no prompt for it; Firefox lists it when installing), and `scripting`, to run OpenRelay on the Lemmy instances you add. Opening or adding an instance asks for the optional host permission for that one instance (lemmy.world is listed by default but gets no access until you open it) (the manifest lists `https://*/*` as optional so any instance can be asked for); removing it gives the permission up. On an instance, requests go only to that instance's own API, same-origin with its pages and its sign-in, and the bridge permits only a narrow list of read-only API routes (`allowedApiPath()` in `src/providers/lemmy/lemmy.ts`) and a fixed set of validated writes (`src/providers/lemmy/writes.ts`), for posts and comments on that instance only. lemmy-ui's sign-in token is read from its cookie in the content script and sent only to the instance; it never reaches the reader. The hybrid feed (turned off for now) is the one exception to going through the tab: in the Reddit tab, the reader reads each listed instance's Local feed straight from its API (only the routes on the same allowlist), without cookies or a sign-in. Lemmy's API allows that from any origin. Because a Lemmy instance can be any https site, the reader page (`reader.html`) can be loaded by any https page, which lets a page detect that OpenRelay is installed; the reader refuses to show or request anything for a site that isn't Reddit or one of your instances. Saving posts for offline reading asks for the optional host permission for Reddit's image hosts (i.redd.it, preview.redd.it, external-preview.redd.it, a.thumbs.redditmedia.com and b.thumbs.redditmedia.com), so the reader can fetch the images to keep; those requests carry no cookies or referrer. Declining it saves posts without images. The media viewer's download button asks for the optional `downloads` permission the first time you use it, because Reddit's image hosts don't let the reader fetch images itself. Declining it leaves the button unused; right-click → **Save image as…** still works for images without it. Reddit keeps a video's sound in a separate file, so a video download fetches both from v.redd.it and joins them into one MP4 in the reader, without re-encoding. Requests use the Reddit tab's normal same-origin session; the subscription list, profiles, inbox, moderation queues, friends and community rules come from Reddit's read-only JSON listings and need you to be signed in to Reddit. The inbox is read with `mark=false`, so opening it does not mark messages read. If Reddit refuses its JSON search, the reader loads Reddit's own search page with the tab's session, keeps only the post IDs, and loads those posts from `/api/info.json`, or from each post's own page if that is refused too. An image or GIF you attach to a reply (PNG, JPEG, GIF or WebP, up to 20 MB) is uploaded by the Reddit tab as Reddit's own uploader does: Reddit leases the upload, and the file goes, with no cookies or referrer, to Reddit's storage bucket at `reddit-uploaded-media.s3-accelerate.amazonaws.com` (Amazon S3), the only host a lease is allowed to name; the reply then refers to it by Reddit's asset ID. On Lemmy it goes to the instance's own image server (`/pictrs/image`). Either way the file is sent as `image.png` (or `.jpg`, `.gif`, `.webp`), so its own name stays on your device. A saved GIF or image you post again is fetched from where it was shown (Reddit's image hosts, which ask for the same optional host permission as offline images, or the image's own host, without cookies or referrer) and uploaded the same way; on Reddit, a saved Giphy GIF, or an image uploaded to a comment, is sent by its ID, with nothing fetched. Nothing is sent to any server other than Reddit, with two exceptions. Reddit often has no copy of a Giphy GIF posted in a comment, so the reader loads that GIF from `i.giphy.com`, which sees your IP address but no referrer or Reddit data. Turn off **Load GIFs from Giphy** in Settings to show those GIFs as links instead. **Restore from archive** on a removed post sends that post's ID, and the IDs of its removed comments, to Arctic Shift (`arctic-shift.photon-reddit.com`), only when you press it; those requests carry no cookies, referrer or Reddit data. Preferences, favourites, the cached subscription list and read/hidden markers are kept in `chrome.storage.local`, because Chrome denies `localStorage` to the reader frame when third-party cookies are blocked. Values saved in `localStorage` by earlier versions are imported on first run. Posts saved for offline reading are kept there too, under their own `openrelay-offline:` keys, and only on this device.

Chrome's content-script model is documented at:
[Content scripts — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

### Desktop app

The desktop app runs the same reader and content script, with the same bridge, allowlists, Giphy exception and archive button, and sends nothing anywhere else: no analytics, no update checks. Reddit's cookies live in the app's own session, separate from your browsers, in the app's user-data folder (`%APPDATA%\OpenRelay` on Windows, `~/Library/Application Support/OpenRelay` on macOS, `~/.config/OpenRelay` on Linux). Preferences, favourites, the cached subscription list and read/hidden markers are kept in `openrelay-storage.json` in the same folder, and posts saved for offline reading in its `offline` folder. The app fetches their images itself, from Reddit's image hosts only, without cookies.

The content script runs in its own isolated JavaScript world in the Reddit window, as an extension's does, so Reddit's scripts can't reach it, and the session modhash stays inside it. The reader is served from the app's own `openrelay://reader` origin. Only that origin gets the app's storage and download channels; the main process checks the sender's origin for each request. Reddit pages get only the content script. Pages in the app may write to the clipboard (the reader's Copy) and go fullscreen (videos); every other permission request is refused. Downloads open a save dialog and go where you choose.

### Android app

The Android app runs the same reader and content script, with the same bridge, allowlists, Giphy exception and archive button, and sends nothing anywhere else. Its only permission is `INTERNET`. Reddit's cookies live in the app's own WebView cookie store, separate from your browsers. Preferences, favourites, the cached subscription list and read/hidden markers are kept in `openrelay-storage.json` in the app's private storage, and posts saved for offline reading in its `offline` folder, both excluded from Android backups. The app fetches their images itself, from Reddit's image hosts only, without cookies. The media viewer's download button saves into your Downloads folder: images through Android's download manager, which fetches them without cookies and shows its own notification, and Reddit videos, joined with their sound in the reader, written there by the app. Neither needs a storage permission.

The reader is served from the app's own `https://appassets.androidplatform.net` origin, answered from the APK and never from the network, and its WebView doesn't send Reddit's cookies. The app gives each WebView one message channel: Reddit's channel only to Reddit's top frame, and the reader's only to the reader's origin. Only the reader's channel reaches storage. Android's WebView has no isolated worlds, so unlike the browsers and desktop app, the content script runs in Reddit's own JavaScript world. It starts before Reddit's scripts, takes its channel off the global object and locks its host in place, and the session modhash stays inside the content script. Reddit's scripts already hold your session, so this exposes nothing new to them.

## Limits

Reddit can block or rate-limit its JSON endpoints. Reading the currently loaded feed still works when its markup is available; direct post pages fall back to loaded text/comments with a notice. Fresh feeds, search, more comments, and full media details require Reddit to return data. DOM fallback contains only loaded material and may lose Markdown formatting or media details.

Reddit-hosted videos use HLS streaming to play their separate audio and video tracks together. If streaming fails, the viewer falls back to the MP4 and shows **Audio unavailable**; that fallback may have no sound. Videos without a playlist use their MP4 directly. The reader opens on feed, post and search pages. It has its own profile, inbox, moderator and friends screens, but Reddit's own pages for those, and settings, stay native when you open them directly. The address bar keeps the original Reddit URL while navigating inside the reader; use Share/Copy link for the selected post. Original Reddit returns to the original page.

The reader has its own in-frame back stack; complete browser forward-history restoration across reader screens is not implemented.

## Development

Requires Node 24+.

```sh
npm ci
npm run check
```

This runs TypeScript, 132 unit tests, and the production build (**dist/** for Chrome, **dist-firefox/** for Firefox). Reload the extension in Chrome after rebuilding.

An additional Chromium test loads the **real built extension** into an isolated browser profile and uses deterministic Reddit HTML/JSON fixtures. With Playwright and its Chromium installed:

```sh
npm run test:browser
```

Set `PLAYWRIGHT_MODULE` to a Playwright module URL or `CHROMIUM_PATH` to an installed Chromium executable when using shared tooling. Test profiles/screenshots are written under ignored `test-results/`.

Vote tests additionally cover initial selection, undo/switch, rapid-click suppression, exact nested-comment ownership, API votes for reader-fetched comments (request body, modhash, reported vote, counts), signed-out handling, disabled controls, unconfirmed changes, delayed rollbacks, and rejection of page-origin spoofed messages, and check that `/api/vote` is the only write. All vote tests use instrumented fixtures; they cast no votes on Reddit.

The account test (`tools/account-smoke.mjs`) walks Profile, User, Compose, Inbox, Moderator, Friends and New Post against fixtures, checks each write's exact request body, and checks that only `/api/*` endpoints are written to and no tabs open.

The browser test profile blocks third-party cookies, to check that settings and favourites survive a reload.

The archive test (`tools/archive-smoke.mjs`) restores a removed post and its removed comments, and rebuilds a thread Reddit refuses, against fixture archive answers. It checks that nothing reaches the archive until **Restore from archive** is pressed, that only the IDs go there (no cookies or referrer), that authors' deletions stay deleted, and the not-in-archive and unreachable messages.

The Lemmy test (`tools/lemmy-smoke.mjs`) adds a Lemmy instance from the source switcher, checks that the content script is registered there, reads a feed, a post with its comment tree, a spoiler and a `!community` link from fixture Lemmy API answers, votes and replies (checking each request body and the sign-in token), opens the inbox without marking it and marks a message read, leaves a bot check alone, switches back to Reddit, checks that Hybrid isn't offered and that Reddit's front page shows no Lemmy posts and makes no Lemmy reads, checks that a site that wasn't added can't use the reader, and removes the instance.

The media test (`tools/media-smoke.mjs`) opens tall, wide and tiny images in the media viewer and checks that each is scaled to fit the screen.

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
- `src/providers/` — what's specific to each site OpenRelay reads: for Reddit (`reddit/`), its normalization, DOM extraction, search fallback, votes and writes; for Lemmy (`lemmy/`), its API normalization and routes; each site's halves of the page bridge; and the hybrid feed's merge (`hybrid.ts`).
- `src/extension/` — message bridge, content script, source switcher checks and toolbar worker.
- `src/hosts/` — what the reader and content script need from the app running them (storage, downloads, reader URL, toggle), with the browser-extension implementation.
- `public/manifest.json` — extension manifest.
- `tools/build.mjs` — extension build, for Chrome and Firefox.
- `tools/build-apps.mjs` and `tools/extension-packages.mjs` — release packages for every platform, and the Chrome zip and signed `.crx`.
- `tools/*-smoke.mjs` — browser integration checks (browser, vote, account, media, video, offline and archive), with fixtures in `tools/fixtures/`.
- `apps/desktop/` — the Electron desktop app (`src/main.js`, `src/preload.cjs`) and its smoke tests.
- `apps/android/` — the Android app (`MainActivity.kt`, and the `page-host.js` and `reader-host.js` shims in its assets).
- `assets/branding/` — the Rounded Tail speech-bubble/R icon; `tools/build-icons.py` generates every platform's icons from it.
- `releases/` — the official packages, one folder per platform.
- `docs/` — guides to packaging the desktop app and to the wrapper apps' design.
