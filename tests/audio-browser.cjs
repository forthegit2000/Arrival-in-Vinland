const { startDefaultCampaign } = require('./browser-session.cjs');
/** Verify actual MP3 decoding and user-controlled playback directly from file://. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    assert.equal(await page.evaluate(() => Vinland.app.audio), null);
    await page.locator('#manage-button').click();
    await page.locator('#modal-content [data-action="campaign"]').click();
    await page.locator('[data-setting="sound"]').check();
    await page.waitForFunction(() => {
      const player = Vinland.app.audio;
      return (
        player?.enabled &&
        player.tracks.size === 9 &&
        [...player.tracks.values()].every(
          ({ element, starting }) => !starting && element.readyState >= 2,
        )
      );
    });
    const recordings = await page.evaluate(() =>
      [...Vinland.app.audio.tracks].map(([key, { element }]) => ({
        key,
        duration: element.duration,
        error: element.error?.code,
        local: element.currentSrc.startsWith('file:'),
      })),
    );
    for (const recording of recordings) {
      assert.ok(recording.local && !recording.error, recording.key);
      assert.ok(recording.duration >= 27 && recording.duration <= 73, recording.key);
    }
    const volume = page.locator('[data-setting="soundVolume"]');
    await volume.focus();
    await volume.press('Home');
    for (let step = 0; step < 35; step++) {
      await volume.press('ArrowRight');
    }
    assert.equal(await page.locator('#sound-volume-output').innerText(), '35%');
    assert.equal(await page.evaluate(() => Vinland.app.audio.volume), 0.35);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      Vinland.setPaused(true);
      Vinland.simulation.state.time = 12;
      const weather = { ...Vinland.simulation.weather, rain: true, snow: false, gale: false };
      Object.defineProperty(Vinland.simulation, 'weather', {
        configurable: true,
        get: () => weather,
      });
    });
    await page.waitForFunction(() => {
      const rain = Vinland.app.audio.tracks.get('rain').element;
      return !rain.paused && rain.currentTime > 0.2 && rain.volume > 0.02;
    });
    await page.evaluate(() => {
      const rain = Vinland.app.audio.tracks.get('rain').element;
      rain.currentTime = rain.duration - 0.2;
    });
    await page.waitForFunction(() => {
      const rain = Vinland.app.audio.tracks.get('rain').element;
      return rain.currentTime > 0.1 && rain.currentTime < 3 && !rain.paused && !rain.ended;
    });
    await page.evaluate(() => {
      const sim = Vinland.simulation;
      const weather = { ...sim.weather, rain: true, snow: true, gale: true, temp: -3 };
      Object.defineProperty(sim, 'weather', { configurable: true, get: () => weather });
    });
    await page.waitForFunction(() => {
      const player = Vinland.app.audio;
      const snow = player.tracks.get('winter-snow').element;
      return (
        player.lastMix.rain === 0 &&
        player.lastMix.daylight === 0 &&
        !snow.paused &&
        snow.currentTime > 0.2 &&
        snow.volume > 0.02
      );
    });
    await page.locator('#manage-button').click();
    await page.locator('#modal-content [data-action="campaign"]').click();
    await page.locator('[data-setting="sound"]').uncheck();
    await page.waitForFunction(() =>
      [...Vinland.app.audio.tracks.values()].every(
        ({ element }) => element.paused && element.volume === 0,
      ),
    );
    await page.reload();
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    assert.equal(await page.evaluate(() => Vinland.app.settings.soundVolume), 0.35);
    assert.equal(await page.evaluate(() => Vinland.app.audio), null);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    console.log(
      'Offline ambience passed: nine local MP3s, explicit enable, rain/snow transitions, volume, mute and persistence.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
