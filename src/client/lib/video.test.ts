import test from 'node:test';
import assert from 'node:assert/strict';
import {
  redditVideoId,
  streamsFromPlaylist,
  videoPlaybackUrl,
} from './video.ts';

// Trimmed from a real v.redd.it DASHPlaylist.mpd.
const cmaf = `<MPD><Period>
  <AdaptationSet contentType="video" id="1" maxHeight="1280" maxWidth="720">
    <Representation bandwidth="809826" codecs="avc1.4d401e" height="640" id="7" mimeType="video/mp4" width="360"><BaseURL>CMAF_360.mp4</BaseURL></Representation>
    <Representation bandwidth="2284192" codecs="avc1.4d401f" height="1280" id="9" mimeType="video/mp4" width="720"><BaseURL>CMAF_720.mp4</BaseURL></Representation>
  </AdaptationSet>
  <AdaptationSet contentType="audio" id="2">
    <Representation audioSamplingRate="48000" bandwidth="66036" codecs="mp4a.40.2" id="10" mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_64.mp4</BaseURL></Representation>
    <Representation audioSamplingRate="48000" bandwidth="131118" codecs="mp4a.40.2" id="11" mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></Representation>
  </AdaptationSet>
</Period></MPD>`;
const base = 'https://v.redd.it/t7qb6f1uez0i1/';

test('a v.redd.it DASH playlist gives an unsigned HLS master with sound, and the best file', () => {
  const streams = streamsFromPlaylist(cmaf, base);
  assert.equal(streams?.mp4, base + 'CMAF_720.mp4');
  assert.equal(
    streams?.master,
    [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="${base}CMAF_AUDIO_128.m3u8"`,
      '#EXT-X-STREAM-INF:BANDWIDTH=940944,CODECS="avc1.4d401e,mp4a.40.2",RESOLUTION=360x640,AUDIO="audio"',
      base + 'CMAF_360.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2415310,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=720x1280,AUDIO="audio"',
      base + 'CMAF_720.m3u8',
      '',
    ].join('\n'),
  );
});

test('a silent or older DASH playlist, and unusable ones', () => {
  const silent = cmaf.replace(/<AdaptationSet contentType="audio"[\s\S]*?<\/AdaptationSet>/, '');
  const master = streamsFromPlaylist(silent, base)!.master;
  assert.doesNotMatch(master, /AUDIO/);
  assert.match(master, /CODECS="avc1\.4d401f",RESOLUTION=720x1280\n/);
  // Older videos name their tracks by mimeType alone, without codecs.
  const older = `<MPD><Period><AdaptationSet><Representation bandwidth="1" mimeType="video/mp4"><BaseURL>DASH_480.mp4</BaseURL></Representation>
    <Representation bandwidth="2" mimeType="audio/mp4"><BaseURL>DASH_audio.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`;
  const old = streamsFromPlaylist(older, base)!;
  assert.equal(old.mp4, base + 'DASH_480.mp4');
  assert.match(old.master, /URI="https:\/\/v\.redd\.it\/t7qb6f1uez0i1\/DASH_audio\.m3u8"/);
  assert.match(old.master, /#EXT-X-STREAM-INF:BANDWIDTH=3,AUDIO="audio"\n/);
  // Only plain file names in the video's own folder.
  assert.equal(streamsFromPlaylist(cmaf.replaceAll(/CMAF_\d+\.mp4/g, '../x.mp4'), base), null);
  assert.equal(streamsFromPlaylist('<Error><Code>AccessDenied</Code></Error>', base), null);
  assert.equal(streamsFromPlaylist('', base), null);
});

test('the v.redd.it video a URL belongs to', () => {
  assert.equal(redditVideoId(base + 'HLSPlaylist.m3u8?a=1'), 't7qb6f1uez0i1');
  assert.equal(redditVideoId('https://cf.v.redd.it/abc123/CMAF_720.mp4'), 'abc123');
  assert.equal(redditVideoId('https://v.redd.it.example.com/abc/x.m3u8'), null);
  assert.equal(redditVideoId('blob:chrome-extension://reader/offline-video'), null);
  assert.equal(redditVideoId(undefined), null);
});

test('Reddit CDN playback uses the CORS-enabled host without changing signed URLs', () => {
  const path = 'd5nx6hcjgazh1/HLSPlaylist.m3u8?f=sd%2CsubsAll%2ChlsSpecOrder%2Cvp9&v=1&a=123%2Cabc%3D%3D';
  assert.equal(videoPlaybackUrl('https://cf.v.redd.it/' + path), 'https://v.redd.it/' + path);
  assert.equal(videoPlaybackUrl('https://CF.V.REDD.IT/id/CMAF_720.mp4'), 'https://v.redd.it/id/CMAF_720.mp4');
});

test('other hosts, lookalike URLs and offline videos keep their original URLs', () => {
  for (const url of [
    'https://v.redd.it/id/HLSPlaylist.m3u8?a=1',
    'https://example.com/video.m3u8',
    'https://cf.v.redd.it.example.com/video.m3u8',
    'https://cf.v.redd.it@example.com/video.m3u8',
    'https://example.com/?url=https://cf.v.redd.it/video.m3u8',
    'blob:chrome-extension://reader/offline-video',
  ]) assert.equal(videoPlaybackUrl(url), url);
});
