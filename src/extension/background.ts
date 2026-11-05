chrome.action.onClicked.addListener((tab) => {
  // A tab without the content script (offline, or not Reddit) gets the posts
  // saved for offline reading instead.
  const offline = () =>
    void chrome.tabs.create({ url: chrome.runtime.getURL("reader.html#offline") });
  if (tab.id === undefined) return offline();
  void chrome.tabs
    .sendMessage(tab.id, { type: "openrelay:toggle" })
    .catch((error: unknown) => {
      // The content script doesn't answer, which can reject too; only a tab
      // with no receiver at all is one without it.
      if (/receiving end does not exist/i.test(String(error))) offline();
    });
});

// The cookie store of the tab the reader is in, for switching accounts there
// alone (a Firefox container or a private window has its own sign-in). Only
// the extension's own reader page may ask.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if ((message as { type?: unknown } | null)?.type !== "openrelay:cookie-store") return;
  const tab = sender.tab;
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL("reader.html")) ||
    tab?.id === undefined
  ) {
    reply(null);
    return;
  }
  if (tab.cookieStoreId) {
    reply(tab.cookieStoreId);
    return;
  }
  const tabId = tab.id;
  const stores = chrome.cookies?.getAllCookieStores();
  if (!stores) {
    reply(null);
    return;
  }
  stores
    .then((list) => reply(list.find((store) => store.tabIds.includes(tabId))?.id ?? null))
    .catch(() => reply(null));
  return true;
});
