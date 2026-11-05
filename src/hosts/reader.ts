import { ACCOUNT_NAME, MEDIA_HOSTS, MEDIA_MAX_BYTES } from "./types.ts";
import {
  ACCOUNTS_PREFIX,
  accountKey,
  cookieSite,
  cookieUrl,
  inDomain,
  keepCookie,
  restoreDetails,
  type CookieDetails,
  type SavedCookie,
} from "./cookies.ts";
import type {
  AccountSessions,
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
    remove(permissions: { permissions?: string[]; origins?: string[] }): Promise<boolean>;
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
  /** Present once the optional `cookies` permission is granted. */
  cookies?: {
    getAll(filter: { domain: string; storeId?: string }): Promise<SavedCookie[]>;
    set(details: CookieDetails): Promise<unknown>;
    remove(details: { url: string; name: string; storeId?: string }): Promise<unknown>;
  };
  runtime?: { sendMessage(message: unknown): Promise<unknown> };
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
      if (keys) return local.get(keys.filter((key) => key.startsWith(STORAGE_PREFIX)));
      // Older browsers read everything; the offline posts and saved sign-ins
      // beside the settings are still left out.
      const all = await local.get(null);
      return Object.fromEntries(
        Object.entries(all).filter(([key]) => key.startsWith(STORAGE_PREFIX)),
      );
    },
    set: (items) => local.set(items),
    remove: (keys) => local.remove(keys),
    onChanged: (listener) =>
      api.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local") return;
        const settings = Object.fromEntries(
          Object.entries(changes).filter(([key]) => key.startsWith(STORAGE_PREFIX)),
        );
        if (Object.keys(settings).length) listener(settings);
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

/**
 * Accounts through the optional `cookies` permission: a site's cookies are
 * copied into `chrome.storage.local` under `ACCOUNTS_PREFIX` (never read into
 * the reader's settings) and put back on switch, in the tab's own cookie
 * store, so a Firefox container or a private window keeps its own sign-in.
 */
function extensionAccounts(api: ChromeApi | null): AccountSessions | undefined {
  const permissions = api?.permissions;
  const local = api?.storage?.local;
  if (!permissions || !local) return undefined;
  const check = (site: string, name?: string) => {
    const target = cookieSite(site);
    if (!target || (name !== undefined && !ACCOUNT_NAME.test(name)))
      throw new Error("Not an account OpenRelay can keep");
    return target;
  };
  // Read at call time: `chrome.cookies` appears once the permission is granted.
  const cookies = () => {
    const found = chromeApi()?.cookies;
    if (!found) throw new Error("Cookie access is off");
    return found;
  };
  // The service worker knows which store the reader's tab uses.
  const store = async (): Promise<string | undefined> => {
    try {
      const id = await api.runtime?.sendMessage({ type: "openrelay:cookie-store" });
      return typeof id === "string" ? id : undefined;
    } catch {
      return undefined;
    }
  };
  const read = async (domain: string, storeId: string | undefined) =>
    (await cookies().getAll(storeId ? { domain, storeId } : { domain })).filter((cookie) =>
      inDomain(cookie.domain, domain),
    );
  const clear = async (domain: string, storeId: string | undefined) => {
    for (const cookie of await read(domain, storeId))
      await cookies().remove({
        url: cookieUrl(cookie),
        name: cookie.name,
        ...(storeId ? { storeId } : {}),
      });
  };
  return {
    allow: async (site) =>
      (await permissions.request({
        permissions: ["cookies"],
        origins: check(site).origins,
      }))
        ? "granted"
        : "declined",
    async save(site, name) {
      const { domain } = check(site, name);
      const saved = (await read(domain, await store())).map(keepCookie);
      await local.set({ [accountKey(domain, name)]: saved });
    },
    async restore(site, name) {
      const { domain } = check(site, name);
      const key = accountKey(domain, name);
      const saved = (await local.get(key))[key];
      if (!Array.isArray(saved) || !saved.length) return false;
      const storeId = await store();
      await clear(domain, storeId);
      for (const cookie of saved as SavedCookie[]) {
        const details = restoreDetails(cookie, storeId);
        if (details) await cookies().set(details);
      }
      return true;
    },
    async clear(site) {
      await clear(check(site).domain, await store());
    },
    async forget(site, name) {
      await local.remove(accountKey(check(site, name).domain, name));
    },
    async revoke(site) {
      const { domain } = check(site);
      const keys = (await local.getKeys?.()) ?? Object.keys(await local.get(null));
      await local.remove(keys.filter((key) => key.startsWith(`${ACCOUNTS_PREFIX}${domain}:`)));
      // The permission covers every site; give it back once no site has saved sign-ins.
      if (!keys.some((key) => key.startsWith(ACCOUNTS_PREFIX) && !key.startsWith(`${ACCOUNTS_PREFIX}${domain}:`)))
        await permissions.remove({ permissions: ["cookies"] }).catch(() => false);
    },
  };
}

function extensionHost(): ReaderHost {
  const api = chromeApi();
  const instances = extensionInstances(api);
  const accounts = extensionAccounts(api);
  return {
    name: "extension",
    storage: extensionStorage(api),
    offline: extensionOffline(api),
    media: () => extensionMedia(api),
    downloads: () => extensionDownloads(api),
    ...(instances ? { instances } : {}),
    ...(accounts ? { accounts } : {}),
  };
}
