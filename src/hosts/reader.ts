import type { Downloads, HostStorage, ReaderHost } from "./types.ts";

/** The reader frame's host: a wrapper app's, or the browser extension's. */
export function readerHost(): ReaderHost {
  const injected = (globalThis as { openRelayReaderHost?: ReaderHost })
    .openRelayReaderHost;
  return injected ?? extensionHost();
}

type ChromeApi = {
  storage?: {
    local?: {
      get(keys: null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
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
    request(permissions: { permissions: string[] }): Promise<boolean>;
  };
  downloads?: {
    download(options: { url: string; filename?: string }): Promise<number>;
  };
};

const chromeApi = (): ChromeApi | null => {
  try {
    return (globalThis as { chrome?: ChromeApi }).chrome ?? null;
  } catch {
    return null;
  }
};

function extensionStorage(api: ChromeApi | null): HostStorage | null {
  const local = api?.storage?.local;
  if (!local) return null;
  return {
    getAll: () => local.get(null),
    set: (items) => local.set(items),
    remove: (keys) => local.remove(keys),
    onChanged: (listener) =>
      api.storage?.onChanged?.addListener((changes, area) => {
        if (area === "local") listener(changes);
      }),
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

function extensionHost(): ReaderHost {
  const api = chromeApi();
  return {
    name: "extension",
    storage: extensionStorage(api),
    downloads: () => extensionDownloads(api),
  };
}
