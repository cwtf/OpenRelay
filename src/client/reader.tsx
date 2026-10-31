import "./styles/reader.css";

import { createRoot } from "react-dom/client";
import { Root } from "./app/App";
import { applyPrefsToDocument, loadCachedPrefs } from "./app/prefs";
import { initStorage } from "./lib/storage";
import { syncInstances, trustedSource } from "./lib/sources";

// Load saved settings first, then apply the theme before first paint.
void initStorage().then(() => {
  applyPrefsToDocument(loadCachedPrefs());
  const container = document.getElementById("root");
  if (!container) return;
  if (!trustedSource()) {
    container.textContent = "OpenRelay isn't set up for this site.";
    return;
  }
  void syncInstances();
  createRoot(container).render(<Root />);
});
