const { startDefaultCampaign } = require('./browser-session.cjs');
/** Real offline entrances, interior work, storage and shelter. */
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
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.route(/^https?:/, (route) => {
      network.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const result = await page.evaluate(() => {
      Vinland.setPaused(true);
      const world = Vinland.world,
        simulation = Vinland.simulation,
        Spaces = VinlandBuildingSpaces;
      const person = simulation.state.people[1];
      function stand(point) {
        Object.assign(person, point);
        world.agentPositions.set(1, { ...point });
        world.actorCollisions.set('person:1', { ...point, radius: 0.34 });
      }
      function completed(type, angle) {
        Object.assign(simulation.state.resources, {
          timber: 100000,
          turf: 100000,
          stone: 10000,
          iron: 10000,
        });
        const order = simulation.order(type, 70, 60, angle);
        if (!order) throw Error('No fixture site: ' + type);
        order.progress = order.hours;
        simulation.state.queue = simulation.state.queue.filter((item) => item.id !== order.id);
        simulation.state.buildings.push({ ...order, condition: 100 });
        world.sync();
        return simulation.state.buildings.at(-1);
      }
      function checkGroundContact(object, wallRoot) {
        const dressing = object.userData.turfGrounding;
        if (!dressing) throw Error('Missing turf ground contact');
        const geometry = dressing.geometry;
        const positions = geometry.attributes.position;
        const point = new THREE.Vector3();
        let lowestGround = Infinity;
        let highestGround = -Infinity;
        // Each wall-edge interval has three courses, each made of two
        // triangles. The first and last vertices of the bottom course are
        // buried, so uneven terrain cannot expose a gap beneath that edge.
        for (let index = 0; index < positions.count; index += 18) {
          for (const offset of [0, 2]) {
            point.fromBufferAttribute(positions, index + offset);
            const localY = point.y;
            object.localToWorld(point);
            const ground = world.terrainSurfaceHeight(point.x, point.z);
            if (point.y > ground - 0.1) throw Error('Turf edge floats above ground');
            if (localY > -0.1) throw Error('Turf edge no longer overlaps the wall base');
            lowestGround = Math.min(lowestGround, ground);
            highestGround = Math.max(highestGround, ground);
          }
        }
        // Independently compare interpolation against the actual rendered mesh.
        const ray = new THREE.Raycaster();
        for (const index of [0, Math.floor(positions.count / 2), positions.count - 1]) {
          point.fromBufferAttribute(positions, index);
          object.localToWorld(point);
          ray.set(new THREE.Vector3(point.x, 200, point.z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObject(world.terrain)[0];
          if (!hit || Math.abs(hit.point.y - world.terrainSurfaceHeight(point.x, point.z)) > 0.001)
            throw Error('Turf terrain sample differs from the rendered surface');
        }
        world.syncTurfGrounding(object, wallRoot);
        if (dressing.geometry !== geometry) throw Error('Unchanged turf geometry rebuilt');
        return { vertices: positions.count, slope: highestGround - lowestGround };
      }
      const groundChecks = [];
      groundChecks.push({ type: 'hall', ...checkGroundContact(world.hall, world.hallWalls) });
      const checks = [];
      for (const [type, angle] of [
        ['workshop', 0.37],
        ['storehouse', 1.23],
        ['longhouse', 2.7],
        ['turfhouse', 0],
        ['sailbudir', 0.83],
        ['tentbudir', 1.9],
      ]) {
        const building = completed(type, angle),
          plan = Spaces.plan(type);
        if (!['sailbudir', 'tentbudir'].includes(type)) {
          const object = world.objects.get(building.id);
          const originalPosition = object.position.clone();
          const originalRotation = object.rotation.y;
          const walls = object.userData.base;
          const wallTransforms = walls.children.map((child) => child.matrix.toArray());
          groundChecks.push({ type, angle, ...checkGroundContact(object, walls) });
          // Exercise a distinctly sloping part of the same map without
          // changing building placement rules or the authoritative save.
          object.position.set(90, VinlandModel.elevation(90, 90, simulation.state.config), 90);
          object.rotation.y += 0.61;
          world.syncTurfGrounding(object, walls);
          groundChecks.push({ type, rotatedSlope: true, ...checkGroundContact(object, walls) });
          object.position.copy(originalPosition);
          object.rotation.y = originalRotation;
          world.syncTurfGrounding(object, walls);
          if (
            JSON.stringify(walls.children.map((child) => child.matrix.toArray())) !==
            JSON.stringify(wallTransforms)
          )
            throw Error('Ground detail changed structural walls');
          const positions = object.userData.turfGrounding.geometry.attributes.position;
          for (let index = 0; index < positions.count; index++) {
            if (
              Math.abs(positions.getX(index)) < plan.doorWidth / 2 - 0.1 &&
              Math.abs(positions.getZ(index) - plan.d / 2) < plan.thickness
            )
              throw Error('Turf dressing obstructs the entrance');
          }
        }
        const outside = Spaces.toWorld(building, { x: 0, z: plan.d / 2 + 3 });
        stand(outside);
        const space = world.usableSpaces().find((space) => space.id === building.id);
        const target = world.indoorTarget(space, person);
        const side = Spaces.toWorld(building, { x: plan.w / 2, z: 0 });
        const front = Spaces.toWorld(building, plan.entrance);
        const route = target && world.path(person, target);
        if (!target || !route?.length)
          throw Error('No interior route ' + type + ' ' + JSON.stringify({ outside, target }));
        simulation.commandWorkers([1], { type: 'move', ...target });
        simulation.advanceRealtime(60, world);
        const inside = Spaces.contains(space, person, plan.thickness / 2);
        checks.push({
          type,
          inside,
          wallSolid: !world.clearAt(side.x, side.z, 0.34),
          doorOpen: world.clearAt(front.x, front.z, 0.34),
          floor: world.actorElevation(person.x, person.z),
        });
        if (!inside)
          throw Error(
            'Worker stopped outside ' +
              type +
              ' ' +
              JSON.stringify({
                person: { x: person.x, z: person.z },
                target,
                route: world.routes.get(1),
              }),
          );
        if (type === 'storehouse') {
          const delivery = world.deliveryPoint('turf', person);
          if (
            delivery?.id !== 'building:' + building.id ||
            !Spaces.contains(space, delivery, plan.thickness / 2)
          )
            throw Error('Storage delivery is outside');
        }
        if (type === 'workshop') {
          const job = world.workAssignment('craft', person);
          if (!job || !Spaces.contains(space, job)) throw Error('Workshop station outside');
        }
        simulation.commandWorkers([1], { type: 'stop' });
        if (!simulation.dismantle(building.id))
          simulation.state.buildings = simulation.state.buildings.filter(
            (item) => item.id !== building.id,
          );
        world.sync();
      }
      simulation.state.hallReady = true;
      world.sync();
      const hallChecks = [];
      for (const space of world.usableSpaces().filter((space) => space.type === 'hall')) {
        stand({ x: 20, z: -15 });
        const target = world.indoorTarget(space, person);
        const route = target && world.path(person, target);
        hallChecks.push({ room: space.room.n, target: !!target, routed: !!route?.length });
        if (!route?.length)
          throw Error(
            'Hall room inaccessible ' +
              JSON.stringify({
                hallChecks,
                space,
                outside: Spaces.toWorld(space, space.plan.outside),
                inside: Spaces.toWorld(space, space.plan.inside),
                points: world
                  .interiorPoints(space)
                  .map((point) => ({ ...point, path: world.path(person, point).length })),
                segment: world.segmentClear(
                  Spaces.toWorld(space, space.plan.outside),
                  Spaces.toWorld(space, space.plan.inside),
                  0.35,
                ),
                entrancePath: world.path(person, Spaces.toWorld(space, space.plan.outside)).length,
              }),
          );
        simulation.commandWorkers([1], { type: 'move', ...target });
        simulation.advanceRealtime(90, world);
        if (!Spaces.contains(space, person))
          throw Error(
            'Worker could not enter Hall room ' +
              space.room.n +
              ' ' +
              JSON.stringify({
                person: { x: person.x, z: person.z },
                target,
                route: world.routes.get(1),
                doors: simulation.state.doors,
              }),
          );
        simulation.commandWorkers([1], { type: 'move', x: 20, z: -15 });
        simulation.advanceRealtime(90, world);
        if (world.spaceAt(person)?.type === 'hall')
          throw Error(
            'Worker could not leave Hall room ' +
              space.room.n +
              ' ' +
              JSON.stringify({
                person: { x: person.x, z: person.z },
                route: world.routes.get(1),
                path: world.path(person, { x: 20, z: -15 }),
              }),
          );
      }
      simulation.state.hallReady = false;
      world.sync();
      const house = completed('turfhouse', 0.49);
      const plan = Spaces.plan(house.type);
      stand(Spaces.toWorld(house, { x: 0, z: plan.d / 2 + 3 }));
      simulation.commandWorkers([1], { type: 'shelter', x: person.x, z: person.z });
      simulation.advanceRealtime(120, world);
      world.preparePeople();
      const sheltered = person.shelterWarmth === 1 && person.insideSpace === 'building:' + house.id;
      if (!sheltered) throw Error('Person did not shelter ' + JSON.stringify(person));
      const loaded = VinlandModel.Simulation.load(simulation.serialize());
      if (!loaded?.state.people[1].restPlace) throw Error('Shelter did not survive saving');
      const outside = Spaces.toWorld(house, { x: 0, z: plan.d / 2 + 3 });
      const oldPlace = { ...person.restPlace };
      world.staticCollisions.set(
        'test-closed-door',
        Spaces.obstacle(house, { ...plan.entrance, w: plan.doorWidth, d: plan.thickness }),
      );
      if (world.path(outside, oldPlace).length) throw Error('Route crossed a blocked doorway');
      world.staticCollisions.remove('test-closed-door');
      stand(outside);
      simulation.state.time = 18;
      simulation.commandWorkers([1], { type: 'work', task: 'herding', ...outside });
      const nightOrder = person.order;
      simulation.advanceRealtime(120, world);
      world.preparePeople();
      if (person.order !== nightOrder || person.shelterWarmth !== 1 || nightOrder.workedHours !== 0)
        throw Error('Off-duty shelter changed the job or counted work');
      simulation.state.time = 8;
      simulation.advanceRealtime(120, world);
      if (
        person.order !== nightOrder ||
        nightOrder.workedHours <= 0 ||
        Spaces.contains(house, person)
      )
        throw Error('Worker did not leave shelter and resume work');
      house.condition = 10;
      world.sync();
      stand(oldPlace);
      world.preparePeople();
      if (person.shelterWarmth !== 0 || !world.path(person, outside).length)
        throw Error('A ruined building trapped its occupant or granted warmth');
      return {
        groundChecks,
        checks,
        hallChecks,
        sheltered,
        saved: true,
        blockedDoor: true,
        nightReturn: true,
        resumedWork: true,
        ruinedExit: true,
      };
    });
    console.log(JSON.stringify(result));
    for (const check of result.checks) {
      assert.equal(check.inside, true);
      assert.equal(check.wallSolid, true);
      assert.equal(check.doorOpen, true);
    }
    assert.equal(result.sheltered, true);
    assert.ok(result.groundChecks.every((check) => check.vertices > 0));
    assert.ok(result.groundChecks.some((check) => check.slope > 0.1));
    await page.evaluate(() => {
      const world = Vinland.world;
      VinlandCheats.configure(Vinland.simulation, { enabled: true });
      VinlandCheats.setWeather(Vinland.simulation, 'fair');
      VinlandCheats.setHour(Vinland.simulation, 12);
      world.focus(0, 0, 42);
      world.distance = 42;
      world.polar = 1;
      world.updateProjection();
      world.updateCamera(1);
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: '/tmp/vinland-turf-ground-contact.png' });
    await page.evaluate(() => {
      const world = Vinland.world;
      const leader = Vinland.simulation.state.leader;
      const person = Vinland.simulation.state.people[leader.id];
      Object.assign(leader, { x: 8, z: -1.5, heading: -Math.PI / 2 });
      Object.assign(person, { x: leader.x, z: leader.z });
      world.agentPositions.set(leader.id, { x: leader.x, z: leader.z });
      world.setView('walk');
      world.walkPitch = 0.12;
      world.updateCamera(1);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/vinland-turf-ground-contact-walk.png' });
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
