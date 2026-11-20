import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanMuteName,
  hidesPost,
  mutedChanges,
  mutedText,
  parseMutedText,
  mutedSet,
  parseMuted,
  withMuted,
  withoutMuted,
} from "./muteState.ts";

test("parseMuted keeps names once each, sorted, and drops anything else", () => {
  assert.deepEqual(parseMuted(["pics", "AskReddit", " Pics ", 4, "", null, "news"]), [
    "AskReddit",
    "news",
    "pics",
  ]);
  assert.deepEqual(parseMuted({ pics: true }), []);
  assert.deepEqual(parseMuted(undefined), []);
});

test("withMuted adds a name once, whatever its case", () => {
  assert.deepEqual(withMuted(["pics"], "news"), ["news", "pics"]);
  assert.deepEqual(withMuted(["pics"], "PICS"), ["pics"]);
});

test("withoutMuted removes a name whatever its case", () => {
  assert.deepEqual(withoutMuted(["news", "Pics"], "pics"), ["news"]);
  assert.deepEqual(withoutMuted(["news"], "pics"), ["news"]);
});

test("hidesPost hides a muted community everywhere but its own feed", () => {
  const muted = mutedSet(["Pics", "memes@lemmy.world"]);
  assert.equal(hidesPost(muted, "pics", "Home"), true);
  assert.equal(hidesPost(muted, "PICS", "popular"), true);
  assert.equal(hidesPost(muted, "pics", "Pics"), false);
  assert.equal(hidesPost(muted, "news", "Home"), false);
  assert.equal(hidesPost(muted, "memes@lemmy.world", "Home"), true);
  assert.equal(hidesPost(muted, "memes", "Home"), false);
});

test("cleanMuteName drops the r/, c/ or ! in front and a trailing slash", () => {
  assert.equal(cleanMuteName(" r/pics "), "pics");
  assert.equal(cleanMuteName("/r/pics/"), "pics");
  assert.equal(cleanMuteName("c/memes@lemmy.world"), "memes@lemmy.world");
  assert.equal(cleanMuteName("!memes@lemmy.world"), "memes@lemmy.world");
  assert.equal(cleanMuteName("AskReddit"), "AskReddit");
});

test("parseMutedText reads one name a line, reporting bad and repeated lines", () => {
  const valid = (name: string) => /^[A-Za-z0-9_]{2,21}$/.test(name);
  const text = "r/pics\n\nnews\nnot a name\nPICS\n/r/AskReddit/";
  assert.deepEqual(parseMutedText(text, valid), {
    names: ["AskReddit", "news", "pics"],
    errors: [4],
    repeats: [[5, 1]],
  });
  assert.deepEqual(parseMutedText("", valid), { names: [], errors: [], repeats: [] });
});

test("mutedText and parseMutedText round-trip the list", () => {
  const list = ["AskReddit", "news", "pics"];
  assert.deepEqual(parseMutedText(mutedText(list), () => true).names, list);
});

test("mutedChanges counts names added and removed, whatever their case", () => {
  assert.deepEqual(mutedChanges(["pics", "news"], ["PICS", "memes"]), { added: 1, removed: 1 });
  assert.deepEqual(mutedChanges([], []), { added: 0, removed: 0 });
});
