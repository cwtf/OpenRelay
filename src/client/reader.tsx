import "./styles/reader.css";

import { createRoot } from "react-dom/client";
import { Root } from "./app/App";
import { applyPrefsToDocument, loadCachedPrefs } from "./app/prefs";

// Apply the viewer's last theme before first paint to avoid a flash.
applyPrefsToDocument(loadCachedPrefs());

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<Root />);
}
