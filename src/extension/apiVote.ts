import { isThingId, type Vote, type VoteResult } from "./votes.ts";

/**
 * Casts a vote through Reddit's own `/api/vote` endpoint with the tab's
 * signed-in session. Used only when Reddit's vote buttons for that post or
 * comment are not on the page (content the reader fetched itself).
 *
 * The request is same-origin from the Reddit tab and carries the session's
 * modhash (Reddit's CSRF token), read from `/api/me.json` and kept only in
 * memory. Nothing else is written and no token leaves the Reddit tab.
 */
type Fetch = typeof fetch;

let modhash: Promise<string> | null = null;
const pending = new Set<string>();

const readModhash = async (fetchFn: Fetch, origin: string): Promise<string> => {
  const response = await fetchFn(new URL("/api/me.json", origin), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const data = response.ok
    ? await response.json().catch(() => null)
    : null;
  const value = data?.data?.modhash;
  if (typeof value !== "string" || !/^[\w-]{8,}$/.test(value))
    throw new Error("Sign in to Reddit to vote.");
  return value;
};

const post = async (
  fetchFn: Fetch,
  origin: string,
  uh: string,
  thingId: string,
  dir: Vote,
) =>
  fetchFn(new URL("/api/vote", origin), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Modhash": uh,
    },
    body: new URLSearchParams({
      id: thingId,
      dir: String(dir),
      uh,
      api_type: "json",
    }),
    signal: AbortSignal.timeout(15000),
  });

export async function apiVote(
  fetchFn: Fetch,
  origin: string,
  thingId: unknown,
  dir: unknown,
): Promise<VoteResult> {
  if (!isThingId(thingId) || (dir !== 1 && dir !== 0 && dir !== -1))
    throw new Error("Invalid vote request");
  if (pending.has(thingId)) return { available: true, vote: null, status: "busy" };
  pending.add(thingId);
  try {
    for (let attempt = 0; ; attempt++) {
      modhash ??= readModhash(fetchFn, origin);
      let uh: string;
      try {
        uh = await modhash;
      } catch (error) {
        modhash = null;
        throw error;
      }
      const response = await post(fetchFn, origin, uh, thingId, dir);
      // A stale modhash is rejected with 403; fetch a fresh one once.
      if (response.status === 403 && attempt === 0) {
        modhash = null;
        continue;
      }
      if (response.status === 429)
        throw new Error("Reddit is rate limiting votes. Try again shortly.");
      if (response.status === 401 || response.status === 403)
        throw new Error("Reddit refused the vote. Check that you are signed in.");
      if (!response.ok)
        throw new Error(`Reddit could not record the vote (${response.status}).`);
      const body = await response.json().catch(() => ({}));
      const errors = body?.json?.errors;
      if (Array.isArray(errors) && errors.length)
        throw new Error(
          String(errors[0]?.[1] || "Reddit could not record the vote."),
        );
      return { available: true, vote: dir, status: "changed", via: "api" };
    }
  } finally {
    pending.delete(thingId);
  }
}

/** Forget the cached modhash (tests). */
export const resetApiVote = (): void => {
  modhash = null;
  pending.clear();
};
