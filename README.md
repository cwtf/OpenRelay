# OpenRelay for Reddit — Chrome extension

A project inspired by **Relay for Reddit**, the Android app by DBrandy. It replaces Reddit's interface with a Relay-style reader: React screens, design tokens, cards, compact/list layouts, themes, comment rails, sheets, drawer, Markdown renderer, gestures, and media viewer.

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

## Data and permissions

A Manifest V3 content script runs only on www.reddit.com, reddit.com and old.reddit.com. It embeds the bundled reader in an extension-origin iframe, keeping the reader's styles separate from Reddit's. The page bridge accepts messages only from that reader frame and permits only a narrow list of read-only JSON routes, read-only vote-state queries, and a validated vote for a specific post/comment ID and direction (a forwarded click, or `/api/vote` when no control is on the page). Page-origin messages cannot invoke these operations.

No API key, server, extra host permissions, browsing-history permission, or third-party analytics are needed. The only permission is `storage`. Requests use the Reddit tab's normal same-origin session; the subscription list, profiles, inbox, moderation queues, friends and community rules come from Reddit's read-only JSON listings and need you to be signed in to Reddit. The inbox is read with `mark=false`, so opening it does not mark messages read. Nothing is sent to any server other than Reddit. Preferences, favourites, the cached subscription list and read/hidden markers are kept in `chrome.storage.local`, because Chrome denies `localStorage` to the reader frame when third-party cookies are blocked. Values saved in `localStorage` by earlier versions are imported on first run.

Chrome's content-script model is documented at:
[Content scripts — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

## Limits

Reddit can block or rate-limit its JSON endpoints. Reading the currently loaded feed still works when its markup is available; direct post pages fall back to loaded text/comments with a notice. Fresh feeds, search, more comments, and full media details require Reddit to return data. DOM fallback contains only loaded material and may lose Markdown formatting or media details.

Reddit-hosted MP4 fallback streams may have no audio. Account/profile/moderation screens remain native. The address bar keeps the original Reddit URL while navigating inside the reader; use Share/Copy link for the selected post. Original Reddit returns to the original page.

The reader has its own in-frame back stack; complete browser forward-history restoration across reader screens is not implemented.

## Development

Requires Node 24+.

```sh
npm ci
npm run check
```

This runs TypeScript, 53 unit tests, and the production build. Reload the extension in Chrome after rebuilding.

An additional Chromium test loads the **real built extension** into an isolated browser profile and uses deterministic Reddit HTML/JSON fixtures. With Playwright and its Chromium installed:

```sh
npm run test:browser
```

Set `PLAYWRIGHT_MODULE` to a Playwright module URL or `CHROMIUM_PATH` to an installed Chromium executable when using shared tooling. Test profiles/screenshots are written under ignored `test-results/`.

Vote tests additionally cover initial selection, undo/switch, rapid-click suppression, exact nested-comment ownership, API votes for reader-fetched comments (request body, modhash, reported vote, counts), signed-out handling, disabled controls, unconfirmed changes, delayed rollbacks, and rejection of page-origin spoofed messages, and check that `/api/vote` is the only write. All vote tests use instrumented fixtures; they cast no votes on Reddit.

The account test (`tools/account-smoke.mjs`) walks Profile, User, Compose, Inbox, Moderator, Friends and New Post against fixtures, checks each write's exact request body, and checks that only `/api/*` endpoints are written to and no tabs open.

The browser test profile blocks third-party cookies, to check that settings and favourites survive a reload.

Validated: injection, loaded-page feeds, settings persistence, the subscriptions drawer, nested comments, direct posts, layouts, themes, toolbar restore/reopen, excluded pages, JSON-denied fallback. A live public Reddit check reached Reddit's humanity challenge, so live signed-in behavior has not been verified.

## Source layout

- `src/client/` — the reader UI.
- `src/shared/api.ts` — the reader's presentation models.
- `src/extension/` — Reddit normalization, DOM extraction, message bridge, content script and toolbar worker.
- `public/manifest.json` — extension manifest.
- `tools/build.mjs` — extension build.
- `tools/browser-smoke.mjs` and `tools/vote-smoke.mjs` — browser integration checks.
