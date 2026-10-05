import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = resolve("test-results");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(resolve(out, "browser-profile-"));
// Block third-party cookies: Chrome then denies localStorage to the reader's
// extension frame, so settings must persist through chrome.storage.
await mkdir(resolve(profile, "Default"));
await writeFile(
  resolve(profile, "Default/Preferences"),
  JSON.stringify({
    profile: { cookie_controls_mode: 1, block_third_party_cookies: true },
  }),
);
const context = await chromium.launchPersistentContext(
  profile,
  {
    channel: "chromium",
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
    viewport: { width: 1280, height: 900 },
  },
);
const errors = [];
const post = {
  id: "abc123",
  name: "t3_abc123",
  title: "A loaded Reddit post in OpenRelay",
  author: "example_user",
  subreddit: "test",
  permalink: "/r/test/comments/abc123/example/",
  url: "https://www.reddit.com/r/test/comments/abc123/example/",
  is_self: true,
  selftext: "This is **Markdown** from Reddit.",
  score: 123,
  num_comments: 2,
  created_utc: 1700000000,
};
const comment = {
  kind: "t1",
  data: {
    id: "c1",
    name: "t1_c1",
    parent_id: post.name,
    author: "reader",
    body: "An actual nested comment fixture",
    score: 7,
    created_utc: 1700000100,
    permalink: post.permalink + "c1/",
    replies: {
      data: {
        children: [
          {
            kind: "t1",
            data: {
              id: "c2",
              parent_id: "t1_c1",
              author: "example_user",
              body: "A nested reply",
              score: 3,
              created_utc: 1700000200,
              is_submitter: true,
            },
          },
        ],
      },
    },
  },
};
const fixture = `<!doctype html><html><head><title>Reddit fixture</title></head><body><h1>Original Reddit fixture</h1><shreddit-post id="t3_abc123" post-title="${post.title}" author="example_user" subreddit-prefixed-name="r/test" permalink="${post.permalink}" content-href="${post.url}" post-type="text" score="123" comment-count="2" created-timestamp="2023-11-14T22:13:20Z"><div slot="text-body">Loaded page text.</div></shreddit-post></body></html>`;
let deny = false;
const writes = [];
const searches = [];
// 1x1 PNG served for profile and community pictures.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
await context.route(/^https:\/\/(www|old)\.reddit\.com\//, async (route) => {
  const url = new URL(route.request().url());
  if (route.request().method() !== "GET") {
    writes.push({
      path: url.pathname,
      body: Object.fromEntries(new URLSearchParams(route.request().postData())),
    });
    const sent = writes.at(-1).body;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        url.pathname === "/api/comment"
          ? {
              json: {
                errors: [],
                data: {
                  things: [
                    {
                      kind: "t1",
                      data: {
                        id: "mine1", name: "t1_mine1", parent_id: sent.thing_id,
                        author: "fixture_user", body: sent.text, score: 1,
                        created_utc: Math.floor(Date.now() / 1000), likes: true,
                        permalink: post.permalink + "mine1/",
                      },
                    },
                  ],
                },
              },
            }
          : {},
      ),
    });
  }
  if (url.pathname === "/r/test/about/moderators.json")
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: { children: [{ name: "modone", date: 1500000000, mod_permissions: ["all"] }] },
      }),
    });
  if (url.pathname === "/api/subreddit_autocomplete_v2.json") {
    searches.push(url.searchParams.get("query"));
    const all = [
      { display_name: "pics", subscribers: 30000000, user_is_subscriber: false },
      { display_name: "picture", subscribers: 1200, over18: true },
    ];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        kind: "Listing",
        data: {
          children: all
            .filter((s) => s.display_name.startsWith(url.searchParams.get("query")))
            .map((data) => ({ kind: "t5", data })),
        },
      }),
    });
  }
  if (url.pathname === "/r/test/wiki/index.json")
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { content_md: "# Wiki home\n\nWelcome to the wiki." } }),
    });
  if (url.pathname.startsWith("/img/"))
    return url.pathname === "/img/broken.png"
      ? route.fulfill({ status: 404, body: "" })
      : route.fulfill({ contentType: "image/png", body: png });
  if (url.pathname === "/api/me.json")
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          name: "fixture_user",
          modhash: "fixturemodhash1",
          is_mod: true,
          inbox_count: 3,
          icon_img: "https://www.reddit.com/img/me.png",
        },
      }),
    });
  if (url.pathname === "/r/challenge/")
    return route.fulfill({
      contentType: "text/html",
      body: "<title>Reddit - Prove your humanity</title><h1>Complete the challenge</h1>",
    });
  if (url.hostname === "old.reddit.com" && !url.pathname.endsWith(".json"))
    return route.fulfill({
      contentType: "text/html",
      body:
        '<title>Old Reddit fixture</title><div class="thing link self" data-fullname="t3_abc123" data-author="old_user" data-subreddit="test" data-score="123" data-comments-count="2" data-permalink="' +
        post.permalink +
        '"><a class="title">' +
        post.title +
        '</a><time datetime="2023-11-14T22:13:20Z"></time></div>',
    });
  if (url.pathname.endsWith(".json")) {
    if (deny)
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: "{}",
      });
    const body = url.pathname === "/subreddits/mine/subscriber.json"
      ? {
          data: {
            after: null,
            children: [
              { kind: "t5", data: { display_name: "zebra", over18: false } },
              {
                kind: "t5",
                data: { display_name: "Apple", primary_color: "#336699" },
              },
              {
                kind: "t5",
                data: { display_name: "u_someone", subreddit_type: "user" },
              },
            ],
          },
        }
      : url.pathname.includes("/comments/")
      ? [
          { data: { children: [{ kind: "t3", data: post }] } },
          { data: { children: [comment] } },
        ]
      : url.pathname.endsWith("about.json")
        ? {
            data: {
              display_name: url.pathname.startsWith("/r/broken/")
                ? "broken"
                : "test",
              community_icon: url.pathname.startsWith("/r/broken/")
                ? "https://www.reddit.com/img/broken.png"
                : "https://www.reddit.com/img/test.png",
              title: "Test community",
              subscribers: 1000,
              accounts_active: 42,
              user_is_subscriber: false,
              banner_background_image: "https://www.reddit.com/img/banner.png",
              public_description: "A community for testing OpenRelay.",
              description: "## Sidebar heading\n\nThe full **sidebar** text.",
            },
          }
        : { data: { children: [{ kind: "t3", data: post }], after: null } };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  }
  return route.fulfill({
    contentType: "text/html",
    body: fixture,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; frame-src 'self'; script-src 'self'",
    },
  });
});
const page = await context.newPage();
page.on("pageerror", (err) => errors.push(err.message));
async function reader() {
  await page.waitForFunction(() =>
    document.getElementById("openrelay-extension"),
  );
  for (let i = 0; i < 60; i++) {
    const frame = page
      .frames()
      .find((f) => f.url().startsWith("chrome-extension://"));
    if (frame) {
      await frame.locator(".post-title").first().waitFor();
      return frame;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Reader iframe did not load");
}
try {
  await page.goto("https://www.reddit.com/r/test/");
  let app = await reader();
  assert.equal(await page.locator("body").evaluate((el) => el.inert), true);
  await app.getByRole("button", { name: post.title, exact: true }).click();
  await app
    .getByText("An actual nested comment fixture", { exact: true })
    .waitFor();
  await app.getByText("A nested reply", { exact: true }).waitFor();
  await app.locator(".screen.is-entering").waitFor({ state: "detached" });
  // Collapsing hides only the replies; the comment itself stays, like Relay.
  await app.getByText("A nested reply", { exact: true }).click(); // Leaf: no-op.
  await app.getByText("A nested reply", { exact: true }).waitFor();
  await app.getByText("An actual nested comment fixture", { exact: true }).click();
  await app
    .getByText("A nested reply", { exact: true })
    .waitFor({ state: "detached" });
  await app.getByText("An actual nested comment fixture", { exact: true }).waitFor();
  assert.equal(
    await app.locator('[data-cid="t1_c1"] .collapsed-count').textContent(),
    "+1",
  );
  assert.equal(
    await app.locator('[data-cid="t1_c1"] .vote[data-thing-id="t1_c1"]').count(),
    1,
  );
  await page.screenshot({ path: resolve(out, "collapsed.png") });
  await app.getByText("An actual nested comment fixture", { exact: true }).click();
  await app.getByText("A nested reply", { exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, "comments.png") });

  // Reply to a comment in place, as in Relay: format bar, preview, send.
  const openReply = async () => {
    await app.locator('[data-cid="t1_c1"] .comment-more').click();
    await app.locator(".sheet-item", { hasText: "Reply" }).click();
    const box = app.getByRole("textbox", { name: "Reply" });
    await box.waitFor();
    return box;
  };
  let box = await openReply();
  await app.getByText("Replying to u/reader").waitFor();
  await box.fill("Totally agree");
  // A draft survives closing the composer.
  await app.getByRole("button", { name: "Cancel" }).click();
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  box = await openReply();
  assert.equal(await box.inputValue(), "Totally agree");
  await box.evaluate((el) => el.setSelectionRange(8, 13)); // "agree"
  await app.getByRole("button", { name: "Bold", exact: true }).click();
  assert.equal(await box.inputValue(), "Totally **agree**");
  await app.getByRole("button", { name: "Preview" }).click();
  await app.locator(".reply-preview strong", { hasText: "agree" }).waitFor();
  await page.screenshot({ path: resolve(out, "reply.png") });
  await app.getByRole("button", { name: "Edit" }).click();
  await app.getByRole("button", { name: "Send", exact: true }).click();
  await app.locator(".toast", { hasText: "Reply sent" }).waitFor();
  assert.deepEqual(writes.at(-1), {
    path: "/api/comment",
    body: {
      thing_id: "t1_c1",
      text: "Totally **agree**",
      uh: "fixturemodhash1",
      api_type: "json",
    },
  });
  // The new reply appears nested under the comment, with its Markdown.
  const mine = app.locator('[data-cid="t1_mine1"]');
  await mine.locator("strong", { hasText: "agree" }).waitFor();
  assert.equal(await mine.getAttribute("data-level"), "1");
  // The sent draft is gone.
  box = await openReply();
  assert.equal(await box.inputValue(), "");
  await app.getByRole("button", { name: "Cancel" }).click();
  await app.locator(".sheet").waitFor({ state: "detached" }); // Fully closed.
  // Relay's swipe actions: drag a comment left to reveal its actions.
  const swipeLeft = async (locator, stepDelay = 0) => {
    const box = await locator.boundingBox();
    const y = box.y + Math.min(box.height / 2, 40);
    await page.mouse.move(box.x + box.width - 30, y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(box.x + box.width - 30 - step * 60, y + step);
      if (stepDelay) await page.waitForTimeout(stepDelay);
    }
    await page.mouse.up();
  };
  const actionLabels = () =>
    app.locator(".swipe.is-open .swipe-btn span").allTextContents();
  // The card has fully slid away, uncovering the actions beneath it.
  const revealed = () =>
    app.waitForFunction(() => {
      const open = document.querySelector(".swipe.is-open");
      const card = open?.querySelector(".swipe-content")?.getBoundingClientRect();
      const row = open?.getBoundingClientRect();
      return card && row && card.right <= row.left + 1;
    });
  await swipeLeft(app.locator('[data-cid="t1_c1"]'));
  await app.locator(".swipe.is-open").waitFor();
  assert.deepEqual(await actionLabels(), ["Up", "Down", "User", "Reply", "Mod", "More"]);
  await revealed();
  await page.screenshot({ path: resolve(out, "swipe-comment.png") });
  // Swiping right on the open row restores the card, triggering nothing.
  const writesBefore = writes.length;
  const openRow = await app.locator(".swipe.is-open").boundingBox();
  const midY = openRow.y + openRow.height / 2;
  await page.mouse.move(openRow.x + 40, midY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++)
    await page.mouse.move(openRow.x + 40 + step * 60, midY + step);
  await page.mouse.up();
  await app.locator(".swipe.is-open").waitFor({ state: "detached" });
  await app.waitForFunction(() => {
    const card = document.querySelector('[data-cid="t1_c1"]')?.closest(".swipe-content");
    const row = card?.parentElement?.getBoundingClientRect();
    const box = card?.getBoundingClientRect();
    return box && row && Math.abs(box.left - row.left) < 1; // Back in place.
  });
  assert.equal(writes.length, writesBefore);
  await app.getByText("A nested reply", { exact: true }).waitFor(); // Not collapsed.
  // And it opens again as before.
  await swipeLeft(app.locator('[data-cid="t1_c1"]'));
  await app.locator(".swipe.is-open").waitFor();
  await app.locator(".swipe.is-open .swipe-btn", { hasText: "Up" }).click();
  await app.locator(".swipe.is-open").waitFor({ state: "detached" });
  assert.deepEqual(writes.at(-1), {
    path: "/api/vote",
    body: { id: "t1_c1", dir: "1", uh: "fixturemodhash1", api_type: "json" },
  });
  await app.locator('.vote[data-thing-id="t1_c1"] .is-up[aria-pressed="true"]').waitFor();
  // The swipe did not collapse the comment it was dragged on.
  await app.getByText("A nested reply", { exact: true }).waitFor();
  // A nested reply offers Parent, which scrolls to and flashes its parent.
  // Slowly (~0.7s): the long-press menu must not open during a swipe.
  await swipeLeft(app.locator('[data-cid="t1_c2"]'), 90);
  assert.ok((await actionLabels()).includes("Parent"));
  assert.equal(await app.locator(".sheet").count(), 0);
  await app.locator(".swipe.is-open .swipe-btn", { hasText: "Parent" }).click();
  await app.locator('.comment.is-focus[data-cid="t1_c1"]').waitFor();

  await app.getByRole("button", { name: "Back", exact: true }).click();
  await app
    .locator(".screen.is-entering,.screen.is-exiting")
    .waitFor({ state: "detached" });
  await page.screenshot({ path: resolve(out, "feed.png") });

  // Posts: the drag reveals Relay's post actions instead of opening the post.
  const card = app.locator(".post", { hasText: post.title }).first();
  await swipeLeft(card);
  await app.locator(".swipe.is-open").waitFor();
  assert.equal(await app.locator(".screen").count(), 1); // Still on the feed.
  assert.deepEqual(await actionLabels(), ["Up", "Down", "Save", "Share", "Cmts", "Mod", "More"]);
  await revealed();
  await page.screenshot({ path: resolve(out, "swipe-post.png") });
  await app.locator(".swipe.is-open .swipe-btn", { hasText: "Save" }).click();
  await app.locator(".toast", { hasText: "Saved" }).waitFor();
  assert.deepEqual(writes.at(-1), {
    path: "/api/save",
    body: { id: "t3_abc123", uh: "fixturemodhash1", api_type: "json" },
  });
  // A sideways trackpad scroll opens it too; Save now shows as active.
  // Measure the row's fixed outer box: the card itself may still be sliding back.
  await app.locator(".swipe.is-open").waitFor({ state: "detached" });
  const cardBox = await app.locator(".swipe").filter({ has: card }).boundingBox();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 30);
  await page.mouse.wheel(150, 0);
  await app.locator('.swipe.is-open .swipe-btn.is-saved.is-active', { hasText: "Saved" }).waitFor();
  await app.locator("body").press("Escape"); // Escape closes the row.
  await app.locator(".swipe.is-open").waitFor({ state: "detached" });
  await app.getByRole("button", { name: /Layout:/ }).click();
  await app.locator('.feed[data-layout="compact"]').waitFor();
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  await app.getByRole("radio", { name: "Dark", exact: true }).click();
  assert.equal(await app.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({ path: resolve(out, "settings.png") });
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  // The drawer is Relay's navigation drawer: account destinations and Settings.
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.getByText("Signed in as u/fixture_user").waitFor();
  assert.deepEqual(
    await app
      .locator(".drawer-body > .drawer-item .label")
      .evaluateAll((els) => els.map((el) => el.textContent)),
    ["Profile", "Inbox", "Moderator", "New Post", "Friends", "User", "Settings"],
  );
  assert.equal(await app.locator(".drawer .sub-row, .drawer .drawer-search").count(), 0);
  assert.equal(await app.locator(".drawer-count").textContent(), "3");
  assert.equal(
    await app.locator(".drawer-head img.avatar").getAttribute("src"),
    "https://www.reddit.com/img/test.png",
  );
  await page.waitForTimeout(400); // Let the drawer finish sliding in.
  await page.screenshot({ path: resolve(out, "drawer-top.png") });
  await app.locator("body").press("Escape");
  await app.locator(".has-drawer").waitFor({ state: "detached" });

  // Relay's community header: banner, icon, description, Subscribe and the menu.
  assert.equal(
    await app.locator(".feed-banner img.avatar").getAttribute("src"),
    "https://www.reddit.com/img/test.png",
  );
  assert.match(
    await app.locator(".community-banner").evaluate((el) => el.style.backgroundImage),
    /img\/banner\.png/,
  );
  await app.getByText("A community for testing OpenRelay.").waitFor();
  await app.getByRole("button", { name: "Subscribe to r/test" }).click();
  await app.getByRole("button", { name: "Unsubscribe from r/test" }).waitFor();
  await app.locator(".toast", { hasText: "Joined r/test" }).waitFor();
  assert.deepEqual(writes.at(-1), {
    path: "/api/subscribe",
    body: {
      action: "sub",
      sr_name: "test",
      skip_initial_defaults: "true",
      uh: "fixturemodhash1",
      api_type: "json",
    },
  });
  await page.screenshot({ path: resolve(out, "community-header.png") });
  const menu = async (item) => {
    await app.getByRole("button", { name: "r/test menu" }).click();
    await app.getByRole("button", { name: item }).click();
  };
  await app.getByRole("button", { name: "r/test menu" }).click();
  assert.deepEqual(
    await app.locator(".sheet .sheet-item .label").allTextContents(),
    [
      "View Sidebar", "View Wiki", "View Rules", "View Mods", "Message Mods",
      "Create Post: Text", "Create Post: Image/Link", "Share",
    ],
  );
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  // View Sidebar: Relay's right-hand panel with the sidebar Markdown.
  await menu("View Sidebar");
  const sidebar = app.getByRole("dialog", { name: "r/test sidebar" });
  await sidebar.getByText("Sidebar Info").waitFor();
  await sidebar.getByRole("heading", { name: "Sidebar heading" }).waitFor();
  assert.equal(await sidebar.getByRole("button", { name: "Subscribed" }).count(), 1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, "sidebar.png") });
  await app.locator("body").press("Escape");
  await sidebar.waitFor({ state: "detached" });
  await menu("View Mods");
  await app.getByText("modone").waitFor();
  await app.getByText(/Permissions: All/).waitFor();
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });
  await menu("View Wiki");
  await app.getByText("Welcome to the wiki.").waitFor();
  await app.locator("body").press("Escape");
  await app.locator(".has-sheet").waitFor({ state: "detached" });

  // Subscriptions load automatically, alphabetically, without user profiles,
  // in the sheet that opens from the feed title.
  const titleSheet = async () => {
    await app.getByRole("button", { name: /Subreddit search$/ }).click();
    const found = app.getByRole("dialog", { name: "Subreddit search" });
    await found.waitFor();
    return found;
  };
  let sheet = await titleSheet();
  await sheet.locator(".sub-row-main", { hasText: "zebra" }).waitFor();
  assert.deepEqual(
    await sheet.locator(".sub-row-main .label").allTextContents(),
    ["Home", "Popular", "All", "Apple", "zebra"],
  );
  await sheet.getByRole("button", { name: "Add r/zebra to Favourites" }).click();
  await sheet.getByRole("button", { name: "Collapse Favourites" }).waitFor();
  await sheet.getByLabel("Search or go to a community").fill("zeb");
  assert.deepEqual(
    await sheet.locator(".sub-row-main .label").allTextContents(),
    ["Go to r/zeb", "zebra"],
  );
  await page.screenshot({ path: resolve(out, "subreddit-search.png") });
  await sheet.getByLabel("Search or go to a community").press("Escape"); // Clears.
  await sheet.getByLabel("Search or go to a community").press("Escape"); // Closes.
  await sheet.waitFor({ state: "detached" });
  // Settings and favourites survive a reload with third-party storage blocked.
  await page.reload();
  app = await reader();
  assert.equal(await app.locator("html").getAttribute("data-theme"), "dark");
  assert.ok(await app.locator('.feed[data-layout="compact"]').count());
  sheet = await titleSheet();
  await sheet.getByRole("button", { name: "Remove r/zebra from Favourites" }).first().waitFor();
  assert.equal(
    await app.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    "Search or go to a community",
  );
  assert.deepEqual(
    await sheet.locator(".sub-header-label").evaluateAll((els) =>
      els.map((el) => el.childNodes[0].textContent),
    ),
    ["Feeds", "Favourites", "Subscriptions"],
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, "subreddit-sheet.png") });
  await sheet.locator(".sub-row-main", { hasText: "Apple" }).click();
  await sheet.waitFor({ state: "detached" });
  await app.locator(".appbar-title .name", { hasText: "r/Apple" }).waitFor();
  // As in Relay, typing searches Reddit live; results can be joined directly.
  sheet = await titleSheet();
  await sheet.getByLabel("Search or go to a community").fill("pic");
  await sheet.locator(".search-results .sub-row-main", { hasText: "picture" }).waitFor();
  assert.deepEqual(
    await sheet.locator(".search-results .sub-row-main .label").allTextContents(),
    ["pics", "picture"],
  );
  assert.match(
    await sheet.locator(".search-results .sub-row.is-double").first().locator(".detail").textContent(),
    /r\/pics · 30M members/,
  );
  assert.equal(await sheet.locator(".search-results .sub-nsfw").count(), 1);
  assert.equal(searches.at(-1), "pic");
  await page.screenshot({ path: resolve(out, "subreddit-live-search.png") });
  await sheet.getByRole("button", { name: "Subscribe to r/pics" }).click();
  await sheet.getByRole("button", { name: "Unsubscribe from r/pics" }).waitFor();
  assert.deepEqual(writes.at(-1).body, {
    action: "sub",
    sr_name: "pics",
    skip_initial_defaults: "true",
    uh: "fixturemodhash1",
    api_type: "json",
  });
  await sheet.locator(".search-results .sub-row-main", { hasText: "pics" }).first().click();
  await sheet.waitFor({ state: "detached" });
  await app.locator(".appbar-title .name", { hasText: "r/pics" }).waitFor();
  // Typing a name and pressing Enter opens it.
  sheet = await titleSheet();
  await sheet.getByLabel("Search or go to a community").fill("test");
  await sheet.getByLabel("Search or go to a community").press("Enter");
  await app.locator(".appbar-title .name", { hasText: "r/test" }).waitFor();
  await sheet.waitFor({ state: "detached" });
  // Toggle through the real service worker, as a toolbar click does.
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.active);
    await chrome.tabs.sendMessage(tab.id, { type: "openrelay:toggle" });
  });
  assert.equal(await page.locator("body").evaluate((el) => el.inert), false);
  assert.equal(await page.locator("#openrelay-extension").isVisible(), false);
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.active);
    await chrome.tabs.sendMessage(tab.id, { type: "openrelay:toggle" });
  });
  assert.equal(await page.locator("body").evaluate((el) => el.inert), true);
  // Home shows the signed-in account's profile picture.
  sheet = await titleSheet();
  await sheet.locator(".sub-row-main", { hasText: "Home" }).click();
  await sheet.waitFor({ state: "detached" });
  await app.getByRole("button", { name: "Open menu" }).click();
  await app.locator('.drawer-head img.avatar[src="https://www.reddit.com/img/me.png"]').waitFor();
  await app.waitForFunction(
    () => document.querySelector(".drawer-head img.avatar")?.naturalWidth === 1,
  ); // The picture actually loads.
  await page.screenshot({ path: resolve(out, "drawer-home.png") });
  await app.locator("body").press("Escape");
  await app.locator(".has-drawer").waitFor({ state: "detached" });
  // A picture that fails to load falls back to the initial.
  await page.goto("https://www.reddit.com/r/broken/");
  app = await reader();
  await app.locator(".feed-banner span.avatar", { hasText: "b" }).waitFor();
  await page.goto("https://www.reddit.com/r/test/comments/abc123/example/");
  app = await reader();
  await app
    .getByText("An actual nested comment fixture", { exact: true })
    .waitFor();
  await page.goto("https://www.reddit.com/settings/");
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("#openrelay-extension").count(), 0);
  await page.goto("https://www.reddit.com/r/test/?openrelay=off");
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("#openrelay-extension").count(), 0);
  deny = true;
  await page.goto("https://www.reddit.com/r/test/comments/abc123/example/");
  app = await reader();
  await app.getByText(/Showing content already loaded/).waitFor();
  await page.goto("https://old.reddit.com/r/test/");
  app = await reader();
  assert.ok(await app.getByText("u/old_user", { exact: true }).count());
  await page.goto("https://www.reddit.com/r/challenge/");
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("#openrelay-extension").count(), 0);
  assert.equal(await page.locator("body").evaluate((el) => el.inert), false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real extension injection, loaded-page feed, comments, Relay-style collapse, replying (format bar, preview, drafts), Relay swipe actions on posts and comments (drag, swipe back, trackpad, vote, save, parent), settings persistence with third-party storage blocked, navigation drawer, Relay community header (subscribe, sidebar, mods, wiki), subreddit search sheet with subscriptions and live Reddit search, profile and community pictures, direct links, native toggle, excluded routes, blocked-JSON fallback; no page errors.",
  );
} finally {
  await context.close();
}
