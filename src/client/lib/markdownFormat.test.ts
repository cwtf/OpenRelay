import test from "node:test";
import assert from "node:assert/strict";
import { applyFormat, type Edit } from "./markdownFormat.ts";

/** "a[b]c": brackets mark the selection. */
const edit = (marked: string): Edit => {
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { text: marked.replace("[", "").replace("]", ""), start, end };
};
const show = ({ text, start, end }: Edit) =>
  text.slice(0, start) + "[" + text.slice(start, end) + "]" + text.slice(end);

test("wraps the selection, or inserts selected placeholder text", () => {
  assert.equal(show(applyFormat(edit("say [hi] now"), "bold")), "say **[hi]** now");
  assert.equal(show(applyFormat(edit("say [] now"), "italic")), "say *[italic text]* now");
  assert.equal(show(applyFormat(edit("[x]"), "strike")), "~~[x]~~");
  assert.equal(show(applyFormat(edit("[x]"), "spoiler")), ">![x]!<");
  assert.equal(show(applyFormat(edit("[x]"), "superscript")), "^([x])");
  assert.equal(show(applyFormat(edit("[x]"), "code")), "`[x]`");
});

test("prefixes every selected line as its own paragraph", () => {
  assert.equal(show(applyFormat(edit("[one\ntwo]"), "quote")), "[> one\n> two]");
  assert.equal(show(applyFormat(edit("[a\nb\nc]"), "numbers")), "[1. a\n2. b\n3. c]");
  assert.equal(show(applyFormat(edit("intro\n[a]"), "bullets")), "intro\n\n[- a]");
  assert.equal(show(applyFormat(edit("[]"), "header")), "[# Heading]");
});

test("builds links with the URL selected, rules and code blocks", () => {
  assert.equal(show(applyFormat(edit("see [docs]"), "link")), "see [docs]([https://])");
  assert.equal(show(applyFormat(edit("[]"), "link")), "[link text]([https://])");
  assert.equal(show(applyFormat(edit("end[]"), "rule")), "end\n\n---\n\n[]");
  assert.equal(
    show(applyFormat(edit("[a\nb]"), "code")),
    "\n```\n[a\nb]\n```\n",
  );
});
