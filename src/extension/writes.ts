import { isThingId, type Vote, type VoteResult } from "./votes.ts";
import type { CommentNode } from "../shared/api.ts";
import { normalizeComments, safeUrl } from "./reddit.ts";

/**
 * Writes to Reddit through its own `/api/*` endpoints with the tab's
 * signed-in session. Requests are same-origin from the Reddit tab and carry
 * the session's modhash (Reddit's CSRF token), read from `/api/me.json` and
 * kept only in memory here. The reader never sees the modhash; it can only
 * ask for one of the actions below, each with validated parameters.
 */
type Fetch = typeof fetch;
type Session = { uh: string; id: string };
type Params = Record<string, string>;

let session: Promise<Session> | null = null;
const pending = new Set<string>();

const readSession = async (fetchFn: Fetch, origin: string): Promise<Session> => {
  const response = await fetchFn(new URL("/api/me.json", origin), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const data = response.ok ? await response.json().catch(() => null) : null;
  const uh = data?.data?.modhash;
  if (typeof uh !== "string" || !/^[\w-]{8,}$/.test(uh))
    throw new Error("Sign in to Reddit first.");
  const id = String(data.data.id ?? "");
  return { uh, id: /^[a-z0-9]+$/i.test(id) ? "t2_" + id : "" };
};

/** POST to a Reddit API path, refreshing a stale modhash once. */
async function post(
  fetchFn: Fetch,
  origin: string,
  path: string,
  params: (me: Session) => Params,
): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    session ??= readSession(fetchFn, origin);
    let me: Session;
    try {
      me = await session;
    } catch (error) {
      session = null;
      throw error;
    }
    const response = await fetchFn(new URL(path, origin), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Modhash": me.uh,
      },
      body: new URLSearchParams({ ...params(me), uh: me.uh, api_type: "json" }),
      signal: AbortSignal.timeout(20000),
    });
    // A stale modhash is rejected with 403; fetch a fresh one once.
    if (response.status === 403 && attempt === 0) {
      session = null;
      continue;
    }
    if (response.status === 429)
      throw new Error("Reddit is rate limiting requests. Try again shortly.");
    if (response.status === 401 || response.status === 403)
      throw new Error("Reddit refused the request. Check that you are signed in.");
    if (!response.ok)
      throw new Error(`Reddit could not complete the request (${response.status}).`);
    const body = await response.json().catch(() => ({}));
    const errors = body?.json?.errors;
    if (Array.isArray(errors) && errors.length)
      throw new Error(String(errors[0]?.[1] || "Reddit could not complete the request."));
    return body;
  }
}

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
    await post(fetchFn, origin, "/api/vote", () => ({
      id: thingId,
      dir: String(dir as Vote),
    }));
    return { available: true, vote: dir, status: "changed", via: "api" };
  } finally {
    pending.delete(thingId);
  }
}

// -- validated actions requested by the reader

const fail = (): never => {
  throw new Error("Invalid request");
};
const thing = (value: unknown, kinds: string): string =>
  typeof value === "string" && new RegExp(`^t[${kinds}]_[a-z0-9]{1,16}$`, "i").test(value)
    ? value
    : fail();
const user = (value: unknown): string =>
  typeof value === "string" && /^[\w-]{3,20}$/.test(value) ? value : fail();
/** A username, or `/r/name` to message a community's moderators. */
const recipient = (value: unknown): string =>
  typeof value === "string" && /^\/r\/[A-Za-z0-9][A-Za-z0-9_]{1,20}$/.test(value)
    ? value
    : user(value);
const community = (value: unknown): string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/.test(value)
    ? value
    : fail();
const text = (value: unknown, max: number, required = true): string =>
  typeof value === "string" &&
  value.length <= max &&
  (!required || value.trim().length > 0)
    ? value
    : fail();
const flag = (value: unknown): string => (value === true ? "true" : "false");

type Args = Record<string, unknown>;
type Action = { path: string; params: (args: Args, me: Session) => Params };

const ACTIONS: Record<string, Action> = {
  // Inbox
  read_message: { path: "/api/read_message", params: (a) => ({ id: thing(a.id, "14") }) },
  unread_message: { path: "/api/unread_message", params: (a) => ({ id: thing(a.id, "14") }) },
  read_all_messages: { path: "/api/read_all_messages", params: () => ({}) },
  del_msg: { path: "/api/del_msg", params: (a) => ({ id: thing(a.id, "4") }) },
  block: { path: "/api/block", params: (a) => ({ id: thing(a.id, "14") }) },
  compose: {
    path: "/api/compose",
    params: (a) => ({
      to: recipient(a.to),
      subject: text(a.subject, 100),
      text: text(a.text, 10000),
    }),
  },
  // Replies to messages and comments.
  comment: {
    path: "/api/comment",
    params: (a) => ({ thing_id: thing(a.parent, "134"), text: text(a.text, 10000) }),
  },
  // Communities
  subscribe: {
    path: "/api/subscribe",
    params: (a) => ({
      action: a.action === "unsub" ? "unsub" : a.action === "sub" ? "sub" : fail(),
      sr_name: community(a.sr),
      ...(a.action === "sub" ? { skip_initial_defaults: "true" } : {}),
    }),
  },
  // Moderation
  approve: { path: "/api/approve", params: (a) => ({ id: thing(a.id, "13") }) },
  remove: {
    path: "/api/remove",
    params: (a) => ({ id: thing(a.id, "13"), spam: flag(a.spam) }),
  },
  ignore_reports: { path: "/api/ignore_reports", params: (a) => ({ id: thing(a.id, "13") }) },
  // Friends (the container is the signed-in account)
  friend: {
    path: "/api/friend",
    params: (a, me) => ({ name: user(a.name), type: "friend", container: me.id || fail() }),
  },
  unfriend: {
    path: "/api/unfriend",
    params: (a, me) => ({ name: user(a.name), type: "friend", container: me.id || fail() }),
  },
  // New post
  submit: {
    path: "/api/submit",
    params: (a) => {
      const kind = a.kind === "link" ? "link" : a.kind === "self" ? "self" : fail();
      const url = kind === "link" ? safeUrl(a.url) || fail() : "";
      return {
        sr: community(a.sr),
        kind,
        title: text(a.title, 300),
        ...(kind === "link" ? { url } : { text: text(a.text ?? "", 40000, false) }),
        sendreplies: a.sendreplies === false ? "false" : "true",
        nsfw: flag(a.nsfw),
        spoiler: flag(a.spoiler),
        resubmit: flag(a.resubmit),
      };
    },
  },
};

export type ActionName = keyof typeof ACTIONS;
export const isAction = (name: unknown): name is ActionName =>
  typeof name === "string" && Object.hasOwn(ACTIONS, name);

/** Run one allow-listed action; returns only what the reader needs. */
export async function apiAction(
  fetchFn: Fetch,
  origin: string,
  name: unknown,
  args: unknown,
): Promise<{ id?: string; url?: string; comment?: CommentNode }> {
  if (!isAction(name) || !args || typeof args !== "object") fail();
  const action = ACTIONS[name as string]!;
  // Validate before reading the session, so bad input never reaches Reddit.
  action.params(args as Args, { uh: "", id: "t2_validate" });
  const body = await post(fetchFn, origin, action.path, (me) =>
    action.params(args as Args, me),
  );
  const data = body?.json?.data;
  const created = data?.things?.[0]?.data;
  const id = String(data?.name ?? created?.name ?? "");
  const url = safeUrl(data?.url);
  // A posted reply comes back as the new comment, so it can be shown at once.
  const comment =
    data?.things?.[0]?.kind === "t1"
      ? normalizeComments([data.things[0]]).comments[0]
      : undefined;
  return {
    ...(/^t\d_[a-z0-9]+$/i.test(id) ? { id } : {}),
    ...(url ? { url } : {}),
    ...(comment ? { comment } : {}),
  };
}

/** Forget the cached session (tests). */
export const resetWrites = (): void => {
  session = null;
  pending.clear();
};
