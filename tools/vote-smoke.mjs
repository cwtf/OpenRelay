import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
await mkdir("test-results", { recursive: true });
const context = await chromium.launchPersistentContext(
  await mkdtemp(resolve("test-results/votes-")),
  {
    channel: "chromium",
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      "--disable-extensions-except=" + resolve("dist"),
      "--load-extension=" + resolve("dist"),
    ],
  },
);
const errors = [];
let writes = 0;
const post = {
  id: "abc",
  name: "t3_abc",
  title: "Vote forwarding test",
  author: "reader",
  subreddit: "test",
  permalink: "/r/test/comments/abc/test/",
  score: 123,
  num_comments: 2,
  is_self: true,
  created_utc: 1700000000,
};
const comment = (id) => ({
  kind: "t1",
  data: {
    id,
    name: "t1_" + id,
    parent_id: "t3_abc",
    author: id,
    body: "Comment " + id,
    score: 10,
    created_utc: 1700000000,
    permalink: post.permalink + id + "/",
  },
});
const fixtureScript = `
const mode=new URL(location.href).searchParams.get("mode");
window.clicks={};
function wire(owner,up,down,initial=0) {
  let value=initial;
  const base=Number(owner.getAttribute("score")||owner.getAttribute("data-score"))-initial;
  const apply=next=>{
    value=next;owner.setAttribute("score",String(base+next));
    if(up.matches(".arrow")){up.className="arrow "+(next===1?"upmod":"up");down.className="arrow "+(next===-1?"downmod":"down");}
    else {up.setAttribute("aria-pressed",String(next===1));down.setAttribute("aria-pressed",String(next===-1));}
  };
  apply(initial);
  [up,down].forEach((button,i)=>button.addEventListener("click",()=>{
    const id=owner.getAttribute("thingid")||owner.getAttribute("data-fullname")||owner.id;
    window.clicks[id]=(window.clicks[id]||0)+1;
    if(mode==="ignore")return;
    const before=value;
    const direction=i===0?1:-1;
    apply(value===direction?0:direction);
    if(mode==="rollback")setTimeout(()=>apply(before),180);
    if(mode==="late-rollback")setTimeout(()=>apply(before),1400);
  }));
}
for(const owner of document.querySelectorAll("shreddit-post,shreddit-comment")){
  const root=owner.attachShadow({mode:"open"});
  const wrapper=document.createElement("vote-controls");
  root.append(wrapper);
  const controls=wrapper.attachShadow({mode:"open"});
  controls.innerHTML='<button aria-label="Upvote">Up</button><button aria-label="Downvote">Down</button>';
  const [up,down]=controls.querySelectorAll("button");
  if(mode==="disabled"){up.disabled=true;down.disabled=true;}
  wire(owner,up,down,mode==="selected"?1:0);
}
for(const owner of document.querySelectorAll(".thing")){
  wire(owner,owner.querySelector(":scope > .midcol .arrow.up"),owner.querySelector(":scope > .midcol .arrow.down"),mode==="selected"?1:0);
}
`;
await context.route(/^https:\/\/(www|old)\.reddit\.com\//, async (route) => {
  if (route.request().method() !== "GET") writes++;
  const url = new URL(route.request().url());
  if (url.pathname === "/fixture.js")
    return route.fulfill({
      contentType: "application/javascript",
      body: fixtureScript,
    });
  if (url.pathname.endsWith(".json")) {
    const body = url.pathname.includes("/comments/")
      ? [
          { data: { children: [{ kind: "t3", data: post }] } },
          { data: { children: [comment("c1"), comment("c2")] } },
        ]
      : url.pathname.endsWith("about.json")
        ? { data: { display_name: "test" } }
        : { data: { children: [], after: null } };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  }
  const modern =
    '<shreddit-post id="t3_abc" post-type="text" score="123" post-title="' +
    post.title +
    '" author="reader" subreddit-prefixed-name="r/test" permalink="' +
    post.permalink +
    '"></shreddit-post><shreddit-comment thingid="t1_c1" score="10"><shreddit-comment thingid="t1_c2" score="10"></shreddit-comment></shreddit-comment>';
  const old =
    '<div class="thing link" data-fullname="t3_abc" data-score="123" data-subreddit="test" data-permalink="' +
    post.permalink +
    '"><a class="title">' +
    post.title +
    '</a><div class="midcol"><div class="arrow up"></div><div class="arrow down"></div></div><div class="thing comment" data-fullname="t1_c1" data-score="10"><div class="midcol"><div class="arrow up"></div><div class="arrow down"></div></div></div></div>';
  return route.fulfill({
    contentType: "text/html",
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; frame-src 'self'",
    },
    body:
      "<!doctype html><title>Reddit fixture</title><body>" +
      (url.hostname === "old.reddit.com" ? old : modern) +
      '<script src="/fixture.js"></script></body>',
  });
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
async function load(mode = "", host = "www") {
  await page.goto("https://" + host + ".reddit.com/r/test/?mode=" + mode);
  await page.waitForFunction(() =>
    document.getElementById("openrelay-extension"),
  );
  let app;
  for (let i = 0; i < 50; i++) {
    app = page.frames().find((f) => f.url().startsWith("chrome-extension://"));
    if (app) break;
    await page.waitForTimeout(100);
  }
  await app.locator('.vote[data-thing-id="t3_abc"]').waitFor();
  return app;
}
async function vote(app, id, direction) {
  const v = app.locator('.vote[data-thing-id="' + id + '"]').last();
  await v.locator(".is-" + direction).click();
  await v.locator("button:disabled").first().waitFor({ state: "detached" });
  return v;
}
async function selected(v, dir) {
  assert.equal(
    await v.locator(".is-up").getAttribute("aria-pressed"),
    String(dir === 1),
  );
  assert.equal(
    await v.locator(".is-down").getAttribute("aria-pressed"),
    String(dir === -1),
  );
}
try {
  let app = await load("selected");
  let v = app.locator('.vote[data-thing-id="t3_abc"]');
  await v.locator('.is-up[aria-pressed="true"]').waitFor();
  await selected(await vote(app, "t3_abc", "up"), 0); // Undo existing vote.
  await selected(await vote(app, "t3_abc", "down"), -1);
  await selected(await vote(app, "t3_abc", "up"), 1); // Switch direction.
  assert.equal(await page.evaluate(() => window.clicks.t3_abc), 3);
  assert.equal(await v.locator(".vote-score").textContent(), "123");
  await v.locator(".is-down").evaluate((button) => {
    button.click();
    button.click();
  });
  await v.locator("button:disabled").first().waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.clicks.t3_abc), 4);
  await selected(v, -1);
  assert.equal(await page.locator("body").evaluate((el) => el.inert), true);
  assert.equal(context.pages().length, 2); // Initial blank tab plus test tab; no popup.

  await app.getByRole("button", { name: post.title, exact: true }).click();
  await app.locator(".screen.is-entering").waitFor({ state: "detached" });
  await app.locator('.vote[data-thing-id="t1_c1"]').waitFor();
  await selected(await vote(app, "t1_c1", "down"), -1);
  assert.equal(await page.evaluate(() => window.clicks.t1_c1), 1);
  assert.equal(await page.evaluate(() => window.clicks.t1_c2 || 0), 0);
  // Missing parent controls must never accidentally click nested-comment arrows.
  await page.evaluate(() =>
    document.querySelector('[thingid="t1_c1"]').shadowRoot.replaceChildren(),
  );
  v = await vote(app, "t1_c1", "up");
  await v.locator(".vote-fallback").waitFor();
  assert.equal(await page.evaluate(() => window.clicks.t1_c2 || 0), 0);

  for (const mode of ["ignore", "rollback", "disabled"]) {
    app = await load(mode);
    v = await vote(app, "t3_abc", "up");
    await v.locator(".vote-fallback").waitFor();
    await selected(v, 0);
    assert.ok(
      (await v.locator(".vote-fallback").getAttribute("href")).includes(
        "openrelay=off",
      ),
    );
    assert.equal(
      await page.evaluate(() => window.clicks.t3_abc || 0),
      mode === "disabled" ? 0 : 1,
    );
  }
  app = await load("late-rollback");
  v = await vote(app, "t3_abc", "up");
  await selected(v, 1);
  await v.locator('.is-up[aria-pressed="false"]').waitFor(); // Read-only polling reflects a delayed rejection.

  app = await load("", "old");
  v = await vote(app, "t3_abc", "up");
  await selected(v, 1);
  await selected(await vote(app, "t3_abc", "up"), 0);
  assert.equal(await page.evaluate(() => window.clicks.t3_abc), 2);

  // The outer page cannot impersonate the extension iframe's source.
  await page.evaluate(() =>
    window.postMessage(
      {
        type: "openrelay:request",
        id: 99,
        action: "vote",
        payload: { thingId: "t3_abc", direction: 1 },
      },
      "*",
    ),
  );
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.clicks.t3_abc), 2);
  assert.equal(writes, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: modern nested-shadow and old Reddit clicks, initial selection, undo/switch, duplicate suppression, exact comment ownership, unavailable/disabled/unconfirmed fallback, delayed rollback, spoof rejection; no direct API writes.",
  );
} finally {
  await context.close();
}
