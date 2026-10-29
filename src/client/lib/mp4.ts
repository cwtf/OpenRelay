/**
 * Joins a Reddit video's separate video and audio files into one MP4.
 *
 * v.redd.it serves each as its own fragmented MP4 (DASH/CMAF: ftyp, moov with
 * one track, sidx, then moof/mdat fragments). Both tracks go into one moov,
 * the audio track is renumbered to 2, and the fragments are interleaved by
 * decode time. Samples are copied as they are; nothing is re-encoded.
 */

type Box = { type: string; start: number; end: number; header: number };

const view = (data: Uint8Array) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength);

const children = (data: Uint8Array, start = 0, end = data.length): Box[] => {
  const dv = view(data);
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = dv.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(dv.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) throw new Error('Malformed MP4');
    out.push({
      type: String.fromCharCode(...data.subarray(at + 4, at + 8)),
      start: at,
      end: at + size,
      header,
    });
    at += size;
  }
  return out;
};

const childrenOf = (data: Uint8Array, box: Box) =>
  children(data, box.start + box.header, box.end);

const find = (data: Uint8Array, box: Box, path: string[]): Box | undefined => {
  let current: Box | undefined = box;
  for (const type of path) {
    current = current && childrenOf(data, current).find((b) => b.type === type);
  }
  return current;
};

const box = (type: string, parts: Uint8Array[]): Uint8Array => {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  view(out).setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const copy = (data: Uint8Array, b: Box) => data.slice(b.start, b.end);

/** Rebuilds a container box, letting `edit` replace or drop each child. */
const rebuild = (
  data: Uint8Array,
  b: Box,
  edit: (child: Box) => Uint8Array[] | undefined,
): Uint8Array =>
  box(
    b.type,
    childrenOf(data, b).flatMap(
      (child) => edit(child) ?? [copy(data, child)],
    ),
  );

/** Offset of the first field after a full box's version/flags. */
const fields = (b: Box) => b.start + b.header + 4;
const version = (data: Uint8Array, b: Box) => data[b.start + b.header] ?? 0;

const readTime = (dv: DataView, at: number, long: boolean) =>
  long ? Number(dv.getBigUint64(at)) : dv.getUint32(at);
const writeTime = (dv: DataView, at: number, long: boolean, value: number) => {
  if (long) dv.setBigUint64(at, BigInt(Math.round(value)));
  else dv.setUint32(at, Math.min(0xffffffff, Math.round(value)));
};

type Track = {
  data: Uint8Array;
  moov: Box;
  trak: Box;
  trex: Box;
  /** Timescale of the file's movie header. */
  movieScale: number;
  /** Timescale of the track's media (tfdt values). */
  mediaScale: number;
  fragments: { moof: Box; mdat: Box }[];
};

const parse = (data: Uint8Array): Track => {
  const top = children(data);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Error('No moov box');
  const traks = childrenOf(data, moov).filter((b) => b.type === 'trak');
  const trak = traks[0];
  const trex = find(data, moov, ['mvex', 'trex']);
  const mvhd = find(data, moov, ['mvhd']);
  const mdhd = trak && find(data, trak, ['mdia', 'mdhd']);
  if (traks.length !== 1 || !trak || !trex || !mvhd || !mdhd) {
    throw new Error('Not a single-track fragmented MP4');
  }
  const dv = view(data);
  const scaleAt = (b: Box) => fields(b) + (version(data, b) ? 16 : 8);
  const fragments: Track['fragments'] = [];
  top.forEach((b, i) => {
    const next = top[i + 1];
    if (b.type === 'moof' && next?.type === 'mdat') {
      fragments.push({ moof: b, mdat: next });
    }
  });
  if (!fragments.length) throw new Error('No fragments');
  return {
    data,
    moov,
    trak,
    trex,
    movieScale: dv.getUint32(scaleAt(mvhd)),
    mediaScale: dv.getUint32(scaleAt(mdhd)),
    fragments,
  };
};

/** Decode time of a fragment, in seconds. */
const fragmentTime = (track: Track, moof: Box): number => {
  const tfdt = find(track.data, moof, ['traf', 'tfdt']);
  if (!tfdt) return 0;
  const long = version(track.data, tfdt) === 1;
  return readTime(view(track.data), fields(tfdt), long) / track.mediaScale;
};

/** The audio track as track 2, its durations moved to the video's timescale. */
const audioTrak = (audio: Track, movieScale: number): Uint8Array => {
  const { data } = audio;
  const scale = movieScale / audio.movieScale;
  const tkhd = (b: Box) => {
    const out = copy(data, b);
    const dv = view(out);
    const long = version(data, b) === 1;
    const id = b.header + 4 + (long ? 16 : 8);
    dv.setUint32(id, 2);
    const duration = id + 8;
    writeTime(dv, duration, long, readTime(dv, duration, long) * scale);
    return out;
  };
  const elst = (b: Box) => {
    const out = copy(data, b);
    const dv = view(out);
    const long = version(data, b) === 1;
    const entry = long ? 20 : 12;
    const count = dv.getUint32(b.header + 4);
    for (let i = 0; i < count; i++) {
      const at = b.header + 8 + i * entry;
      writeTime(dv, at, long, readTime(dv, at, long) * scale);
    }
    return out;
  };
  return rebuild(data, audio.trak, (child) => {
    if (child.type === 'tkhd') return [tkhd(child)];
    if (child.type === 'edts') {
      return [
        rebuild(data, child, (e) => (e.type === 'elst' ? [elst(e)] : undefined)),
      ];
    }
    return undefined;
  });
};

/** A fragment with its sequence number set and (for audio) track ID 2. */
const fragment = (
  track: Track,
  frag: Track['fragments'][number],
  sequence: number,
  trackId?: number,
): Uint8Array[] => {
  const { data } = track;
  const moof = rebuild(data, frag.moof, (child) => {
    if (child.type === 'mfhd') {
      const out = copy(data, child);
      view(out).setUint32(child.header + 4, sequence);
      return [out];
    }
    if (child.type === 'traf') {
      return [
        rebuild(data, child, (t) => {
          if (t.type !== 'tfhd') return undefined;
          const out = copy(data, t);
          const dv = view(out);
          // An absolute base offset would point into the original file.
          if (dv.getUint32(t.header) & 0x1) {
            throw new Error('Absolute fragment offsets');
          }
          if (trackId) dv.setUint32(t.header + 4, trackId);
          return [out];
        }),
      ];
    }
    return undefined;
  });
  if (moof.length !== frag.moof.end - frag.moof.start) {
    throw new Error('Fragment size changed');
  }
  return [moof, data.subarray(frag.mdat.start, frag.mdat.end)];
};

/** Combines a video-only and an audio-only fragmented MP4 into one file. */
export const muxAudioVideo = (
  videoData: Uint8Array,
  audioData: Uint8Array,
): Uint8Array => {
  const video = parse(videoData);
  const audio = parse(audioData);
  const ftyp = children(videoData).find((b) => b.type === 'ftyp');

  const trex = copy(audioData, audio.trex);
  view(trex).setUint32(audio.trex.header + 4, 2);
  const moov = rebuild(videoData, video.moov, (child) => {
    if (child.type === 'mvhd') {
      const out = copy(videoData, child);
      view(out).setUint32(out.length - 4, 3); // next_track_ID
      return [out];
    }
    if (child.type === 'trak') {
      return [copy(videoData, child), audioTrak(audio, video.movieScale)];
    }
    if (child.type === 'mvex') {
      return [
        box('mvex', [
          ...childrenOf(videoData, child).map((b) => copy(videoData, b)),
          trex,
        ]),
      ];
    }
    return undefined;
  });

  const ordered = [
    ...video.fragments.map((f) => ({
      track: video,
      frag: f,
      audio: false,
      time: fragmentTime(video, f.moof),
    })),
    ...audio.fragments.map((f) => ({
      track: audio,
      frag: f,
      audio: true,
      time: fragmentTime(audio, f.moof),
    })),
  ].sort((a, b) => a.time - b.time);

  const parts = [
    ...(ftyp ? [copy(videoData, ftyp)] : []),
    moov,
    ...ordered.flatMap((entry, i) =>
      fragment(entry.track, entry.frag, i + 1, entry.audio ? 2 : undefined),
    ),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/**
 * The audio file named in a v.redd.it DASH playlist, highest bitrate first.
 * Returns null for silent videos, whose playlist has no audio.
 */
export const audioFromPlaylist = (mpd: string): string | null => {
  let best: { name: string; bandwidth: number } | null = null;
  for (const set of mpd.match(/<AdaptationSet\b[\s\S]*?<\/AdaptationSet>/g) ??
    []) {
    const audioSet = /<AdaptationSet\b[^>]*\b(contentType|mimeType)="audio/.test(
      set,
    );
    for (const rep of set.match(/<Representation\b[\s\S]*?<\/Representation>/g) ??
      []) {
      if (!audioSet && !/\bmimeType="audio/.test(rep)) continue;
      const name = /<BaseURL>\s*([^<\s]+)\s*<\/BaseURL>/.exec(rep)?.[1];
      const bandwidth = Number(/\bbandwidth="(\d+)"/.exec(rep)?.[1] ?? 0);
      if (name && /^[\w.-]+$/.test(name) && (!best || bandwidth > best.bandwidth)) {
        best = { name, bandwidth };
      }
    }
  }
  return best?.name ?? null;
};
