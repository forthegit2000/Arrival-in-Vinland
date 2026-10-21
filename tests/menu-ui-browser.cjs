/** Menu framing, save cards, keyboard focus and responsive game dialogs. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startDefaultCampaign } = require('./browser-session.cjs');
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
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    const modal = page.locator('#modal');
    await page.locator('#title-screen [data-action="load-game"]').click();
    assert.equal(await modal.evaluate((element) => element.matches(':modal')), true);
    assert.equal(await page.locator('.window-tabs').isVisible(), false);
    assert.equal(await page.locator('.window-pause').isVisible(), false);
    assert.equal(await page.locator('.empty-saves').isVisible(), true);
    await page.locator('#modal [data-action="menu-back"]').click();
    assert.equal(
      await page
        .locator('#title-screen [data-action="load-game"]')
        .evaluate((button) => button === document.activeElement),
      true,
    );
    await page.evaluate(() => {
      const sim = new VinlandModel.Simulation();
      sim.state.time = 108;
      localStorage.setItem('vinland-campaign-v3', sim.serialize());
      sim.state.time = 110.5;
      localStorage.setItem('vinland-autosave-v3', sim.serialize());
      const old = new VinlandModel.Simulation(VinlandContent.PRESETS.traders);
      old.state.time = 56;
      localStorage.setItem('vinland-previous-campaign', old.serialize());
    });
    await page.locator('#title-screen [data-action="load-game"]').click();
    assert.equal(await page.locator('.save-card').count(), 3);
    assert.match(await page.locator('.save-card').nth(0).innerText(), /12:00/);
    assert.match(await page.locator('.save-card').nth(1).innerText(), /14:30/);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#modal img')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    let bounds = await modal.boundingBox();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - 756) < 2);
    assert.ok(Math.abs(bounds.y + bounds.height / 2 - 491) < 2);
    assert.ok(bounds.height < 720, 'The dialog should fit its contents.');
    assert.equal(
      await page
        .locator('.save-details')
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 15),
      true,
    );
    await page.screenshot({ path: '/tmp/vinland-load-menu-desktop.png' });
    await page.locator('#import-file').setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from('invalid'),
    });
    await page.waitForFunction(() =>
      document.querySelector('#menu-notice')?.textContent.includes('Invalid campaign save'),
    );
    assert.equal(await page.locator('#menu-notice').isVisible(), true);
    assert.equal(await modal.evaluate((e) => e.matches(':modal')), true);
    await page.keyboard.press('Escape');
    await page.locator('#title-screen [data-action="campaign"]').click();
    assert.equal(await page.locator('#window-title').innerText(), 'Settings');
    await page.locator('[data-setting="textScale"]').selectOption('1.3');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#title-screen [data-action="load-game"]').click();
    const mobile = await modal.evaluate((e) => ({
      x: e.getBoundingClientRect().x,
      right: e.getBoundingClientRect().right,
      overflow:
        document.querySelector('#modal-content').scrollWidth >
        document.querySelector('#modal-content').clientWidth,
    }));
    assert.ok(mobile.x >= 0 && mobile.right <= 390);
    assert.equal(mobile.overflow, false);
    await page.screenshot({ path: '/tmp/vinland-load-menu-mobile.png' });
    for (const height of [844, 568]) {
      await page.setViewportSize({ width: 390, height });
      const previousSave = page.locator('#modal [data-action="load-slot"][data-slot="previous"]');
      await previousSave.scrollIntoViewIfNeeded();
      const buttonBounds = await previousSave.boundingBox();
      const footerBounds = await page.locator('#window-footer').boundingBox();
      assert.ok(
        buttonBounds.y + buttonBounds.height <= footerBounds.y + 1,
        'Footer must not obscure a scrolled save button.',
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#modal-content [data-action="load-slot"][data-slot="current"]').click();
    assert.equal(await page.evaluate(() => Vinland.simulation.state.time), 108);
    assert.equal(await page.evaluate(() => Vinland.app.atTitleScreen), false);
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.locator('#manage-button').click();
    await page.locator('#modal-content [data-action="load-game"]').click();
    assert.equal(await page.locator('.window-tabs').isVisible(), false);
    await page.locator('#modal [data-action="menu-back"]').click();
    assert.equal(await page.locator('#window-title').innerText(), 'Game menu');
    await page.locator('#modal-content [data-action="campaign"]').click();
    assert.equal(await page.locator('#window-title').innerText(), 'Settings');
    assert.equal(await page.locator('#modal-content [data-action="save"]').count(), 0);
    const download = page.waitForEvent('download');
    await page.locator('#modal [data-action="export"]').click();
    assert.match((await download).suggestedFilename(), /^vinland-campaign-/);
    await page.keyboard.press('Escape');
    await page.evaluate(() => Vinland.ui.people());
    assert.equal(await page.locator('.window-tabs').isVisible(), true);
    assert.equal(await modal.evaluate((e) => e.matches(':modal')), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#terrain-attribution').count(), 0);
    await page.locator('#manage-button').click();
    await page.locator('#modal-content [data-action="help"]').click();
    assert.equal(await page.locator('#window-title').innerText(), 'Controls & historical notes');
    assert.equal(
      await page.locator('#modal-content h3', { hasText: 'Sources & licences' }).count(),
      1,
    );
    const osm = page.locator('#modal-content a[href="https://www.openstreetmap.org/copyright"]');
    assert.match(await osm.innerText(), /© OpenStreetMap contributors/);
    const odbl = page.locator(
      '#modal-content a[href="https://opendatacommons.org/licenses/odbl/1-0/"]',
    );
    assert.equal(await odbl.innerText(), 'ODbL 1.0');
    const canada = page.locator(
      '#modal-content a[href="https://open.canada.ca/en/open-government-licence-canada"]',
    );
    assert.equal(await canada.innerText(), 'Open Government Licence – Canada');
    assert.match(await canada.locator('..').innerText(), /Natural Resources Canada/);
    for (const viewport of [
      { width: 1512, height: 982 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const link of [osm, odbl, canada]) {
        await link.scrollIntoViewIfNeeded();
        assert.equal(await link.isVisible(), true);
        assert.equal(
          await link.evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 15),
          true,
        );
      }
      assert.equal(
        await page
          .locator('#modal-content')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
        true,
        'Help credits must fit without horizontal scrolling.',
      );
      const helpBounds = await modal.boundingBox();
      assert.ok(helpBounds.x >= 0 && helpBounds.x + helpBounds.width <= viewport.width);
      await page.screenshot({ path: `/tmp/vinland-help-credits-${viewport.width}.png` });
    }
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      JSON.stringify({
        saveCards: 3,
        explicitLoad: true,
        modalFocus: true,
        readableText: true,
        mobile: true,
        export: true,
        contextualTabs: true,
        helpCredits: true,
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
