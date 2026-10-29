import test from "node:test";
import assert from "node:assert/strict";

import { audioFromPlaylist, muxAudioVideo } from "./mp4.ts";

// Minimal single-track fragmented MP4s, laid out like v.redd.it's CMAF files.

const u32 = (...values: number[]) => {
  const out = new Uint8Array(values.length * 4);
  values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
  return out;
};
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const box = (type: string, ...parts: Uint8Array[]) => {
  const size = 8 + parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(ascii(type), 4);
  let at = 8;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
const concat = (...parts: Uint8Array[]) => box("xxxx", ...parts).slice(8);

type Fixture = {
  movieScale: number;
  mediaScale: number;
  elst?: number;
  fragments: { time: number; payload: string }[];
  tfhdFlags?: number;
};

const file = (f: Fixture) =>
  concat(
    box("ftyp", ascii("iso6"), u32(0)),
    box(
      "moov",
      // version/flags, creation, modification, timescale, duration, …, next_track_ID
      box("mvhd", u32(0, 0, 0, f.movieScale, 0), new Uint8Array(76), u32(2)),
      box(
        "trak",
        // version/flags, creation, modification, track_ID, reserved, duration
        box("tkhd", u32(0, 0, 0, 1, 0, 2 * f.movieScale), new Uint8Array(60)),
        ...(f.elst === undefined
          ? []
          : [box("edts", box("elst", u32(0, 1, f.elst, 1024, 0x10000)))]),
        box("mdia", box("mdhd", u32(0, 0, 0, f.mediaScale, 0, 0))),
      ),
      box("mvex", box("trex", u32(0, 1, 1, 0, 0, 0))),
    ),
    box("sidx", u32(0)),
    ...f.fragments.flatMap((frag, i) => [
      box(
        "moof",
        box("mfhd", u32(0, i + 1)),
        box(
          "traf",
          box("tfhd", u32(f.tfhdFlags ?? 0x20000, 1)),
          box("tfdt", u32(0, frag.time)),
        ),
      ),
      box("mdat", ascii(frag.payload)),
    ]),
  );

type Parsed = { type: string; start: number; end: number; body: Uint8Array };
const parse = (data: Uint8Array, start = 0, end = data.length): Parsed[] => {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: Parsed[] = [];
  for (let at = start; at < end; at += dv.getUint32(at)) {
    const size = dv.getUint32(at);
    out.push({
      type: String.fromCharCode(...data.subarray(at + 4, at + 8)),
      start: at,
      end: at + size,
      body: data.subarray(at + 8, at + size),
    });
  }
  return out;
};
const inside = (b: Parsed) => parse(b.body);
const words = (b: Parsed) => {
  const dv = new DataView(b.body.buffer, b.body.byteOffset, b.body.byteLength);
  return Array.from({ length: b.body.length >> 2 }, (_, i) => dv.getUint32(i * 4));
};
const child = (b: Parsed, type: string) => {
  const found = inside(b).find((c) => c.type === type);
  assert.ok(found, `missing ${type}`);
  return found;
};

const video = file({
  movieScale: 15360,
  mediaScale: 15360,
  fragments: [
    { time: 0, payload: "V0" },
    { time: 61440, payload: "V1" },
  ],
});
const audio = (extra: Partial<Fixture> = {}) =>
  file({
    movieScale: 48000,
    mediaScale: 48000,
    elst: 96000,
    fragments: [
      { time: 0, payload: "A0" },
      { time: 96000, payload: "A1" },
      { time: 192000, payload: "A2" },
    ],
    ...extra,
  });

test("muxing puts the audio track beside the video as track 2", () => {
  const out = parse(muxAudioVideo(video, audio()));
  assert.deepEqual(
    out.map((b) => b.type),
    ["ftyp", "moov", ...Array(5).fill(["moof", "mdat"]).flat()],
  );
  const moov = out[1]!;
  assert.equal(words(child(moov, "mvhd")).at(-1), 3);
  const traks = inside(moov).filter((b) => b.type === "trak");
  assert.deepEqual(
    traks.map((t) => words(child(t, "tkhd"))[3]),
    [1, 2],
  );
  const trexes = inside(child(moov, "mvex")).filter((b) => b.type === "trex");
  assert.deepEqual(trexes.map((t) => words(t)[1]), [1, 2]);
});

test("audio durations move to the video's movie timescale", () => {
  const moov = parse(muxAudioVideo(video, audio()))[1]!;
  const trak = inside(moov).filter((b) => b.type === "trak")[1]!;
  // 2 s and an edit of 2 s, at 15360 instead of 48000 per second.
  assert.equal(words(child(trak, "tkhd"))[5], 30720);
  const elst = words(child(child(trak, "edts"), "elst"));
  assert.deepEqual(elst.slice(2, 4), [30720, 1024]);
});

test("fragments interleave by decode time and are renumbered", () => {
  const out = parse(muxAudioVideo(video, audio()));
  const moofs = out.filter((b) => b.type === "moof");
  const payloads = out
    .filter((b) => b.type === "mdat")
    .map((b) => String.fromCharCode(...b.body));
  // Video fragments start at 0 s and 4 s; audio at 0, 2 and 4 s.
  assert.deepEqual(payloads, ["V0", "A0", "A1", "V1", "A2"]);
  assert.deepEqual(
    moofs.map((m) => words(child(m, "mfhd"))[1]),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    moofs.map((m) => words(child(child(m, "traf"), "tfhd"))[1]),
    [1, 2, 2, 1, 2],
  );
});

test("muxing refuses fragments with absolute data offsets", () => {
  assert.throws(() => muxAudioVideo(video, audio({ tfhdFlags: 0x1 })));
  assert.throws(() => muxAudioVideo(video, ascii("not an mp4 file")));
});

test("the playlist's best audio file is found, or none for silent video", () => {
  const cmaf = `<MPD><Period>
    <AdaptationSet contentType="video"><Representation bandwidth="900000" mimeType="video/mp4"><BaseURL>CMAF_720.mp4</BaseURL></Representation></AdaptationSet>
    <AdaptationSet contentType="audio">
      <Representation bandwidth="68020" mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_64.mp4</BaseURL></Representation>
      <Representation bandwidth="131877" mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></Representation>
    </AdaptationSet></Period></MPD>`;
  assert.equal(audioFromPlaylist(cmaf), "CMAF_AUDIO_128.mp4");
  const older = `<MPD><Period><AdaptationSet><Representation bandwidth="1" mimeType="video/mp4"><BaseURL>DASH_480.mp4</BaseURL></Representation>
    <Representation bandwidth="2" mimeType="audio/mp4"><BaseURL>DASH_audio.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`;
  assert.equal(audioFromPlaylist(older), "DASH_audio.mp4");
  const silent = cmaf.replace(/<AdaptationSet contentType="audio">[\s\S]*?<\/AdaptationSet>/, "");
  assert.equal(audioFromPlaylist(silent), null);
  assert.equal(
    audioFromPlaylist(cmaf.replace("CMAF_AUDIO_128.mp4", "../x.mp4")),
    "CMAF_AUDIO_64.mp4",
  );
});
