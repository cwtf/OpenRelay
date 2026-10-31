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

test("lets the tab go only to a source's front page", () => {
  assert.equal(sourceUrl("https://www.reddit.com/"), "https://www.reddit.com/");
  assert.equal(sourceUrl(instanceHome("lemmy.world")), "https://lemmy.world/");
  for (const value of [
    undefined,
    42,
    "https://www.reddit.com/r/all/",
    "https://old.reddit.com/",
    "https://lemmy.world/c/memes",
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
