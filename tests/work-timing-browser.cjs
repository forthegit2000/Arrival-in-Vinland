const { startDefaultCampaign } = require('./browser-session.cjs');
/** Real workplace assignment, batch UI and duty-correct axe animation offline. */
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
    const ids = await page.evaluate(() => {
      Vinland.setPaused(true);
      const sim = Vinland.simulation;
      Object.defineProperty(sim, 'weather', {
        get: () => ({
          temp: 5,
          feels: 5,
          rain: false,
          snow: false,
          gale: false,
          wind: 20,
          factor: 1,
          daylight: 16,
          name: 'FAIR',
        }),
      });
      sim.state.time = 8;
      VinlandCheats.configure(sim, { enabled: true });
      const result = {};
      for (const type of ['charcoal', 'smokehouse']) {
        for (let x = 30; x <= 80 && !result[type]; x += 10)
          for (let z = 30; z <= 80 && !result[type]; z += 10) {
            if (!sim.canPlace(type, x, z)) continue;
            result[type] = sim.order(type, x, z).id;
          }
      }
      VinlandCheats.configure(sim, { enabled: false });
      Vinland.world.sync();
      VinlandStorage.deposit(sim.state, 'building:' + result.charcoal, 'firewood', 200);
      VinlandStorage.deposit(sim.state, 'building:' + result.smokehouse, 'freshFish', 10);
      Vinland.app.workerControls.select([1]);
      Vinland.ui.building(result.charcoal);
      return result;
    });
    await page.locator('[data-action="work-here"]').click();
    const charcoal = await page.evaluate((id) => {
      const sim = Vinland.simulation,
        world = Vinland.world,
        person = sim.state.people[1];
      const storeId = 'building:' + id;
      if (person.order?.workplaceId !== storeId) throw Error('Worker not assigned to actual pit');
      person.skills.craft = 0.34 / 0.55;
      person.fatigue = 0;
      Object.assign(person, { x: person.order.x, z: person.order.z });
      world.agentPositions.set(1, { x: person.x, z: person.z });
      world.actorCollisions.set('person:1', { x: person.x, z: person.z, radius: 0.34 });
      world.paused = false;
      sim.advanceRealtime(1, world);
      const batch = sim.state.processing.batches[storeId];
      if (!batch || batch.phase !== 'preparing') throw Error('No physically prepared batch');
      if (sim.state.storage.stores[storeId].stock.charcoal) throw Error('Instant charcoal');
      VinlandProductionProcesses.work(sim, person, 4.5 * 3600);
      if (batch.phase !== 'processing') throw Error('Preparation did not start burn');
      sim.advance(48);
      if (batch.phase !== 'cooling') throw Error('No cooling period');
      sim.advance(48);
      if (batch.phase !== 'unloading') throw Error('Cooling did not finish');
      if (sim.state.storage.stores[storeId].stock.charcoal) throw Error('Unloaded without workers');
      VinlandProductionProcesses.work(sim, person, 2 * 3600);
      world.paused = true;
      return sim.state.storage.stores[storeId].stock.charcoal;
    }, ids.charcoal);
    assert.ok(Math.abs(charcoal - 40) < 1e-6);
    await page.evaluate((id) => {
      Vinland.app.workerControls.select([2]);
      Vinland.ui.building(id);
    }, ids.smokehouse);
    await page.locator('[data-action="work-here"]').click();
    await page.evaluate((id) => {
      const sim = Vinland.simulation,
        world = Vinland.world,
        person = sim.state.people[2];
      if (person.order?.workplaceId !== 'building:' + id)
        throw Error('No physical drying-house workplace');
      person.skills.herding = 0.34 / 0.55;
      person.fatigue = 0;
      Object.assign(person, { x: person.order.x, z: person.order.z });
      world.agentPositions.set(2, { x: person.x, z: person.z });
      world.actorCollisions.set('person:2', { x: person.x, z: person.z, radius: 0.34 });
      world.paused = false;
      sim.advanceRealtime(1, world);
      VinlandProductionProcesses.work(sim, person, 3600);
      world.paused = true;
      Vinland.ui.building(id);
    }, ids.smokehouse);
    assert.match(
      await page.locator('#modal-content').innerText(),
      /Stockfish drying.*28 fair-weather days/,
    );
    await page.screenshot({ path: '/tmp/vinland-work-batch.png' });
    await page.keyboard.press('Escape');
    const animation = await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world,
        person = sim.state.people[3];
      sim.commandWorkers([3], { type: 'gather', resource: 'timber', x: 50, z: 50 });
      person.order.phase = 'working';
      person.moving = false;
      const tool = world.people[3].children.find((child) => child.name === 'harvest-tool');
      const checks = {};
      world.paused = false;
      for (const [name, hour, activity] of [
        ['felling', 9, 'felling'],
        ['limbing', 9, 'limbing'],
        ['loading', 9, 'loading'],
        ['sharpening', 9, 'sharpening'],
        ['offDuty', 18, 'felling'],
      ]) {
        sim.state.time = Math.floor(sim.state.time / 24) * 24 + hour;
        person.order.activity = activity;
        world.animatePeople(0.1, 1);
        checks[name] = tool.visible;
      }
      world.paused = true;
      if (!VinlandModel.Simulation.load(sim.serialize()))
        throw Error('Timing state failed save/load');
      return checks;
    });
    assert.deepEqual(animation, {
      felling: true,
      limbing: true,
      loading: false,
      sharpening: false,
      offDuty: false,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      JSON.stringify(
        { charcoalKg: charcoal, stockfish: '28 fair-weather days', animation, offline: true },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
