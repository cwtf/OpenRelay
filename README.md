# OpenRelay for Reddit — Chrome extension

Render Reddit pages with the **actual interface from the neighboring OpenRelay project**: its React screens, design tokens, cards, compact/list layouts, themes, comment rails, sheets, drawer, Markdown renderer, gestures, and media viewer.

## Install

The built extension is in **dist/**.

1. Open **chrome://extensions** in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this project's **dist** folder.
4. Open or refresh a Reddit page. Existing tabs need a refresh after installation.
5. Pin **OpenRelay for Reddit** if you want a toolbar toggle.

Click **Original Reddit** at the bottom left to restore the loaded page. Click the extension toolbar icon to reopen the reader. Native mode persists during navigation in that document; Reddit links opened through voting/reply actions include `openrelay=off` to keep their controls visible.

## What works

- Home, subreddit, popular/all and supported sorted feeds on www.reddit.com, reddit.com and old.reddit.com.
- Initially reads posts already present in the loaded page; supports current Reddit's `shreddit-post` and old Reddit's post markup.
- Direct post and search URLs, feed sorting and time ranges, search and pagination through Reddit's same-origin JSON endpoints.
- Post Markdown, nested comments, collapse, comment search/navigation, and additional replies where Reddit returns them.
- OpenRelay image/gallery/video presentation, NSFW/spoiler blur, local read/hidden markers, and settings. Settings changes save automatically and apply to every open Reddit tab.
- Your subscribed communities load automatically into the drawer, alphabetically, in a Relay-style list: round community icons, collapsible Feeds / Favourites / Recent / Subscriptions sections, a star to pin favourites, a re-sync button, and a search pill that filters the list or opens a typed community. The list is kept for 30 minutes between syncs.
- Cards, Compact and List layouts; Auto, Light, Dark and Black themes.
- One-click restoration of Reddit's original page. Unsupported pages (settings, login, profiles, messages, moderation) stay native. Recognized challenge screens stay native too.

**Vote arrows forward one click to the matching native Reddit vote control**, using the page’s signed-in session. Upvote, downvote, undo, and switching votes are supported when the native control is loaded and exposes its state. Current and old Reddit controls are supported, including open shadow roots. Buttons pause while a click is pending; the reader mirrors Reddit’s displayed selection/count and later rollbacks. This reflects Reddit’s UI, not an independent server acknowledgment.

If the control is absent, disabled, inaccessible, or does not change state, an explicit **Vote on Reddit** link appears. There are no automatic retries or redirect popups. Posts/comments fetched only inside the reader may lack native controls and need this fallback. Replies still open Reddit’s editor. The extension does not read authentication tokens, send vote API requests, request OAuth access, or use Devvit's app account. Settings stay local to the browser; Reddit account preference syncing is not included.

## Data and permissions

A Manifest V3 content script runs only on the three Reddit hosts above. It embeds the bundled reader in an extension-origin iframe, keeping OpenRelay's styles separate from Reddit's. The page bridge accepts messages only from that reader frame and permits only a narrow list of read-only JSON routes, read-only vote-state queries, and validated single-click vote forwarding for a specific post/comment ID. Page-origin messages cannot invoke these operations.

No API key, server, extra host permissions, browsing-history permission, or third-party analytics are needed. The only permission is `storage`. Requests use the Reddit tab's normal same-origin session; the subscription list comes from Reddit's read-only `/subreddits/mine/subscriber.json` and needs you to be signed in to Reddit. Nothing is sent to an OpenRelay server. Preferences, favourites, the cached subscription list and read/hidden markers are kept in `chrome.storage.local`, because Chrome denies `localStorage` to the reader frame when third-party cookies are blocked. Values saved in `localStorage` by earlier versions are imported on first run.

Chrome's content-script model is documented at:
[Content scripts — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

## Limits

Reddit can block or rate-limit its JSON endpoints. Reading the currently loaded feed still works when its markup is available; direct post pages fall back to loaded text/comments with a notice. Fresh feeds, search, more comments, and full media details require Reddit to return data. DOM fallback contains only loaded material and may lose Markdown formatting or media details.

Reddit-hosted MP4 fallback streams may have no audio. Account/profile/moderation screens remain native. The address bar keeps the original Reddit URL while navigating inside the reader; use Share/Copy link for the selected post. Original Reddit returns to the original page.

The inherited reader has its own in-frame back stack; complete browser forward-history restoration across reader screens is not implemented.

## Development

Requires Node 24+.

```sh
npm ci
npm run check
```

This runs TypeScript, 27 unit tests, and the production build. Reload the extension in Chrome after rebuilding.

An additional Chromium test loads the **real built extension** into an isolated browser profile and uses deterministic Reddit HTML/JSON fixtures. With Playwright and its Chromium installed:

```sh
npm run test:browser
```

Set `PLAYWRIGHT_MODULE` to a Playwright module URL or `CHROMIUM_PATH` to an installed Chromium executable when using shared tooling. Test profiles/screenshots are written under ignored `test-results/`.

Vote tests additionally cover initial selection, undo/switch, rapid-click suppression, exact nested-comment ownership, disabled/missing controls, unconfirmed changes, delayed rollbacks, and rejection of page-origin spoofed messages. All vote tests use instrumented fixtures; they cast no votes on Reddit.

The browser test profile blocks third-party cookies, to check that settings and favourites survive a reload.

Validated: injection, loaded-page feeds, settings persistence, the subscriptions drawer, nested comments, direct posts, layouts, themes, toolbar restore/reopen, excluded pages, JSON-denied fallback. A live public Reddit check reached Reddit's humanity challenge, so live signed-in behavior has not been verified.

## Source layout

- `src/client/` — OpenRelay's UI, copied from `../OpenRelay` and adapted locally.
- `src/shared/api.ts` — OpenRelay's presentation models.
- `src/extension/` — Reddit normalization, DOM extraction, message bridge, content script and toolbar worker.
- `public/manifest.json` — extension manifest.
- `tools/build.mjs` — independent extension build; no dependency on the sibling project at build/runtime.
- `tools/browser-smoke.mjs` and `tools/vote-smoke.mjs` — browser integration checks.

No files in the neighboring OpenRelay project are modified.
