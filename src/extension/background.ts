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
