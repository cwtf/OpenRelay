import type { PageHost } from "./types.ts";

/** The Reddit page's host: a wrapper app's, or the browser extension's. */
export function pageHost(): PageHost {
  const injected = (globalThis as { openRelayPageHost?: PageHost })
    .openRelayPageHost;
  return injected ?? extensionHost();
}

const extensionHost = (): PageHost => ({
  readerUrl: (hash) => chrome.runtime.getURL("reader.html") + "#" + hash,
  onToggle: (listener) =>
    chrome.runtime.onMessage.addListener((message) => {
      if ((message as { type?: string })?.type === "openrelay:toggle")
        listener();
    }),
});
