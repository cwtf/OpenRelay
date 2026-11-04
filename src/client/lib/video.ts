/**
 * Reddit's Cloudflare video host can omit CORS headers even on a successful
 * playlist response. HLS.js must read the playlist and its relative segments
 * across origins, so use the equivalent CORS-enabled host for playback.
 * Keep the path and signed query intact, and leave other media (including
 * offline blob URLs) alone.
 */
export const videoPlaybackUrl = (url: string): string =>
  url.replace(/^https:\/\/cf\.v\.redd\.it\//i, 'https://v.redd.it/');
