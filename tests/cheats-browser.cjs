const { startDefaultCampaign } = require('./browser-session.cjs');
/** Exercise testing tools through the actual offline game controls. */
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
    const errors = [],
      network = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route(/^https?:/, (route) => {
      network.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const panel = page.locator('#cheat-panel');
    assert.equal(await page.locator('#cheat-indicator').isVisible(), false);
    await page.locator('#manage-button').click();
    await page.locator('[data-action="cheats"]').click();
    assert.equal(await panel.isVisible(), true);
    assert.equal(await panel.locator('[data-cheat="spawn"]').isEnabled(), false);
    assert.equal(await panel.locator('#cheat-weather').isEnabled(), false);
    await panel.locator('#cheats-enabled').check();
    await page.waitForFunction(() => !document.querySelector('#cheat-indicator').hidden);
    assert.equal(await panel.locator('#cheats-instant').isChecked(), true);
    for (const [preset, name] of [
      ['rain', 'COASTAL RAIN'],
      ['snow', 'SNOW'],
      ['gale', 'ATLANTIC GALE'],
      ['fair', 'FAIR WINDS'],
    ]) {
      await panel.locator('#cheat-weather').selectOption(preset);
      assert.equal(await page.evaluate(() => Vinland.simulation.weather.name), name);
    }
    await panel.locator('#cheat-weather').selectOption('natural');
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.locator('[data-worker-action="build"]').isEnabled(), true);
    await page.locator('[data-worker-action="build"]').click();
    assert.equal(await page.locator('#construction-palette').isVisible(), true);
    await page.locator('[data-build="turfhouse"]').click();
    const placement = await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world;
      Vinland.setPaused(true);
      for (const key of VinlandStorage.MATERIALS) sim.state.resources[key] = 0;
      for (let x = 30; x <= 80; x += 2)
        for (let z = 30; z <= 80; z += 2) {
          if (!sim.canPlace('turfhouse', x, z)) continue;
          world.focus(x, z, 65);
          world.distance = 65;
          world.updateProjection();
          world.updateCamera(1);
          const pixel = world.project(x, world.actorElevation(x, z), z);
          const bounds = world.container.getBoundingClientRect();
          return {
            x,
            z,
            clientX: bounds.left + pixel.x,
            clientY: bounds.top + pixel.y,
            time: sim.state.time,
          };
        }
      throw Error('No clear building site');
    });
    await page.mouse.move(placement.clientX, placement.clientY);
    await page.mouse.click(placement.clientX, placement.clientY);
    await page.waitForFunction(() => Vinland.simulation.state.buildings.length === 1);
    const built = await page.evaluate(() => {
      const sim = Vinland.simulation,
        building = sim.state.buildings[0],
        object = Vinland.world.objects.get(building.id);
      return {
        id: building.id,
        queue: sim.state.queue.length,
        timber: sim.state.resources.timber,
        progress: building.progress,
        hours: building.hours,
        time: sim.state.time,
        selectable: object?.userData.select === 'building',
        workers: sim.assigned,
      };
    });
    assert.equal(built.queue, 0);
    assert.equal(built.timber, 0);
    assert.equal(built.progress, built.hours);
    assert.equal(built.workers, 0);
    assert.equal(built.time, placement.time);
    assert.equal(built.selectable, true);
    await page.evaluate(() => {
      Vinland.simulation.state.buildings[0].condition = 20;
      Vinland.ui.building(Vinland.simulation.state.buildings[0].id);
    });
    await page.locator('[data-action="repair-building"]').click();
    assert.equal(await page.evaluate(() => Vinland.simulation.state.buildings[0].condition), 100);
    await page.evaluate(() => {
      Vinland.view('walk');
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        world = Vinland.world;
      const point = world.findActorPosition({ x: 45, z: 25 }, 0.34, 'person:0');
      Object.assign(sim.state.leader, point);
      Object.assign(sim.state.people[0], point);
      world.agentPositions.set(0, { ...point });
      world.previousWalkPose = world.currentWalkPose = null;
      world.walkYaw = 0;
      world.actorCollisions.set('person:0', { ...point, radius: 0.34 });
      world.update(0.1);
    });
    await page.keyboard.press('F10');
    await panel.locator('#cheat-amount').fill('25');
    await panel.locator('[data-cheat="spawn"]').click();
    await page.waitForFunction(() =>
      [...Vinland.app.cheatControls.meshes.values()].some((mesh) => mesh.visible),
    );
    const pile = await page.evaluate(() => {
      const sim = Vinland.simulation,
        store = Object.values(sim.state.storage.stores).find((store) => store.cheatPile);
      const leader = sim.state.leader;
      return {
        id: store.id,
        x: store.x,
        z: store.z,
        amount: store.stock.firewood,
        distance: Math.hypot(store.x - leader.x, store.z - leader.z),
        ahead: store.z > leader.z,
      };
    });
    assert.equal(pile.amount, 25);
    assert.ok(pile.distance < 3 && pile.distance > 1);
    assert.equal(pile.ahead, true);
    await panel.locator('[data-cheat="repair"]').click();
    assert.equal(await page.evaluate(() => Vinland.simulation.state.hallReady), true);
    await panel.locator('#cheats-protect').check();
    await panel.locator('[data-cheat="noon"]').click();
    assert.equal(await page.evaluate(() => Vinland.simulation.hour), 12);
    // Resource units and wood quality remain explicit when switching materials.
    await panel.locator('#cheat-resource').selectOption('timber');
    assert.equal(await page.locator('#cheat-unit').innerText(), 'm³');
    await panel.locator('#cheat-resource').selectOption('water');
    assert.equal(await page.locator('#cheat-unit').innerText(), 'L');
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1024, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      const bounds = await panel.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
      assert.ok(bounds.y + bounds.height <= viewport.height);
      assert.equal(
        await panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
        true,
      );
    }
    await page.screenshot({ path: '/tmp/vinland-cheat-mode.png' });
    await page.evaluate(() => {
      const loaded = VinlandModel.Simulation.load(Vinland.simulation.serialize());
      if (!loaded) throw Error('Cheat save failed to load');
      Vinland.replaceSimulation(loaded);
    });
    await page.waitForFunction(
      () =>
        Vinland.app.cheatControls.world === Vinland.world &&
        Vinland.app.cheatControls.meshes.size > 0,
    );
    assert.equal(await panel.locator('#cheats-enabled').isChecked(), true);
    await panel.locator('#cheats-enabled').uncheck();
    await page.waitForFunction(() =>
      document.querySelector('#cheat-indicator').textContent.includes('CHEAT SAVE'),
    );
    await page.keyboard.press('Escape');
    const disabled = await page.evaluate(() => {
      const sim = Vinland.simulation;
      const store = Object.values(sim.state.storage.stores).find((store) => store.cheatPile);
      return {
        enabled: VinlandCheats.settings(sim.state).enabled,
        used: sim.state.cheats.used,
        pileKept: store.stock.firewood === 25,
        blocked: !!sim.blockedReason('longhouse'),
      };
    });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.used, true);
    assert.equal(disabled.pileKept, true);
    assert.equal(disabled.blocked, true);
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      JSON.stringify({ built, pile, disabled, offline: true, responsive: true }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
