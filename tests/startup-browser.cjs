/** Start-screen gating and explicit loading of separate manual/recovery saves. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startDefaultCampaign, loadSavedCampaign } = require('./browser-session.cjs');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
    const errors = [],
      requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    async function ready() {
      await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
      assert.equal(await page.locator('#title-screen').isVisible(), true);
      assert.equal(await page.locator('#loading').isVisible(), false);
      assert.equal(await page.locator('#game').evaluate((game) => game.inert), true);
      assert.equal(await page.evaluate(() => Vinland.paused), true);
      assert.equal(await page.locator('#title-screen [data-action="continue-game"]').count(), 0);
    }
    await ready();
    assert.deepEqual(await page.locator('#title-screen .menu-action span').allTextContents(), [
      'New Game',
      'Load Game',
      'Settings',
      'Help',
    ]);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Space');
    await page.keyboard.press('F10');
    await page.keyboard.press('w');
    assert.equal(await page.evaluate(() => Vinland.app.hasStartedCampaign), false);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    assert.equal(await page.evaluate(() => localStorage.getItem('vinland-autosave-v3')), null);
    await page.locator('#title-screen [data-action="load-game"]').click();
    assert.match(await page.locator('#modal-content').innerText(), /No saved games/);
    await page.keyboard.press('Escape');
    for (const action of ['campaign', 'help']) {
      await page.locator('#title-screen [data-action="' + action + '"]').click();
      assert.equal(await page.locator('.window-tabs').isVisible(), false);
      if (action === 'campaign') {
        assert.equal(await page.locator('#modal-content [data-action="save"]').count(), 0);
        assert.doesNotMatch(await page.locator('#modal-content').innerText(), /Current campaign/);
      }
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#title-screen').isVisible(), true);
    }
    await page.screenshot({ path: '/tmp/vinland-start-screen.png' });
    await startDefaultCampaign(page, { arrival: true });
    assert.equal(
      await page.evaluate(() =>
        Vinland.simulation.state.people.every((p) => p.arrivalShip !== null),
      ),
      true,
    );
    assert.equal(await page.evaluate(() => Vinland.world.tents.some((t) => t.visible)), false);
    assert.equal(
      await page.evaluate(() =>
        Object.values(Vinland.simulation.state.storage.stores.camp.stock).some((n) => n > 0),
      ),
      false,
    );
    assert.equal(await page.evaluate(() => localStorage.getItem('vinland-campaign-v3')), null);
    assert.equal(
      await page.evaluate(() => localStorage.getItem('vinland-previous-campaign')),
      null,
    );
    await page.evaluate(() => {
      Vinland.simulation.state.time = 14;
    });
    await page.locator('#manage-button').click();
    await page.locator('#modal-content [data-action="save"]').click();
    const manual = await page.evaluate(() => localStorage.getItem('vinland-campaign-v3'));
    await page.evaluate(() => {
      Vinland.simulation.state.time = 17;
      Vinland.setPaused(false);
    });
    // Exercise the actual thirty-second timer, independently of exit recovery.
    await page.waitForFunction(() => localStorage.getItem('vinland-autosave-v3') !== null, null, {
      timeout: 40000,
    });
    assert.equal(await page.evaluate(() => localStorage.getItem('vinland-campaign-v3')), manual);
    await page.evaluate(() => {
      Vinland.setPaused(true);
      Vinland.simulation.state.time = 17;
    });
    await page.reload();
    await ready();
    assert.equal(await page.evaluate(() => Vinland.simulation.state.time), 8);
    assert.equal(await page.evaluate(() => localStorage.getItem('vinland-campaign-v3')), manual);
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem('vinland-autosave-v3')).time),
      17,
    );
    await loadSavedCampaign(page);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.time), 14);
    assert.equal(await page.evaluate(() => Vinland.paused), true);
    await page.reload();
    await ready();
    await loadSavedCampaign(page, 'autosave');
    // Closing the loaded manual game creates a recovery of that game, not a new manual save.
    assert.equal(await page.evaluate(() => Vinland.simulation.state.time), 14);
    await page.evaluate(() => {
      Vinland.simulation.state.time = 19;
    });
    await page.locator('#manage-button').click();
    await page.locator('#modal-content [data-action="quit"]').click();
    assert.equal(
      await page.locator('#title-screen [data-action="continue-game"]').isVisible(),
      true,
    );
    assert.equal(await page.evaluate(() => localStorage.getItem('vinland-campaign-v3')), manual);
    await page.locator('#title-screen [data-action="continue-game"]').click();
    assert.equal(await page.evaluate(() => Vinland.app.atTitleScreen), false);
    await page.evaluate(() => Vinland.setPaused(true));
    await page.reload();
    await ready();
    const recovery = await page.evaluate(() => localStorage.getItem('vinland-autosave-v3'));
    await startDefaultCampaign(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('vinland-campaign-v3')), manual);
    assert.equal(await page.evaluate(() => localStorage.getItem('vinland-autosave-v3')), recovery);
    // Loading a portable file is also an explicit way out of the start screen.
    await page.reload();
    await ready();
    await page.locator('#title-screen [data-action="load-game"]').click();
    await page.locator('#import-file').setInputFiles({
      name: 'saved-campaign.json',
      mimeType: 'application/json',
      buffer: Buffer.from(manual),
    });
    await page.waitForFunction(() => !Vinland.app.atTitleScreen);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.time), 14);
    await page.reload();
    await ready();
    await page.evaluate(() => {
      localStorage.setItem('vinland-campaign-v3', 'broken save');
      localStorage.removeItem('vinland-autosave-v3');
      localStorage.removeItem('vinland-previous-campaign');
    });
    await page.locator('#title-screen [data-action="load-game"]').click();
    assert.match(await page.locator('#modal-content').innerText(), /No saved games/);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator('.title-card').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      JSON.stringify({
        startup: 'explicit New/Load',
        manualSavePreserved: true,
        separateRecovery: true,
        import: true,
        invalidSave: true,
        mobile: true,
        offline: true,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
