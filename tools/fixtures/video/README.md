# Generated playback fixture

Six seconds of a test pattern and a 440 Hz tone. Generated locally with
FFmpeg (synthetic inputs, no third-party media). The HLS master names separate
video and AAC audio playlists; `fallback.mp4` contains video only.

To regenerate from the repository root with FFmpeg on your PATH:

```sh
ffmpeg -f lavfi -i "testsrc=size=160x90:rate=10:duration=6" -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=6" -map 0:v -map 1:a -c:v libx264 -profile:v baseline -pix_fmt yuv420p -g 20 -sc_threshold 0 -c:a aac -b:a 48k -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -var_stream_map "v:0,agroup:audio a:0,agroup:audio,default:yes" -master_pl_name master.m3u8 -hls_fmp4_init_filename "init_%v.mp4" -hls_segment_filename "tools/fixtures/video/part_%v_%d.m4s" "tools/fixtures/video/stream_%v.m3u8"
ffmpeg -i tools/fixtures/video/stream_0.m3u8 -c copy -an tools/fixtures/video/fallback.mp4
```

Run `node tools/video-smoke.mjs` after building the extension, or
`node tools/video-smoke.mjs --desktop` after building the desktop app.
Playwright and its Chromium must be installed for the extension test, as for
the other browser tests; `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` are supported.
