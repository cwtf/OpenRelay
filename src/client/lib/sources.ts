import { useSyncExternalStore } from "react";
import { offlineMode, pageUrl } from "../../extension/bridge";
import {
  instanceHome,
  instanceHost,
  REDDIT_HOME,
} from "../../extension/sources";
import { openSource } from "./api";
import { toast } from "./platform";
import { readJson, watchKey, writeJson } from "./storage";

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

/** Reddit, then the Lemmy instances the viewer added, in the order added. */
const sourceList = (): Source[] => {
  if (!sources) {
    const saved = readJson<unknown>(KEY, []);
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

/** Adds the instance `input` names; returns its host, or an error to show. */
export function addInstance(input: string): { host: string } | { error: string } {
  const host = instanceHost(input);
  if (!host) return { error: "Enter an instance's address, like lemmy.world" };
  const list = instances();
  if (list.includes(host)) return { host };
  if (list.length >= MAX_INSTANCES)
    return { error: `You can add up to ${MAX_INSTANCES} instances` };
  writeJson(KEY, [...list, host]);
  emit();
  return { host };
}

export function removeInstance(host: string): void {
  writeJson(KEY, instances().filter((item) => item !== host));
  emit();
}

/** The source this reader was opened from; `null` when reading offline. */
export const currentSource = (): Source | null => {
  if (offlineMode) return null;
  const host = pageUrl.hostname;
  if (host === "reddit.com" || host.endsWith(".reddit.com")) return REDDIT;
  return sourceList().find((source) => source.id === host) ?? lemmy(host);
};

/** Loads the source's front page in this tab. */
export function switchSource(source: Source): void {
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
