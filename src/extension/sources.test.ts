import test from "node:test";
import assert from "node:assert/strict";
import { instanceHome, instanceHost, sourceUrl } from "./sources.ts";

test("reads a Lemmy instance from an address, link or handle", () => {
  for (const input of [
    "lemmy.world",
    " Lemmy.World ",
    "https://lemmy.world",
    "https://lemmy.world/c/memes?sort=New",
    "!memes@lemmy.world",
    "@someone@lemmy.world",
  ])
    assert.equal(instanceHost(input), "lemmy.world", input);
  assert.equal(instanceHost("sh.itjust.works"), "sh.itjust.works");
});

test("refuses anything but a public https host name", () => {
  for (const input of [
    "",
    "lemmy",
    "localhost",
    "http://lemmy.world",
    "ftp://lemmy.world",
    "javascript:alert(1)",
    "lemmy.world:8536",
    "https://user:pass@lemmy.world",
    "192.168.1.10",
    "-bad.example",
    "bad_name.example",
    "reddit.com",
    "old.reddit.com",
    "!memes@",
  ])
    assert.equal(instanceHost(input), null, input);
});

test("lets the tab go only to a source's front page, or a hybrid feed item's page", () => {
  assert.equal(sourceUrl("https://www.reddit.com/"), "https://www.reddit.com/");
  assert.equal(sourceUrl(instanceHome("lemmy.world")), "https://lemmy.world/");
  for (const value of [
    "https://lemmy.world/post/123",
    "https://lemmy.world/comment/45",
    "https://lemmy.world/c/memes",
    "https://lemmy.world/c/linux@lemmy.ml",
    "https://lemmy.world/u/some_one@sh.itjust.works",
  ])
    assert.equal(sourceUrl(value), value);
  for (const value of [
    undefined,
    42,
    "https://www.reddit.com/r/all/",
    "https://www.reddit.com/post/123",
    "https://old.reddit.com/",
    "https://lemmy.world/post/abc",
    "https://lemmy.world/post/123/edit",
    "https://lemmy.world/c/me%20mes",
    "https://lemmy.world/settings",
    "https://lemmy.world/api/v3/user/logout",
    "https://lemmy.world/?x=1",
    "https://lemmy.world/#x",
    "https://lemmy.world:8536/",
    "http://lemmy.world/",
    "https://localhost/",
    "https://127.0.0.1/",
    "javascript:alert(1)",
    "https://" + "a".repeat(300) + ".example/",
  ])
    assert.equal(sourceUrl(value), null, String(value));
});
