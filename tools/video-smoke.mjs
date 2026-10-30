// Real media playback with separate HLS audio, in the built extension or app.
// Build first. Pass --desktop to exercise the Electron host instead.
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

process.chdir(resolve(import.meta.dirname, '..'));
const desktop = process.argv.includes('--desktop');
const desktopRequire = createRequire(resolve('apps/desktop/package.json'));
const playback = await import(process.env.PLAYWRIGHT_MODULE || (desktop
  ? pathToFileURL(desktopRequire.resolve('playwright')).href : 'playwright'));
const { chromium, _electron } = playback.default || playback;
const out = resolve('test-results');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(resolve(out, 'video-profile-'));
let electronApp;
let context;
if (desktop) {
  electronApp = await _electron.launch({
    executablePath: desktopRequire('electron'),
    args: ['-r', resolve('apps/desktop/test/hook.cjs'), resolve('apps/desktop')],
    env: { ...process.env, OPENRELAY_TEST_PROFILE: profile },
  });
  context = electronApp.context();
} else {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`],
    viewport: { width: 1100, height: 760 },
  });
}

const names = ['sound', 'hlsonly', 'silent', 'broken', 'noaudio', 'gif', 'unplayable'];
const post = (id) => ({
  kind: 't3',
  data: {
    id, name: `t3_${id}`, title: `Video ${id}`, author: 'fixture', subreddit: 'test',
    permalink: `/r/test/comments/${id}/x/`, url: `https://v.redd.it/${id}`,
    is_self: false, domain: 'v.redd.it', score: 1, num_comments: 0,
    secure_media: { reddit_video: {
      ...(id === 'hlsonly' ? {} : { fallback_url: `https://v.redd.it/${id}/fallback.mp4` }),
      hls_url: `https://v.redd.it/${id}/${id === 'silent' ? 'stream_0' : 'master'}.m3u8`,
      width: 160, height: 90, is_gif: id === 'gif',
    } },
  },
});
const requested = [];
const errors = [];
try {
  await context.route(/^https:\/\/(www\.reddit\.com|v\.redd\.it)\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'v.redd.it') {
      requested.push(url.pathname);
      const [, id, file] = url.pathname.split('/');
      const headers = { 'access-control-allow-origin': '*' };
      if (!names.includes(id) || !/^[\w.-]+$/.test(file) ||
          (id === 'broken' && file.endsWith('.m3u8')) ||
          (id === 'noaudio' && file === 'stream_1.m3u8') || id === 'unplayable')
        return route.fulfill({ status: 404, headers, body: '' });
      const body = await readFile(resolve('tools/fixtures/video', file));
      return route.fulfill({ body, headers,
        contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4' });
    }
    if (url.pathname.endsWith('.json')) return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { after: null, children:
        url.pathname === '/r/test/hot.json' ? names.map(post) : [] } }),
    });
    return route.fulfill({ contentType: 'text/html', body: '<title>Video fixture</title>' });
  });
  if (electronApp) await electronApp.evaluate(() => { globalThis.openRelayFixturesReady = true; });
  const page = electronApp ? await electronApp.firstWindow() : await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('https://www.reddit.com/r/test/');
  let app;
  for (let i = 0; i < 100 && !app; i++) {
    app = page.frames().find((frame) => frame.url().startsWith(
      desktop ? 'openrelay://reader' : 'chrome-extension://'));
    if (!app) await page.waitForTimeout(100);
  }
  assert.ok(app, 'reader frame loads');
  await app.getByText('Video sound', { exact: true }).first().waitFor();
  const open = async (id) => {
    await app.locator('.post', { hasText: `Video ${id}` })
      .getByRole('button', { name: /^(Play|Open) (video|GIF)$/ }).first().click();
    await app.locator('.viewer').waitFor();
    return app.locator('.viewer video');
  };
  const close = async () => {
    await app.locator('body').press('Escape');
    await app.locator('.viewer').waitFor({ state: 'detached' });
  };
  const play = async (video) => {
    await video.waitFor();
    // Give the reader a user gesture, including when autoplay is blocked.
    await video.click({ position: { x: 20, y: 20 } });
    await video.evaluate((v) => v.play());
    await app.waitForFunction(() => {
      const v = document.querySelector('.viewer video');
      return v && v.readyState >= 3 && v.currentTime > 0.1;
    });
  };
  for (const id of ['sound', 'hlsonly']) {
    const video = await open(id);
    await play(video);
    await app.waitForFunction(() => document.querySelector('.viewer video').webkitAudioDecodedByteCount > 0);
    assert.equal(await video.evaluate((v) => v.muted), false, 'normal videos are unmuted');
    // Decode a non-silent audio signal, rather than checking just an attribute.
    const level = await video.evaluate(async (v) => {
      const audio = new AudioContext();
      const source = audio.createMediaElementSource(v);
      const analyser = audio.createAnalyser();
      source.connect(analyser);
      analyser.connect(audio.destination);
      await audio.resume();
      const samples = new Float32Array(analyser.fftSize);
      let peak = 0;
      for (let i = 0; i < 20 && peak < 0.01; i++) {
        await new Promise((done) => setTimeout(done, 50));
        analyser.getFloatTimeDomainData(samples);
        peak = Math.max(peak, ...samples.map(Math.abs));
      }
      await audio.close();
      return peak;
    });
    assert.ok(level > 0.01, `${id}: audible signal decoded (${level})`);
    await video.evaluate((v) => { v.currentTime = 3; });
    await app.waitForFunction(() => {
      const v = document.querySelector('.viewer video');
      return v && !v.seeking && v.currentTime >= 3 && v.readyState >= 3;
    });
    const handle = await video.elementHandle();
    await close();
    assert.equal(await handle.evaluate((v) => v.paused && !v.getAttribute('src')), true, 'close releases media');
    const reopened = await open(id);
    await play(reopened);
    await app.waitForFunction(() => document.querySelector('.viewer video').webkitAudioDecodedByteCount > 0);
    await close();
  }
  for (const id of ['broken', 'noaudio']) {
    const video = await open(id);
    await app.getByRole('status').filter({ hasText: 'Audio unavailable' }).waitFor({ timeout: 30000 });
    assert.match(await video.getAttribute('src'), /fallback\.mp4$/);
    await play(video);
    await close();
  }
  const silent = await open('silent');
  await play(silent);
  assert.equal(await app.getByText('Audio unavailable', { exact: true }).count(), 0, 'silent HLS is not an error');
  await close();
  const gif = await open('gif');
  await play(gif);
  assert.equal(await gif.evaluate((v) => v.muted && v.loop && !v.controls), true);
  assert.ok(!requested.some((path) => path.startsWith('/gif/') && path.endsWith('.m3u8')), 'GIF bypasses HLS');
  await close();
  await open('unplayable');
  await app.getByText("This video can't be played here.", { exact: true }).waitFor({ timeout: 30000 });
  await close();
  assert.deepEqual(errors, []);
  console.log(`PASS (${desktop ? 'desktop' : 'extension'}): separate HLS audio decodes a non-silent signal; HLS-only videos, seeking, cleanup/reopening, broken playlists/audio fallback, silent videos, GIFs and playback errors.`);
} finally {
  if (electronApp) await electronApp.close();
  else await context.close();
}
