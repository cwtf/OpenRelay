import { build } from "vite";
import { copyFile } from "node:fs/promises";
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
await copyFile(
  resolve(root, "public/manifest.json"),
  resolve(root, "dist/manifest.json"),
);
