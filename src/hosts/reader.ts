import { MEDIA_HOSTS, MEDIA_MAX_BYTES } from "./types.ts";
import type {
  Downloads,
  HostStorage,
  InstanceAccess,
  MediaFetcher,
  OfflineStore,
  ReaderHost,
} from "./types.ts";

/** The reader frame's host: a wrapper app's, or the browser extension's. */
export function readerHost(): ReaderHost {
  const injected = (globalThis as { openRelayReaderHost?: ReaderHost })
    .openRelayReaderHost;
  return injected ?? extensionHost();
}

type ChromeApi = {
  storage?: {
    local?: {
      get(keys: string[] | string | null): Promise<Record<string, unknown>>;
      /** Newer browsers only (Chrome 130+). */
      getKeys?(): Promise<string[]>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[] | string): Promise<void>;
    };
    onChanged?: {
      addListener(
        fn: (
          changes: Record<string, { newValue?: unknown }>,
          area: string,
        ) => void,
      ): void;
    };
  };
  permissions?: {
    request(permissions: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
    remove(permissions: { origins?: string[] }): Promise<boolean>;
    contains(permissions: { origins?: string[] }): Promise<boolean>;
  };
  scripting?: {
    getRegisteredContentScripts(filter: { ids: string[] }): Promise<{ id: string }[]>;
    registerContentScripts(scripts: ContentScript[]): Promise<void>;
    updateContentScripts(scripts: ContentScript[]): Promise<void>;
    unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
  };
  downloads?: {
    download(options: { url: string; filename?: string }): Promise<number>;
  };
};

type ContentScript = {
  id: string;
  matches: string[];
  js: string[];
  runAt: "document_idle";
};

const chromeApi = (): ChromeApi | null => {
  try {
    return (globalThis as { chrome?: ChromeApi }).chrome ?? null;
  } catch {
    return null;
  }
};

/** Settings keys start with this; offline posts use `OFFLINE_PREFIX`. */
const STORAGE_PREFIX = "openrelay:";
const OFFLINE_PREFIX = "openrelay-offline:";

function extensionStorage(api: ChromeApi | null): HostStorage | null {
  const local = api?.storage?.local;
  if (!local) return null;
  return {
    // Read the settings without the offline posts beside them, where the
    // browser can list keys.
    getAll: async () => {
      const keys = await local.getKeys?.();
      return keys
        ? local.get(keys.filter((key) => key.startsWith(STORAGE_PREFIX)))
        : local.get(null);
    },
    set: (items) => local.set(items),
    remove: (keys) => local.remove(keys),
    onChanged: (listener) =>
      api.storage?.onChanged?.addListener((changes, area) => {
        if (area === "local") listener(changes);
      }),
  };
}

/** Offline posts beside the settings in `chrome.storage.local` (`unlimitedStorage`). */
function extensionOffline(api: ChromeApi | null): OfflineStore | null {
  const local = api?.storage?.local;
  if (!local) return null;
  return {
    get: async (key) => (await local.get(OFFLINE_PREFIX + key))[OFFLINE_PREFIX + key],
    set: (key, value) => local.set({ [OFFLINE_PREFIX + key]: value }),
    remove: (keys) => local.remove(keys.map((key) => OFFLINE_PREFIX + key)),
  };
}

/** `url` if it's https on one of `MEDIA_HOSTS`, else an error. */
export function mediaUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !MEDIA_HOSTS.includes(parsed.hostname))
    throw new Error("Not a Reddit image");
  return parsed;
}

/** Fetches images behind the optional host permission for `MEDIA_HOSTS`. */
async function extensionMedia(
  api: ChromeApi | null,
): Promise<MediaFetcher | "declined" | "unavailable"> {
  if (!api?.permissions) return "unavailable";
  const granted = await api.permissions.request({
    origins: MEDIA_HOSTS.map((host) => `https://${host}/*`),
  });
  if (!granted) return "declined";
  return {
    async fetch(url) {
      const response = await fetch(mediaUrl(url), {
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.size > MEDIA_MAX_BYTES) throw new Error("Too large");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return { type: blob.type, data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
    },
  };
}

/** Saves with `chrome.downloads`, behind the optional `downloads` permission. */
async function extensionDownloads(
  api: ChromeApi | null,
): Promise<Downloads | "declined" | "unavailable"> {
  if (!api?.permissions) return "unavailable";
  const granted = await api.permissions.request({ permissions: ["downloads"] });
  const downloads = api.downloads;
  if (!granted || !downloads) return "declined";
  return {
    async save(file) {
      if ("url" in file) {
        await downloads.download(file);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([file.data as Uint8Array<ArrayBuffer>], { type: file.type }),
      );
      try {
        await downloads.download({ url, filename: file.filename });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    },
  };
}

const INSTANCES_SCRIPT = "openrelay-lemmy";
const origin = (host: string) => `https://${host}/*`;

/**
 * Lemmy instances through the manifest's optional host permission for any
 * https site, asked for one instance at a time, and a content script
 * registered on the instances granted.
 */
function extensionInstances(api: ChromeApi | null): InstanceAccess | undefined {
  const permissions = api?.permissions;
  const scripting = api?.scripting;
  if (!permissions || !scripting) return undefined;
  return {
    allow: async (host) =>
      (await permissions.request({ origins: [origin(host)] })) ? "granted" : "declined",
    forget: async (host) => {
      await permissions.remove({ origins: [origin(host)] }).catch(() => false);
    },
    async sync(hosts) {
      const granted: string[] = [];
      for (const host of hosts)
        if (await permissions.contains({ origins: [origin(host)] })) granted.push(origin(host));
      const registered = await scripting.getRegisteredContentScripts({ ids: [INSTANCES_SCRIPT] });
      const script: ContentScript = {
        id: INSTANCES_SCRIPT,
        matches: granted,
        js: ["content.js"],
        runAt: "document_idle",
      };
      if (!granted.length) {
        if (registered.length)
          await scripting.unregisterContentScripts({ ids: [INSTANCES_SCRIPT] });
      } else if (registered.length) await scripting.updateContentScripts([script]);
      else await scripting.registerContentScripts([script]);
    },
  };
}

function extensionHost(): ReaderHost {
  const api = chromeApi();
  const instances = extensionInstances(api);
  return {
    name: "extension",
    storage: extensionStorage(api),
    offline: extensionOffline(api),
    media: () => extensionMedia(api),
    downloads: () => extensionDownloads(api),
    ...(instances ? { instances } : {}),
  };
}
