const { startDefaultCampaign } = require('./browser-session.cjs');
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
    await startDefaultCampaign(page);
    const initial = await page.evaluate(() => {
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        world = Vinland.world;
      Object.assign(sim.state.resources, { timber: 10000, turf: 10000, stone: 1000, iron: 1000 });
      const order = sim.order('turfhouse', 70, 60, 0.37);
      if (!order) throw Error('No test site');
      sim.state.queue = sim.state.queue.filter((item) => item.id !== order.id);
      sim.state.buildings.push({ ...order, progress: order.hours, condition: 100 });
      world.sync();
      Vinland.view('walk');
      const door = world.doorControls.entries.get('building:' + order.id).door;
      const point = VinlandBuildingSpaces.toWorld(door, { x: 0, z: 1.3 });
      Object.assign(sim.state.leader, point);
      Object.assign(sim.state.people[0], point);
      world.agentPositions.set(0, { ...point });
      world.actorCollisions.set('person:0', { ...point, radius: 0.34 });
      window.testDoorId = door.id;
      const test = { ...point };
      const across = VinlandBuildingSpaces.toWorld(door, { x: 0, z: -1.3 });
      world.moveActor(test, across.x - test.x, across.z - test.z, 0.34, 'person:0');
      return {
        closed: !VinlandDoors.isOpen(sim.state, door.id),
        blocked: Math.hypot(test.x - across.x, test.z - across.z) > 0.5,
      };
    });
    assert.deepEqual(initial, { closed: true, blocked: true });
    await page.waitForFunction(
      () => document.querySelector('#interact-button').textContent === 'E · Open door',
    );
    await page.keyboard.press('e');
    assert.equal(
      await page.evaluate(() => VinlandDoors.isOpen(Vinland.simulation.state, window.testDoorId)),
      true,
    );
    await page.waitForFunction(
      () => document.querySelector('#interact-button').textContent === 'E · Close door',
    );
    const opened = await page.evaluate(() => {
      const w = Vinland.world,
        d = w.doorControls.entries.get(window.testDoorId).door;
      const point = VinlandBuildingSpaces.toWorld(d, { x: 0, z: 1.3 }),
        end = VinlandBuildingSpaces.toWorld(d, { x: 0, z: -1.3 });
      w.moveActor(point, end.x - point.x, end.z - point.z, 0.34, 'person:0');
      const before = w.doorControls.entries.get(d.id).pivot.rotation.y;
      w.sync();
      const loaded = VinlandModel.Simulation.load(Vinland.simulation.serialize());
      return {
        passed: Math.hypot(point.x - end.x, point.z - end.z) < 0.05,
        saved: loaded.state.doors[d.id],
        stable: before === w.doorControls.entries.get(d.id).pivot.rotation.y,
      };
    });
    assert.deepEqual(opened, { passed: true, saved: true, stable: true });
    await page.keyboard.press('e');
    assert.equal(
      await page.evaluate(() => VinlandDoors.isOpen(Vinland.simulation.state, window.testDoorId)),
      false,
    );
    const checks = await page.evaluate(() => {
      const sim = Vinland.simulation,
        w = Vinland.world,
        doors = w.doorControls;
      const door = doors.entries.get(window.testDoorId).door;
      doors.setOpen(door.id, true);
      const original = { x: sim.state.people[0].x, z: sim.state.people[0].z };
      Object.assign(sim.state.people[0], { x: door.x, z: door.z });
      const safe = doors.setOpen(door.id, false) === false;
      Object.assign(sim.state.people[0], original);
      doors.setOpen(door.id, false);
      const worker = sim.state.people[1];
      const start = VinlandBuildingSpaces.toWorld(door, { x: 0, z: 1.3 }),
        end = VinlandBuildingSpaces.toWorld(door, { x: 0, z: -1.3 });
      Object.assign(worker, start);
      w.agentPositions.set(1, { ...start });
      w.actorCollisions.set('person:1', { ...start, radius: 0.34 });
      doors.beforeWorkerMove(worker, end);
      const autoOpened = VinlandDoors.isOpen(sim.state, door.id);
      Object.assign(worker, end);
      w.agentPositions.set(1, { ...end });
      sim.state.time += 3 / 3600;
      doors.update();
      const autoClosed = !VinlandDoors.isOpen(sim.state, door.id);
      const hall = doors.entries.get('hall:III:east').door;
      doors.setOpen(hall.id, true);
      const hallOpen = VinlandDoors.isOpen(sim.state, hall.id);
      const active = w.usableSpaces().find((s) => s.spaceId === window.testDoorId);
      const interior = VinlandBuildingSpaces.toWorld(active, { x: 0.8, z: 0 });
      Object.assign(sim.state.leader, interior);
      Object.assign(sim.state.people[0], interior);
      w.indoorPresentation.updateLighting(1, 0);
      const closedLight = w.indoorPresentation.doorLight.intensity;
      doors.setOpen(door.id, true);
      w.indoorPresentation.updateLighting(1, 0);
      const openLight = w.indoorPresentation.doorLight.intensity;
      return { safe, autoOpened, autoClosed, hallOpen, closedLight, openLight };
    });
    for (const key of ['safe', 'autoOpened', 'autoClosed', 'hallOpen'])
      assert.equal(checks[key], true, key);
    assert.equal(checks.closedLight, 0);
    assert.ok(checks.openLight > 0);
    await page.screenshot({ path: '/tmp/vinland-doors.png' });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(JSON.stringify({ initial, opened, checks, offline: true }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
