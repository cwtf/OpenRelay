/**
 * The hybrid feed's reading half, in the Reddit tab: Reddit's front page
 * through the bridge, mixed with each listed instance's Local feed read
 * straight from the instance's API. Those reads are signed out (no cookies),
 * and Lemmy's API allows any origin, so no sign-in ever reaches the reader.
 * Lemmy's posts open on their instance, where OpenRelay reads them in full.
 */
import type { FeedResponse, FeedSort, Timeframe } from "../../shared/api";
import { ApiFailure } from "../../shared/api";
import { pageUrl } from "../../extension/bridge";
import { providerOf } from "../../providers/hosts";
import { lemmyFeed } from "../../providers/lemmy/reader";
import { allowedApiPath, hostTag, lemmyNumber } from "../../providers/lemmy/lemmy";
import {
  decodeCursor,
  encodeCursor,
  hybridPost,
  mergeFeeds,
} from "../../providers/hybrid";
import { hybridMode, instances } from "./sources";
import { toast } from "./platform";

/** Reddit's feed that the instances' Local feeds are mixed into. */
const HYBRID_FEED = "Home";

/** Whether `sub` is shown as the hybrid feed here. */
export const isHybridFeed = (sub: string): boolean =>
  sub === HYBRID_FEED && hybridMode();

const LEMMY_ID = /^t[13]_(\d{1,12})_([a-z0-9]{1,8})$/;

/**
 * Whether `id` is a Lemmy post or comment shown in the Reddit tab (from the
 * hybrid feed). Reddit's writes and votes must never get one.
 */
export const isLemmyItem = (id: unknown): boolean =>
  typeof id === "string" && LEMMY_ID.test(id) && providerOf(pageUrl) === "reddit";

/**
 * Whether a community or user name is a Lemmy one in the Reddit tab: the
 * hybrid feed writes them `name@host`, and Reddit's names never have one.
 */
export const isLemmyName = (name: string): boolean =>
  name.includes("@") && providerOf(pageUrl) === "reddit";

/** The listed instance a Lemmy item's ID came from, if it's still listed. */
const itemHost = (id: string): string | null => {
  const tag = LEMMY_ID.exec(id)?.[2];
  return instances().find((host) => hostTag(host) === tag) ?? null;
};

/** The item's page on its instance, where OpenRelay opens on it. */
export function lemmyItemUrl(id: string): string | null {
  const host = itemHost(id);
  const kind = id.startsWith("t1_") ? "t1" : "t3";
  const n = lemmyNumber(id, kind);
  if (!host || n === null) return null;
  return `https://${host}/${kind === "t1" ? "comment" : "post"}/${n}`;
}

/**
 * A community's or user's page for a hybrid `name@host`: on that instance
 * if it's listed, else seen from the first listed one.
 */
export function lemmyActorUrl(kind: "c" | "u", name: string): string | null {
  const at = name.indexOf("@");
  if (at < 1) return null;
  const listed = instances();
  const host = name.slice(at + 1).toLowerCase();
  if (listed.includes(host)) return `https://${host}/${kind}/${name.slice(0, at)}`;
  return listed[0] ? `https://${listed[0]}/${kind}/${name}` : null;
}

/** A signed-out read of the instance's API, only on its read allowlist. */
const instanceGet = (host: string) => async (path: string): Promise<any> => {
  if (!allowedApiPath(path)) throw new ApiFailure("Invalid Lemmy request");
  const response = await fetch(`https://${host}${path}`, {
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new ApiFailure(`${host} answered ${response.status}`, response.status);
  return response.json();
};

// Each instance's failure is shown once per reader, not on every page.
const reported = new Set<string>();

/**
 * One page of the hybrid feed. Reddit failing fails the page; an instance
 * failing drops it from the rest of this feed and says so.
 */
export async function fetchHybridFeed(
  redditFeed: (after?: string | null) => Promise<FeedResponse>,
  sort: FeedSort,
  t: Timeframe,
  after?: string | null,
): Promise<FeedResponse> {
  const first = !after;
  const cursor = decodeCursor(after, instances());
  const hosts = Object.keys(cursor.lemmy);
  const [reddit, ...lemmy] = await Promise.allSettled([
    first || cursor.reddit !== null
      ? redditFeed(cursor.reddit)
      : Promise.resolve({ posts: [], after: null }),
    ...hosts.map((host) =>
      lemmyFeed(
        `https://${host}`,
        instanceGet(host),
        "Local",
        sort,
        t,
        cursor.lemmy[host],
      ),
    ),
  ]);
  if (reddit!.status === "rejected") throw reddit!.reason;
  const pages = [reddit!.value.posts];
  const next = { reddit: reddit!.value.after, lemmy: {} as Record<string, string | null> };
  lemmy.forEach((result, index) => {
    const host = hosts[index]!;
    if (result.status === "fulfilled") {
      pages.push(result.value.posts.map((post) => hybridPost(post, host)));
      next.lemmy[host] = result.value.after;
    } else if (!reported.has(host)) {
      reported.add(host);
      toast(`Couldn't load ${host} into the hybrid feed`);
    }
  });
  return { posts: mergeFeeds(pages, sort), after: encodeCursor(next) };
}
