import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedApiPath,
  feedSort,
  hostTag,
  lemmyNumber,
  normalizeAbout,
  normalizeAccount,
  normalizeComments,
  normalizeFollows,
  normalizeInbox,
  normalizePost,
  parseRoute,
  resolveLink,
} from "./lemmy.ts";

const ORIGIN = "https://lemmy.world";
const TAG = hostTag("lemmy.world");

// Trimmed from lemmy.world's /api/v3/post/list (Lemmy 0.19).
const imagePost = {
  post: {
    id: 53824981,
    name: "All the ram are belong to us",
    url: "https://media.piefed.social/posts/hc/bQ/hcbQUwz4SE30UtL.jpg",
    body: "",
    creator_id: 24318619,
    removed: false,
    locked: false,
    published: "2026-10-31T18:06:09.395174Z",
    deleted: false,
    nsfw: false,
    thumbnail_url: "https://lemmy.world/pictrs/image/123cd214.jpeg",
    local: false,
    featured_community: false,
    featured_local: false,
    url_content_type: "image/jpeg",
  },
  image_details: { width: 512, height: 342, content_type: "image/jpeg" },
  creator: { id: 24318619, name: "BlindPenguin", actor_id: "https://piefed.social/u/BlindPenguin", local: false },
  community: { name: "lemmyshitpost", actor_id: "https://lemmy.world/c/lemmyshitpost", local: true, nsfw: false },
  counts: { comments: 0, score: 98 },
  subscribed: "NotSubscribed",
  saved: false,
};

test("tags IDs with their instance", () => {
  assert.match(TAG, /^[a-z0-9]{1,7}$/);
  assert.notEqual(TAG, hostTag("lemmy.ml"));
  assert.equal(lemmyNumber(`t3_53824981_${TAG}`, "t3"), 53824981);
  assert.equal(lemmyNumber("53824981", "t3"), 53824981);
  assert.equal(lemmyNumber(`t1_5_${TAG}`, "t3"), null);
  assert.equal(lemmyNumber("t3_abc123", "t3"), null);
});

test("normalizes an image post from another instance", () => {
  const post = normalizePost(imagePost, ORIGIN);
  assert.equal(post.id, `t3_53824981_${TAG}`);
  assert.equal(post.author, "BlindPenguin@piefed.social");
  assert.equal(post.subreddit, "lemmyshitpost");
  assert.equal(post.permalink, "https://lemmy.world/post/53824981");
  assert.equal(post.createdAt, Date.parse("2026-10-31T18:06:09.395174Z"));
  assert.equal(post.score, 98);
  assert.equal(post.saved, false);
  assert.equal(post.vote, undefined);
  assert.deepEqual(post.media, {
    kind: "image",
    image: { url: imagePost.post.url, width: 512, height: 342 },
    animated: false,
  });
});

test("normalizes text and link posts, with the viewer's vote", () => {
  const text = normalizePost(
    {
      ...imagePost,
      post: { ...imagePost.post, url: undefined, thumbnail_url: undefined, body: "Hello **there**", published: "2023-06-01T10:00:00" },
      community: { name: "linux", actor_id: "https://lemmy.ml/c/linux", local: false },
      my_vote: -1,
    },
    ORIGIN,
  );
  assert.equal(text.media.kind, "self");
  assert.equal(text.body, "Hello **there**");
  assert.equal(text.subreddit, "linux@lemmy.ml");
  assert.equal(text.url, text.permalink);
  assert.equal(text.vote, -1);
  const folded = normalizePost(
    { ...imagePost, post: { ...imagePost.post, url: undefined, body: "Specs:\n\n::: spoiler Full specs\nIntel Atom\n:::\n\nThanks" } },
    ORIGIN,
  );
  assert.equal(folded.excerpt, "Specs:\n\n[Full specs]\n\nThanks");
  // No time zone: Lemmy's times are UTC.
  assert.equal(text.createdAt, Date.parse("2023-06-01T10:00:00Z"));
  const link = normalizePost(
    { ...imagePost, post: { ...imagePost.post, url: "https://www.404media.co/story/", url_content_type: "text/html" } },
    ORIGIN,
  );
  assert.equal(link.media.kind, "link");
  assert.equal(link.domain, "www.404media.co");
  assert.equal(link.thumb?.url, imagePost.post.thumbnail_url);
});

const comment = (id: number, path: string, childCount: number, extra = {}) => ({
  comment: { id, post_id: 53789780, content: `comment ${id}`, path, published: "2026-10-31T18:26:53Z", deleted: false, removed: false, distinguished: false, ...extra },
  creator: { id: id * 10, name: `user${id}`, local: true },
  post: { creator_id: 70, locked: false },
  counts: { score: 3, child_count: childCount },
});

test("builds the comment tree from Lemmy's paths", () => {
  const tree = normalizeComments(
    [
      comment(1, "0.1", 2),
      comment(2, "0.1.2", 1),
      comment(3, "0.1.2.3", 0),
      comment(7, "0.7", 2, { deleted: true }),
      comment(8, "0.7.8", 0),
    ],
    ORIGIN,
  );
  assert.deepEqual(tree.map((c) => c.id), [`t1_1_${TAG}`, `t1_7_${TAG}`]);
  assert.equal(tree[0]!.parentId, `t3_53789780_${TAG}`);
  assert.equal(tree[0]!.replies[0]!.parentId, `t1_1_${TAG}`);
  assert.equal(tree[0]!.replies[0]!.replies[0]!.body, "comment 3");
  // Comment 1 has both its descendants; comment 7 counts 2 but 1 arrived.
  assert.equal(tree[0]!.moreReplies, false);
  assert.equal(tree[1]!.moreReplies, true);
  assert.equal(tree[1]!.body, "[deleted]");
  assert.equal(tree[1]!.removed, "author");
  assert.equal(tree[0]!.permalink, "https://lemmy.world/comment/1");
  // A reply list fetched by parent (the parent is included) roots at the parent.
  const replies = normalizeComments([comment(2, "0.1.2", 1), comment(3, "0.1.2.3", 0)], ORIGIN);
  assert.equal(replies.length, 1);
  assert.equal(replies[0]!.replies.length, 1);
});

test("reads a community, the signed-in person and their follows", () => {
  const { about } = normalizeAbout(
    {
      community_view: {
        community: { name: "linux", title: "Linux", description: "First part.\n\nRules follow.", actor_id: "https://lemmy.ml/c/linux", local: false, nsfw: false, published: "2019-01-01T00:00:00Z" },
        counts: { subscribers: 42629, users_active_day: 4235 },
        subscribed: "Subscribed",
      },
    },
    "linux@lemmy.ml",
  );
  assert.equal(about.name, "linux@lemmy.ml");
  assert.equal(about.description, "First part.");
  assert.equal(about.subscribers, 42629);
  assert.equal(about.subscribed, true);
  const site = {
    my_user: {
      local_user_view: { person: { name: "me", avatar: "https://lemmy.world/pictrs/image/me.png" } },
      follows: [{ community: { name: "linux", actor_id: "https://lemmy.ml/c/linux", local: false } }],
      moderates: [],
    },
  };
  assert.deepEqual(normalizeAccount(site, { replies: 2, mentions: 1, private_messages: 0 }), {
    name: "me",
    icon: "https://lemmy.world/pictrs/image/me.png",
    inboxCount: 3,
  });
  assert.equal(normalizeAccount({}), null);
  assert.deepEqual(normalizeFollows(site).map((c) => c.name), ["linux@lemmy.ml"]);
});

test("opens lemmy-ui's feeds, communities, posts and search", () => {
  assert.deepEqual(parseRoute("https://lemmy.world/"), { sub: "Home", sort: "hot", timeframe: "day" });
  assert.equal(parseRoute("https://lemmy.world/c/linux@lemmy.ml")?.sub, "linux@lemmy.ml");
  assert.equal(parseRoute("https://lemmy.world/post/123")?.postId, `t3_123_${TAG}`);
  assert.equal(parseRoute("https://lemmy.world/search?q=rust")?.query, "rust");
  for (const href of [
    "https://lemmy.world/settings",
    "https://lemmy.world/u/someone",
    "https://lemmy.world/login",
    "https://lemmy.world/post/abc",
    "https://lemmy.world/c/bad name",
  ])
    assert.equal(parseRoute(href), null, href);
  assert.equal(feedSort("top", "week"), "TopWeek");
  assert.equal(feedSort("rising", "day"), "Active");
});

test("allows only read-only API routes", () => {
  for (const path of ["/api/v3/post/list?sort=Hot", "/api/v3/site", "/api/v3/comment/list?post_id=1"])
    assert.ok(allowedApiPath(path), path);
  for (const path of [
    "/api/v3/post/like",
    "/api/v3/user/login",
    "/api/v3/post/list/../like",
    "//evil.example/api/v3/site",
    "https://evil.example/api/v3/site",
    "/api/v3/site/../../user/login",
    42,
  ])
    assert.equal(allowedApiPath(path), false, String(path));
});

test("merges replies, mentions and messages into one inbox", () => {
  const reply = (id: number, path: string, read: boolean, at: string) => ({
    comment_reply: { id: id + 1000, read },
    comment: { id, content: `reply ${id}`, path, published: at },
    creator: { name: "replier", actor_id: "https://lemmy.ml/u/replier", local: false },
    recipient: { name: "me", local: true },
    post: { id: 101, name: "My post" },
    community: { name: "linux", actor_id: "https://lemmy.ml/c/linux", local: false },
  });
  const items = normalizeInbox(
    {
      replies: [reply(201, "0.201", false, "2026-11-01T10:00:00Z"), reply(202, "0.150.202", true, "2026-11-01T09:00:00Z")],
      mentions: [{ person_mention: { id: 9, read: false }, ...reply(203, "0.203", false, "2026-11-01T08:00:00Z") }],
      messages: [
        {
          private_message: { id: 77, content: "Hi there", read: false, published: "2026-11-01T11:00:00Z" },
          creator: { name: "friend", local: true },
          recipient: { name: "me", local: true },
        },
      ],
    },
    ORIGIN,
  );
  assert.deepEqual(
    items.map((item) => [item.id, item.kind, item.unread]),
    [
      [`t4_77_${TAG}`, "message", true],
      [`t1_201_${TAG}`, "post_reply", true],
      [`t1_202_${TAG}`, "comment_reply", false],
      [`t1_203_${TAG}`, "mention", true],
    ],
  );
  assert.equal(items[1]!.author, "replier@lemmy.ml");
  assert.equal(items[1]!.postId, `t3_101_${TAG}`);
  assert.equal(items[1]!.subreddit, "linux@lemmy.ml");
  assert.ok(allowedApiPath("/api/v3/user/replies?unread_only=false"));
  assert.equal(allowedApiPath("/api/v3/user/mark_all_as_read"), false);
});

test("opens this instance's posts and communities in the reader", () => {
  assert.deepEqual(resolveLink("https://lemmy.world/post/42", ORIGIN), { kind: "post", id: `t3_42_${TAG}` });
  assert.deepEqual(resolveLink("/c/linux@lemmy.ml", ORIGIN), { kind: "sub", name: "linux@lemmy.ml" });
  for (const href of ["https://lemmy.ml/post/42", "https://www.reddit.com/r/linux/", "https://lemmy.world/u/someone"])
    assert.equal(resolveLink(href, ORIGIN)?.kind, "external", href);
  assert.equal(resolveLink("javascript:alert(1)", ORIGIN), null);
});
