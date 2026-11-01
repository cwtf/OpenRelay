# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OpenRelay for Reddit/Lemmy replaces Reddit's (and Lemmy's) UI with a React reader modelled on the Android app Relay for Reddit. It ships as a Manifest V3 browser extension (Chrome and Firefox), an Electron desktop app (`apps/desktop/`) and an Android WebView app (`apps/android/`), all built from the same `dist/`. Many behaviours (pane rules, swipe actions, comment collapsing) intentionally copy Relay, and code comments often cite Relay's own logic.

## Commands

Requires Node 24+.

```sh
npm ci
npm run check          # type-check + unit tests + production build (the main gate)
npm run type-check     # tsc --noEmit
npm test               # unit tests (node:test, run on the .ts sources directly)
npm run build          # vite build into dist/ (Chrome) and dist-firefox/
npm run test:browser   # Playwright smoke tests against the built dist/ (build first)
npm run build:apps     # desktop exes, signed Android APK, Chrome .zip/.crx and unsigned Firefox .xpi into releases/<desktop|android|chrome|firefox>/ (name targets: `-- exe apk chrome firefox`; `-- --debug` for a debug APK; `-- --publish` uploads them to a draft GitHub Release v<version> with gh)
```

Run one unit test file, or one test by name:

```sh
node --experimental-strip-types --test src/client/lib/panes.test.ts
node --experimental-strip-types --test --test-name-pattern="modhash" src/providers/reddit/writes.test.ts
```

Run one browser suite with `node tools/vote-smoke.mjs` (or `browser-smoke`, `account-smoke`, `media-smoke`, `offline-smoke`, `archive-smoke`, `lemmy-smoke`). They need Playwright with Chromium. `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` override where those come from. They load the real `dist/` into a throwaway profile under `test-results/` with third-party cookies blocked, serve fixture Reddit HTML/JSON, and assert on the exact write requests sent. They never contact real Reddit.

The desktop app has its own `package.json` (Electron and Playwright) in `apps/desktop/`:

```sh
cd apps/desktop
npm ci
npm run build          # root build, then copies reader.html, assets/, content.js into apps/desktop/openrelay/
npm start              # run the app
npm test               # test/smoke.mjs: browser-smoke ported to Playwright's Electron launcher
npm run dist           # build, then package with electron-builder into release/ (Windows: NSIS setup + portable exe)
npm run test:packaged  # Windows, after dist: the real OpenRelay.exe offline over CDP, then smoke.mjs on its app.asar
```

Packaged builds set Electron fuses (`build.electronFuses` in `apps/desktop/package.json`), so the exe ignores `-r`, `--inspect` and `NODE_OPTIONS`. That's why `test/packaged-smoke.mjs` drives it over `--remote-debugging-port` with `--proxy-server` pointed at a dead port and `--user-data-dir` set to a throwaway profile, instead of using the test hook.

After rebuilding, reload the unpacked extension in `chrome://extensions` and refresh the Reddit tab. Until the extension is reloaded, the old content script keeps running and rejects new bridge actions with "Unsupported request". The reader shows that as a "reload the extension" message.

## Unit-test constraints

Unit tests run the TypeScript sources directly through Node's type stripping, with no bundler. So any module a test imports (and everything it imports) must use only erasable TS syntax: no enums, namespaces or constructor parameter properties. Its relative imports also need the explicit `.ts` extension (see `writes.ts` → `./votes.ts`). `tsconfig.json` excludes `*.test.ts` from type-checking. Tests that touch storage stub `globalThis.chrome` (see `storage.test.ts`).

## Architecture

The code runs in three contexts. `tools/build.mjs` builds them separately: the reader as a Vite app from `src/client/reader.html`, and `content.ts` and `background.ts` as standalone IIFE bundles. It then copies `public/manifest.json` into `dist/`, and copies `dist/` to `dist-firefox/` with a Firefox manifest (`background.scripts` in place of the service worker, plus `browser_specific_settings` with the add-on ID). Only the manifest differs between the two. The browser tests cover Chrome only.

1. **Content script** (`src/extension/content.ts`, Reddit page origin): mounts a full-screen closed-shadow-DOM host holding an iframe of `reader.html`, passing the page URL in the hash (`#source=…`). It marks the page `inert`, shows the "Original Reddit" exit button, and skips humanity/captcha gate pages. It polls `location.href` to remount on SPA navigation. It is also the **only** code that talks to Reddit: requests run same-origin with the user's session. Everything site-specific (routes, gate pages, the bridge actions) is the page provider's (see Providers).
2. **Reader** (`src/client/`, extension origin, inside the iframe): the React app. It can't reach Reddit directly. Every request goes through `bridge()` in `src/extension/bridge.ts`, a postMessage RPC to the parent page. Despite its folder, `bridge.ts` is imported by the reader.
3. **Service worker** (`src/extension/background.ts`): only forwards toolbar-icon clicks as `openrelay:toggle`.

### Providers

`src/providers/` holds everything specific to a site OpenRelay reads: Reddit (`reddit/`) and Lemmy (`lemmy/`, read-only, Lemmy 0.19's v3 API). `hosts.ts` says which provider a page URL belongs to (`providerOf`: Reddit's hosts, else any public https host is Lemmy); the bridge, the content script and the reader all choose by it. `types.ts` defines the two halves, one on each side of the bridge:

- `PageProvider` (content script): `parseRoute`, `isGatePage`, and `handle()`, which answers every bridge action except `navigate`. Reddit's is `reddit/page.ts` and Lemmy's `lemmy/page.ts`, picked by `providers/page.ts`.
- `ReaderProvider` (reader): the fetch functions (`fetchFeed`, `fetchPost`, `runAction`, …), which build bridge requests and normalize the answers into `shared/api.ts` models. Reddit's is `reddit/reader.ts` and Lemmy's `lemmy/reader.ts`, picked by `providers/reader.ts`. It also tells the UI about the site: `name`, `features` (writes, inbox, friends, moderation, wiki, archive; the UI hides the rest), `communityLabel` (`r/`, `c/`), `isCommunity`, `validCommunityName`, `communityUrl` and `loginUrl`, which `api.ts` exports as `site`.

`src/client/lib/api.ts` re-exports the reader provider's functions to the screens, and adds what doesn't depend on the site: the offline fallback in `fetchPost` and `openSource`. Some UI still assumes Reddit directly (`platform.ts`, `archive.ts`, the "open on Reddit" links, `client/lib/votes.ts`'s thing IDs).

### Lemmy

- IDs: Lemmy's numbers are only unique per instance, so posts and comments get `t3_<id>_<tag>` / `t1_<id>_<tag>` (`hostTag()` of the host). They pass the UI's `t3_`/`t1_` checks and are valid offline keys, and can't collide with Reddit's. Comments arrive flat with a `path`; `normalizeComments` builds the tree and sets `moreReplies` from `child_count`.
- Default: `DEFAULT_INSTANCES` (`["lemmy.world"]`, in `src/extension/sources.ts`, mirrored in `main.js` and `MainActivity.kt`) is the list until the `lemmy-instances` key is written; removing writes the list, so a removed default stays removed. In the extension it gets no access until first opened (`switchSource` asks).
- Running there: the manifest's content script is Reddit-only. Adding an instance (`addInstance` in `client/lib/sources.ts`) asks for that origin through `ReaderHost.instances` (optional host permission), then `sync()` registers `content.js` with `chrome.scripting` on the granted instances (id `openrelay-lemmy`). `web_accessible_resources` therefore matches `https://*/*`, and `reader.tsx` renders nothing unless `trustedSource()` (Reddit, offline, or a host in the list).
- Auth: lemmy-ui and the API share an origin, so the page provider's same-origin requests carry lemmy-ui's `jwt` cookie; `writes.ts` also reads it (`sessionToken`) and sends it as a bearer token, in the content script only. New read endpoints go in `READ_ROUTES` in `lemmy/lemmy.ts`; new writes in `lemmyAction` in `lemmy/writes.ts`, validating that IDs carry this instance's tag. The inbox's read state changes only through `read_message`/`unread_message`/`read_all_messages`.
- Per-site storage: the account, subscriptions, favourites, recent communities and search history use `siteKey()` (`client/lib/site.ts`): Reddit's keys are unchanged, an instance's get `@host`.
- The wrapper apps read the list from their own storage file (`INSTANCES_KEY` in `apps/desktop/src/main.js` and `MainActivity.kt`) and treat those hosts like Reddit; their `instances` access just answers "granted". Android re-registers its document-start script and page channel when the list changes.
- `isGatePage` for Lemmy is "not lemmy-ui": no `#root` or no `isoData` script, which covers Cloudflare/Anubis bot checks.

### Hybrid feed

Turned off for now: `HYBRID_ENABLED` in `client/lib/sources.ts` is `false`, so the drawer doesn't offer it and `hybridMode()` is always false, even with `hybrid-feed` stored. The code below stays for when it returns.

The drawer's **Hybrid** source (shown once an instance is listed) is the Reddit tab with the `hybrid-feed` storage key set (`hybridMode()` in `client/lib/sources.ts`). Its Home feed is Reddit's plus each listed instance's Local feed:

- `api.ts`'s `fetchFeed` hands Home to `fetchHybridFeed` (`client/lib/hybrid.ts`). Reddit goes through the bridge as usual. Each instance is read straight from the reader with `fetch` (`credentials: "omit"`, `allowedApiPath` only) through `lemmyFeed()` in `lemmy/reader.ts`. This is the one place the reader talks to a site itself; Lemmy's API sends CORS headers for any origin, so the wrapper apps need nothing extra.
- The pure parts are in `providers/hybrid.ts`: `mergeFeeds` (New by time, other sorts spread by each source's own rank, since scores aren't comparable), the `hybrid:` JSON cursor holding each source's own `after`, and `hybridPost`, which writes local names as `name@host`.
- In the Reddit tab, `isLemmyItem(id)` (a `t3_<n>_<tag>` ID) and `isLemmyName(name)` (contains `@`) mark hybrid items. Reddit must never get them: `runAction` and `castVote` refuse them, vote-status skips them, cards drop their vote/save buttons, and `site.communityLabel`/`userLabel` use Lemmy's labels for them.
- `openPost`, `openCommunity` and `openProfile` in `App.tsx` send a hybrid item to its instance's page (`lemmyItemUrl`, `lemmyActorUrl`, then `openOnInstance`), which is why `sourceUrl()` also allows an instance's `/post/<n>`, `/comment/<n>`, `/c/<name>` and `/u/<name>`.

### Host adapter

Code outside `src/hosts/` must not call `chrome.*` directly (the toolbar worker excepted). `src/hosts/types.ts` defines what OpenRelay needs from the app running it: `ReaderHost` for the reader frame (storage, the offline store, image fetching for offline posts, file downloads) and `PageHost` for the content script (reader URL, toggle). `hosts/reader.ts` and `hosts/page.ts` return the browser-extension implementation, unless a wrapper app (Android WebView, Electron) has defined `globalThis.openRelayReaderHost` / `openRelayPageHost` first. The reader origin the bridge trusts comes from `PageHost.readerUrl()`. `docs/handover-android-electron.md` covers the wrapper apps.

### Desktop app (`apps/desktop/`)

Plain JavaScript, no bundler; it uses the built `dist/` files, never `src/` directly.

- `src/main.js` (main process): a `BrowserWindow` on `https://www.reddit.com/` in the `persist:openrelay` session. It serves the copied build from the privileged `openrelay://reader` scheme (`bypassCSP`, so Reddit's CSP can't block the frame), with the extension's page CSP. Its IPC handlers (storage in `userData/openrelay-storage.json`, downloads) reject any sender frame whose origin isn't `openrelay://reader`. It hands `content.js` only to Reddit top frames. Before anything loads, it removes `Electron/…` and `OpenRelay/…` from `app.userAgentFallback`, because Reddit answers its JSON endpoints with 403 to a user agent that names them (confirmed on real Reddit). Keep it app-wide: a session-only `setUserAgent` misses the reader iframe's requests. It also sets the new-window rules (Reddit URLs in a new window on the same session, others via `shell.openExternal`), the permission allowlist, and the View menu's `toggle-reader` item.
- `src/preload.cjs` (sandboxed, so CommonJS and a single file): runs in every frame. On a Reddit top frame it defines `openRelayPageHost` and runs `content.js` in isolated world 1001 on `DOMContentLoaded`. That world has its own CSP and the page's security origin, so its fetches are same-origin with Reddit and it is exempt from Reddit's CSP. On the `openrelay://reader` frame it exposes `openRelayReaderHost` through `contextBridge`. Every other frame gets nothing.
- `test/hook.cjs` is loaded with `electron -r` by the smoke test only. It sets a throwaway `userData`, keeps windows rendering when occluded, and cancels every request until the fixture routes are in place. In the test, resize the real window (`setContentSize`), not Playwright's viewport: an emulated viewport larger than the window puts clicks outside it.

### The bridge is a security boundary

`content.ts` accepts messages only from its own iframe with the extension origin, and handles a fixed set of actions (Reddit's provider, `src/providers/reddit/page.ts`, handles all but `navigate`):

- `json`: GET, only if `allowedJsonPath()` matches `READ_ROUTES` in `src/providers/reddit/reddit.ts`. **A new read endpoint must be added to that allowlist.**
- `snapshot`: scrapes the already-loaded page DOM (`snapshot.ts`, handling both `shreddit-*` new Reddit and `.thing` old Reddit). It is the fallback when JSON is blocked or rate-limited.
- `search-page`: GETs Reddit's HTML search (`allowedSearchPagePath()` in `src/providers/reddit/search.ts`) and returns only the post IDs and next-page path. The reader then loads the posts from `/api/info.json`, or from each post's `/comments/<id>.json` when that is refused too. This is the fallback when `/search.json` is refused (403).
- `vote` / `vote-status`: `votes.ts` first clicks the native Reddit vote control for that thing ID. If none is on the page, `apiVote` posts to `/api/vote`.
- `action`: a write, which must be an entry in the `ACTIONS` table in `src/providers/reddit/writes.ts`, with validated params. **New writes go there.**
- `upload`: an image or GIF for a reply. `decodeImage()` in `src/providers/upload.ts` checks its type (PNG, JPEG, GIF, WebP), first bytes and size (20 MB), and names it `image.<ext>`. Reddit's `apiUpload` gets a lease from `/api/media/asset.json` and posts the file, without credentials, only to the S3 host `UPLOAD_HOST` allows; a `comment` or `edit` whose text refers to uploaded media (`![img](<asset id>)`) is sent as `richtext_json`, converted by Reddit's `/api/convert_rte_body_format`. Lemmy's `lemmyUpload` posts to `/pictrs/image`. The bridge carries the bytes as base64, because the Android app's bridge carries only strings.
- `me`: account name and avatar only.
- `navigate`: the drawer's source switcher (handled by `content.ts` itself, for every site). Loads Reddit's front page, or a Lemmy instance's front page or a hybrid feed item's page on it, in the tab, and only those (`sourceUrl()` in `src/extension/sources.ts`). Added instances are kept under the `lemmy-instances` storage key (`src/client/lib/sources.ts`).

The session modhash (CSRF token) is fetched and kept only in the content script and never sent to the reader. The README's "Data and permissions" section is the user-facing promise: only the `storage` and `unlimitedStorage` permissions (plus optional ones asked for when used: `downloads`, and host access to Reddit's image hosts for offline images), no third-party hosts apart from the optional Giphy GIFs and Arctic Shift (`lib/archive.ts`, fetched only when you press Restore from archive on a removed post), and the inbox read with `mark=false`. Keep changes consistent with it.

### Data flow

- `src/providers/reddit/reddit.ts` holds the shared normalizers (raw Reddit JSON → presentation models), plus `parseRoute` and `safeUrl`. Both the reader provider (`reddit/reader.ts`) and the DOM snapshot use them, so live and fallback data have the same shape.
- `src/shared/api.ts` defines those presentation models (`PostSummary`, `PostDetail`, `CommentNode`, `Community`, …), plus `PageRoute`, the listing section types and `ApiFailure`.
- `src/client/lib/api.ts` is the reader's data layer as the screens see it (`fetchFeed`, `fetchPost`, `runAction`, …), backed by the page's reader provider. Reddit's seeds the first feed/search from the page snapshot and falls back to it when a fetch fails.

### Reader app

- `app/App.tsx` is the shell: screen stack, drawer, sheets, media viewer, and Relay's dual-pane layout (listing left, post right). Screens navigate through `useNav()` (`NavContext` in `app/nav.ts`) and learn which pane they're in from `usePane()`. Dual-pane rules are in `lib/panes.ts`.
- Preferences are in `app/prefs.tsx` and are applied to `document` before first render (`reader.tsx`).
- Persistence: always use `lib/storage.ts` (`readJson`/`writeJson`/`RecentSet`), never `localStorage`. It is a synchronous in-memory cache over the host's storage (`chrome.storage.local` in the extension), loaded by `initStorage()` before the app renders. Posts saved for offline reading don't go there: `lib/offlineStore.ts` keeps them in the host's `OfflineStore`, read one entry at a time (`openrelay-offline:` keys in `chrome.storage.local`, an `offline/` folder of JSON files in the wrapper apps). `reader.html#offline` is the reader opened without Reddit: `bridge()` fails at once, `fetchPost` reads saved copies, and `OfflineScreen` replaces the feed. Images saved with a post are `media:` entries; so is a post's v.redd.it video, joined with its sound by `redditVideo` in `lib/platform.ts` (v.redd.it allows CORS, so the reader fetches it itself). Saved pages keep Reddit's URLs; `withOfflineMedia` swaps them for `blob:` URLs when shown and drops a saved video's `hls`, so players use the file. Chrome denies `localStorage` to the extension frame when third-party cookies are blocked, which the browser tests exercise.
- Styling: `styles/theme.css` holds the design tokens/themes, `reader.css` the components, and `markdown.css` the custom Reddit Markdown renderer (`lib/markdownParser.ts` + `lib/markdown.tsx`).

## Repo notes

- `dist/`, `dist-firefox/`, `*.xpi`, `dist.crx`, `dist.pem` (the extension signing key) and `test-results/` are git-ignored. Never commit `dist.pem`, `apps/android/keystore.properties` or the `.jks` keystore.
- `releases/` holds the official packages that `build:apps` puts there, one subfolder per platform. `android/`, `chrome/` and `firefox/` are committed (`.gitignore` re-includes their `.zip` and `.xpi` files); `desktop/` is git-ignored, because the exes are about 98 MiB, too close to GitHub's 100 MiB file limit, and they're published only as GitHub Release assets (`--publish`). The script refuses to copy a committed package over 100 MiB. The `.crx` is signed with `dist.pem` by `tools/extension-packages.mjs` (CRX3 and zip in plain Node), so the extension ID stays `hgeofllbbcejfkcojkpkdkpkkdijgbaj`. The desktop build's `compression: "maximum"`, English-only `electronLanguages` and the installer's `differentialPackage: false` (solid compression; there's no electron-updater) keep the downloads small.
- The README lists the unit-test count ("81 unit tests"). Update it if you add or remove tests.
