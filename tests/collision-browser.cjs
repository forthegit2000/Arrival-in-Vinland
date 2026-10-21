const { startDefaultCampaign } = require('./browser-session.cjs');
/** Exercise collision through the real offline renderer and movement methods. */
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
    const errors = [];
    const network = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => {
      network.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const settlement = await page.evaluate(() => {
      Vinland.setPaused(true);
      const world = Vinland.world;
      world.animatePeople(0, world.elapsed);
      const points = [...world.agentPositions.values()];
      let minimumGap = Infinity;
      for (let first = 0; first < points.length; first++) {
        for (let second = first + 1; second < points.length; second++) {
          minimumGap = Math.min(
            minimumGap,
            Math.hypot(points[first].x - points[second].x, points[first].z - points[second].z),
          );
        }
      }
      const tentsUsable = world.tents.every((tent) => {
        const building = { x: tent.position.x, z: tent.position.z, rotation: tent.rotation.y };
        const side = VinlandBuildingSpaces.toWorld(building, { x: 1.65, z: 0 });
        const door = VinlandBuildingSpaces.toWorld(building, { x: 0, z: 2.5 });
        return (
          world.clearAt(tent.position.x, tent.position.z, 0.34) &&
          !world.clearAt(side.x, side.z, 0.34) &&
          world.clearAt(door.x, door.z, 0.34)
        );
      });
      const peopleClear = points.every((point) => world.clearAt(point.x, point.z, 0.34));
      // Reserve a real building site, then verify it is solid before completion.
      for (const key of ['timber', 'turf', 'stone', 'iron', 'cloth'])
        world.sim.state.resources[key] = 100000;
      let order;
      for (let x = 42; x < 90 && !order; x += 6) {
        for (let z = 42; z < 90 && !order; z += 6) order = world.sim.order('woodshed', x, z, 0.63);
      }
      world.sync();
      const siteSolid = order && !world.clearAt(order.x, order.z);
      const definition = VinlandModel.TYPES[order.type];
      const outsideX = order.x + Math.cos(order.rotation) * (definition.w / 2 + 0.6);
      const outsideZ = order.z - Math.sin(order.rotation) * (definition.w / 2 + 0.6);
      const rotatedEdgeClear = world.clearAt(outsideX, outsideZ, 0.34);
      const worker = world.agentPositions.get(1);
      worker.x = order.x;
      worker.z = order.z;
      world.relocateActors = true;
      world.animatePeople(0, world.elapsed);
      const workerOutsideSite = world.clearAt(worker.x, worker.z, 0.34);
      world.animateLivestock(20);
      world.animateLivestock(20.1);
      const livestockClear = [...world.actorCollisions.entries]
        .filter(([id]) => id.startsWith('animal:'))
        .every(([id, { shape }]) => world.actorClearAt(shape.x, shape.z, shape.radius, id));
      const before = [];
      for (let x = -18; x <= 18; x++)
        for (let z = -18; z <= 18; z++) before.push(world.clearAt(x, z));
      world.toggleRoof();
      const after = [];
      for (let x = -18; x <= 18; x++)
        for (let z = -18; z <= 18; z++) after.push(world.clearAt(x, z));
      return {
        minimumGap,
        tentsUsable,
        peopleClear,
        siteSolid,
        rotatedEdgeClear,
        workerOutsideSite,
        livestockClear,
        cutawayPreservesWalls: JSON.stringify(before) === JSON.stringify(after),
      };
    });
    assert.ok(settlement.minimumGap >= 0.68 - 0.00001, JSON.stringify(settlement));
    for (const key of [
      'tentsUsable',
      'peopleClear',
      'siteSolid',
      'rotatedEdgeClear',
      'workerOutsideSite',
      'livestockClear',
      'cutawayPreservesWalls',
    ]) {
      assert.equal(settlement[key], true, key);
    }
    const waterCollision = await page.evaluate(() => {
      const world = Vinland.world,
        sim = Vinland.simulation,
        leader = sim.state.leader;
      const check = (value, message) => {
        if (!value) throw Error(message);
      };
      const saved = { x: leader.x, z: leader.z };
      world.elapsed = 30;
      world.animateShips(30);
      const boat = world.boatFrame(0),
        Spaces = VinlandBuildingSpaces;
      const outside = Spaces.toWorld(boat, { x: 4, z: -4 });
      Object.assign(leader, outside);
      const inward = Spaces.toWorld(boat, { x: 0, z: -4 });
      world.moveActor(leader, inward.x - outside.x, inward.z - outside.z, 0.34, 'person:0');
      check(!world.deckBoatAt(leader), 'Swimmer passes through hull');
      const deck = Spaces.toWorld(boat, { x: world.deckHalfWidth(boat, -4) - 0.42, z: -4 });
      Object.assign(leader, deck);
      world.moveActor(leader, 20, 0, 0.34, 'person:0');
      check(world.deckBoatAt(leader)?.index === 0, 'Player walks off deck through gunwale');
      const mast = Spaces.toWorld(boat, { x: 0, z: 0 });
      check(!world.playerClearAt(mast.x, mast.z, 0.34), 'Mast lacks collision');
      const cargo = Spaces.toWorld(boat, { x: 0, z: 1 });
      check(!world.playerClearAt(cargo.x, cargo.z, 0.34), 'Cargo lacks collision');
      Object.assign(leader, { x: -150, z: 90 });
      const staticIndex = world.staticCollisions;
      world.staticCollisions = new VinlandCollision.SpatialIndex();
      world.staticCollisions.set('wet-wall', { x: -150, z: 90, w: 0.15, d: 8 });
      Object.assign(leader, { x: -152, z: 90 });
      world.moveActor(leader, 5, 0, 0.34, 'person:0');
      check(leader.x < -150.4, 'Swimming bypasses solid objects');
      check(!world.playerClearAt(world.mapExtent.minX - 1, 0, 0.34), 'Swimmer escapes map');
      check(!world.clearAt(outside.x, outside.z, 0.34), 'Crew pathfinding now crosses water');
      world.staticCollisions = staticIndex;
      Object.assign(leader, saved);
      return {
        hull: true,
        gunwale: true,
        mast: true,
        cargo: true,
        waterObstacles: true,
        mapBoundary: true,
        crewRoutes: true,
      };
    });
    console.log(JSON.stringify({ waterCollision }));
    const movement = await page.evaluate(() => {
      const world = Vinland.world;
      const enclosure = world.buildGeneric('palisade');
      const rails = enclosure.userData.base.children.filter(
        (mesh) => mesh.name === 'Enclosure rail',
      ).length;
      world.buildingBounds = [{ type: 'palisade', x: 70, z: 60, w: 14, d: 14, rotation: 0 }];
      const fenceIndex = new VinlandCollision.SpatialIndex();
      let fenceId = 0;
      world.addBuildingObstacles((shape) => fenceIndex.set(fenceId++, shape));
      const firstAngle = (2 / 28) * Math.PI * 2;
      const nextAngle = (3 / 28) * Math.PI * 2;
      const fenceSolid = fenceIndex.blocked(
        70 + (Math.sin(firstAngle) + Math.sin(nextAngle)) * 3.5,
        60 + (Math.cos(firstAngle) + Math.cos(nextAngle)) * 3.5,
        0.34,
      );
      const gatewayOpen = !fenceIndex.blocked(70, 67, 0.34);
      // An isolated thin wall on real, walkable land tests tunneling without
      // depending on the random positions of trees or the initial crowd.
      world.staticCollisions = new VinlandCollision.SpatialIndex();
      world.actorCollisions = new VinlandCollision.SpatialIndex();
      world.staticCollisions.set('wall', { x: 70, z: 60, w: 0.15, d: 12, rotation: 0 });
      const point = { x: 68, z: 60 };
      world.moveActor(point, 8, 0, 0.34, 'test');
      const bigStepStopped = point.x < 69.59;
      const route = world.path({ x: 68, z: 60 }, { x: 72, z: 60 });
      let previous = { x: 68, z: 60 };
      const safeRoute =
        route.length > 0 &&
        route.every((next) => {
          const clear = world.segmentClear(previous, next, 0.34);
          previous = next;
          return clear;
        });
      const leader = world.sim.state.leader;
      leader.x = 68;
      leader.z = 60;
      world.view = 'walk';
      world.walkYaw = 0;
      world.paused = false;
      world.keys = new Set(['KeyA', 'ShiftLeft']);
      world.stepLeader(2);
      world.updateCamera(2);
      const sprintStopped = leader.x < 69.59;
      world.keys.clear();
      world.paused = true;
      world.staticCollisions = new VinlandCollision.SpatialIndex();
      world.actorCollisions = new VinlandCollision.SpatialIndex();
      const first = { x: 68, z: 60 },
        second = { x: 72, z: 60 };
      world.actorCollisions.set('person:1', { ...first, radius: 0.34 });
      world.actorCollisions.set('person:2', { ...second, radius: 0.34 });
      let minimumGap = Infinity;
      for (let frame = 0; frame < 500; frame++) {
        for (const [point, goal, id] of [
          [first, { x: 72, z: 60 }, 'person:1'],
          [second, { x: 68, z: 60 }, 'person:2'],
        ]) {
          const distance = Math.hypot(goal.x - point.x, goal.z - point.z);
          const step = Math.min(distance, 0.07);
          if (distance > 0.01)
            world.moveActor(
              point,
              ((goal.x - point.x) / distance) * step,
              ((goal.z - point.z) / distance) * step,
              0.34,
              id,
              true,
            );
          minimumGap = Math.min(minimumGap, Math.hypot(first.x - second.x, first.z - second.z));
        }
      }
      return {
        bigStepStopped,
        rails,
        fenceSolid,
        gatewayOpen,
        safeRoute,
        sprintStopped,
        minimumGap,
        passed: first.x > 71.8 && second.x < 68.2,
      };
    });
    assert.equal(movement.bigStepStopped, true);
    assert.equal(movement.rails, 50);
    assert.equal(movement.fenceSolid, true);
    assert.equal(movement.gatewayOpen, true);
    assert.equal(movement.safeRoute, true);
    assert.equal(movement.sprintStopped, true);
    assert.ok(movement.minimumGap >= 0.68 - 0.00001);
    assert.equal(movement.passed, true, JSON.stringify(movement));
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      JSON.stringify({ result: 'PASS', settlement, movement, offlineRequests: network.length }),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
