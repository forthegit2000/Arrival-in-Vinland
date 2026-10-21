/** Contextual guidance appears once; general instructions live in Help. */
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
    const strip = page.locator('#contextual-hints');
    const hint = page.locator('#controls-hint');
    assert.equal(await strip.count(), 1);
    assert.equal(await strip.isVisible(), false);
    assert.equal(
      await page
        .locator('#mode-status, .palette-title, .walk-movement-hint, .expedition-panel h1')
        .count(),
      0,
    );
    assert.equal(
      await page.locator('#settlement-name').innerText(),
      await page.evaluate(() => Vinland.simulation.homeName),
    );
    assert.equal(await page.locator('#pause-indicator span').count(), 0);

    await page.evaluate(() => Vinland.app.workerControls.select([1]));
    assert.match(await hint.innerText(), /Right-click/);
    assert.doesNotMatch(
      await page.locator('#worker-orders').innerText(),
      /Shift adds|Workday:|Click a person/,
    );
    await page.locator('[data-worker-action="move"]').click();
    assert.match(await hint.innerText(), /Click ground to move/);
    assert.doesNotMatch(await page.locator('#worker-order-status').innerText(), /Click ground/);
    await page.locator('[data-worker-action="work-menu"]').click();
    await page.locator('[data-worker-action="haul"]').click();
    assert.match(await hint.innerText(), /store or workplace/);
    await page.locator('[data-worker-action="build"]').click();
    assert.equal(await hint.innerText(), 'Choose a building');

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
        await page.evaluate(() => Vinland.startPlacement('turfhouse'));
        const world = await page.locator('#world').boundingBox();
        await page.mouse.move(world.x + world.width * 0.7, world.y + world.height * 0.3);
        assert.equal(await strip.isVisible(), true);
        assert.equal(await hint.isVisible(), false);
        assert.equal(await page.locator('#walk-hint').isVisible(), false);
        assert.equal(await strip.locator('#placement-banner').isVisible(), true);
        const bounds = await strip.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
        assert.ok(
          await strip.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        );
        for (const id of ['rotate', 'rotate-left', 'cancel-place'])
          assert.equal(await page.locator('#' + id).isVisible(), true);
        await page.locator('#cancel-place').click();
        assert.equal(await page.evaluate(() => Vinland.world.placing), null);
        await page.evaluate(() => Vinland.app.workerControls.action('back'));
        await page.locator('[data-worker-action="move"]').click();
        assert.match(await hint.innerText(), /Click ground/);
        assert.ok(
          await hint.evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 15),
        );
      }
    }
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--text-scale', 1);
      Vinland.app.workerControls.select([]);
    });
    assert.equal(await strip.isVisible(), false);
    await page.locator('#manage-button').click();
    await page.locator('#modal-content [data-action="help"]').click();
    const help = await page.locator('#modal-content').innerText();
    for (const text of [
      'Shift adds',
      '08:00 to 18:00',
      'Middle/right-drag',
      'arrow keys look',
      '15 kg',
      'Activity groups Construction',
    ])
      assert.ok(help.includes(text), text);
    await page.keyboard.press('Escape');

    // Put Karlsefni beside one worker on a clear path, away from the camp crowd.
    await page.evaluate(() => {
      Vinland.view('walk');
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        world = Vinland.world;
      let origin;
      for (let x = 60; x <= 110 && !origin; x += 4)
        for (let z = 40; z <= 90 && !origin; z += 4)
          if (world.segmentClear({ x, z }, { x: x + 14, z }, 0.6)) origin = { x, z };
      if (!origin) throw Error('No clear conversation route');
      for (const [id, point] of [
        [0, origin],
        [1, { x: origin.x + 1.5, z: origin.z }],
      ]) {
        Object.assign(sim.state.people[id], point);
        world.agentPositions.set(id, { ...point });
        world.people[id].position.set(
          point.x,
          VinlandModel.elevation(point.x, point.z, sim.state.config),
          point.z,
        );
        world.actorCollisions.set('person:' + id, { ...point, radius: 0.34 });
      }
      Object.assign(sim.state.leader, origin);
      world.relocateActors = false;
      world.previousWalkPose = world.currentWalkPose = null;
      if (world.nearby()?.id !== 1) throw Error('Companion is not nearest');
    });
    await page.waitForFunction(
      () =>
        document.querySelector('#interact-button').textContent === 'E · Speak' &&
        !document.querySelector('#contextual-hints').hidden,
    );
    assert.equal(await strip.locator('#interact-button').isVisible(), true);
    assert.equal(await hint.isVisible(), false);
    await page.keyboard.press('e');
    assert.equal(await page.locator('#walk-conversation').isVisible(), true);
    assert.equal(await strip.isVisible(), false);
    await page.keyboard.press('0');
    assert.equal(await page.locator('#walk-conversation').isVisible(), false);
    await page.waitForFunction(() => !document.querySelector('#contextual-hints').hidden);

    const saved = await page.evaluate(() => Vinland.simulation.serialize());
    await page.evaluate((saved) => {
      Vinland.replaceSimulation(VinlandModel.Simulation.load(saved));
      Vinland.setPaused(true);
    }, saved);
    assert.equal(await page.locator('#mode-status').count(), 0);
    await page.evaluate(() => Vinland.view('atlantic'));
    assert.equal(await strip.isVisible(), false);
    await page.locator('[data-atlantic="district"]').click();
    assert.equal(await strip.isVisible(), false);
    await page.screenshot({ path: '/tmp/vinland-contextual-hints-idle.png' });

    // New arrivals have their own targeting actions; they use the same strip.
    await page.reload();
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page, { arrival: true });
    await page.evaluate(() => {
      Vinland.view('district');
      Vinland.setPaused(true);
      Vinland.app.workerControls.select([1, 2]);
    });
    await page.locator('[data-worker-action="arrival-landing"]').click();
    assert.match(await hint.innerText(), /clear beach/);
    assert.doesNotMatch(
      await page.locator('#worker-order-status').innerText(),
      /Click a clear beach/,
    );
    // A landed tent exposes the placement action; cargo transport is covered separately.
    await page.evaluate(() => {
      Vinland.simulation.state.arrival.tents[0].status = 'landed';
      Vinland.app.workerControls.render();
    });
    await page.locator('[data-worker-action="arrival-pitch"]').click();
    assert.match(await hint.innerText(), /pitch a packed tent/);
    assert.doesNotMatch(
      (await page.locator('#toast.visible').allTextContents()).join(' '),
      /Choose (a clear beach|clear ground)/,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.style.setProperty('--text-scale', 1.3));
    assert.ok(await strip.evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
    await page.screenshot({ path: '/tmp/vinland-contextual-hints-arrival-mobile.png' });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      'Single contextual strip, worker/arrival targeting, placement, walking conversation, Help, save/load, responsive text and offline loading passed.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
