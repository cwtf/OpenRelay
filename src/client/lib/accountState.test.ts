import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_ACCOUNTS,
  makeDefault,
  markExpired,
  otherAccounts,
  parseAccounts,
  reconcile,
  removeAccount,
  signedOut,
  startAdding,
  switchedTo,
  type AccountState,
} from "./accountState.ts";

const two: AccountState = {
  list: [{ name: "alice", icon: "a.png" }, { name: "bob" }],
  active: "alice",
};

test("one account with no list stays unlisted", () => {
  assert.equal(reconcile(NO_ACCOUNTS, { name: "alice" }), NO_ACCOUNTS);
  assert.equal(reconcile(NO_ACCOUNTS, null), NO_ACCOUNTS);
});

test("adding lists the current account, then the one signed in next", () => {
  const adding = startAdding(NO_ACCOUNTS, { name: "alice", icon: "a.png" });
  assert.deepEqual(adding, { list: [{ name: "alice", icon: "a.png" }], active: null, adding: true });
  // Back on the site before signing in: still adding.
  assert.deepEqual(reconcile(adding, null), adding);
  assert.deepEqual(reconcile(adding, { name: "bob" }), { list: two.list, active: "bob" });
});

test("adding while signed out lists only the new account", () => {
  const adding = startAdding(NO_ACCOUNTS, null);
  assert.deepEqual(reconcile(adding, { name: "carol" }), { list: [{ name: "carol" }], active: "carol" });
});

test("signing in on the site itself is followed", () => {
  assert.deepEqual(reconcile(two, { name: "BOB" }), { list: two.list, active: "bob" });
  assert.deepEqual(reconcile(two, { name: "carol" }).list.map((a) => a.name), ["alice", "bob", "carol"]);
  assert.deepEqual(reconcile(two, null), { list: two.list, active: null });
});

test("a fresh picture replaces the saved one, and signing in again clears expired", () => {
  const expired = markExpired(two, "bob");
  assert.equal(expired.list[1]!.expired, true);
  assert.deepEqual(reconcile(expired, { name: "bob", icon: "b.png" }).list[1], { name: "bob", icon: "b.png" });
  assert.deepEqual(switchedTo(expired, "bob"), { list: two.list, active: "bob" });
});

test("switching, signing out and the default order", () => {
  assert.equal(switchedTo(two, "nobody").active, null);
  assert.deepEqual(signedOut({ ...two, adding: true }), { list: two.list, active: null });
  assert.deepEqual(makeDefault(two, "bob").list.map((a) => a.name), ["bob", "alice"]);
  assert.equal(makeDefault(two, "nobody"), two);
  assert.deepEqual(otherAccounts(two).map((a) => a.name), ["bob"]);
});

test("removing an account, never the signed-in one", () => {
  assert.equal(removeAccount(two, "alice"), two);
  // Only the signed-in account would be left: nothing to switch between.
  assert.deepEqual(removeAccount(two, "bob"), NO_ACCOUNTS);
  // Signed out with one other account left: it stays to switch back to.
  const out = signedOut(two);
  assert.deepEqual(removeAccount(out, "alice"), { list: [{ name: "bob" }], active: null });
  const three = reconcile(two, { name: "carol" });
  assert.deepEqual(removeAccount(three, "bob").list.map((a) => a.name), ["alice", "carol"]);
});

test("stored state is checked", () => {
  assert.deepEqual(parseAccounts(null), NO_ACCOUNTS);
  assert.deepEqual(
    parseAccounts({
      list: [{ name: "alice", icon: 3 }, { name: "ALICE" }, { name: "x y" }, null, { name: "bob", expired: true }],
      active: "Alice",
      adding: "yes",
    }),
    { list: [{ name: "alice" }, { name: "bob", expired: true }], active: "alice" },
  );
  assert.equal(parseAccounts({ list: [], active: "ghost" }).active, null);
});
