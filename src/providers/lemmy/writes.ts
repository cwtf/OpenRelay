import type { CommentNode } from "../../shared/api.ts";
import { safeUrl } from "../reddit/reddit.ts";
import type { VoteResult } from "../reddit/votes.ts";
import type { ImageFile } from "../upload.ts";
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
const KINDS = { "1": "comment", "3": "post", "4": "message" } as const;
/** A post, comment or private message of this instance, from its reader ID. */
function thing(value: unknown, tag: string, kinds = "13") {
  const match =
    typeof value === "string"
      ? new RegExp(`^t([${kinds}])_(\\d{1,12})_${tag}$`).exec(value)
      : null;
  if (!match) return fail();
  return { kind: KINDS[match[1] as keyof typeof KINDS], id: Number(match[2]) };
}
/** A username here (`name`) or on another instance (`name@host`). */
const person = (value: unknown): string =>
  typeof value === "string" && /^[\w-]{1,30}(?:@[a-z0-9.-]{1,253})?$/i.test(value) ? value : fail();
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
  const personId = async (name: string) => {
    const data = await api("GET", "/api/v3/user?" + new URLSearchParams({ username: name, limit: "1" }));
    const id = data?.person_view?.person?.id;
    return typeof id === "number" ? id : fail();
  };
  /** A private message among your newest ones (Lemmy has no lookup by ID). */
  const message = async (id: number) => {
    for (let page = 1; page <= 5; page++) {
      const data = await api("GET", `/api/v3/private_message/list?page=${page}&limit=50`);
      const list: any[] = Array.isArray(data?.private_messages) ? data.private_messages : [];
      const found = list.find((view) => view?.private_message?.id === id);
      if (found) return found;
      if (list.length < 50) break;
    }
    throw new Error("This message is unavailable.");
  };
  const send = async (recipientId: number, content: string): Promise<Result> => {
    const data = await api("POST", "/api/v3/private_message", { content, recipient_id: recipientId });
    const id = data?.private_message_view?.private_message?.id;
    return typeof id === "number" ? { id: `t4_${id}_${tag}` } : {};
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
      const parent = thing(a.parent, tag, "134");
      const content = text(a.text, 10000);
      // A reply to a private message is a message back to its other end.
      if (parent.kind === "message") {
        const [view, site] = await Promise.all([message(parent.id), api("GET", "/api/v3/site")]);
        const me = site?.my_user?.local_user_view?.person?.id;
        const other = view?.creator?.id === me ? view?.recipient?.id : view?.creator?.id;
        return send(Number(other) || fail(), content);
      }
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
    // The inbox. A reply or mention is marked through its own record, found
    // among the newest ones; a private message directly.
    case "read_message":
    case "unread_message": {
      const t = thing(a.id, tag, "14");
      const read = name === "read_message";
      if (t.kind === "message") {
        await api("POST", "/api/v3/private_message/mark_as_read", { private_message_id: t.id, read });
        return {};
      }
      const filter = `?sort=New&unread_only=${read}&page=1&limit=50`;
      const [replies, mentions] = await Promise.all([
        api("GET", "/api/v3/user/replies" + filter),
        api("GET", "/api/v3/user/mention" + filter),
      ]);
      const of = (list: unknown) =>
        (Array.isArray(list) ? list : []).filter((view: any) => view?.comment?.id === t.id);
      for (const view of of(replies?.replies))
        await api("POST", "/api/v3/comment/mark_as_read", { comment_reply_id: view.comment_reply.id, read });
      for (const view of of(mentions?.mentions))
        await api("POST", "/api/v3/user/mention/mark_as_read", { person_mention_id: view.person_mention.id, read });
      return {};
    }
    case "read_all_messages":
      await api("POST", "/api/v3/user/mark_all_as_read", {});
      return {};
    case "del_msg": {
      const t = thing(a.id, tag, "4");
      await api("POST", "/api/v3/private_message/delete", { private_message_id: t.id, deleted: true });
      return {};
    }
    case "compose": {
      // Lemmy's messages have no subject; it leads the text instead.
      const to = person(a.to);
      const subject = typeof a.subject === "string" ? a.subject.trim().slice(0, 100) : "";
      const body = text(a.text, 10000);
      return send(await personId(to), subject ? `**${subject}**\n\n${body}` : body);
    }
    case "block": {
      const t = thing(a.id, tag, "14");
      const creator =
        t.kind === "message"
          ? (await message(t.id))?.creator?.id
          : (await api("GET", `/api/v3/comment?id=${t.id}`))?.comment_view?.creator?.id;
      await api("POST", "/api/v3/user/block", { person_id: Number(creator) || fail(), block: true });
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

/**
 * Uploads a reply's image to the instance's image server (pict-rs, behind
 * lemmy-ui's `/pictrs/image`), signed in like the API. Returns its URL, which
 * the reply embeds as `![](<url>)`.
 */
export async function lemmyUpload(
  fetchFn: Fetch,
  origin: string,
  token: string | null,
  image: ImageFile,
): Promise<{ url: string }> {
  const form = new FormData();
  form.append("images[]", new Blob([image.bytes], { type: image.type }), image.name);
  const response = await fetchFn(new URL("/pictrs/image", origin), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
    signal: AbortSignal.timeout(80000),
  });
  if (response.status === 413) throw new Error("The image is too large for this instance.");
  if (response.status === 401 || response.status === 403) throw new Error("Sign in to Lemmy first.");
  if (response.status === 429)
    throw new Error("This instance is rate limiting requests. Please wait and try again.");
  const data = await response.json().catch(() => null);
  const file = data?.files?.[0]?.file;
  if (!response.ok || data?.msg !== "ok" || typeof file !== "string" || !/^[\w-]+\.[a-z0-9]{2,5}$/i.test(file))
    throw new Error(
      typeof data?.error === "string" && ERRORS[data.error]
        ? ERRORS[data.error]
        : `This instance did not take the image (${response.status}).`,
    );
  return { url: new URL(`/pictrs/image/${file}`, origin).href };
}

/** Forget pending votes (tests). */
export const resetLemmyWrites = (): void => pending.clear();
