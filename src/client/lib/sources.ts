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
import { readJson, watchKey, writeJson } from "./storage";
import { readerHost } from "../../hosts/reader";

/** A site the drawer's source switcher can open. */
export type Source = {
  kind: "reddit" | "lemmy";
  /** `reddit` for Reddit, the host name for a Lemmy instance. */
  id: string;
  label: string;
  url: string;
};

const KEY = "lemmy-instances";
const MAX_INSTANCES = 20;

export const REDDIT: Source = {
  kind: "reddit",
  id: "reddit",
  label: "Reddit",
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

/** Reddit, then the Lemmy instances: lemmy.world until the viewer changes the list. */
const sourceList = (): Source[] => {
  if (!sources) {
    const saved = readJson<unknown>(KEY, DEFAULT_INSTANCES);
    const hosts = Array.isArray(saved)
      ? saved.filter(
          (host): host is string =>
            typeof host === "string" && instanceHost(host) === host,
        )
      : [];
    sources = [REDDIT, ...hosts.map(lemmy)];
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

const instances = () =>
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

/** The source this reader was opened from; `null` when reading offline. */
export const currentSource = (): Source | null => {
  if (offlineMode) return null;
  if (providerOf(pageUrl) === "reddit") return REDDIT;
  const host = pageUrl.hostname;
  return sourceList().find((source) => source.id === host) ?? lemmy(host);
};

/**
 * Loads the source's front page in this tab. An instance OpenRelay has no
 * access to yet (added before it asked, or declined) asks again first, so
 * call this straight from the click handler.
 */
export function switchSource(source: Source): void {
  const access = readerHost().instances;
  if (source.kind === "lemmy" && access) {
    void access
      .allow(source.id)
      .then(async (answer) => {
        if (answer === "declined")
          toast(`Without access to ${source.id}, it opens in its own web app`);
        await syncInstances();
      })
      .catch(() => undefined)
      .finally(() => go(source));
    return;
  }
  go(source);
}

function go(source: Source): void {
  // Read offline, the reader is the page itself (or the host's own view).
  if (offlineMode) {
    if (window.top === window) location.assign(source.url);
    else window.open(source.url, "_blank", "noopener,noreferrer");
    return;
  }
  openSource(source.url).catch((error: unknown) =>
    toast(error instanceof Error ? error.message : "Could not switch"),
  );
}
