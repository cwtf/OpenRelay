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

const names = ['sound', 'hlsonly', 'cdn', 'cdnfallback', 'silent', 'broken', 'noaudio', 'gif', 'hlsgif', 'unplayable'];
const cdnQuery = '?f=sd%2CsubsAll%2ChlsSpecOrder%2Cvp9&v=1&a=123%2Cabc%3D%3D';
const post = (id) => ({
  kind: 't3',
  data: {
    id, name: `t3_${id}`, title: `Video ${id}`, author: 'fixture', subreddit: 'test',
    permalink: `/r/test/comments/${id}/x/`, url: `https://v.redd.it/${id}`,
    is_self: false, domain: 'v.redd.it', score: 1, num_comments: 0,
    secure_media: { reddit_video: {
      ...(['hlsonly', 'cdn', 'hlsgif'].includes(id) ? {} : {
        fallback_url: `https://${id === 'cdnfallback' ? 'cf.v.redd.it' : 'v.redd.it'}/${id}/fallback.mp4`,
      }),
      hls_url: `https://${id.startsWith('cdn') ? 'cf.v.redd.it' : 'v.redd.it'}/${id}/${id === 'silent' ? 'stream_0' : 'master'}.m3u8${id.startsWith('cdn') ? cdnQuery : ''}`,
      width: 160, height: 90, is_gif: ['gif', 'hlsgif'].includes(id),
    } },
  },
});
const requested = [];
const cdnRequests = [];
const cdnPlaylists = [];
const errors = [];
const htmlGifSource = 'https://preview.redd.it/htmlgif.gif?width=160&format=mp4&s=fixture';
const htmlGif = `<shreddit-post id="t3_htmlgif" post-title="Video htmlgif" author="fixture" subreddit-name="htmlgif" permalink="/r/htmlgif/comments/htmlgif/x/" content-href="https://i.redd.it/htmlgif.gif" post-type="gif" score="1" comment-count="0"><shreddit-player src="${htmlGifSource.replaceAll('&', '&amp;')}" gif></shreddit-player></shreddit-post>`;
try {
  await context.route(/^https:\/\/(www\.reddit\.com|preview\.redd\.it|(?:cf\.)?v\.redd\.it)\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'preview.redd.it') {
      requested.push(url.pathname + url.search);
      return route.fulfill({ contentType: 'video/mp4', body: await readFile(resolve('tools/fixtures/video/fallback.mp4')) });
    }
    if (url.hostname === 'cf.v.redd.it') {
      cdnRequests.push(url.href);
      // Like the real CDN response: HTTP success without CORS permission.
      return route.fulfill({ status: 200, headers: {
        'access-control-allow-origin': '',
      }, contentType: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n' });
    }
    if (url.hostname === 'v.redd.it') {
      requested.push(url.pathname);
      if (url.pathname.startsWith('/cdn') && url.pathname.endsWith('/master.m3u8'))
        cdnPlaylists.push(url.search);
      const [, id, file] = url.pathname.split('/');
      const headers = { 'access-control-allow-origin': '*' };
      if (!names.includes(id) || !/^[\w.-]+$/.test(file) ||
          (['broken', 'cdnfallback'].includes(id) && file.endsWith('.m3u8')) ||
          (id === 'noaudio' && file === 'stream_1.m3u8') || id === 'unplayable')
        return route.fulfill({ status: 404, headers, body: '' });
      const body = await readFile(resolve('tools/fixtures/video', file));
      return route.fulfill({ body, headers,
        contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4' });
    }
    if (url.pathname === '/r/htmlgif/') return route.fulfill({
      contentType: 'text/html', body: '<title>HTML GIF fixture</title>' + htmlGif,
    });
    if (url.pathname === '/original.gif') return route.fulfill({
      contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    });
    if (url.pathname === '/comments/htmlgif.json') return route.fulfill({
      contentType: 'application/json', body: JSON.stringify([
        { data: { children: [{ kind: 't3', data: {
          id: 'htmlgif', name: 't3_htmlgif', title: 'Video htmlgif', subreddit: 'htmlgif',
          permalink: '/r/htmlgif/comments/htmlgif/x/', url: 'https://i.redd.it/htmlgif.gif',
          preview: { images: [{ source: { url: 'https://www.reddit.com/original.gif', width: 160, height: 90 } }] },
        } }] } }, { data: { children: [] } },
      ]),
    });
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
  for (const id of ['sound', 'hlsonly', 'cdn']) {
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
  for (const id of ['broken', 'noaudio', 'cdnfallback']) {
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
  const hlsGif = await open('hlsgif');
  await play(hlsGif);
  assert.equal(await hlsGif.evaluate((v) => v.muted && v.loop && !v.controls), true, 'HLS-only GIFs still stream');
  await close();
  await open('unplayable');
  await app.getByText("This video can't be played here.", { exact: true }).waitFor({ timeout: 30000 });
  await close();
  assert.deepEqual(cdnRequests, [], 'playback avoids the CDN host without CORS');
  assert.ok(cdnPlaylists.length >= 3, 'CDN HLS-only playback, reopening and MP4 fallback exercised');
  assert.ok(cdnPlaylists.every((query) => query === cdnQuery), 'signed playback parameters stay intact');

  // The feed snapshot has Reddit's MP4 GIF player; the post JSON describes
  // the same upload as an animated image. Both must be usable as GIFs.
  await page.goto('https://www.reddit.com/r/htmlgif/');
  app = undefined;
  for (let i = 0; i < 100 && !app; i++) {
    app = page.frames().find((frame) => frame.url().startsWith(
      desktop ? 'openrelay://reader' : 'chrome-extension://'));
    if (!app) await page.waitForTimeout(100);
  }
  const card = app.locator('.post', { hasText: 'Video htmlgif' });
  await card.getByText('GIF', { exact: true }).first().waitFor();
  const feedGif = await open('htmlgif');
  await play(feedGif);
  assert.equal(await feedGif.evaluate((v) => v.muted && v.loop && !v.controls), true);
  assert.equal(await feedGif.getAttribute('src'), htmlGifSource, 'HTML GIF uses its direct MP4');
  await close();
  await card.getByRole('button', { name: '0 comments', exact: true }).click();
  const detail = app.locator('.screen.is-detail');
  await detail.getByText('GIF', { exact: true }).waitFor();
  await detail.getByRole('button', { name: /^Open (image|media)$/ }).click();
  await app.locator('.viewer img').waitFor();
  await app.waitForFunction(() => document.querySelector('.viewer img')?.naturalWidth > 0);
  await close();
  assert.deepEqual(errors, []);
  console.log(`PASS (${desktop ? 'desktop' : 'extension'}): separate HLS audio decodes a non-silent signal; CDN playback with signed URLs, HLS-only videos and GIFs, seeking, cleanup/reopening, broken playlists/audio fallback, silent videos, HTML GIF previews and JSON GIFs in both panes, and playback errors.`);
} finally {
  if (electronApp) await electronApp.close();
  else await context.close();
}
