import assert from "node:assert/strict";
import test from "node:test";
import { accountKey, cookieSite, inDomain, keepCookie, restoreDetails, type SavedCookie } from "./cookies.ts";

test("a site's sign-in is all of reddit.com, or the instance's own host", () => {
  assert.deepEqual(cookieSite("www.reddit.com"), {
    domain: "reddit.com",
    origins: ["https://*.reddit.com/*"],
  });
  assert.equal(cookieSite("old.reddit.com")?.domain, "reddit.com");
  assert.deepEqual(cookieSite("lemmy.world"), {
    domain: "lemmy.world",
    origins: ["https://lemmy.world/*"],
  });
  for (const bad of ["", "localhost", "evil.reddit.com", "a/b.com", "LEMMY.WORLD", "x.com:8"])
    assert.equal(cookieSite(bad), null, bad);
});

test("cookie domains match the site and its subdomains only", () => {
  assert.ok(inDomain(".reddit.com", "reddit.com"));
  assert.ok(inDomain("www.reddit.com", "reddit.com"));
  assert.ok(!inDomain("notreddit.com", "reddit.com"));
  assert.ok(!inDomain("reddit.com.evil", "reddit.com"));
});

const base: SavedCookie = {
  name: "reddit_session",
  value: "abc",
  domain: ".reddit.com",
  hostOnly: false,
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "no_restriction",
  session: false,
  expirationDate: 2_000_000_000,
};

test("a saved cookie keeps its flags and drops the store it came from", () => {
  const kept = keepCookie({ ...base, storeId: "0" } as SavedCookie);
  assert.deepEqual(kept, {
    name: "reddit_session",
    value: "abc",
    domain: ".reddit.com",
    hostOnly: false,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "no_restriction",
    expirationDate: 2_000_000_000,
  });
  assert.equal(keepCookie({ ...base, session: true }).expirationDate, undefined);
});

test("restoring sets a domain cookie with its domain and a host-only one without", () => {
  assert.deepEqual(restoreDetails(base, "firefox-container-1", 0), {
    url: "https://reddit.com/",
    name: "reddit_session",
    value: "abc",
    domain: ".reddit.com",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "no_restriction",
    expirationDate: 2_000_000_000,
    storeId: "firefox-container-1",
  });
  const hostOnly = restoreDetails(
    { ...base, domain: "www.reddit.com", hostOnly: true, sameSite: "unspecified", path: "/r" },
    undefined,
    0,
  )!;
  assert.equal(hostOnly.domain, undefined);
  assert.equal(hostOnly.sameSite, undefined);
  assert.equal(hostOnly.url, "https://www.reddit.com/r");
  assert.equal(hostOnly.storeId, undefined);
});

test("an expired cookie isn't put back", () => {
  assert.equal(restoreDetails(base, undefined, 2_000_000_000 * 1000), null);
  const { expirationDate: _, ...session } = base;
  assert.ok(restoreDetails(session, undefined, Number.MAX_SAFE_INTEGER));
});

test("saved sign-ins are keyed by cookie domain and account", () => {
  assert.equal(accountKey("reddit.com", "alice"), "openrelay-accounts:reddit.com:alice");
});
