const { startDefaultCampaign } = require('./browser-session.cjs');
/** Full shells, confined walk cameras, aperture daylight and switchable hearths. */
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
    const results = await page.evaluate(() => {
      Vinland.setPaused(true);
      const world = Vinland.world,
        sim = Vinland.simulation,
        Spaces = VinlandBuildingSpaces;
      sim.state.hallReady = true;
      sim.state.time = 12;
      Object.assign(sim.state.resources, {
        timber: 100000,
        turf: 100000,
        stone: 10000,
        firewood: 2000,
      });
      const order = sim.order('turfhouse', 70, 60, 0.73);
      if (!order) throw Error('No house fixture');
      sim.state.queue = sim.state.queue.filter((item) => item.id !== order.id);
      sim.state.buildings.push({ ...order, progress: order.hours, condition: 100 });
      world.sync();
      Vinland.view('walk');
      world.cutaway = true; // A district cutaway must never remove walk-view walls.
      const interiors = world.indoorPresentation;
      const house = world.usableSpaces().find((space) => space.id === order.id);
      const checks = [];
      function stand(space, local) {
        const point = Spaces.toWorld(space, local || { x: 0.95, z: -0.8 });
        Object.assign(sim.state.leader, point);
        Object.assign(sim.state.people[0], point);
        world.previousWalkPose = world.currentWalkPose = null;
        world.agentPositions.set(0, point);
      }
      for (const space of [
        house,
        ...world.usableSpaces().filter((space) => space.type === 'hall'),
      ]) {
        stand(space, space.type === 'hall' ? { x: 0.92, z: -0.9 } : undefined);
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
          world.walkYaw = angle;
          world.walkPitch = 0.38;
          world.updateInteriorVisibility();
          world.updateCamera(1);
          const cameraRoom = interiors.cameraSpaceAt(world.camera.position);
          if (
            space.type === 'hall'
              ? cameraRoom?.type !== 'hall'
              : !Spaces.contains(space, world.camera.position)
          )
            throw Error('Camera left room ' + space.spaceId);
          if (
            world.camera.position.y >
            interiors.ceiling(cameraRoom || space, world.camera.position) + 0.001
          )
            throw Error('Camera above roof');
          if (world.camera.position.y < world.actorElevation(space.x, space.z) + 0.25)
            throw Error('Camera below floor');
        }
        const shell = interiors.shell(space);
        if (space.type === 'hall') {
          if (!world.hallRoofs.visible || world.hallWalls.scale.y !== 1)
            throw Error('Hall cut away');
        } else if (!shell.userData.roof.visible) throw Error('House roof hidden');
        checks.push(space.spaceId);
      }
      const passageChecks = [];
      for (const passage of interiors.hallPassages()) {
        const [first, second] = passage.rooms;
        const alongX = Math.abs(first.room.x - second.room.x) > 1;
        const axis = alongX ? 'x' : 'z';
        const halfLength = passage.plan[alongX ? 'w' : 'd'] / 2;
        for (const direction of [-1, 1]) {
          world.walkYaw =
            passage.rotation + (alongX ? Math.PI / 2 : 0) + (direction < 0 ? Math.PI : 0);
          world.walkPitch = 0.15;
          // Start inside a room, cross the entire passage at walking speed,
          // and pause in its centre. Previously that pause zoomed outdoors.
          for (let frame = 0; frame <= 180; frame++) {
            const offset =
              frame < 120 ? -halfLength - 0.7 + (frame / 119) * (halfLength * 2 + 1.4) : 0;
            const local = { x: 0, z: 0, [axis]: offset * direction };
            const point = Spaces.toWorld(passage, local);
            Object.assign(sim.state.leader, point);
            Object.assign(sim.state.people[0], point);
            world.previousWalkPose = world.currentWalkPose = null;
            world.updateCamera(1 / 60);
            if (frame > 20 && interiors.cameraBlend < 0.99)
              throw Error('Outdoor zoom in Hall doorway');
            if (interiors.cameraSpaceAt(world.camera.position)?.type !== 'hall')
              throw Error('Camera escaped Hall passage');
            if (
              Math.abs(
                world.actorElevation(point.x, point.z) - world.actorElevation(first.x, first.z),
              ) > 0.001
            )
              throw Error('Hall doorway floor discontinuity');
          }
        }
        passageChecks.push(first.room.n + '–' + second.room.n);
      }
      // Leaving through an exterior entrance must still restore outdoor zoom.
      const mainRoom = world.usableSpaces().find((space) => space.spaceId === 'hall:II');
      stand(mainRoom, { x: mainRoom.plan.w / 2 + 3, z: 0 });
      world.updateCamera(1);
      if (interiors.activeSpace() || interiors.cameraBlend > 0.01)
        throw Error('Indoor camera persisted outdoors');
      stand(house);
      // Follow the full door transition, not only settled camera positions.
      world.walkYaw = house.rotation + Math.PI;
      for (let frame = 0; frame <= 90; frame++) {
        stand(house, { x: 0, z: 7 - frame * 0.05 });
        world.updateCamera(1 / 60);
        const space = world.spaceAt(sim.state.leader);
        if (space?.spaceId === house.spaceId && !Spaces.contains(space, world.camera.position))
          throw Error('Camera escaped during doorway transition');
      }
      stand(house);
      const person = sim.state.people[0],
        hearthId = house.spaceId;
      VinlandStorage.syncStores(sim.state);
      VinlandStorage.deposit(sim.state, hearthId, 'firewood', 4);
      if (
        VinlandHearths.addFuel(sim, person, hearthId, 2) ||
        VinlandHearths.light(sim, person, hearthId)
      )
        throw Error('Cannot light fixture');
      sim.advance(3 / 60);
      world.walkYaw = house.rotation + Math.PI;
      world.walkPitch = 0.15;
      world.update(1);
      const daytime = {
        door: interiors.doorLight.intensity,
        smoke: interiors.smokeLight.intensity,
        fire: interiors.fireLight.intensity,
      };
      if (!(daytime.door > 0 && daytime.smoke > 0 && daytime.fire > 0))
        throw Error('Missing daytime light');
      const roof = interiors.shell(house).userData.roof;
      if (!roof.children.some((child) => child.userData.smokeOpening))
        throw Error('No actual smoke aperture');
      roof.updateWorldMatrix(true, true);
      const probe = new THREE.Raycaster();
      const floor = world.actorElevation(house.x, house.z);
      probe.set(new THREE.Vector3(house.x, floor + 2, house.z), new THREE.Vector3(0, 1, 0));
      if (probe.intersectObject(roof, true).length)
        throw Error('Smoke aperture is covered by geometry');
      const back = Spaces.toWorld(house, { x: 0, z: -house.plan.d / 2 - 0.6 });
      const origin = new THREE.Vector3(house.x, floor + 2.25, house.z);
      const destination = new THREE.Vector3(back.x, origin.y, back.z);
      probe.set(origin, destination.clone().sub(origin).normalize());
      probe.far = origin.distanceTo(destination);
      if (!probe.intersectObject(roof, true).length) throw Error('Open gap above the rear wall');
      VinlandHearths.bank(sim, person, hearthId);
      sim.advance(1 / 3600);
      world.update(0.1);
      if (interiors.hearth(house).userData.flame.visible)
        throw Error('Extinguished hearth still shines');
      const saved = VinlandModel.Simulation.load(sim.serialize());
      if (saved?.state.hearths.fires[hearthId]?.lit !== false)
        throw Error('Hearth switch lost on load');
      sim.state.time = 0;
      world.update(0.1);
      if (interiors.doorLight.intensity !== 0 || interiors.smokeLight.intensity !== 0)
        throw Error('Daylight at midnight');
      VinlandHearths.light(sim, person, hearthId);
      sim.advance(1 / 3600);
      world.update(0.1);
      if (!(interiors.fireLight.intensity > 0)) throw Error('Hearth did not relight');
      sim.state.resources.firewood = 0;
      world.update(0.1);
      if (!(interiors.fireLight.intensity > 0))
        throw Error('Camp stock incorrectly extinguished loaded fuel');
      sim.state.resources.firewood = 2000;
      sim.state.time = 12;
      // Repeated weather refreshes must not keep wrapping material shaders.
      for (let i = 0; i < 3; i++) {
        world.weatherEffects.refreshRoofs();
        world.sync();
        world.update(0.1);
      }
      return {
        rooms: checks,
        passages: passageChecks,
        daytime,
        shaderRooms: interiors.uniforms.indoorRoomCount.value,
        near: world.camera.near,
      };
    });
    await page.screenshot({ path: '/tmp/vinland-indoor-day.png' });
    await page.evaluate(() => {
      Vinland.simulation.state.time = 0;
      Vinland.world.update(0.1);
    });
    await page.screenshot({ path: '/tmp/vinland-indoor-night.png' });
    await page.keyboard.press('f');
    await page.waitForTimeout(150);
    await page.screenshot({ path: '/tmp/vinland-indoor-dark.png' });
    await page.keyboard.press('f');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const hearthBounds = await page.locator('#hearth-button').boundingBox();
    assert.ok(hearthBounds && hearthBounds.x >= 0 && hearthBounds.x + hearthBounds.width <= 390);
    await page.evaluate(() => {
      Vinland.view('district');
      Vinland.world.update(0.1);
    });
    assert.equal(
      await page.evaluate(() => Vinland.world.indoorPresentation.uniforms.indoorRoomCount.value),
      0,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(JSON.stringify(results));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
