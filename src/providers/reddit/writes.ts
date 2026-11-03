import { isThingId, type Vote, type VoteResult } from "./votes.ts";
import type { CommentNode } from "../../shared/api.ts";
import { normalizeComments, safeUrl } from "./reddit.ts";
import { hasMediaRef, toRichtext } from "./richtext.ts";
import type { ImageFile } from "../upload.ts";

/**
 * Writes to Reddit through its own `/api/*` endpoints with the tab's
 * signed-in session. Requests are same-origin from the Reddit tab and carry
 * the session's modhash (Reddit's CSRF token), read from `/api/me.json` and
 * kept only in memory here. The reader never sees the modhash; it can only
 * ask for one of the actions below, each with validated parameters.
 */
type Fetch = typeof fetch;
type Session = { uh: string; id: string; name: string };
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
  const name = String(data.data.name ?? "");
  return {
    uh,
    id: /^[a-z0-9]+$/i.test(id) ? "t2_" + id : "",
    name: /^[\w-]{1,30}$/.test(name) ? name : "",
  };
};

/**
 * Reddit turned the request down in its answer (an error list, or 400), so
 * it did nothing, and the same write sent differently can't be a duplicate.
 * A timeout or a 5xx is no refusal: the write may have gone through.
 */
class Refused extends Error {
  /** Reddit's error code (`RATELIMIT`, …), when its answer gave one. */
  code: string;
  constructor(message: string, code = "") {
    super(message);
    this.code = code;
  }
}

/**
 * How long Reddit's rate limit asks to wait ("Take a break for 5 seconds"),
 * when it is short enough to wait out within a reply: at most 10 seconds.
 */
const rateLimitWait = (error: unknown): number | null => {
  if (!(error instanceof Refused) || error.code !== "RATELIMIT") return null;
  const seconds = /(\d+)\s*seconds?/i.exec(error.message)?.[1];
  return seconds && Number(seconds) <= 10 ? (Number(seconds) + 1) * 1000 : null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POST to a Reddit API path, refreshing a stale modhash once. `refused` is
 * the error when Reddit still answers 401 or 403.
 */
async function post(
  fetchFn: Fetch,
  origin: string,
  path: string,
  params: (me: Session) => Params,
  refused = "Reddit refused the request. Check that you are signed in.",
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
      throw new Error(refused);
    if (!response.ok)
      throw new (response.status === 400 ? Refused : Error)(
        `Reddit could not complete the request (${response.status}).`,
      );
    const body = await response.json().catch(() => ({}));
    const errors = body?.json?.errors;
    if (Array.isArray(errors) && errors.length)
      throw new Refused(
        String(errors[0]?.[1] || "Reddit could not complete the request."),
        String(errors[0]?.[0] ?? ""),
      );
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
  // Saving posts and comments; editing or deleting your own.
  save: { path: "/api/save", params: (a) => ({ id: thing(a.id, "13") }) },
  unsave: { path: "/api/unsave", params: (a) => ({ id: thing(a.id, "13") }) },
  edit: {
    path: "/api/editusertext",
    params: (a) => ({ thing_id: thing(a.id, "13"), text: text(a.text, 40000) }),
  },
  del: { path: "/api/del", params: (a) => ({ id: thing(a.id, "13") }) },
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

/** A comment's `t1_` full name from either its full name or its bare id. */
const fullName = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const id = value.startsWith("t1_") ? value : "t1_" + value;
  return /^t1_[a-z0-9]+$/i.test(id) ? id : undefined;
};

/** Comments from a Reddit listing (a GET with the session), or none on failure. */
async function readComments(
  fetchFn: Fetch,
  origin: string,
  path: string,
  query: Params,
): Promise<CommentNode[]> {
  try {
    const url = new URL(path, origin);
    url.search = new URLSearchParams({ ...query, raw_json: "1" }).toString();
    const response = await fetchFn(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const listing = response.ok ? await response.json().catch(() => null) : null;
    return normalizeComments(listing?.data?.children ?? []).comments;
  } catch {
    return [];
  }
}

/** One comment by its full name, from `/api/info`. */
const commentInfo = async (fetchFn: Fetch, origin: string, name: string) =>
  (await readComments(fetchFn, origin, "/api/info.json", { id: name })).find(
    (comment) => comment.id === name,
  );

/** How long to wait before each further look for a reply Reddit hasn't listed yet. */
const REPLY_LOOKS = [1500, 3000];

/**
 * The reply just posted to `parent`, from the account's newest comments,
 * for when Reddit's answer doesn't say which comment it created (as with a
 * reply sent as richtext). Only one created since `since` (less a minute
 * for clock skew) counts, so an earlier reply to the same parent isn't
 * taken for it. Reddit can list a new comment a few seconds late, so it
 * looks again (`REPLY_LOOKS`) before giving up.
 */
async function newestReply(
  fetchFn: Fetch,
  origin: string,
  parent: string,
  since: number,
  wait: (ms: number) => Promise<void>,
): Promise<CommentNode | undefined> {
  const me = await session?.catch(() => null);
  if (!me?.name) return undefined;
  for (let look = 0; ; look++) {
    const comments = await readComments(fetchFn, origin, `/user/${me.name}/comments.json`, {
      sort: "new",
      limit: "10",
    });
    const found = comments.find(
      (comment) => comment.parentId === parent && comment.createdAt >= since - 60000,
    );
    const delay = REPLY_LOOKS[look];
    if (found || delay === undefined) return found;
    await wait(delay);
  }
}

/**
 * The comment Reddit created for a reply. Reddit may answer `/api/comment`
 * with the full comment, or with a short form (`id` already a full name,
 * `contentText`, `parent`, `link`) that lacks the author, body and time.
 * The short form is completed from `/api/info`, or failing that from what
 * the response and the session know, so the reply never shows as deleted.
 */
async function postedComment(
  fetchFn: Fetch,
  origin: string,
  created: any,
  parent: unknown,
): Promise<CommentNode | undefined> {
  if (!created || typeof created !== "object") return undefined;
  if (typeof created.author === "string" && typeof created.body === "string")
    return normalizeComments([{ kind: "t1", data: created }]).comments[0];
  const name = fullName(created.name) ?? fullName(created.id);
  if (!name) return undefined;
  const found = await commentInfo(fetchFn, origin, name);
  if (found) return found;
  const me = await session?.catch(() => null);
  return {
    id: name,
    parentId: String(created.parent ?? created.parent_id ?? parent ?? ""),
    author: me?.name || "[you]",
    body: String(created.contentText ?? ""),
    score: 1,
    createdAt: Date.now(),
    edited: false,
    stickied: false,
    locked: false,
    isSubmitter: false,
    permalink: "",
    replies: [],
    moreReplies: false,
    // Reddit upvotes your own comment when it is posted.
    vote: 1,
  };
}

/**
 * Run one allow-listed action; returns only what the reader needs. A reply
 * or edit may carry a `fallback` text (its saved media as links in place of
 * their IDs), sent instead when Reddit refuses the media by ID; `linked`
 * then says so, and `reason` is what Reddit said. Sent straight after the
 * refused reply, the fallback can meet Reddit's limit between comments; when
 * that asks for a few seconds, it is sent again once they have passed.
 */
export async function apiAction(
  fetchFn: Fetch,
  origin: string,
  name: unknown,
  args: unknown,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<{ id?: string; url?: string; comment?: CommentNode; linked?: true; reason?: string }> {
  if (!isAction(name) || !args || typeof args !== "object") fail();
  const action = ACTIONS[name as string]!;
  const writing = name === "comment" || name === "edit";
  const versions = [args as Args];
  if (writing && (args as Args).fallback !== undefined)
    versions.push({ ...(args as Args), text: (args as Args).fallback });
  // Validate before reading the session, so bad input never reaches Reddit.
  const checked = versions.map((version) =>
    action.params(version, { uh: "", id: "t2_validate", name: "" }),
  )[0]!;
  // A reply or edit with media by ID (an upload, a Giphy GIF) goes as
  // richtext instead.
  const send = (version: Args) => {
    const markdown = String(version.text ?? "");
    const rtjson = writing && hasMediaRef(markdown) ? toRichtext(markdown) : null;
    return post(fetchFn, origin, action.path, (me) => {
      const params = action.params(version, me);
      if (rtjson === null) return params;
      delete params.text;
      return { ...params, richtext_json: rtjson };
    });
  };
  const sentAt = Date.now();
  let reason: string | null = null;
  let body: any;
  try {
    body = await send(versions[0]!);
  } catch (error) {
    // Only the media by ID can differ, so a refusal of plain Markdown, or
    // Reddit's rate limit, stands.
    const fallback = versions[1];
    if (
      !(error instanceof Refused) ||
      error.code === "RATELIMIT" ||
      !fallback ||
      !hasMediaRef(checked.text ?? "")
    )
      throw error;
    reason = error.message;
    try {
      body = await send(fallback);
    } catch (limited) {
      // Refused, so nothing was posted: sending it again can't duplicate it.
      const ms = rateLimitWait(limited);
      if (ms === null) throw limited;
      await wait(ms);
      body = await send(fallback);
    }
  }
  const data = body?.json?.data;
  const created = data?.things?.[0]?.data;
  const id = String(data?.name ?? created?.name ?? fullName(created?.id) ?? "");
  const url = safeUrl(data?.url);
  // A posted reply comes back as the new comment, so it can be shown at once.
  let comment =
    data?.things?.[0]?.kind === "t1"
      ? await postedComment(fetchFn, origin, created, (args as Args).parent)
      : undefined;
  // An answer without it (Reddit's to a reply or edit with a GIF or image)
  // leaves the comment to be found: an edited one by its ID, a new reply to
  // a post or comment among the account's newest comments.
  const target = checked.thing_id ?? "";
  if (!comment && name === "edit" && target.startsWith("t1_"))
    comment = await commentInfo(fetchFn, origin, target);
  if (!comment && name === "comment" && /^t[13]_/.test(target))
    comment = await newestReply(fetchFn, origin, target, sentAt, wait);
  return {
    ...(/^t\d_[a-z0-9]+$/i.test(id) ? { id } : {}),
    ...(url ? { url } : {}),
    ...(comment ? { comment } : {}),
    ...(reason !== null ? { linked: true as const, reason } : {}),
  };
}

/** Where Reddit's upload leases may send a file: its S3 bucket. */
const UPLOAD_HOST = /^reddit-uploaded-media\.s3(?:-accelerate|[.-][a-z0-9-]+)?\.amazonaws\.com$/;

/**
 * Uploads a reply's image as Reddit's own uploader does (and PRAW): Reddit
 * leases an upload to its S3 bucket and names the asset, the file goes to
 * S3 without credentials, and the reply refers to it as `![img](<asset id>)`.
 */
export async function apiUpload(
  fetchFn: Fetch,
  origin: string,
  image: ImageFile,
): Promise<{ id: string }> {
  // Reddit has answered a signed-in browser session with 403 here (in the
  // extension and the desktop app) while its other writes work, so a
  // refusal isn't about signing in.
  const lease = await post(
    fetchFn,
    origin,
    "/api/media/asset.json",
    () => ({ filepath: image.name, mimetype: image.type }),
    "Reddit refused the image upload. Giphy GIFs saved from comments can still be added.",
  );
  const id = lease?.asset?.asset_id;
  const fields: unknown = lease?.args?.fields;
  let target: URL | null = null;
  try {
    target = new URL("https:" + String(lease?.args?.action ?? "").replace(/^https:/, ""));
  } catch {
    // Checked below.
  }
  if (
    typeof id !== "string" ||
    !/^[a-z0-9]{1,30}$/i.test(id) ||
    !target ||
    target.protocol !== "https:" ||
    !UPLOAD_HOST.test(target.hostname) ||
    !Array.isArray(fields)
  )
    throw new Error("Reddit did not accept the image upload.");
  const form = new FormData();
  for (const field of fields)
    if (typeof field?.name === "string" && typeof field?.value === "string")
      form.append(field.name, field.value);
  form.append("file", new Blob([image.bytes], { type: image.type }), image.name);
  const response = await fetchFn(target, {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    body: form,
    signal: AbortSignal.timeout(80000),
  });
  if (!response.ok) {
    const answer = await response.text().catch(() => "");
    throw new Error(
      /EntityTooLarge/.test(answer)
        ? "The image is too large for Reddit."
        : `Reddit could not store the image (${response.status}).`,
    );
  }
  return { id };
}

/** Forget the cached session (tests). */
export const resetWrites = (): void => {
  session = null;
  pending.clear();
};
