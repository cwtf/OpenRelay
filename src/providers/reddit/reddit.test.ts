import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedJsonPath,
  eachItem,
  normalizeAccount,
  normalizeFriends,
  normalizeInbox,
  normalizeListing,
  normalizeModerators,
  normalizeUserAbout,
  normalizeCommunity,
  normalizePost,
  normalizeComments,
  normalizeRules,
  parseRoute,
  safeUrl,
} from "./reddit.ts";

test("recognizes supported Reddit routes and preserves sorting and search", () => {
  assert.deepEqual(
    parseRoute("https://www.reddit.com/r/typescript/top/?t=week"),
    { sub: "typescript", sort: "top", timeframe: "week" },
  );
  assert.equal(
    parseRoute("https://old.reddit.com/r/test/comments/abc/title/")?.postId,
    "t3_abc",
  );
  assert.equal(
    parseRoute("https://www.reddit.com/search/?q=hello")?.query,
    "hello",
  );
  for (const path of [
    "/login",
    "/settings",
    "/message/inbox",
    "/user/me",
    "/r/test/about/modqueue",
    "/r/test/submit",
  ])
    assert.equal(parseRoute("https://www.reddit.com" + path), null);
  assert.equal(parseRoute("https://reddit.com.evil.test/r/test"), null);
});
test("bridge allows only read-only Reddit JSON paths", () => {
  for (const path of [
    "/hot.json?raw_json=1",
    "/r/test/new.json?after=t3_abc",
    "/comments/abc.json?comment=def",
    "/r/test/about.json",
    "/subreddits/mine/subscriber.json?limit=100&after=t5_abc",
    "/subreddits/mine/moderator.json",
    "/user/spez/overview.json?sort=new",
    "/user/spez/about.json",
    "/message/unread.json?mark=false",
    "/message/moderator/unread.json",
    "/r/mod/about/modqueue.json?only=links",
    "/r/test/about/rules.json",
    "/prefs/friends.json",
    "/r/test/about/moderators.json",
    "/r/test/wiki/index.json",
    "/api/subreddit_autocomplete_v2.json?query=pic&include_over_18=true",
    "/subreddits/search.json?q=pic",
    "/api/info.json?id=t3_abc,t3_def",
  ])
    assert.ok(allowedJsonPath(path), path);
  for (const path of [
    "//evil.test/hot.json",
    "https://www.reddit.com/hot.json",
    "/api/vote",
    "/api/comment",
    "/r/test/../../api/me.json",
    "/\\evil.test/hot.json",
    "/r/%2f/api.json",
    "/r/test/subreddits/mine/subscriber.json",
    "/user/spez/gilded/../../api/me.json",
    "/user/a/overview.json",
    "/message/compose.json",
    "/r/test/about/banned.json",
    "/r/test/about/edit.json",
    "/prefs/blocked.json",
    "/r/test/wiki/settings/index.json",
    "/r/test/wiki/edit.json",
    "/api/subscribe.json",
    "/api/subreddit_autocomplete_v2.json/../me.json",
  ])
    assert.equal(allowedJsonPath(path), false, path);
});
test("normalizes image, gallery, video, deleted text and unsafe media", () => {
  const base = {
    id: "abc",
    name: "t3_abc",
    title: "Test",
    created_utc: 100,
    permalink: "/r/test/comments/abc/test/",
    subreddit: "test",
  };
  const p = normalizePost({
    ...base,
    url: "https://i.redd.it/image.png",
    post_hint: "image",
    score: 42,
  });
  assert.equal(p.media.kind, "image");
  assert.equal(p.createdAt, 100000);
  assert.equal(p.score, 42);
  assert.equal(p.author, "[deleted]");
  const g = normalizePost({
    ...base,
    gallery_data: { items: [{ media_id: "one" }, { media_id: "missing" }] },
    media_metadata: {
      one: {
        s: { u: "https://i.redd.it/one.png?a=1&amp;b=2", x: 600, y: 400 },
      },
    },
  });
  assert.equal(g.media.kind, "gallery");
  if (g.media.kind === "gallery") {
    assert.equal(g.media.items.length, 1);
    assert.ok(g.media.items[0]!.url.includes("&b=2"));
  }
  assert.equal(
    normalizePost({
      ...base,
      media: {
        reddit_video: { fallback_url: "https://v.redd.it/abc/DASH_720.mp4" },
      },
    }).media.kind,
    "video",
  );
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,abc"), "");
});
test("preserves safe HLS sources, including videos without an MP4", () => {
  for (const source of ["secure_media", "media", "preview"]) {
    const key = source === "preview" ? "reddit_video_preview" : "reddit_video";
    const hls = "https://v.redd.it/abc/HLSPlaylist.m3u8?a=1&amp;b=2";
    const media = normalizePost({ [source]: { [key]: { hls_url: hls } } }).media;
    assert.equal(media.kind, "video");
    if (media.kind === "video") {
      assert.equal(media.video.hls, hls.replace("&amp;", "&"));
      assert.equal(media.video.mp4, undefined);
    }
  }
  const media = normalizePost({
    media: { reddit_video: {
      fallback_url: "https://v.redd.it/abc/DASH_720.mp4",
      hls_url: "javascript:alert(1)",
    } },
  }).media;
  assert.equal(media.kind, "video");
  if (media.kind === "video") assert.equal(media.video.hls, undefined);
});

test("keeps a crosspost's original and takes its media like Relay", () => {
  const crosspost = (original: Record<string, unknown>, own = {}) =>
    normalizePost({
      id: "xp",
      name: "t3_xp",
      title: "Crossposted",
      subreddit: "elsewhere",
      permalink: "/r/elsewhere/comments/xp/crossposted/",
      crosspost_parent: "t3_orig",
      crosspost_parent_list: [
        {
          id: "orig",
          name: "t3_orig",
          title: "Original",
          subreddit: "source",
          permalink: "/r/source/comments/orig/original/",
          num_comments: 44,
          ...original,
        },
      ],
      ...own,
    });
  const self = crosspost(
    { is_self: true, selftext: "Body", domain: "self.source" },
    { url: "/r/source/comments/orig/original/" },
  );
  assert.equal(self.crosspost, true);
  assert.equal(self.media.kind, "self");
  assert.equal(self.url, "https://www.reddit.com/r/elsewhere/comments/xp/crossposted/");
  assert.equal(self.domain, "self.source");
  assert.equal(self.crosspostParent?.id, "t3_orig");
  assert.equal(self.crosspostParent?.comments, 44);
  assert.equal(self.crosspostParent?.subreddit, "source");
  const video = crosspost(
    {
      url: "https://v.redd.it/abc",
      secure_media: {
        reddit_video: { fallback_url: "https://v.redd.it/abc/DASH_720.mp4" },
      },
    },
    { url: "https://v.redd.it/abc", domain: "v.redd.it" },
  );
  assert.equal(video.media.kind, "video");
  const gallery = crosspost(
    {
      gallery_data: { items: [{ media_id: "one" }] },
      media_metadata: {
        one: { s: { u: "https://i.redd.it/one.png", x: 600, y: 400 } },
      },
    },
    { url: "https://www.reddit.com/gallery/orig" },
  );
  assert.equal(gallery.media.kind, "gallery");
  const link = crosspost(
    { url: "https://example.com/story", domain: "example.com" },
    { url: "https://example.com/story" },
  );
  assert.equal(link.media.kind, "link");
  assert.equal(link.domain, "example.com");
  assert.equal("crosspostParent" in normalizePost({ id: "plain" }), false);
});
test("preserves nested comments and missing-reply markers", () => {
  const result = normalizeComments([
    {
      kind: "t1",
      data: {
        id: "c1",
        parent_id: "t3_abc",
        body: "hello",
        replies: {
          data: {
            children: [
              {
                kind: "t1",
                data: { id: "c2", parent_id: "t1_c1", body: "nested" },
              },
              { kind: "more", data: {} },
            ],
          },
        },
      },
    },
    { kind: "more", data: {} },
  ]);
  assert.equal(result.more, true);
  assert.equal(result.comments[0]!.moreReplies, true);
  assert.equal(result.comments[0]!.replies[0]!.parentId, "t1_c1");
});
test("keeps the media a comment body refers to by ID", () => {
  const [comment] = normalizeComments([
    {
      kind: "t1",
      data: {
        id: "c1",
        body: "![gif](giphy|abc123|downsized) and ![img](up1)",
        media_metadata: {
          "giphy|abc123": {
            status: "valid",
            e: "AnimatedImage",
            s: {
              x: 200,
              y: 150,
              gif: "https://external-preview.redd.it/abc.gif?s=1&amp;w=2",
              mp4: "https://external-preview.redd.it/abc.gif?format=mp4",
            },
          },
          up1: { e: "Image", s: { u: "https://preview.redd.it/up1.png", x: 800, y: 600 } },
          unused: { e: "Image", s: { u: "https://preview.redd.it/unused.png" } },
          bad: { e: "Image", s: { u: "javascript:alert(1)" } },
        },
      },
    },
  ]).comments;
  assert.deepEqual(comment!.media, {
    "giphy|abc123": {
      url: "https://external-preview.redd.it/abc.gif?s=1&w=2",
      width: 200,
      height: 150,
      mp4: "https://external-preview.redd.it/abc.gif?format=mp4",
    },
    up1: { url: "https://preview.redd.it/up1.png", width: 800, height: 600 },
  });
  const plain = normalizeComments([{ kind: "t1", data: { id: "c2", body: "hi" } }]);
  assert.equal("media" in plain.comments[0]!, false);
});
test("normalizes subscribed communities and skips user profiles", () => {
  assert.deepEqual(
    normalizeCommunity({
      display_name: "typescript",
      community_icon: "https://styles.redditmedia.com/t5_1/icon.png?width=256&amp;s=x",
      icon_img: "",
      primary_color: "#0079d3",
      subscribers: 1234,
      over18: false,
    }),
    {
      name: "typescript",
      icon: "https://styles.redditmedia.com/t5_1/icon.png?width=256&s=x",
      color: "#0079d3",
      subscribers: 1234,
      nsfw: false,
    },
  );
  assert.deepEqual(
    normalizeCommunity({
      display_name: "pics",
      community_icon: "javascript:alert(1)",
      key_color: "red",
      over18: true,
    }),
    { name: "pics", nsfw: true },
  );
  assert.equal(
    normalizeCommunity({ display_name: "u_someone", subreddit_type: "user" }),
    null,
  );
  assert.equal(normalizeCommunity({ display_name: "../api" }), null);
});
test("reads the viewer's vote from Reddit's likes field", () => {
  const base = { id: "v", title: "T", created_utc: 1, permalink: "/r/t/comments/v/" };
  assert.equal(normalizePost({ ...base, likes: true }).vote, 1);
  assert.equal(normalizePost({ ...base, likes: false }).vote, -1);
  assert.equal(normalizePost({ ...base, likes: null }).vote, 0);
  assert.equal("vote" in normalizePost(base), false);
  const tree = normalizeComments([
    { kind: "t1", data: { id: "c", body: "x", likes: false } },
  ]);
  assert.equal(tree.comments[0]?.vote, -1);
});
test("reads only the account name and picture, never the modhash", () => {
  assert.deepEqual(
    normalizeAccount({
      data: {
        name: "reader_1",
        modhash: "secret",
        is_mod: true,
        inbox_count: 3,
        icon_img: "https://styles.redditmedia.com/t5_u/profileIcon.png?a=1&amp;b=2",
        snoovatar_img: "https://i.redd.it/snoo.png",
      },
    }),
    {
      name: "reader_1",
      icon: "https://styles.redditmedia.com/t5_u/profileIcon.png?a=1&b=2",
      isMod: true,
      inboxCount: 3,
    },
  );
  assert.deepEqual(
    normalizeAccount({
      data: { name: "snoo_fan", icon_img: "", snoovatar_img: "https://i.redd.it/snoo.png" },
    }),
    { name: "snoo_fan", icon: "https://i.redd.it/snoo.png" },
  );
  assert.equal(normalizeAccount({}), null); // Signed out.
  assert.equal(normalizeAccount({ data: { name: "<bad name>" } }), null);
});
test("normalizes profile and moderator listings with reports", () => {
  const items = normalizeListing([
    {
      kind: "t3",
      data: {
        id: "p1", name: "t3_p1", title: "Post", created_utc: 1, permalink: "/r/a/comments/p1/",
        user_reports: [["spam", 2]], mod_reports: [["rule 1", "modname"]],
      },
    },
    {
      kind: "t1",
      data: {
        id: "c1", name: "t1_c1", body: "Hi", author: "bob", score: 4, created_utc: 2,
        subreddit: "a", link_id: "t3_p1", link_title: "Post", permalink: "/r/a/comments/p1/x/c1/",
        approved_by: "modname", user_reports: [], mod_reports: [],
      },
    },
    { kind: "more", data: {} },
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0]?.type === "post" && items[0].post.mod, {
    reports: ["u/modname: rule 1", "2: spam"],
  });
  assert.equal(items[1]?.type === "comment" && items[1].comment.postId, "t3_p1");
  assert.deepEqual(items[1]?.type === "comment" && items[1].comment.mod, {
    reports: [],
    state: "approved",
  });
});
test("normalizes inbox messages and comment notifications", () => {
  const [message, reply, mention] = normalizeInbox([
    {
      kind: "t4",
      data: { name: "t4_m1", subject: "Hello", body: "Hi", author: "bob", dest: "me", new: true, created_utc: 3,
        replies: { data: { children: [{}, {}] } } },
    },
    {
      kind: "t1",
      data: { name: "t1_r1", type: "comment_reply", link_title: "A post", subreddit: "a", body: "Reply",
        author: "carol", dest: "me", new: false, created_utc: 4, context: "/r/a/comments/p9/x/r1/?context=3" },
    },
    { kind: "t1", data: { name: "t1_r2", type: "username_mention", body: "u/me", author: "dan", created_utc: 5 } },
  ]);
  assert.equal(message?.kind, "message");
  assert.equal(message?.unread, true);
  assert.equal(message?.replies, 2);
  assert.equal(reply?.kind, "comment_reply");
  assert.equal(reply?.subject, "A post");
  assert.equal(reply?.postId, "t3_p9");
  assert.equal(mention?.kind, "mention");
});
test("normalizes user profiles and friends", () => {
  assert.deepEqual(
    normalizeUserAbout({
      data: { name: "spez", link_karma: 10, comment_karma: 20, created_utc: 100, is_friend: true,
        icon_img: "https://example.com/i.png" },
    }),
    { name: "spez", icon: "https://example.com/i.png", linkKarma: 10, commentKarma: 20,
      createdAt: 100000, isFriend: true, suspended: false },
  );
  assert.equal(normalizeUserAbout({ data: { name: "<x>" } }), null);
  assert.deepEqual(
    normalizeFriends([
      { kind: "UserList", data: { children: [{ name: "zed", date: 2 }, { name: "amy", date: 1 }, { name: "<bad>" }] } },
    ]),
    [{ name: "amy", addedAt: 1000 }, { name: "zed", addedAt: 2000 }],
  );
});
test("normalizes community moderators", () => {
  assert.deepEqual(
    normalizeModerators({
      data: {
        children: [
          { name: "modone", date: 1500000000, mod_permissions: ["all"] },
          { name: "<bad>", date: 1 },
        ],
      },
    }),
    [{ name: "modone", since: 1500000000000, permissions: ["all"] }],
  );
  assert.deepEqual(normalizeModerators({}), []);
});
test("reads whether the viewer subscribes to a search result", () => {
  assert.equal(normalizeCommunity({ display_name: "pics", user_is_subscriber: true })?.subscribed, true);
  assert.equal("subscribed" in normalizeCommunity({ display_name: "pics" })!, false);
});
test("reads whether the viewer saved a post", () => {
  const base = { id: "s", title: "T", created_utc: 1, permalink: "/r/t/comments/s/" };
  assert.equal(normalizePost({ ...base, saved: true }).saved, true);
  assert.equal("saved" in normalizePost(base), false);
});

test("tells who removed a post or comment", () => {
  const base = { id: "r", title: "T", created_utc: 1, permalink: "/r/t/comments/r/" };
  assert.equal(normalizePost({ ...base, removed_by_category: "moderator" }).removed, "mods");
  assert.equal(normalizePost({ ...base, removed_by_category: "automod_filtered" }).removed, "mods");
  assert.equal(normalizePost({ ...base, removed_by_category: "anti_evil_ops" }).removed, "reddit");
  assert.equal(normalizePost({ ...base, removed_by_category: "deleted" }).removed, "author");
  assert.equal(normalizePost({ ...base, selftext: "[removed]" }).removed, "mods");
  assert.equal("removed" in normalizePost({ ...base, selftext: "Hello" }), false);
  const { comments } = normalizeComments([
    { kind: "t1", data: { id: "a", body: "[removed]" } },
    { kind: "t1", data: { id: "b", body: "[deleted]" } },
    { kind: "t1", data: { id: "c", body: "Still here" } },
  ]);
  assert.deepEqual(comments.map((c) => c.removed), ["mods", "author", undefined]);
});

test("skips a post Reddit sends in an unexpected shape instead of the whole listing", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const base = { title: "T", created_utc: 1, permalink: "/r/t/comments/a/" };
  assert.deepEqual(eachItem({ not: "a list" }, () => [1]), []);
  assert.deepEqual(
    eachItem([1, 2, 3], (n) => {
      if (n === 2) throw new Error("new shape");
      return [n];
    }),
    [1, 3],
  );
  // Fields that stop being lists no longer throw.
  const odd = normalizePost({
    ...base,
    id: "odd",
    gallery_data: { items: { first: { media_id: "x" } } },
    poll_data: { options: "yes/no" },
    mod_reports: [null, ["spam", "modone"]],
    crosspost_parent_list: [{ ...base, id: "parent", gallery_data: { items: [null] } }],
  });
  assert.equal(odd.id, "t3_odd");
  assert.equal(odd.mod?.reports[0], "u/modone: spam");
  // A post that can't be read at all is left out of the listing.
  const items = normalizeListing([
    { kind: "t3", data: { ...base, id: "a" } },
    { kind: "t3", data: null },
    null,
    { kind: "t3", data: { ...base, id: "b" } },
  ]);
  assert.deepEqual(
    items.map((item) => item.type === "post" && item.post.id),
    ["t3_a", "t3_b"],
  );
  assert.equal(warn.mock.callCount(), 2);
});

test("skips comments, messages and rules Reddit sends in an unexpected shape", (t) => {
  t.mock.method(console, "warn", () => {});
  const { comments, more } = normalizeComments([
    { kind: "t1", data: { id: "a", body: "Kept", replies: { data: { children: "none" } } } },
    { kind: "t1", data: null },
    null,
    { kind: "more" },
    {
      kind: "t1",
      data: {
        id: "b",
        body: "Also kept",
        replies: { data: { children: [{ kind: "t1" }, { kind: "t1", data: { id: "c" } }] } },
      },
    },
  ]);
  assert.equal(more, true);
  assert.deepEqual(comments.map((c) => c.id), ["t1_a", "t1_b"]);
  assert.deepEqual(comments[1]!.replies.map((c) => c.id), ["t1_c"]);
  assert.deepEqual(normalizeComments({ children: [] } as never), { comments: [], more: false });
  assert.equal(normalizeInbox([null, { kind: "t4", data: { id: "m", subject: "Hi" } }]).length, 1);
  assert.deepEqual(normalizeRules({ rules: [null, { short_name: "Be kind" }] }), [
    { title: "Be kind", description: "" },
  ]);
});
