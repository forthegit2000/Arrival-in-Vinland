/** Warm material theme: contrast, document scoping and usable offline controls. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startDefaultCampaign } = require('./browser-session.cjs');

function contrast(first, second) {
  function luminance(hex) {
    const rgb = hex
      .replace('#', '')
      .match(/../g)
      .slice(0, 3)
      .map((value) => {
        const channel = parseInt(value, 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

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
    await page.screenshot({ path: '/tmp/vinland-warm-title.png' });
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          'ink',
          'muted',
          'window-bg',
          'button-text',
          'button-bg-top',
          'button-selected-top',
          'paper-ink',
          'paper-muted',
          'paper',
          'paper-edge',
          'paper-link',
          'paper-warning',
        ].map((key) => [key, style.getPropertyValue('--' + key).trim()]),
      );
    });
    const ratios = {};
    for (const [foreground, background] of [
      ['ink', 'window-bg'],
      ['muted', 'window-bg'],
      ['button-text', 'button-bg-top'],
      ['button-text', 'button-selected-top'],
      ['paper-ink', 'paper'],
      ['paper-muted', 'paper'],
      ['paper-link', 'paper'],
      ['paper-warning', 'paper'],
      ['paper-ink', 'paper-edge'],
    ]) {
      const label = `${foreground} / ${background}`;
      ratios[label] = contrast(colors[foreground], colors[background]);
      assert.ok(ratios[label] >= 4.5, `${label}: ${ratios[label].toFixed(2)} must be >= 4.5`);
    }
    await startDefaultCampaign(page);
    const modal = page.locator('#modal');
    const content = page.locator('#modal-content');
    const tabs = page.locator('.window-tabs');
    await page.screenshot({ path: '/tmp/vinland-warm-hud.png' });
    await page.locator('.command-strip [data-action="settlement"]').click();
    assert.equal(
      await modal.evaluate((element) => element.classList.contains('document-window')),
      false,
    );
    await page.screenshot({ path: '/tmp/vinland-warm-people.png' });
    await page.keyboard.press('Escape');
    await page.evaluate(() => Vinland.app.workerControls.select([1, 2]));
    await page.locator('[data-worker-action="build"]').click();
    await page.screenshot({ path: '/tmp/vinland-warm-build.png' });
    await page.locator('.command-strip [data-action="activity"]').click();
    await tabs.locator('[data-action="reports"]').click();
    assert.equal(
      await modal.evaluate((element) => element.classList.contains('document-window')),
      true,
    );
    assert.equal(
      await content.evaluate((element) => getComputedStyle(element).color),
      'rgb(53, 41, 26)',
    );
    await page.screenshot({ path: '/tmp/vinland-warm-reports.png' });
    await tabs.locator('[data-action="works"]').click();
    assert.equal(
      await modal.evaluate((element) => element.classList.contains('document-window')),
      false,
    );
    await tabs.locator('[data-action="journal"]').click();
    assert.equal(
      await modal.evaluate((element) => element.classList.contains('document-window')),
      true,
    );
    await tabs.locator('[data-action="chronicle"]').click();
    assert.equal(
      await modal.evaluate((element) => element.classList.contains('document-window')),
      true,
    );
    await page.keyboard.press('Escape');
    await page.locator('#manage-button').click();
    await page.locator('#modal-content [data-action="help"]').click();
    assert.equal(
      await modal.evaluate((element) => element.classList.contains('document-window')),
      true,
    );
    await page.screenshot({ path: '/tmp/vinland-warm-help.png' });
    assert.ok(
      await page
        .locator('.help-list')
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 16),
    );
    await page.keyboard.press('Escape');

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
        for (const action of ['settlement', 'activity']) {
          await page.locator(`.command-strip [data-action="${action}"]`).click();
          if (action === 'activity') await tabs.locator('[data-action="reports"]').click();
          const bounds = await modal.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
          assert.ok(
            await content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          );
          const close = page.locator('#close-modal');
          await page.keyboard.press('Tab');
          await close.focus();
          assert.ok(
            await close.evaluate(
              (element) => parseFloat(getComputedStyle(element).outlineWidth) >= 2,
            ),
          );
          if (viewport.width === 390 && scale === 1.3 && action === 'activity')
            await page.screenshot({ path: '/tmp/vinland-warm-mobile.png' });
          await close.click();
        }
        for (const button of await page.locator('[data-build]').all()) {
          assert.ok(
            await button.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
          );
        }
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      JSON.stringify({
        contrast: ratios,
        documentScoping: true,
        controls: true,
        responsive: true,
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
