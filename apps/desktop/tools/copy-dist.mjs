// Copies the shared build (`npm run build` at the repo root) into the app.
// The manifest and background.js are only for the extension.
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const app = resolve(import.meta.dirname, "..");
const dist = resolve(app, "../../dist");
const out = resolve(app, "openrelay");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const entry of ["reader.html", "assets", "content.js"])
  await cp(resolve(dist, entry), resolve(out, entry), { recursive: true });
console.log("Copied reader.html, assets/ and content.js into", out);
