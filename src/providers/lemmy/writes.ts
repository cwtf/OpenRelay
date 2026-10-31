import type { CommentNode } from "../../shared/api.ts";
import { safeUrl } from "../reddit/reddit.ts";
import type { VoteResult } from "../reddit/votes.ts";
import {
  hostTag,
  isCommunityName,
  normalizeComments,
  postId,
} from "./lemmy.ts";

/**
 * Requests to a Lemmy instance's API from the content script, same-origin
 * with lemmy-ui. lemmy-ui keeps its sign-in token in a `jwt` cookie, which
 * the API takes as a cookie or a bearer token; it's read here and sent as
 * both, and never reaches the reader. Writes are a fixed set of actions with
 * validated parameters, like Reddit's in `reddit/writes.ts`.
 */
type Fetch = typeof fetch;
type Method = "GET" | "POST" | "PUT";

/** lemmy-ui's sign-in token from `document.cookie`, or null. */
export function sessionToken(cookie: string): string | null {
  const match = /(?:^|;\s*)jwt=([^;]+)/.exec(cookie);
  if (!match) return null;
  const token = decodeURIComponent(match[1]!);
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : null;
}

const ERRORS: Record<string, string> = {
  not_logged_in: "Sign in to Lemmy first.",
  incorrect_login: "Sign in to Lemmy first.",
  rate_limit_error: "This instance is rate limiting requests. Try again shortly.",
  locked: "This thread is locked.",
  couldnt_find_post: "This post is unavailable.",
  couldnt_find_comment: "This comment is unavailable.",
  couldnt_find_community: "This community is unavailable.",
  banned_from_community: "You're banned from this community.",
  site_ban: "You're banned from this instance.",
  deleted: "This was deleted.",
};

/** One API call; Lemmy's `{ "error": "…" }` answers become readable errors. */
export async function call(
  fetchFn: Fetch,
  origin: string,
  token: string | null,
  method: Method,
  path: string,
  body?: Record<string, unknown>,
): Promise<any> {
  const response = await fetchFn(new URL(path, origin), {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(method === "GET" ? 18000 : 20000),
  });
  if (response.status === 429)
    throw new Error("This instance is rate limiting requests. Please wait and try again.");
  if (!response.headers.get("content-type")?.includes("json"))
    throw new Error(
      `This instance did not answer with Lemmy's API (${response.status}). Use Original Lemmy to continue.`,
    );
  const data = await response.json();
  if (!response.ok || typeof data?.error === "string") {
    const code = String(data?.error ?? response.status);
    throw new Error(
      ERRORS[code] ?? `Lemmy could not do that (${code.replaceAll("_", " ")}).`,
    );
  }
  return data;
}

// -- validation

const fail = (): never => {
  throw new Error("Invalid request");
};
/** A post or comment of this instance, from the reader's tagged ID. */
function thing(value: unknown, tag: string, kinds = "13") {
  const match =
    typeof value === "string"
      ? new RegExp(`^t([${kinds}])_(\\d{1,12})_${tag}$`).exec(value)
      : null;
  if (!match) return fail();
  return { kind: match[1] === "3" ? ("post" as const) : ("comment" as const), id: Number(match[2]) };
}
const text = (value: unknown, max: number, required = true): string =>
  typeof value === "string" &&
  value.length <= max &&
  (!required || value.trim().length > 0)
    ? value
    : fail();
const community = (value: unknown): string =>
  typeof value === "string" && isCommunityName(value) ? value : fail();

type Args = Record<string, unknown>;
type Result = { id?: string; url?: string; comment?: CommentNode };
const pending = new Set<string>();

/** A vote on a post or comment: 1, -1, or 0 to take it back. */
export async function lemmyVote(
  fetchFn: Fetch,
  origin: string,
  token: string | null,
  thingId: unknown,
  dir: unknown,
): Promise<VoteResult> {
  const target = thing(thingId, hostTag(new URL(origin).hostname));
  if (dir !== 1 && dir !== 0 && dir !== -1) return fail();
  const key = String(thingId);
  if (pending.has(key)) return { available: true, vote: null, status: "busy" };
  pending.add(key);
  try {
    const data = await call(fetchFn, origin, token, "POST", `/api/v3/${target.kind}/like`, {
      [`${target.kind}_id`]: target.id,
      score: dir,
    });
    const view = data?.post_view ?? data?.comment_view;
    const vote = view?.my_vote === 1 || view?.my_vote === -1 ? view.my_vote : 0;
    return { available: true, vote: vote as -1 | 0 | 1, status: "changed", via: "api" };
  } finally {
    pending.delete(key);
  }
}

/** Runs one allow-listed write; returns only what the reader needs. */
export async function lemmyAction(
  fetchFn: Fetch,
  origin: string,
  token: string | null,
  name: unknown,
  rawArgs: unknown,
): Promise<Result> {
  if (!rawArgs || typeof rawArgs !== "object") return fail();
  const a = rawArgs as Args;
  const tag = hostTag(new URL(origin).hostname);
  const api = (method: Method, path: string, body?: Record<string, unknown>) =>
    call(fetchFn, origin, token, method, path, body);
  const posted = (data: any): Result => {
    const comment = normalizeComments([data?.comment_view], origin)[0];
    return comment ? { id: comment.id, comment } : {};
  };
  const communityId = async (name: string) => {
    const data = await api("GET", "/api/v3/community?" + new URLSearchParams({ name }));
    const id = data?.community_view?.community?.id;
    return typeof id === "number" ? id : fail();
  };
  switch (name) {
    case "save":
    case "unsave": {
      const t = thing(a.id, tag);
      await api("PUT", `/api/v3/${t.kind}/save`, { [`${t.kind}_id`]: t.id, save: name === "save" });
      return {};
    }
    case "comment": {
      const parent = thing(a.parent, tag);
      const content = text(a.text, 10000);
      // Lemmy needs the post of a reply to a comment too.
      const postNumber =
        parent.kind === "post"
          ? parent.id
          : Number(
              (await api("GET", `/api/v3/comment?id=${parent.id}`))?.comment_view?.comment?.post_id,
            ) || fail();
      return posted(
        await api("POST", "/api/v3/comment", {
          post_id: postNumber,
          ...(parent.kind === "comment" ? { parent_id: parent.id } : {}),
          content,
        }),
      );
    }
    case "edit": {
      const t = thing(a.id, tag);
      if (t.kind === "comment")
        return posted(
          await api("PUT", "/api/v3/comment", { comment_id: t.id, content: text(a.text, 10000) }),
        );
      await api("PUT", "/api/v3/post", { post_id: t.id, body: text(a.text, 40000) });
      return {};
    }
    case "del": {
      const t = thing(a.id, tag);
      await api("POST", `/api/v3/${t.kind}/delete`, { [`${t.kind}_id`]: t.id, deleted: true });
      return {};
    }
    case "subscribe": {
      const follow = a.action === "sub" ? true : a.action === "unsub" ? false : fail();
      const id = await communityId(community(a.sr));
      await api("POST", "/api/v3/community/follow", { community_id: id, follow });
      return {};
    }
    case "submit": {
      const kind = a.kind === "link" ? "link" : a.kind === "self" ? "self" : fail();
      const url = kind === "link" ? safeUrl(a.url) || fail() : "";
      const title = text(a.title, 200);
      const body = kind === "self" ? text(a.text ?? "", 40000, false) : "";
      const id = await communityId(community(a.sr));
      const data = await api("POST", "/api/v3/post", {
        name: title,
        community_id: id,
        ...(url ? { url } : {}),
        ...(body ? { body } : {}),
        nsfw: a.nsfw === true,
      });
      const created = data?.post_view?.post?.id;
      return typeof created === "number" ? { id: postId(created, tag) } : {};
    }
    default:
      throw new Error("OpenRelay can't do that on Lemmy yet. Use Original Lemmy.");
  }
}

/** Forget pending votes (tests). */
export const resetLemmyWrites = (): void => pending.clear();
