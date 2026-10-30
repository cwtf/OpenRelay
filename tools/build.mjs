import { build } from "vite";
import { copyFile, cp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
await build({
  configFile: false,
  root: resolve(root, "src/client"),
  base: "./",
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    rolldownOptions: { input: resolve(root, "src/client/reader.html") },
  },
});
for (const entry of ["content", "background"]) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      outDir: resolve(root, "dist"),
      emptyOutDir: false,
      lib: {
        entry: resolve(root, `src/extension/${entry}.ts`),
        name: "OpenRelay",
        formats: ["iife"],
        fileName: () => `${entry}.js`,
      },
    },
  });
}
const manifest = JSON.parse(
  await readFile(resolve(root, "public/manifest.json"), "utf8"),
);
await copyFile(
  resolve(root, "public/manifest.json"),
  resolve(root, "dist/manifest.json"),
);
await cp(resolve(root, "public/icons"), resolve(root, "dist/icons"), {
  recursive: true,
});
// Firefox gets the same files in dist-firefox/. Its MV3 has no background
// service worker, only event-page scripts, and it needs a fixed add-on ID
// (keep it unchanged once published, or updates won't reach installs).
// AMO also requires a data-collection declaration, which needs Firefox 140 (142 on Android).
await rm(resolve(root, "dist-firefox"), { recursive: true, force: true });
await cp(resolve(root, "dist"), resolve(root, "dist-firefox"), {
  recursive: true,
});
const firefox = {
  ...manifest,
  background: { scripts: ["background.js"] },
  browser_specific_settings: {
    gecko: {
      id: "openrelay-reddit@cwtf",
      strict_min_version: "140.0",
      data_collection_permissions: { required: ["none"] },
    },
    gecko_android: { strict_min_version: "142.0" },
  },
};
await writeFile(
  resolve(root, "dist-firefox/manifest.json"),
  JSON.stringify(firefox, null, 2) + "\n",
);
