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
- OpenRelay image/gallery/video presentation (the viewer scales images, GIFs and videos to fit the screen on both axes, enlarging small ones, as Relay does), NSFW/spoiler blur, local read/hidden markers, and settings. Settings changes save automatically and apply to every open Reddit tab.
- Your subscribed communities load automatically. As in Relay, tapping the feed title opens a tall **Subreddit search** sheet: a search field ready for typing, then collapsible Feeds / Favourites / Recent / Subscriptions sections in a Relay-style list (round community icons, alphabetical, a star to pin favourites, a re-sync button). Typing filters your communities and, as in Relay, searches Reddit live (after two characters, debounced) through its read-only subreddit autocomplete, showing results with member counts, NSFW tags and a subscribe button; you can also open the typed name directly. The list is kept for 30 minutes between syncs.
- **Swipe actions**, as in Relay: swipe a post or comment to the left (touch, mouse drag or a sideways trackpad scroll) and it slides away over a row of actions. Posts: Up, Down, Save, Share, Cmts, Mod (moderators), More. Comments: Up, Down, User, Edit (your own), Reply, Parent, Mod, More. Profile comments: Up, Down, Full, Reply, Edit, Mod. Active votes and saves use Relay's colours; swipe right to bring the card back as it was (or tap the row's background or press Escape).
- **Replying** to posts, comments and inbox messages inside the reader, after Relay's reply screen: the parent quoted under "Replying to", a Markdown format bar (bold, italic, strikethrough, spoiler, quote, link, lists, rule, code, header, superscript), Preview, and Send (Ctrl/Cmd+Enter). Drafts are kept per parent until sent; a posted reply appears in the thread straight away.
- Relay's community header: banner, 72px icon, title, members and online counts, and description, with round **Subscribe** (+ / ✓) and **⋮** buttons. The ⋮ menu has View Sidebar (Relay's right-hand "Sidebar Info" panel with the full sidebar), View Wiki, View Rules, View Mods, Message Mods, Create Post (Text or Image/Link) and Share. Tapping the description also opens the sidebar.
- The drawer is Relay's navigation drawer: the community header, then Profile, Inbox, Moderator, New Post, Friends, User and Settings.
- Relay's account destinations, inside the reader, each with Relay's layout: an app bar whose title switches section, and a bottom bar of icon-over-label actions:
  - **Profile** and **User** (any username): picture, karma, Overview / Comments / Posts (plus Upvoted / Downvoted / Hidden / Saved on your own profile), sorting, Friend / UnFriend and a Send Message button.
  - **Inbox**: Inbox All, Unread, Messages, Comment and Post Replies, Sent, Mentions and Mod Mail, with an unread count in the drawer. Tap a message for User, Context, Reply, Delete, Block and Read/Unread; Read All. **Context** opens the comment's thread (Reddit's context view: the comment, its parents and replies), scrolls to the comment and keeps it highlighted, with **View all comments** for the full thread. Comments on profiles open the same way.
  - **Moderator** (moderators only): Modqueue, Reports, Spam, Edited and Unmoderated, filtered to posts or comments, for all moderated communities or one; reports shown on each item, with Approve, Remove, Spam and Ignore.
  - **New Post**: text or link post with subreddit rules and options (inbox replies, NSFW, spoiler, repost). **Friends**: your friends list with remove. **New Message**: compose a private message.
- Cards, Compact and List layouts, applied to feeds, profiles, the inbox and the opened post (as in Relay, Compact and List show the post as its feed row with a tappable thumbnail instead of full-size media); Auto, Light, Dark and Black themes.
- One-click restoration of Reddit's original page. Unsupported pages (settings, login, profiles, messages, moderation) stay native. Recognized challenge screens stay native too.

**Vote arrows work in place, without leaving the reader.** When Reddit's own vote control for that post or comment is on the page, the reader forwards one click to it, using the page’s signed-in session. Upvote, downvote, undo, and switching votes are supported when the native control is loaded and exposes its state. Current and old Reddit controls are supported, including open shadow roots. Buttons pause while a click is pending; the reader mirrors Reddit’s displayed selection/count and later rollbacks. This reflects Reddit’s UI, not an independent server acknowledgment.

Posts and comments the reader fetched itself (other pages, more comments) have no control on the page. Their votes go to Reddit's `/api/vote` endpoint as a same-origin request from the Reddit tab, with your existing session and its modhash (Reddit's CSRF token, read from `/api/me.json` and held only in memory in that tab). The arrows start from the vote Reddit reports for you, and the count adjusts locally. A stale modhash is refreshed once; nothing else is retried.

If you are signed out, the control is disabled (archived/locked), or Reddit does not confirm a clicked vote, the reader explains why and shows a **Vote on Reddit** link as a fallback. The extension does not request OAuth access, use Devvit's app account, or send any token outside the Reddit tab.

**Writes** happen only when you act, through Reddit's own `/api/*` endpoints with your session: voting, replying to posts, comments and messages, subscribing and unsubscribing, messaging a community's moderators, and the account screens' actions (mark read/unread, read all, reply to inbox items, delete and block, compose, approve/remove/spam/ignore reports, friend/unfriend, submit). The page script accepts only this fixed list, validates every parameter (IDs, usernames, community names, lengths, http(s) URLs) before contacting Reddit, and adds the modhash itself; the reader never receives it. Deleting, blocking and removing friends ask for confirmation first. Settings stay local to the browser; Reddit account preference syncing is not included.

## Data and permissions

A Manifest V3 content script runs only on the three Reddit hosts above. It embeds the bundled reader in an extension-origin iframe, keeping OpenRelay's styles separate from Reddit's. The page bridge accepts messages only from that reader frame and permits only a narrow list of read-only JSON routes, read-only vote-state queries, and a validated vote for a specific post/comment ID and direction (a forwarded click, or `/api/vote` when no control is on the page). Page-origin messages cannot invoke these operations.

No API key, server, extra host permissions, browsing-history permission, or third-party analytics are needed. The only permission is `storage`. Requests use the Reddit tab's normal same-origin session; the subscription list, profiles, inbox, moderation queues, friends and community rules come from Reddit's read-only JSON listings and need you to be signed in to Reddit. The inbox is read with `mark=false`, so opening it does not mark messages read. Nothing is sent to an OpenRelay server. Preferences, favourites, the cached subscription list and read/hidden markers are kept in `chrome.storage.local`, because Chrome denies `localStorage` to the reader frame when third-party cookies are blocked. Values saved in `localStorage` by earlier versions are imported on first run.

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

This runs TypeScript, 47 unit tests, and the production build. Reload the extension in Chrome after rebuilding.

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

- `src/client/` — OpenRelay's UI, copied from `../OpenRelay` and adapted locally.
- `src/shared/api.ts` — OpenRelay's presentation models.
- `src/extension/` — Reddit normalization, DOM extraction, message bridge, content script and toolbar worker.
- `public/manifest.json` — extension manifest.
- `tools/build.mjs` — independent extension build; no dependency on the sibling project at build/runtime.
- `tools/browser-smoke.mjs` and `tools/vote-smoke.mjs` — browser integration checks.

No files in the neighboring OpenRelay project are modified.
