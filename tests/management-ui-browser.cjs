/** Grouped management navigation and the single construction activity list. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startDefaultCampaign } = require('./browser-session.cjs');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
    const errors = [],
      requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const tabs = page.locator('.window-tabs');
    const content = page.locator('#modal-content');
    const modal = page.locator('#modal');
    const strip = page.locator('.command-strip');
    assert.deepEqual(
      await strip
        .locator('[data-action]')
        .evaluateAll((buttons) => buttons.map((button) => button.dataset.action)),
      ['settlement', 'exploration', 'activity'],
    );
    assert.equal(
      await page.locator('#queue, #works-button, #fleet-button, #objectives-button').count(),
      0,
    );

    for (const [group, pages] of [
      [
        'settlement',
        [
          ['people', 'People & households'],
          ['stocks', 'Provisions & fuel'],
          ['council', 'Council & stewardship'],
        ],
      ],
      [
        'exploration',
        [
          ['fleet', 'Fleet & livestock'],
          ['coast', 'Coast & neighbours'],
        ],
      ],
      [
        'activity',
        [
          ['works', 'Construction orders'],
          ['reports', 'Reports & warnings'],
          ['journal', 'Journal'],
          ['chronicle', 'Expedition chronicle'],
        ],
      ],
    ]) {
      await strip.locator(`[data-action="${group}"]`).click();
      assert.equal(await tabs.locator('button').count(), pages.length);
      for (const [action, title] of pages) {
        await tabs.locator(`[data-action="${action}"]`).click();
        assert.equal(await page.locator('#window-title').innerText(), title);
        assert.equal(
          await tabs.locator('[aria-current="page"]').getAttribute('data-action'),
          action,
        );
        assert.equal(await page.evaluate(() => Vinland.paused), true);
        assert.equal(
          await tabs
            .locator('[aria-current="page"]')
            .evaluate((button) => button === document.activeElement),
          true,
          'Tab navigation preserves keyboard focus',
        );
      }
      await page.keyboard.press('Escape');
      assert.equal(await modal.evaluate((element) => element.open), false);
    }

    // Coast still opens the dedicated Atlantic screen rather than a chart popup.
    await strip.locator('[data-action="exploration"]').click();
    await tabs.locator('[data-action="coast"]').click();
    await content.locator('[data-action="atlantic"]').click();
    assert.equal(await page.locator('#atlantic-screen').isVisible(), true);
    assert.equal(await modal.evaluate((element) => element.open), false);
    await page.evaluate(() => Vinland.view('district'));

    // Deterministic in-progress fixture: exercise UI and cancellation, not construction rules.
    await page.evaluate(() => {
      const sim = Vinland.simulation;
      sim.state.queue.push({
        id: 9002,
        type: 'storehouse',
        x: 95,
        z: 60,
        rotation: 0.2,
        hours: 100,
        progress: 25,
        workers: 0,
        cost: {},
        materials: {},
        sailShip: null,
      });
      Vinland.world.sync();
      sim.emit();
    });
    await page.waitForFunction(
      () => document.querySelector('#activity-projects').textContent === '1 project',
    );
    const warningCount = await page.evaluate(() => Vinland.simulation.alerts.length);
    assert.equal(await page.locator('#activity-warnings').isVisible(), warningCount > 0);
    assert.match(
      await page.locator('#activity-button').getAttribute('aria-label'),
      new RegExp(`${warningCount} warnings`),
    );
    await strip.locator('[data-action="activity"]').click();
    const project = page.locator('[data-project="9002"]');
    assert.match(await project.innerText(), /25%/);
    assert.match(await project.innerText(), /75 person-hours\s+left/);
    assert.match(await project.innerText(), /Waiting for crew/);
    assert.equal(await project.locator('[role="progressbar"]').getAttribute('aria-valuenow'), '25');
    await page.screenshot({ path: '/tmp/vinland-management-project.png' });
    await project.locator('[data-action="building"]').click();
    assert.equal(
      await content.locator('[data-action="assign-workers"][data-id="9002"]').count(),
      1,
    );
    await content.locator('[data-action="focus-building"]').click();
    assert.equal(await modal.evaluate((element) => element.open), false);

    // Select the project through the existing world selection callback.
    await page.evaluate(() => Vinland.world.onSelect('building', 9002));
    assert.match(await page.locator('#inspect-details').innerText(), /25%/);
    await page.evaluate(() => {
      Vinland.simulation.state.queue.find((order) => order.id === 9002).progress = 50;
      Vinland.simulation.emit();
    });
    await page.waitForFunction(() =>
      document.querySelector('#inspect-details').textContent.includes('50%'),
    );
    await strip.locator('[data-action="activity"]').click();
    assert.match(await project.innerText(), /50%/);
    await project.locator('[data-action="cancel-project"]').click();
    assert.equal(await modal.evaluate((element) => element.open), true);
    assert.match(await content.innerText(), /No construction orders/);
    await page.waitForFunction(() => document.querySelector('#activity-projects').hidden);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.queue.length), 0);
    await page.keyboard.press('Escape');

    // Every grouped command and tab stays reachable on small screens and large text.
    for (const viewport of [
      { width: 1512, height: 982 },
      { width: 820, height: 720 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const scale of [1, 1.3]) {
        await page.evaluate(
          (scale) => document.documentElement.style.setProperty('--text-scale', scale),
          scale,
        );
        for (const group of ['settlement', 'exploration', 'activity']) {
          await strip.locator(`[data-action="${group}"]`).click();
          for (const tab of await tabs.locator('button').all()) {
            await tab.click();
            assert.equal(
              await tab.evaluate((button) => button.scrollHeight <= button.clientHeight + 1),
              true,
            );
            assert.ok(
              await tab.evaluate((button) => parseFloat(getComputedStyle(button).fontSize) >= 15),
            );
          }
          const bounds = await modal.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
          assert.ok(
            await content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          );
          await page.keyboard.press('Escape');
        }
        if (viewport.width === 390) {
          assert.equal(await page.locator('#mobile-walk').isVisible(), true);
          await page.locator('#mobile-atlantic').click();
          assert.equal(await page.locator('#atlantic-screen').isVisible(), true);
          await page.evaluate(() => Vinland.view('district'));
        }
      }
    }
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.evaluate(() => document.documentElement.style.setProperty('--text-scale', 1));
    await strip.locator('[data-action="activity"]').click();
    await page.screenshot({ path: '/tmp/vinland-management-activity.png' });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      'Grouped navigation, construction progress/cancellation, responsive text, Atlantic access and offline loading passed.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
