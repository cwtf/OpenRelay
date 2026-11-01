import { useSyncExternalStore } from "react";
import { offlineMode, pageUrl } from "../../extension/bridge";
import {
  DEFAULT_INSTANCES,
  instanceHome,
  instanceHost,
  REDDIT_HOME,
} from "../../extension/sources";
import { providerOf } from "../../providers/hosts";
import { openSource } from "./api";
import { toast } from "./platform";
import { flushStorage, readJson, watchKey, writeJson } from "./storage";
import { readerHost } from "../../hosts/reader";

/** A site the drawer's source switcher can open, or the hybrid feed. */
export type Source = {
  kind: "reddit" | "hybrid" | "lemmy";
  /** `reddit` for Reddit, `hybrid`, or the host name for a Lemmy instance. */
  id: string;
  label: string;
  url: string;
};

const KEY = "lemmy-instances";
/** Set while the reader on Reddit shows the hybrid feed. */
const HYBRID_KEY = "hybrid-feed";
const MAX_INSTANCES = 20;
/**
 * Hybrid is off for now: its Lemmy posts can only be read signed out in the
 * Reddit tab, so opening one leaves Reddit. The drawer doesn't offer it, and
 * a reader that had it on shows Reddit's own feed.
 */
const HYBRID_ENABLED = false;

export const REDDIT: Source = {
  kind: "reddit",
  id: "reddit",
  label: "Reddit",
  url: REDDIT_HOME,
};

/**
 * Reddit's posts mixed with the listed instances'. It runs in the Reddit
 * tab, so it's Reddit's front page with `HYBRID_KEY` set.
 */
export const HYBRID: Source = {
  kind: "hybrid",
  id: "hybrid",
  label: "Hybrid",
  url: REDDIT_HOME,
};

const lemmy = (host: string): Source => ({
  kind: "lemmy",
  id: host,
  label: host,
  url: instanceHome(host),
});

const listeners = new Set<() => void>();
let sources: Source[] | null = null;

const emit = () => {
  sources = null;
  for (const listener of listeners) listener();
};

/**
 * Reddit, Hybrid (when enabled) when there's an instance to mix in, then the
 * Lemmy instances: lemmy.world until the viewer changes the list.
 */
const sourceList = (): Source[] => {
  if (!sources) {
    const saved = readJson<unknown>(KEY, DEFAULT_INSTANCES);
    const hosts = Array.isArray(saved)
      ? saved.filter(
          (host): host is string =>
            typeof host === "string" && instanceHost(host) === host,
        )
      : [];
    sources = [
      REDDIT,
      ...(HYBRID_ENABLED && hosts.length ? [HYBRID] : []),
      ...hosts.map(lemmy),
    ];
  }
  return sources;
};

// Instances added in another tab show up here too.
let unwatch: (() => void) | undefined;
const subscribe = (listener: () => void) => {
  if (!listeners.size) unwatch = watchKey(KEY, emit);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) unwatch?.();
  };
};

export const useSources = (): Source[] =>
  useSyncExternalStore(subscribe, sourceList);

/** The listed Lemmy instances' hosts. */
export const instances = (): string[] =>
  sourceList()
    .filter((source) => source.kind === "lemmy")
    .map((source) => source.id);

/**
 * Adds the instance `input` names, asking the host for access to it where
 * OpenRelay can run there; returns its host, or an error to show. Call it
 * straight from the click handler: the browser's prompt needs the gesture.
 */
export async function addInstance(
  input: string,
): Promise<{ host: string } | { error: string }> {
  const host = instanceHost(input);
  if (!host) return { error: "Enter an instance's address, like lemmy.world" };
  const list = instances();
  if (!list.includes(host) && list.length >= MAX_INSTANCES)
    return { error: `You can add up to ${MAX_INSTANCES} instances` };
  const access = readerHost().instances;
  if (access && (await access.allow(host)) === "declined")
    return { error: `Allow access to ${host} so OpenRelay can show it` };
  if (!list.includes(host)) {
    writeJson(KEY, [...list, host]);
    emit();
  }
  await syncInstances();
  return { host };
}

export async function removeInstance(host: string): Promise<void> {
  writeJson(KEY, instances().filter((item) => item !== host));
  emit();
  await readerHost().instances?.forget(host);
  await syncInstances();
}

/** Runs OpenRelay on the instances in the list that it has access to. */
export const syncInstances = (): Promise<void> =>
  readerHost().instances?.sync(instances()).catch(() => undefined) ?? Promise.resolve();

/**
 * Whether the reader may read the page it was opened from: Reddit, or an
 * instance the viewer added. Any https site can load the reader in a frame,
 * so a Lemmy page that isn't in the list gets nothing.
 */
export const trustedSource = (): boolean =>
  offlineMode ||
  providerOf(pageUrl) === "reddit" ||
  (providerOf(pageUrl) === "lemmy" && instances().includes(pageUrl.hostname));

/** Whether this reader shows the hybrid feed: on Reddit, with an instance listed. */
export const hybridMode = (): boolean =>
  HYBRID_ENABLED &&
  !offlineMode &&
  providerOf(pageUrl) === "reddit" &&
  instances().length > 0 &&
  readJson<unknown>(HYBRID_KEY, false) === true;

/** The source this reader was opened from; `null` when reading offline. */
export const currentSource = (): Source | null => {
  if (offlineMode) return null;
  if (providerOf(pageUrl) === "reddit") return hybridMode() ? HYBRID : REDDIT;
  const host = pageUrl.hostname;
  return sourceList().find((source) => source.id === host) ?? lemmy(host);
};

/**
 * Loads the source's front page in this tab. An instance OpenRelay has no
 * access to yet (added before it asked, or declined) asks again first, so
 * call this straight from the click handler.
 */
export function switchSource(source: Source): void {
  if (source.kind === "lemmy") withAccess(source.id, () => void go(source));
  else void go(source);
}

/**
 * Loads a hybrid feed item's page on its listed instance in this tab
 * (`sourceUrl` checks it), asking for access first like `switchSource`.
 */
export function openOnInstance(url: string): void {
  withAccess(new URL(url).hostname, () =>
    void openSource(url).catch((error: unknown) =>
      toast(error instanceof Error ? error.message : "Could not open it"),
    ),
  );
}

/** Asks for access to `host` where OpenRelay can run there, then runs `then`. */
function withAccess(host: string, then: () => void): void {
  const access = readerHost().instances;
  if (!access) return then();
  void access
    .allow(host)
    .then(async (answer) => {
      if (answer === "declined")
        toast(`Without access to ${host}, it opens in its own web app`);
      await syncInstances();
    })
    .catch(() => undefined)
    .finally(then);
}

async function go(source: Source): Promise<void> {
  // Saved before the tab leaves, so the next reader there knows.
  writeJson(HYBRID_KEY, source.kind === "hybrid");
  await flushStorage().catch(() => undefined);
  // Read offline, the reader is the page itself (or the host's own view).
  if (offlineMode) {
    if (window.top === window) location.assign(source.url);
    else window.open(source.url, "_blank", "noopener,noreferrer");
    return;
  }
  await openSource(source.url).catch((error: unknown) =>
    toast(error instanceof Error ? error.message : "Could not switch"),
  );
}
