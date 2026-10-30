// Packs a built extension folder as a .zip (Chrome Web Store upload, Firefox
// .xpi) or a signed CRX3 (sideloading, e.g. Edge Canary on Android), with only
// Node's own zlib and crypto.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

// A plain zip of every file under dir, with forward-slash paths (Firefox
// rejects backslashes) and a fixed 1980-01-01 timestamp, so the same files
// always give the same bytes.
export function zipDirectory(dir) {
  const DOS_DATE = (1 << 5) | 1;
  const UTF8 = 0x0800;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of listFiles(dir)) {
    const name = Buffer.from(relative(dir, file).split("\\").join("/"));
    const data = readFileSync(file);
    const deflated = deflateRawSync(data, { level: 9 });
    const [method, body] = deflated.length < data.length ? [8, deflated] : [0, data];
    const crc = crc32(data);
    // Fields shared by the local and central headers, from "version needed" on.
    const common = Buffer.concat([
      u16(20), u16(UTF8), u16(method), u16(0), u16(DOS_DATE),
      u32(crc), u32(body.length), u32(data.length), u16(name.length), u16(0),
    ]);
    const local = Buffer.concat([u32(0x04034b50), common, name, body]);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, central, end]);
}

function varint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

// A length-delimited protobuf field.
function field(number, bytes) {
  return Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes]);
}

// The extension ID Chrome derives from a key: the first 16 bytes of the
// SHA-256 of its public key, as hex digits mapped onto a-p.
export function extensionId(publicKeyDer) {
  return [...createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 32)]
    .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
    .join("");
}

// A CRX3 file, as Chrome's "Pack extension" writes it: "Cr24", version 3, a
// CrxFileHeader protobuf with one RSA-SHA256 proof, then the zip. The
// signature covers "CRX3 SignedData\0", the SignedData's length and bytes, and
// the zip. See components/crx_file/crx3.proto in Chromium.
export function crx3(zip, privateKeyPem) {
  const publicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "der" });
  const crxId = createHash("sha256").update(publicKey).digest().subarray(0, 16);
  const signedData = field(1, crxId);
  const signature = sign(
    "sha256",
    Buffer.concat([Buffer.from("CRX3 SignedData\0"), u32(signedData.length), signedData, zip]),
    privateKeyPem,
  );
  const header = Buffer.concat([field(2, Buffer.concat([field(1, publicKey), field(2, signature)])), field(10000, signedData)]);
  return { crx: Buffer.concat([Buffer.from("Cr24"), u32(3), u32(header.length), header, zip]), id: extensionId(publicKey) };
}
