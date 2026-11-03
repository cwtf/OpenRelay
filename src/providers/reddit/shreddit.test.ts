import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedHtmlPath,
  commentsPath,
  feedPagePath,
  htmlToMarkdown,
  postPagePath,
  type HtmlNode,
} from "./shreddit.ts";

/** A DOM-shaped element for `htmlToMarkdown`; strings are text nodes. */
const h = (
  name: string,
  attrs: Record<string, string> = {},
  ...kids: (HtmlNode | string)[]
): HtmlNode => ({
  nodeType: 1,
  nodeName: name.toUpperCase(),
  nodeValue: null,
  getAttribute: (key) => attrs[key] ?? null,
  childNodes: kids.map((kid) =>
    typeof kid === "string"
      ? { nodeType: 3, nodeName: "#text", nodeValue: kid, childNodes: [] }
      : kid,
  ),
});

test("builds the feed pages new Reddit loads while scrolling", () => {
  assert.equal(
    feedPagePath("AskReddit", "hot", "day"),
    "/svc/shreddit/community-more-posts/hot/?name=AskReddit",
  );
  // The cursor is the last post's full name in base64, as on Reddit.
  assert.equal(
    feedPagePath("pics", "top", "week", "t3_1xlxbsg"),
    "/svc/shreddit/community-more-posts/top/?name=pics&t=WEEK&after=dDNfMXhseGJzZw%3D%3D",
  );
  assert.equal(
    feedPagePath("Home", "new", "day", "t3_abc"),
    "/svc/shreddit/feeds/popular-feed?sort=NEW&after=dDNfYWJj&cursor=dDNfYWJj",
  );
  assert.equal(feedPagePath("popular", "hot", "day"), "/svc/shreddit/feeds/popular-feed?sort=HOT");
  // Multireddits have no such page; a cursor that isn't a post is dropped.
  assert.equal(feedPagePath("pics+aww", "hot", "day"), null);
  assert.equal(
    feedPagePath("pics", "new", "day", "/svc/x"),
    "/svc/shreddit/community-more-posts/new/?name=pics",
  );
  for (const sort of ["hot", "new", "top", "rising", "controversial"] as const)
    assert.ok(allowedHtmlPath(feedPagePath("pics", sort, "all")));
  assert.ok(allowedHtmlPath(feedPagePath("Home", "top", "all", "t3_abc")));
});

test("builds a post's page and its comments", () => {
  assert.equal(postPagePath("t3_1xlmbb6"), "/comments/1xlmbb6/");
  assert.equal(
    commentsPath("t3_1xlmbb6", "AskReddit", "confidence"),
    "/svc/shreddit/comments/r/AskReddit/t3_1xlmbb6?sort=CONFIDENCE",
  );
  assert.ok(allowedHtmlPath(postPagePath("t3_1xlmbb6")));
  assert.ok(allowedHtmlPath(commentsPath("t3_1xlmbb6", "AskReddit", "new")));
  assert.ok(allowedHtmlPath("/r/AskReddit/comments/1xlmbb6/people_who_lost/"));
});

test("allows only Reddit's own post and comment pages", () => {
  const more =
    "/svc/shreddit/more-comments/AskReddit/t3_1xlmbb6?sort=CONFIDENCE&startingDepth=1&commentParentPositions=0";
  const cursor = "Y29tbWVudHRyZWU6ODEzMDFiOWQsOjoxOmQxOnQxXzE5czBkOGM4eGhqZHY=";
  // "More comments" is a POST with its cursor, and nothing else is.
  assert.ok(allowedHtmlPath(more, cursor));
  assert.equal(allowedHtmlPath(more), false);
  assert.equal(allowedHtmlPath(postPagePath("t3_abc"), cursor), false);
  assert.equal(allowedHtmlPath(more, "bad cursor&x=1"), false);
  assert.equal(allowedHtmlPath(more, ""), false);
  assert.equal(allowedHtmlPath(more, 42), false);
  for (const path of [
    "https://evil.example/svc/shreddit/feeds/popular-feed",
    "//evil.example/svc/shreddit/feeds/popular-feed",
    "/\\evil.example/svc/shreddit/feeds/popular-feed",
    "/svc/shreddit/user-hover-card/someone",
    "/api/comment",
    "/settings/",
    "/r/pics/",
    "/message/inbox/",
    "/svc/shreddit/comments/r/pics/t1_abc",
    "/" + "a".repeat(3001),
    undefined,
  ])
    assert.equal(allowedHtmlPath(path), false, String(path));
});

test("turns Reddit's rendered bodies back into Markdown", () => {
  const body = h(
    "div",
    { class: "md" },
    "\n  ",
    h("p", {}, "\n    Some ", h("strong", {}, "bold "), "and ", h("em", {}, "italic"), " text,\n    a ",
      h("a", { href: "https://example.com/a_(b)" }, "link"), " and ", h("code", {}, "x*y"), ".\n  "),
    h("p", {}, "Line one", h("br"), "line two with snake_case and [brackets]"),
    h("blockquote", {}, h("p", {}, "Quoted"), h("p", {}, "twice")),
    h("ul", {}, h("li", {}, "one"), h("li", {}, h("p", {}, "two"), h("ol", { start: "3" }, h("li", {}, "nested")))),
    h("pre", {}, h("code", {}, "let a = 1;\nlet b = 2;\n")),
    h("p", {}, h("span", { class: "md-spoiler-text" }, "secret"), " ", h("del", {}, "gone"), " ", h("sup", {}, "up")),
    h("p", {}, "# not a heading"),
    h("h2", {}, "A ", h("em", {}, "heading")),
    h("hr"),
    h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "A"), h("th", {}, "B"))),
      h("tbody", {}, h("tr", {}, h("td", {}, "1|2"), h("td", {}, "3")))),
    h("p", {}, "Image: ", h("img", { src: "https://i.redd.it/x.png", alt: "" }), h("script", {}, "ignored")),
  );
  assert.equal(
    htmlToMarkdown(body),
    [
      "Some **bold** and *italic* text, a [link](https://example.com/a_%28b%29) and `x*y`.",
      "Line one\\\nline two with snake\\_case and \\[brackets\\]",
      "> Quoted\n>\n> twice",
      "- one\n- two\n\n  3. nested",
      "```\nlet a = 1;\nlet b = 2;\n```",
      ">!secret!< ~~gone~~ ^(up)",
      "\\# not a heading",
      "## A *heading*",
      "***",
      "| A | B |\n| --- | --- |\n| 1\\|2 | 3 |",
      "Image: ![image](https://i.redd.it/x.png)",
    ].join("\n\n"),
  );
});

test("keeps pictures and videos posted in comments", () => {
  const picture = "https://preview.redd.it/abc.png?width=640&format=png&auto=webp&s=1";
  const body = h(
    "div",
    {},
    h("p", {}, "Look:"),
    h("figure", {}, h("a", { href: "https://i.redd.it/abc.png" },
      h("img", { src: picture, alt: "Comment [Image]" }))),
    h("figure", {}, h("shreddit-player-2", {
      src: "https://v.redd.it/vid123/HLSPlaylist.m3u8?a=1",
      poster: "https://preview.redd.it/p.png",
    }, h("img", { src: "https://preview.redd.it/p.png", alt: "media poster" }))),
    h("p", {}, h("a", { href: "https://reddit.com/link/xyz/video/vid456/player" },
      h("img", { src: "https://preview.redd.it/q.png", alt: "media poster" }))),
  );
  assert.equal(
    htmlToMarkdown(body, "t3_xyz"),
    [
      "Look:",
      `![Comment Image](${picture})`,
      "https://www.reddit.com/link/xyz/video/vid123/player",
      "https://reddit.com/link/xyz/video/vid456/player",
    ].join("\n\n"),
  );
  // Without the post, the video's poster stands in for it.
  assert.equal(
    htmlToMarkdown(h("div", {}, h("shreddit-player", { src: "https://v.redd.it/v/HLS.m3u8" },
      h("img", { src: "https://preview.redd.it/p.png", alt: "media poster" })))),
    "![media poster](https://preview.redd.it/p.png)",
  );
});
