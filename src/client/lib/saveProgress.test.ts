import test from "node:test";
import assert from "node:assert/strict";
import {
  saveState,
  secondsLeft,
  timeLeftLabel,
  type SaveProgress,
} from "./saveProgress.ts";

const progress = (done: number, stopping = false): SaveProgress => ({
  ids: ["t3_a", "t3_b", "t3_c", "t3_d"],
  done,
  started: 0,
  stopping,
});

test("the post being saved, the ones after it and the ones done", () => {
  const p = progress(1);
  assert.deepEqual(
    ["t3_a", "t3_b", "t3_c", "t3_x"].map((id) => saveState(p, id)),
    [null, "saving", "queued", null],
  );
  assert.equal(saveState(null, "t3_a"), null);
  // Still picking: nothing is waiting yet.
  assert.equal(saveState({ ...p, ids: [], done: 0 }, "t3_a"), null);
});

test("once stopped, only the post being saved is still shown", () => {
  const p = progress(1, true);
  assert.deepEqual(
    ["t3_b", "t3_c"].map((id) => saveState(p, id)),
    ["saving", null],
  );
});

test("time left follows the average pace, from the first post done", () => {
  assert.equal(secondsLeft(progress(0), 5000), null);
  // One post took 2 s: three more take 6 s.
  assert.equal(secondsLeft(progress(1), 2000), 6);
  assert.equal(secondsLeft(progress(4), 8000), null);
});

test("time left is shown in whole minutes, rounded up", () => {
  assert.equal(timeLeftLabel(12), "under a minute left");
  assert.equal(timeLeftLabel(60), "about 1 min left");
  assert.equal(timeLeftLabel(61), "about 2 min left");
});
