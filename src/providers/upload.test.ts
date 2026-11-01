import test from "node:test";
import assert from "node:assert/strict";
import { decodeImage, encodeImage } from "./upload.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const GIF = new TextEncoder().encode("GIF89a....");

test("carries an image across the bridge, named only by its type", async () => {
  const payload = await encodeImage(new Blob([PNG], { type: "image/png" }));
  assert.deepEqual(decodeImage(payload), { name: "image.png", type: "image/png", bytes: PNG });
  const gif = decodeImage(await encodeImage(new Blob([GIF], { type: "image/gif" })));
  assert.equal(gif.name, "image.gif");
  await assert.rejects(encodeImage(new Blob(["<svg/>"], { type: "image/svg+xml" })), /PNG, JPEG, GIF or WebP/);
});

test("refuses anything but a PNG, JPEG, GIF or WebP that looks like one", async () => {
  const png = await encodeImage(new Blob([PNG], { type: "image/png" }));
  for (const bad of [
    null,
    "image",
    { type: "image/svg+xml", data: png.data },
    { type: "text/html", data: png.data },
    // A PNG's bytes sent as a GIF, or a page sent as a PNG.
    { type: "image/gif", data: png.data },
    { type: "image/png", data: btoa("<html>") },
    { type: "image/png", data: "not base64!" },
    { type: "image/png", data: "" },
    { type: "image/png", data: "A".repeat(28 * 1024 * 1024) },
  ])
    assert.throws(() => decodeImage(bad), /Invalid request/);
});
