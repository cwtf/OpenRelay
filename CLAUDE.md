# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OpenRelay for Reddit is a Manifest V3 Chrome extension that replaces Reddit's UI with a React reader modelled on the Android app Relay for Reddit. Many behaviours (pane rules, swipe actions, comment collapsing) intentionally copy Relay, and code comments often cite Relay's own logic.

## Commands

Requires Node 24+.

```sh
npm ci
npm run check          # type-check + unit tests + production build (the main gate)
npm run type-check     # tsc --noEmit
npm test               # unit tests (node:test, run on the .ts sources directly)
npm run build          # vite build into dist/ (Chrome) and dist-firefox/
npm run test:browser   # Playwright smoke tests against the built dist/ (build first)
```

Run one unit test file, or one test by name:

```sh
node --experimental-strip-types --test src/client/lib/panes.test.ts
node --experimental-strip-types --test --test-name-pattern="modhash" src/extension/writes.test.ts
```

Run one browser suite with `node tools/vote-smoke.mjs` (or `browser-smoke`, `account-smoke`, `media-smoke`). They need Playwright with Chromium. `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` override where those come from. They load the real `dist/` into a throwaway profile under `test-results/` with third-party cookies blocked, serve fixture Reddit HTML/JSON, and assert on the exact write requests sent. They never contact real Reddit.

After rebuilding, reload the unpacked extension in `chrome://extensions` and refresh the Reddit tab. Until the extension is reloaded, the old content script keeps running and rejects new bridge actions with "Unsupported request". The reader shows that as a "reload the extension" message.

## Unit-test constraints

Unit tests run the TypeScript sources directly through Node's type stripping, with no bundler. So any module a test imports (and everything it imports) must use only erasable TS syntax: no enums, namespaces or constructor parameter properties. Its relative imports also need the explicit `.ts` extension (see `writes.ts` → `./votes.ts`). `tsconfig.json` excludes `*.test.ts` from type-checking. Tests that touch storage stub `globalThis.chrome` (see `storage.test.ts`).

## Architecture

The code runs in three contexts. `tools/build.mjs` builds them separately: the reader as a Vite app from `src/client/reader.html`, and `content.ts` and `background.ts` as standalone IIFE bundles. It then copies `public/manifest.json` into `dist/`, and copies `dist/` to `dist-firefox/` with a Firefox manifest (`background.scripts` in place of the service worker, plus `browser_specific_settings` with the add-on ID). Only the manifest differs between the two. The browser tests cover Chrome only.

1. **Content script** (`src/extension/content.ts`, Reddit page origin): mounts a full-screen closed-shadow-DOM host holding an iframe of `reader.html`, passing the page URL in the hash (`#source=…`). It marks the page `inert`, shows the "Original Reddit" exit button, and skips humanity/captcha gate pages. It polls `location.href` to remount on SPA navigation. It is also the **only** code that talks to Reddit: requests run same-origin with the user's session.
2. **Reader** (`src/client/`, extension origin, inside the iframe): the React app. It can't reach Reddit directly. Every request goes through `bridge()` in `src/extension/bridge.ts`, a postMessage RPC to the parent page. Despite its folder, `bridge.ts` is imported by the reader.
3. **Service worker** (`src/extension/background.ts`): only forwards toolbar-icon clicks as `openrelay:toggle`.

### The bridge is a security boundary

`content.ts` accepts messages only from its own iframe with the extension origin, and handles a fixed set of actions:

- `json`: GET, only if `allowedJsonPath()` matches `READ_ROUTES` in `src/extension/reddit.ts`. **A new read endpoint must be added to that allowlist.**
- `snapshot`: scrapes the already-loaded page DOM (`snapshot.ts`, handling both `shreddit-*` new Reddit and `.thing` old Reddit). It is the fallback when JSON is blocked or rate-limited.
- `search-page`: GETs Reddit's HTML search (`allowedSearchPagePath()` in `src/extension/search.ts`) and returns only the post IDs and next-page path. The reader then loads the posts from `/api/info.json`, or from each post's `/comments/<id>.json` when that is refused too. This is the fallback when `/search.json` is refused (403).
- `vote` / `vote-status`: `votes.ts` first clicks the native Reddit vote control for that thing ID. If none is on the page, `apiVote` posts to `/api/vote`.
- `action`: a write, which must be an entry in the `ACTIONS` table in `src/extension/writes.ts`, with validated params. **New writes go there.**
- `me`: account name and avatar only.

The session modhash (CSRF token) is fetched and kept only in the content script and never sent to the reader. The README's "Data and permissions" section is the user-facing promise: only the `storage` permission, no third-party hosts, and the inbox read with `mark=false`. Keep changes consistent with it.

### Data flow

- `src/extension/reddit.ts` holds the shared normalizers (raw Reddit JSON → presentation models), plus `parseRoute` and `safeUrl`. Both the reader (`src/client/lib/api.ts`) and the DOM snapshot use them, so live and fallback data have the same shape.
- `src/shared/api.ts` defines those presentation models (`PostSummary`, `PostDetail`, `CommentNode`, `Community`, …).
- `src/client/lib/api.ts` is the reader's whole data layer (`fetchFeed`, `fetchPost`, `runAction`, …). It seeds the first feed/search from the page snapshot and falls back to it when a fetch fails.

### Reader app

- `app/App.tsx` is the shell: screen stack, drawer, sheets, media viewer, and Relay's dual-pane layout (listing left, post right). Screens navigate through `useNav()` (`NavContext` in `app/nav.ts`) and learn which pane they're in from `usePane()`. Dual-pane rules are in `lib/panes.ts`.
- Preferences are in `app/prefs.tsx` and are applied to `document` before first render (`reader.tsx`).
- Persistence: always use `lib/storage.ts` (`readJson`/`writeJson`/`RecentSet`), never `localStorage`. It is a synchronous in-memory cache over `chrome.storage.local`, loaded by `initStorage()` before the app renders. Chrome denies `localStorage` to the extension frame when third-party cookies are blocked, which the browser tests exercise.
- Styling: `styles/theme.css` holds the design tokens/themes, `reader.css` the components, and `markdown.css` the custom Reddit Markdown renderer (`lib/markdownParser.ts` + `lib/markdown.tsx`).

## Repo notes

- `dist/`, `dist-firefox/`, `*.xpi`, `dist.crx`, `dist.pem` (the extension signing key) and `test-results/` are git-ignored. Never commit `dist.pem`.
- The README lists the unit-test count ("54 unit tests"). Update it if you add or remove tests.
