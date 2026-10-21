const { startDefaultCampaign } = require('./browser-session.cjs');
/** Deterministic render frames isolate camera jitter from GPU frame timing. */
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
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const water = await page.evaluate(() => {
      Vinland.view('walk');
      Vinland.setPaused(true);
      const world = Vinland.world,
        sim = Vinland.simulation;
      const check = (value, message) => {
        if (!value) throw Error(message);
      };
      const stand = (point) => {
        Object.assign(sim.state.leader, point);
        Object.assign(sim.state.people[0], point);
        world.agentPositions.set(0, { x: point.x, z: point.z });
        world.actorCollisions.set('person:0', { x: point.x, z: point.z, radius: 0.34 });
        world.previousWalkPose = world.currentWalkPose = null;
      };
      world.elapsed = 30;
      world.animateShips(30);
      let coastLine = null;
      for (let z = -90; z < 90 && !coastLine; z += 3) {
        let clear = true;
        for (let x = -65; x >= -101; x -= 0.2)
          if (!world.openWaterClearAt(x, z, 0.34)) {
            clear = false;
            break;
          }
        if (
          clear &&
          world.leaderSurfaceAt({ x: -65, z }).mode === 'land' &&
          world.leaderSurfaceAt({ x: -101, z }).mode === 'swim'
        )
          coastLine = z;
      }
      check(coastLine !== null, 'No real shoreline crossing fixture');
      stand({ x: -65, z: coastLine, heading: -Math.PI / 2 });
      world.walkYaw = -Math.PI / 2;
      world.keys.clear();
      world.keys.add('KeyW');
      const modes = new Set();
      for (let step = 0; step < 900 && sim.state.leader.x > -101; step++) {
        world.stepLeader(0.1);
        modes.add(world.leaderSurfaceAt(sim.state.leader).mode);
      }
      world.keys.clear();
      check(
        modes.has('land') && modes.has('wade') && modes.has('swim'),
        'Missing shore transition: ' + [...modes],
      );
      check(sim.state.leader.x < -100, 'Sea remains blocked');
      const x = sim.state.leader.x;
      world.keys.add('KeyW');
      for (let step = 0; step < 10; step++) world.stepLeader(0.1);
      world.keys.clear();
      check(Math.abs(x - sim.state.leader.x - 0.7) < 1e-6, 'Incorrect swimming speed');
      world.updateCamera(10);
      world.animatePeople(0.1, 30);
      check(world.camera.position.y > 0.4, 'Swimming camera underwater');
      const surface = world.leaderSurfaceAt(sim.state.leader);
      check(
        Math.abs(world.people[0].position.y - (surface.surface - 1.15)) < 0.08,
        'Swimmer stands on seabed',
      );
      const saved = sim.serialize(),
        loaded = VinlandModel.Simulation.load(saved);
      check(!!loaded, 'Swimming save rejected');
      const swimmingPosition = { x: sim.state.leader.x, z: sim.state.leader.z };
      window.swimmingSave = saved;
      world.walkYaw = Math.PI / 2;
      world.keys.add('KeyW');
      for (let step = 0; step < 1000 && sim.state.leader.x < -65; step++) world.stepLeader(0.1);
      world.keys.clear();
      check(world.leaderSurfaceAt(sim.state.leader).mode === 'land', 'Cannot leave the water');
      // Cross a mapped freshwater line, choosing a segment clear of props.
      let ford = null;
      for (const stream of VinlandMeadows.data.streams) {
        for (let index = 1; index < stream.points.length && !ford; index++) {
          const a = stream.points[index - 1],
            b = stream.points[index],
            length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (length < 1) continue;
          const mid = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 },
            nx = -(b[1] - a[1]) / length,
            nz = (b[0] - a[0]) / length;
          if (VinlandMeadows.shoreDistance(mid.x, mid.z) < 10) continue;
          let clear = true;
          for (let t = -3; t <= 3; t += 0.15)
            if (!world.openWaterClearAt(mid.x + nx * t, mid.z + nz * t, 0.34)) {
              clear = false;
              break;
            }
          if (clear && world.leaderSurfaceAt(mid).mode === 'wade') ford = { mid, nx, nz };
        }
      }
      check(!!ford, 'No real stream crossing fixture');
      stand({ x: ford.mid.x - ford.nx * 3, z: ford.mid.z - ford.nz * 3, heading: 0 });
      world.walkYaw = Math.atan2(ford.nx, ford.nz);
      world.keys.add('KeyW');
      let waded = false;
      for (let step = 0; step < 70; step++) {
        world.stepLeader(0.1);
        waded ||= world.leaderSurfaceAt(sim.state.leader).mode === 'wade';
      }
      world.keys.clear();
      check(
        waded &&
          (sim.state.leader.x - ford.mid.x) * ford.nx +
            (sim.state.leader.z - ford.mid.z) * ford.nz >
            1.2,
        'Stream remained a barrier',
      );
      return {
        modes: [...modes],
        swimmingPosition,
        cameraHeight: world.camera.position.y,
        streamCrossed: true,
      };
    });
    await page.evaluate(() => {
      Vinland.replaceSimulation(VinlandModel.Simulation.load(window.swimmingSave));
      Vinland.setPaused(true);
      const world = Vinland.world,
        leader = Vinland.simulation.state.leader;
      world.animatePeople(0, world.elapsed);
      if (world.leaderSurfaceAt(leader).mode !== 'swim')
        throw Error('Load moved swimmer onto land');
    });
    assert.equal(await page.locator('.walk-movement-hint').count(), 0);
    assert.equal(await page.evaluate(() => Vinland.world.view), 'walk');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/vinland-swimming.png' });
    const boatId = await page.evaluate(() => {
      const world = Vinland.world,
        sim = Vinland.simulation;
      world.elapsed = 0;
      sim.state.time = 8 + 15 / 3600;
      world.animateShips(0);
      const boat = world.boatFrame(0),
        point = VinlandBuildingSpaces.toWorld(boat, { x: 3.29, z: -4 });
      Object.assign(sim.state.leader, point);
      Object.assign(sim.state.people[0], point);
      world.agentPositions.set(0, { ...point });
      world.actorCollisions.set('person:0', { ...point, radius: 0.34 });
      world.previousWalkPose = world.currentWalkPose = null;
      if (Math.hypot(boat.ship.position.x - boat.x, boat.ship.position.z - boat.z) > 0.01)
        throw Error('Boat arrival ignores simulation speed');
      if (world.nearby()?.type !== 'board-boat') throw Error('No boarding action beside hull');
      return boat.index;
    });
    await page.waitForFunction(
      () => document.querySelector('#interact-button').textContent === 'E · Board boat',
    );
    await page.keyboard.press('e');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/vinland-aboard.png' });
    const aboard = await page.evaluate((boatId) => {
      const world = Vinland.world,
        sim = Vinland.simulation;
      const surface = world.leaderSurfaceAt(sim.state.leader);
      if (surface.mode !== 'deck' || surface.boat.index !== boatId) throw Error('E did not board');
      window.deckSave = sim.serialize();
      return { x: sim.state.leader.x, z: sim.state.leader.z };
    }, boatId);
    await page.evaluate(() => {
      Vinland.replaceSimulation(VinlandModel.Simulation.load(window.deckSave));
      Vinland.setPaused(true);
      const world = Vinland.world,
        leader = Vinland.simulation.state.leader;
      world.animateShips(0);
      world.animatePeople(0, 0);
      if (world.leaderSurfaceAt(leader).mode !== 'deck') throw Error('Load lost boat deck');
      const pitch = world.walkPitch;
      world.walkPitch = -Math.PI * 0.44;
      world.updateCamera(10);
      if (world.camera.position.y <= 0.4) throw Error('Deck camera dips underwater');
      world.walkPitch = pitch;
      const boat = world.deckBoatAt(leader);
      if (Math.hypot(boat.ship.position.x - boat.x, boat.ship.position.z - boat.z) > 0.01)
        throw Error('Arrival replayed under passenger');
    });
    assert.ok(
      Math.abs((await page.evaluate(() => Vinland.simulation.state.leader.x)) - aboard.x) < 1e-6,
    );
    await page.waitForFunction(
      () => document.querySelector('#interact-button').textContent === 'E · Leave boat',
    );
    await page.keyboard.press('e');
    assert.equal(
      await page.evaluate(
        () => Vinland.world.leaderSurfaceAt(Vinland.simulation.state.leader).mode,
      ),
      'swim',
    );
    console.log(
      JSON.stringify({ water, boatId, boarding: true, disembarking: true, saveLoad: true }),
    );
    await page.evaluate(() => {
      Vinland.replaceSimulation(new VinlandModel.Simulation());
      Vinland.setPaused(true);
    });
    const results = await page.evaluate(() => {
      Vinland.setPaused(true);
      Vinland.view('walk');
      const world = Vinland.world;
      const simulation = Vinland.simulation;
      const elevation = VinlandModel.elevation;
      const results = [];
      // Flat ground and an empty collision index remove terrain/crowd effects.
      // Any periodic camera pitch here comes from the movement/render timing.
      VinlandModel.elevation = () => 0;
      world.staticCollisions = new VinlandCollision.SpatialIndex();
      world.actorCollisions = new VinlandCollision.SpatialIndex();
      world.relocateActors = false;
      for (const speed of [1, 3, 8]) {
        for (const sprint of [false, true]) {
          Object.assign(simulation.state.leader, { x: 70, z: 60, heading: 0 });
          Object.assign(simulation.state.people[0], { x: 70, z: 60 });
          simulation.state.realtimeRemainderSeconds = 0;
          world.agentPositions.set(0, { x: 70, z: 60 });
          world.walkYaw = 0;
          world.walkPitch = Math.atan2(3, 7.5);
          world.keys.clear();
          world.updateCamera(10);
          world.keys.add('KeyW');
          if (sprint) world.keys.add('ShiftLeft');
          const pitches = [],
            frameDistances = [];
          let previousPosition;
          for (let frame = 0; frame < 240; frame++) {
            simulation.advanceRealtime(speed / 60, world);
            world.updateCamera(1 / 60);
            world.animatePeople(1 / 60, frame / 60);
            const forward = world.camera.getWorldDirection(new THREE.Vector3());
            const position = world.people[0].position.clone();
            if (frame >= 120) {
              pitches.push(Math.atan2(forward.y, Math.hypot(forward.x, forward.z)));
              frameDistances.push(position.distanceTo(previousPosition));
            }
            previousPosition = position;
          }
          results.push({
            speed,
            sprint,
            pitchRange: Math.max(...pitches) - Math.min(...pitches),
            minimumFrameDistance: Math.min(...frameDistances),
            maximumFrameDistance: Math.max(...frameDistances),
            physicalDistance: simulation.state.leader.z - 60,
          });
        }
      }
      VinlandModel.elevation = elevation;
      world.keys.clear();
      return results;
    });
    console.log(JSON.stringify(results));
    for (const result of results) {
      assert.ok(
        result.pitchRange < 0.0001,
        'Camera pitch must stay steady on flat ground: ' + JSON.stringify(result),
      );
      const expectedStep = (1.4 * (result.sprint ? 3 : 1) * result.speed) / 60;
      assert.ok(
        Math.abs(result.minimumFrameDistance - expectedStep) < 0.00001,
        'The avatar must advance each render frame',
      );
      assert.ok(
        Math.abs(result.maximumFrameDistance - expectedStep) < 0.00001,
        'The avatar must not jump at a work tick',
      );
      assert.ok(
        Math.abs(result.physicalDistance - expectedStep * 240) < 0.00001,
        'Smoothing must not change physical speed',
      );
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
