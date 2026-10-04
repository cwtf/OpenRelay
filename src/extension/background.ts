chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    void chrome.tabs
      .sendMessage(tab.id, { type: "openrelay:toggle" })
      .catch(() => undefined);
  }
});
