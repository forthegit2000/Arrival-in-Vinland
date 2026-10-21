const { startDefaultCampaign } = require('./browser-session.cjs');
/** Direct-file checks of worker selection, explicit orders and visible hauling. */
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
    const errors = [];
    const requests = [];
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
    assert.equal(await page.locator('#construction-palette').isVisible(), false);
    assert.equal(await page.evaluate(() => Vinland.simulation.assigned), 0);
    const idleMovement = await page.evaluate(() => {
      const world = Vinland.world;
      const before = world.people.map((person) => person.position.clone());
      world.paused = false;
      world.animatePeople(3, world.elapsed + 3);
      world.paused = true;
      return Math.max(...world.people.map((person, id) => person.position.distanceTo(before[id])));
    });
    assert.equal(idleMovement, 0);

    // Select actual rendered people with the pointer, including Shift-add.
    const people = await page.evaluate(() => {
      const world = Vinland.world;
      world.focus(0, 15, 110);
      world.distance = 110;
      world.updateProjection();
      world.updateCamera(1);
      world.camera.updateMatrixWorld(true);
      const rectangle = world.container.getBoundingClientRect();
      return world.people
        .map((object, id) => {
          const point = world.project(
            object.position.x,
            object.position.y + 0.9,
            object.position.z,
          );
          const x = point.x + rectangle.left;
          const y = point.y + rectangle.top;
          return {
            id,
            x,
            y,
            hit: Vinland.app.workerControls.hitPerson({ clientX: x, clientY: y }),
          };
        })
        .filter(
          (point) => point.id === point.hit && point.y > 110 && point.y < rectangle.bottom - 20,
        );
    });
    assert.ok(people.length >= 2);
    await page.mouse.click(people[0].x, people[0].y);
    assert.equal(await page.evaluate(() => Vinland.app.workerControls.selected.size), 1);
    await page.keyboard.down('Shift');
    await page.mouse.click(people[1].x, people[1].y);
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => Vinland.app.workerControls.selected.size), 2);

    // Left drag selects units; it no longer pans the district camera.
    const bounds = await page.locator('#world').boundingBox();
    const cameraBefore = await page.evaluate(() => Vinland.world.target.toArray());
    await page.mouse.move(bounds.x + 5, bounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 5, bounds.y + bounds.height - 5, { steps: 8 });
    await page.mouse.up();
    assert.ok(await page.evaluate(() => Vinland.app.workerControls.selected.size > 10));
    assert.deepEqual(await page.evaluate(() => Vinland.world.target.toArray()), cameraBefore);
    await page.evaluate(
      (ids) => Vinland.app.workerControls.select(ids),
      [people[0].id, people[1].id],
    );

    async function clickGround(point) {
      const pixel = await page.evaluate(({ x, z }) => {
        const world = Vinland.world;
        const p = world.project(x, VinlandModel.elevation(x, z, world.sim.state.config), z);
        const rect = world.container.getBoundingClientRect();
        return { x: p.x + rect.left, y: p.y + rect.top };
      }, point);
      await page.mouse.click(pixel.x, pixel.y);
    }

    await page.locator('[data-worker-action="move"]').click();
    const moveTarget = await page.evaluate(() => {
      const controls = Vinland.app.workerControls;
      const id = [...controls.selected][0];
      const origin = Vinland.world.agentPositions.get(id);
      for (let x = 35; x < 70; x += 5) {
        for (let z = 35; z < 70; z += 5) {
          if (Vinland.world.clearAt(x, z) && Vinland.world.path(origin, { x, z }).length)
            return { x, z };
        }
      }
      throw Error('No reachable move destination');
    });
    await clickGround(moveTarget);
    const moved = await page.evaluate(() => {
      const controls = Vinland.app.workerControls;
      const id = [...controls.selected][0];
      const world = Vinland.world;
      const before = world.people[id].position.clone();
      world.paused = false;
      Vinland.simulation.advanceRealtime(1, world);
      world.animatePeople(1, world.elapsed + 1);
      world.paused = true;
      return {
        type: Vinland.simulation.state.people[id].order?.type,
        distance: before.distanceTo(world.people[id].position),
      };
    });
    assert.equal(moved.type, 'move');
    assert.ok(moved.distance > 0.5);
    await page.locator('[data-worker-action="stop"]').click();
    assert.equal(
      await page.evaluate(() =>
        [...Vinland.app.workerControls.selected].every(
          (id) => !Vinland.simulation.state.people[id].order,
        ),
      ),
      true,
    );

    assert.equal(
      await page.locator('#crew-button, [data-action="crew"], [data-preset], [data-task]').count(),
      0,
    );
    for (const [label, task] of [
      ['Fishing', 'fishing'],
      ['Foraging', 'foraging'],
      ['Camp care', 'herding'],
    ]) {
      await page.getByRole('button', { name: 'Work', exact: true }).click();
      await page.getByRole('button', { name: label, exact: true }).click();
      const support = await page.evaluate((task) => {
        const selected = [...Vinland.app.workerControls.selected];
        const simulation = Vinland.simulation;
        return {
          count: simulation.roster()[task].length,
          selected: selected.length,
          onlySelected: simulation.availablePeople.every((person) =>
            selected.includes(person.id)
              ? person.order?.type === 'work' && person.order.task === task
              : !person.order,
          ),
        };
      }, task);
      assert.equal(support.count, support.selected);
      assert.equal(support.onlySelected, true);
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      assert.equal(
        await page.evaluate((task) => Vinland.simulation.roster()[task].length, task),
        0,
      );
    }
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.getByRole('button', { name: 'Crafting', exact: true }).click();
    assert.match(await page.locator('#toast').innerText(), /charcoal clamp/);
    assert.equal(await page.evaluate(() => Vinland.simulation.roster().craft.length), 0);
    await page.locator('[data-worker-action="work-back"]').click();

    for (const resource of ['timber', 'turf', 'firewood', 'hay']) {
      const label = resource === 'timber' ? 'logs' : resource;
      await page.getByRole('button', { name: 'Gather ' + label, exact: true }).click();
      const haul = await page.evaluate((resource) => {
        const simulation = Vinland.simulation;
        const world = Vinland.world;
        const ids = [...Vinland.app.workerControls.selected];
        const person = simulation.state.people[ids[0]];
        simulation.commandWorkers(ids.slice(1), { type: 'stop' });
        const target = world.findHarvestTarget(resource, person);
        if (!target) throw Error('No harvest target for ' + resource);
        const node = simulation.registerHarvestSource(target.source);
        Object.assign(person, { x: target.x, z: target.z });
        world.agentPositions.set(person.id, { x: target.x, z: target.z });
        world.actorCollisions.set('person:' + person.id, {
          x: target.x,
          z: target.z,
          radius: 0.34,
        });
        Object.assign(person.order, { x: target.x, z: target.z, nodeId: node.id });
        // The browser fixture starts near completion; the model tests cover full work durations.
        node.felled = node.kind === 'tree';
        if (resource === 'hay') {
          // Keep the delivery fixture dry; weather-dependent curing has model coverage.
          Object.defineProperty(simulation, 'weather', {
            configurable: true,
            get: () => ({
              name: 'CLEAR',
              rain: false,
              snow: false,
              gale: false,
              temp: 8,
              feels: 8,
              wind: 10,
              daylight: 16,
              factor: 1,
            }),
          });
          node.remaining = 0;
          node.dryHay = 7.2;
        }
        const amount = resource === 'hay' ? 7.2 : VinlandGathering.RULES[resource].load;
        if (node.kind === 'tree') Object.assign(node, VinlandGathering.treeBudget(node));
        node.processingHours = VinlandGathering.loadHours(node, resource, amount) - 0.00001;
        const before = simulation.state.flow.production[resource] || 0;
        let carried = false,
          unloaded = false;
        world.paused = false;
        for (let step = 0; step < 300; step++) {
          simulation.advanceRealtime(1, world);
          world.animatePeople(1, world.elapsed + step);
          const load = world.people[person.id].children.find(
            (child) => child.name === 'carried-' + resource,
          );
          carried ||= !!load?.visible;
          unloaded ||= person.order?.phase === 'unloading';
          if ((simulation.state.flow.production[resource] || 0) > before) break;
        }
        world.paused = true;
        world.sync();
        const loaded = VinlandModel.Simulation.load(simulation.serialize());
        return {
          carried,
          unloaded,
          gained: (simulation.state.flow.production[resource] || 0) > before,
          marked: !!world.harvestMeshes.get(node.id),
          saved: !!loaded,
        };
      }, resource);
      assert.deepEqual(
        haul,
        { carried: true, unloaded: true, gained: true, marked: true, saved: true },
        resource,
      );
      await page.locator('[data-worker-action="stop"]').click();
    }
    await page.evaluate(() => {
      Vinland.simulation.state.time = 8;
    });

    const storageRouting = await page.evaluate(() => {
      const simulation = Vinland.simulation;
      const world = Vinland.world;
      const source = Object.values(simulation.state.harvest.nodes).find(
        (node) => node.kind === 'tree',
      );
      const point = world.findActorPosition(source, 0.45, 'person:1');
      const person = { id: 1, ...point, order: {} };
      const camp = world.deliveryPoint('timber', person);
      const store = { id: 99999, type: 'woodshed', x: source.x + 6, z: source.z, condition: 100 };
      simulation.state.buildings.push(store);
      delete person.order.storePoint;
      const nearer = world.deliveryPoint('timber', person);
      simulation.state.buildings.pop();
      const fallback = world.deliveryPoint('timber', person);
      return {
        camp: camp.id,
        nearer: nearer.id,
        fallback: fallback.id,
        shortened:
          Math.hypot(nearer.x - point.x, nearer.z - point.z) <
          Math.hypot(camp.x - point.x, camp.z - point.z),
      };
    });
    assert.deepEqual(storageRouting, {
      camp: 'camp',
      nearer: 'building:99999',
      fallback: 'camp',
      shortened: true,
    });

    await page.locator('[data-worker-action="build"]').click();
    assert.equal(await page.locator('#construction-palette').isVisible(), true);
    await page.locator('[data-build="restore"]').click();
    const construction = await page.evaluate(() => {
      const simulation = Vinland.simulation;
      const order = simulation.state.queue.find((building) => building.type === 'restore');
      // This existing check measures onsite labor after supplies arrive.
      for (const material of Object.values(order.materials)) {
        material.delivered = material.required;
        material.reservations = [];
      }
      for (const person of simulation.availablePeople.filter(
        (person) => person.order?.buildingId === order.id,
      )) {
        person.x = person.order.x;
        person.z = person.order.z;
      }
      simulation.advanceConstruction(36000);
      simulation.emit();
      return {
        progress: order.progress,
        crew: simulation.crewDistribution().find((item) => item.q.id === order.id).assigned,
      };
    });
    assert.equal(construction.crew, 2);
    assert.equal(construction.progress, 20);
    await page.locator('[data-worker-action="back"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector('#worker-selection-summary')
        .textContent.includes('620 person-hours left'),
    );
    assert.match(
      await page.locator('#worker-selection-summary').innerText(),
      /620 person-hours left/,
    );
    await page.screenshot({ path: '/tmp/vinland-worker-orders.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const workerLayout = await page.locator('#worker-orders').evaluate((panel) => {
      const bounds = panel.parentElement.getBoundingClientRect();
      return [...panel.children]
        .filter((child) => child.getClientRects().length)
        .every((child) => {
          const rectangle = child.getBoundingClientRect();
          return rectangle.top >= bounds.top - 1 && rectangle.bottom <= bounds.bottom + 1;
        });
    });
    assert.equal(workerLayout, true);
    await page.locator('[data-worker-action="move"]').click();
    assert.equal(await page.locator('#controls-hint').isVisible(), true);
    assert.match(await page.locator('#controls-hint').innerText(), /Click ground/);
    const persistedMarks = await page.evaluate(() => {
      const simulation = VinlandModel.Simulation.load(Vinland.simulation.serialize());
      if (!simulation) throw Error('Physical gathering save did not load');
      Vinland.replaceSimulation(simulation);
      const world = Vinland.world;
      world.sync();
      let stumps = 0,
        patches = 0;
      for (const node of Object.values(simulation.state.harvest.nodes)) {
        const mark = world.harvestMeshes.get(node.id);
        if (node.kind === 'tree' && node.felled) {
          const tree = world.harvestSources.get(node.id);
          const matrix = new THREE.Matrix4();
          tree.crowns.getMatrixAt(tree.index * tree.crownsPerTree, matrix);
          if (matrix.elements[0] !== 0) throw Error('Saved tree grew back');
          if (mark) stumps++;
        } else if (['turf', 'hay'].includes(node.kind) && mark?.visible) patches++;
      }
      return { stumps, patches };
    });
    assert.ok(persistedMarks.stumps >= 1);
    assert.equal(persistedMarks.patches, 2);
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.evaluate(() => Vinland.view('walk'));
    for (const speed of [1, 3, 8]) {
      await page.locator('[data-speed="' + speed + '"]').click();
      assert.equal(await page.evaluate(() => Vinland.world.view), 'walk');
      assert.equal(await page.evaluate(() => Vinland.app.speed), speed);
      await page.evaluate(() => Vinland.setPaused(true));
    }
    await page.reload();
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    assert.equal(await page.locator('#construction-palette').isVisible(), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      'Worker orders passed: idle start, pointer/box selection, move, stop, forest/store haul cycle and specific 10-hour construction crews.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
