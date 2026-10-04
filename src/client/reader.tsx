import "./styles/reader.css";

import { createRoot } from "react-dom/client";
import { Root } from "./app/App";
import { applyPrefsToDocument, loadCachedPrefs } from "./app/prefs";
import { initStorage } from "./lib/storage";

// Load saved settings first, then apply the theme before first paint.
void initStorage().then(() => {
  applyPrefsToDocument(loadCachedPrefs());
  const container = document.getElementById("root");
  if (container) createRoot(container).render(<Root />);
});
