import test from 'node:test';
import assert from 'node:assert/strict';
import { videoPlaybackUrl } from './video.ts';

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
