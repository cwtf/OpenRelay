/**
 * Reddit's Cloudflare video host can omit CORS headers even on a successful
 * playlist response. HLS.js must read the playlist and its relative segments
 * across origins, so use the equivalent CORS-enabled host for playback.
 * Keep the path and signed query intact, and leave other media (including
 * offline blob URLs) alone.
 */
export const videoPlaybackUrl = (url: string): string =>
  url.replace(/^https:\/\/cf\.v\.redd\.it\//i, 'https://v.redd.it/');

const REDDIT_VIDEO = /^https:\/\/(?:cf\.)?v\.redd\.it\/([a-z0-9]+)\//i;

/** The v.redd.it video a stream or file URL belongs to. */
export const redditVideoId = (url: string | undefined): string | null =>
  (url && REDDIT_VIDEO.exec(url)?.[1]) || null;

/** Its DASH playlist, which v.redd.it serves unsigned and with CORS. */
export const redditDashUrl = (id: string): string =>
  `https://v.redd.it/${id}/DASHPlaylist.mpd`;

type Track = {
  name: string;
  bandwidth: number;
  codecs: string;
  width: number;
  height: number;
};

/**
 * A v.redd.it video's tracks, read from its DASH playlist (`base` is the
 * playlist's folder): the best video file, and an HLS master playlist that
 * names each track's own playlist.
 *
 * Reddit signs the HLS master playlist (`HLSPlaylist.m3u8?a=…`) and refuses
 * it without a valid signature, and a post read from Reddit's page HTML has
 * only that stream, no MP4. The per-track playlists (`CMAF_720.m3u8`) and
 * files need no signature, so this master plays the video with its sound
 * when the signed one is refused, and the file plays it without.
 */
export const streamsFromPlaylist = (
  mpd: string,
  base: string,
): { master: string; mp4: string } | null => {
  const video: Track[] = [];
  const audio: Track[] = [];
  for (const set of mpd.match(/<AdaptationSet\b[\s\S]*?<\/AdaptationSet>/g) ??
    []) {
    const head = /<AdaptationSet\b[^>]*>/.exec(set)?.[0] ?? '';
    const kind = /\b(?:contentType|mimeType)="(audio|video)/.exec(head)?.[1];
    for (const rep of set.match(/<Representation\b[\s\S]*?<\/Representation>/g) ??
      []) {
      const attr = (name: string) =>
        new RegExp(`\\b${name}="([^"]*)"`).exec(rep)?.[1] ?? '';
      const name = /<BaseURL>\s*([^<\s]+)\s*<\/BaseURL>/.exec(rep)?.[1] ?? '';
      if (!/^[\w.-]+\.mp4$/.test(name)) continue;
      const track = {
        name,
        bandwidth: Number(attr('bandwidth')) || 0,
        codecs: /^[\w.,-]+$/.test(attr('codecs')) ? attr('codecs') : '',
        width: Number(attr('width')) || 0,
        height: Number(attr('height')) || 0,
      };
      const type = /^(audio|video)/.exec(attr('mimeType'))?.[1] ?? kind;
      if (type === 'audio') audio.push(track);
      else if (type === 'video') video.push(track);
    }
  }
  if (!video.length) return null;
  const best = <T extends Track>(list: T[]) =>
    list.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a));
  const sound = audio.length ? best(audio) : null;
  const playlist = (track: Track) => base + track.name.replace(/\.mp4$/, '.m3u8');
  const lines = ['#EXTM3U', '#EXT-X-VERSION:6'];
  if (sound)
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="${playlist(sound)}"`,
    );
  for (const track of [...video].sort((a, b) => a.bandwidth - b.bandwidth)) {
    const codecs = [track.codecs, sound?.codecs].filter(Boolean);
    lines.push(
      '#EXT-X-STREAM-INF:' +
        [
          `BANDWIDTH=${track.bandwidth + (sound?.bandwidth ?? 0) || 1}`,
          // Both or neither: a partial list would hide the other track.
          ...(track.codecs && (!sound || sound.codecs)
            ? [`CODECS="${codecs.join(',')}"`]
            : []),
          ...(track.width && track.height
            ? [`RESOLUTION=${track.width}x${track.height}`]
            : []),
          ...(sound ? ['AUDIO="audio"'] : []),
        ].join(','),
      playlist(track),
    );
  }
  return { master: lines.join('\n') + '\n', mp4: base + best(video).name };
};
