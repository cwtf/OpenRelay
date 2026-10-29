import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedSearchPagePath,
  parseSearchPage,
  searchPagePath,
} from "./search.ts";

test("builds Reddit's own search page for new and old Reddit", () => {
  assert.equal(
    searchPagePath("Home", "y700 tablet", "new", false),
    "/search/?q=y700+tablet&sort=new&type=posts",
  );
  assert.equal(
    searchPagePath("Android", "y700", "relevance", false),
    "/r/Android/search/?q=y700&sort=relevance&restrict_sr=1&type=posts",
  );
  assert.equal(
    searchPagePath("Android", "y700", "top", true),
    "/r/Android/search?q=y700&sort=top&restrict_sr=on&type=link",
  );
  for (const sub of ["Home", "Android"])
    for (const old of [false, true])
      assert.ok(allowedSearchPagePath(searchPagePath(sub, "a&b=/c", "new", old)));
});

test("allows only same-origin search pages", () => {
  for (const path of [
    "/search/?q=x",
    "/r/test/search?q=x",
    "/svc/shreddit/search/?q=x&cursor=abc",
  ])
    assert.ok(allowedSearchPagePath(path), path);
  for (const path of [
    "//evil.test/search/",
    "https://www.reddit.com/search/",
    "/search.json?q=x",
    "/api/me.json",
    "/r/test/../../api/me.json?/search/",
    "/\\evil.test/search/",
    "/settings/search/",
    "/svc/shreddit/comments/abc",
    42,
  ])
    assert.equal(allowedSearchPagePath(path), false, String(path));
});

test("reads post IDs and the next page from new Reddit search", () => {
  const page = parseSearchPage(`
    <a href="/r/Android/comments/zzz999/sidebar/">Unrelated link</a>
    <search-telemetry-tracker data-thingid="t3_abc12" data-testid="search-sdui-post">
      <a data-testid="post-title" href="/r/Android/comments/abc12/title/">One</a>
    </search-telemetry-tracker>
    <search-telemetry-tracker data-thingid="t1_comment1"></search-telemetry-tracker>
    <search-telemetry-tracker data-thingid="t3_DEF34"></search-telemetry-tracker>
    <search-telemetry-tracker data-thingid="t3_abc12"></search-telemetry-tracker>
    <faceplate-partial loading="lazy" src="/svc/shreddit/search/?q=y700&amp;cursor=bmV4dA%3D%3D"></faceplate-partial>
  `);
  assert.deepEqual(page.ids, ["t3_abc12", "t3_def34"]);
  assert.equal(page.next, "/svc/shreddit/search/?q=y700&cursor=bmV4dA%3D%3D");
});

test("reads post IDs and the next link from old Reddit search", () => {
  const page = parseSearchPage(`
    <div class="search-result search-result-subreddit" data-fullname="t5_2qlqh"></div>
    <div class="search-result search-result-link" data-fullname="t3_old1"></div>
    <div class="search-result search-result-link" data-fullname="t3_old2"></div>
    <a href="https://old.reddit.com/search?q=y700&amp;count=22&amp;after=t3_old2" rel="nofollow next">next ›</a>
  `);
  assert.deepEqual(page.ids, ["t3_old1", "t3_old2"]);
  assert.equal(page.next, "/search?q=y700&count=22&after=t3_old2");
});

test("falls back to post links and ignores unsafe or missing next pages", () => {
  assert.deepEqual(
    parseSearchPage(`
      <a href="https://www.reddit.com/r/test/comments/aa1/x/">A</a>
      <a href="/r/test/comments/bb2/y/">B</a>
      <a href="/r/test/comments/aa1/x/">A again</a>
      <a rel="next" href="https://evil.test/search?q=x">next</a>
      <faceplate-partial src="/svc/shreddit/settings/x"></faceplate-partial>
    `),
    { ids: ["t3_aa1", "t3_bb2"], next: null },
  );
  // No results: never a next page, so "More results" cannot loop.
  assert.deepEqual(
    parseSearchPage(`<a rel="next" href="/search?q=x&after=t3_z">next</a>`),
    { ids: [], next: null },
  );
});
