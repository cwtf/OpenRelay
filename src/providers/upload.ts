/**
 * An image attached to a reply, as it crosses the page bridge: its type and
 * bytes as base64 (the Android app's bridge carries only strings). The reader
 * encodes it; the content script checks it before any site sees it.
 */
export type ImagePayload = { type: string; data: string };
export type ImageFile = { name: string; type: string; bytes: Uint8Array<ArrayBuffer> };

/** The types replies take, and the extension each is uploaded under. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
export const IMAGE_TYPES = Object.keys(EXTENSIONS);
/** Reddit's limit for images; Lemmy instances set their own, usually lower. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** How long the page gets to upload one (the bridge's usual wait is 22 s). */
export const UPLOAD_TIMEOUT = 90000;

/** Whether the bytes start the way an image of `type` does. */
const looksLike = (type: string, b: Uint8Array): boolean => {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  switch (type) {
    case "image/png":
      return b[0] === 0x89 && ascii(1, 4) === "PNG";
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/gif":
      return ascii(0, 4) === "GIF8";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    default:
      return false;
  }
};

/** The reader's half: an image file as the bridge carries it. */
export async function encodeImage(file: Blob): Promise<ImagePayload> {
  if (!IMAGE_TYPES.includes(file.type))
    throw new Error("Attach a PNG, JPEG, GIF or WebP image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images can be at most 20 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: file.type, data: btoa(binary) };
}

/**
 * The content script's half: the image from a bridge request, or "Invalid
 * request". Its name is always `image.<ext>`, so the file's own name never
 * leaves the device.
 */
export function decodeImage(value: unknown): ImageFile {
  const payload = value as Partial<ImagePayload> | null;
  const type = typeof payload?.type === "string" ? payload.type : "";
  const data = typeof payload?.data === "string" ? payload.data : "";
  const extension = Object.hasOwn(EXTENSIONS, type) ? EXTENSIONS[type] : undefined;
  if (!extension || !data || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
    throw new Error("Invalid request");
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    throw new Error("Invalid request");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!looksLike(type, bytes)) throw new Error("Invalid request");
  return { name: `image.${extension}`, type, bytes };
}
