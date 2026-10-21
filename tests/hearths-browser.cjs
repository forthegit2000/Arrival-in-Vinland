const { startDefaultCampaign } = require('./browser-session.cjs');
/** Offline controls, real Hall geometry, lighting and cooking. */
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
    await page.evaluate(() => {
      Vinland.view('walk');
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        world = Vinland.world;
      window.standAt = (point) => {
        Object.assign(sim.state.leader, point);
        Object.assign(sim.state.people[0], point);
        world.agentPositions.set(0, { ...point });
        world.previousWalkPose = world.currentWalkPose = null;
        world.actorCollisions.set('person:0', { ...point, radius: 0.34 });
        world.update(0.1);
      };
      VinlandStorage.deposit(sim.state, 'camp', 'firewood', 100, 0.2);
      world.update(0);
      const pile = VinlandStorage.resourcePiles(sim.state, sim.state.storage.stores.camp).find(
        (p) => p.resource === 'firewood',
      );
      const candidates = [
        { x: pile.x, z: pile.z + pile.d / 2 + 0.6 },
        { x: pile.x, z: pile.z - pile.d / 2 - 0.6 },
        { x: pile.x + pile.w / 2 + 0.6, z: pile.z },
        { x: pile.x - pile.w / 2 - 0.6, z: pile.z },
      ];
      const point = candidates.find(
        (p) => world.actorClearAt(p.x, p.z, 0.34, 'person:0') && world.canReachSupply(p, pile),
      );
      if (!point) throw Error('No firewood approach');
      standAt(point);
    });
    await page.waitForFunction(() => !document.querySelector('#supply-button').hidden);
    await page.keyboard.press('g');
    assert.equal(await page.evaluate(() => Vinland.simulation.state.people[0].cargo?.amount), 15);
    const roomChecks = await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world;
      return VinlandHearths.definitions(sim.state).map((def) => {
        const point = VinlandBuildingSpaces.toWorld(def.room, {
          x: def.id === 'hall:IV' ? 0.1 : 1,
          z: def.id === 'hall:IV' ? 1 : 0,
        });
        standAt(point);
        return {
          id: def.id,
          near: VinlandHearths.nearest(sim, sim.state.people[0])?.id,
          clear: world.actorClearAt(point.x, point.z, 0.34, 'person:0'),
        };
      });
    });
    assert.equal(roomChecks.length, 4);
    for (const room of roomChecks) {
      assert.equal(room.near, room.id, JSON.stringify(room));
      assert.equal(room.clear, true, JSON.stringify(room));
    }
    await page.evaluate(() => {
      const def = VinlandHearths.definitions(Vinland.simulation.state).find(
        (def) => def.id === 'hall:II',
      );
      standAt(VinlandBuildingSpaces.toWorld(def.room, { x: 1, z: 0 }));
      Vinland.simulation.state.time = 12;
      for (const [key, amount] of Object.entries({
        water: 4,
        grain: 0.5,
        freshFish: 0.5,
        plants: 0.25,
      }))
        VinlandStorage.deposit(Vinland.simulation.state, def.storeId, key, amount);
    });
    await page.waitForFunction(() => !document.querySelector('#hearth-button').hidden);
    await page.keyboard.press('f');
    const panel = page.locator('#hearth-panel');
    assert.equal(await panel.isVisible(), true);
    await panel.locator('[data-hearth="large"]').click();
    await panel.locator('[data-hearth="light"]').click();
    // The same hand load supplies another 2 kg without an inventory teleport.
    await panel.locator('[data-hearth="large"]').click();
    await panel.locator('[data-hearth="cook"]').click();
    await page.evaluate(() => {
      Vinland.simulation.advance(25 / 60);
      Vinland.world.update(0.1);
    });
    const burning = await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world,
        room = world.usableSpaces().find((space) => space.spaceId === 'hall:II');
      const fire = sim.state.hearths.fires['hall:II'];
      return {
        unrepaired: !sim.state.hallReady,
        power: fire.powerKW,
        cooked: VinlandHearths.ready(fire.pot),
        temperature: VinlandHearths.potTemperature(fire.pot),
        light: world.indoorPresentation.fireLight.intensity,
        potVisible: world.indoorPresentation.hearth(room).userData.pot.visible,
        saved: !!VinlandModel.Simulation.load(sim.serialize()),
      };
    });
    assert.equal(burning.unrepaired, true);
    assert.ok(burning.power > 1 && burning.light > 0);
    assert.equal(burning.cooked, true);
    assert.ok(burning.temperature <= 100.0001);
    assert.equal(burning.potVisible, true);
    assert.equal(burning.saved, true);
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/vinland-hearth-cooking.png' });
    await panel.locator('[data-hearth="lift"]').click();
    await page.evaluate(() => Vinland.simulation.advance(25 / 60));
    await page.waitForFunction(() => !document.querySelector('[data-hearth="serve"]').disabled);
    await panel.locator('[data-hearth="serve"]').click();
    assert.ok(await page.evaluate(() => Vinland.simulation.state.people[0].mealCalories > 0));
    await panel.locator('[data-hearth="bank"]').click();
    await page.evaluate(() => {
      Vinland.simulation.advance(1 / 3600);
      Vinland.world.update(0.1);
    });
    assert.equal(
      await page.evaluate(() => Vinland.simulation.state.hearths.fires['hall:II'].flameKW),
      0,
    );
    if (process.env.VINLAND_MANUAL_SUPPLIES_ONLY) {
      assert.deepEqual(network, []);
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({ roomChecks, burning, manualFirewood: true, offline: true }, null, 2),
      );
      return;
    }
    await page.evaluate(() => Vinland.app.workerControls.select([1]));
    await page.waitForFunction(() => !document.querySelector('[data-hearth="supply"]').disabled);
    await panel.locator('[data-hearth="supply"]').click();
    const delivery = await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world,
        person = sim.state.people[1];
      const store = sim.state.storage.stores['hearth:hall:II'];
      if (person.order?.destinationStoreId !== store.id)
        throw Error('Wrong hearth supply destination');
      const source = world.storagePoint('camp', person, 'firewood');
      if (!source) throw Error('No camp source point');
      Object.assign(person, { x: source.x, z: source.z });
      world.agentPositions.set(person.id, { x: person.x, z: person.z });
      world.actorCollisions.set('person:' + person.id, { x: person.x, z: person.z, radius: 0.34 });
      world.paused = false;
      for (let step = 0; step < 1800 && !store.stock.firewood; step++)
        sim.advanceRealtime(0.1, world);
      world.paused = true;
      const delivered = store.stock.firewood || 0;
      if (!delivered) throw Error('Hall hearth delivery failed: ' + JSON.stringify(person));
      if (
        !VinlandBuildingSpaces.contains(
          VinlandHearths.definitions(sim.state).find((def) => def.id === 'hall:II').room,
          person,
        )
      )
        throw Error('Hearth stock credited outside the room');
      sim.commandWorkers([1], { type: 'stop' });
      return delivered;
    });
    assert.ok(delivery > 0);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1024, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      const bounds = await panel.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height);
      assert.equal(
        await panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
        true,
      );
    }
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false);
    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ roomChecks, burning, offline: true, responsive: true }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
