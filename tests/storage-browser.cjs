const { startDefaultCampaign } = require('./browser-session.cjs');
/** Real warehouse doors, worker hauling, inventory UI and offline save/load. */
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
      Vinland.setPaused(true);
      Vinland.view('walk');
      const sim = Vinland.simulation,
        world = Vinland.world,
        Storage = VinlandStorage;
      window.standWithSupplies = (point) => {
        Object.assign(sim.state.leader, point);
        Object.assign(sim.state.people[0], point);
        world.agentPositions.set(0, { ...point });
        world.actorCollisions.set('person:0', { ...point, radius: 0.34 });
        world.previousWalkPose = world.currentWalkPose = null;
        world.update(0);
      };
      world.update(0);
      const store = sim.state.storage.stores.camp;
      const pile = Storage.resourcePiles(sim.state, store).find((p) => p.resource === 'hay');
      if (!pile) throw Error('Missing arrival hay');
      const candidates = [
        { x: pile.x, z: pile.z + pile.d / 2 + 0.6 },
        { x: pile.x, z: pile.z - pile.d / 2 - 0.6 },
        { x: pile.x + pile.w / 2 + 0.6, z: pile.z },
        { x: pile.x - pile.w / 2 - 0.6, z: pile.z },
      ];
      const point = candidates.find(
        (p) =>
          world.actorClearAt(p.x, p.z, 0.34, 'person:0') &&
          world.canReachSupply(p, pile) &&
          VinlandSupplies.nearest(sim, { ...sim.state.people[0], ...p })?.pile.id === pile.id,
      );
      if (!point) throw Error('Arrival pile not reachable');
      standWithSupplies(point);
      window.manualSource = { id: pile.id, before: pile.amount };
      Vinland.app.supplyControls.update();
    });
    await page.waitForFunction(
      () => document.querySelector('#supply-button').textContent === 'G · Take hay',
    );
    await page.keyboard.press('g');
    assert.equal(await page.evaluate(() => Vinland.simulation.state.people[0].cargo?.amount), 15);
    await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world;
      const pile = VinlandStorage.resourcePiles(sim.state, sim.state.storage.stores.camp).find(
        (p) => p.id === manualSource.id,
      );
      if (Math.abs(pile.amount - (manualSource.before - 15)) > 1e-7)
        throw Error('Wrong arrival pile shrank');
      if (!VinlandModel.Simulation.load(sim.serialize()))
        throw Error('Manual cargo failed save/load');
      let chosen = null;
      world.walkYaw = 0;
      for (let x = 35; x < 85 && !chosen; x += 5)
        for (let z = 35; z < 85 && !chosen; z += 5) {
          const person = { ...sim.state.people[0], x, z };
          if (world.canPlaceSupply(person, { x, z: z + 2 })) chosen = { x, z };
        }
      if (!chosen) throw Error('No clear ground fixture');
      standWithSupplies(chosen);
      const target = world.supplyPlacement(sim.state.people[0], sim.state.people[0].cargo);
      if (!target.point) throw Error('Expected ground placement: ' + JSON.stringify(target));
    });
    await page.waitForFunction(() =>
      document.querySelector('#supply-button').textContent.includes('Place'),
    );
    await page.keyboard.press('g');
    assert.equal(await page.evaluate(() => Vinland.simulation.state.people[0].cargo), null);
    const placed = await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world;
      const store = Object.values(sim.state.storage.stores).find((s) => s.id.startsWith('hand:'));
      const pile = VinlandStorage.resourcePiles(sim.state, store)[0];
      return { amount: store.stock.hay, visible: world.resourcePileMarkers.has(pile.id) };
    });
    assert.deepEqual(placed, { amount: 15, visible: true });
    await page.waitForFunction(
      () => document.querySelector('#supply-button').textContent === 'G · Take hay',
    );
    await page.keyboard.press('g');
    assert.equal(await page.evaluate(() => Vinland.simulation.state.people[0].cargo.amount), 15);
    assert.equal(
      await page.evaluate(
        () =>
          Object.values(Vinland.simulation.state.storage.stores).find((s) =>
            s.id.startsWith('hand:'),
          ).stock.hay,
      ),
      0,
    );
    const manualStore = await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world,
        Spaces = VinlandBuildingSpaces;
      const type = 'storehouse',
        definition = VinlandModel.TYPES[type];
      const building = {
        id: sim.state.nextId++,
        type,
        x: 70,
        z: 60,
        rotation: 0.73,
        condition: 100,
        hours: definition.hours,
        progress: definition.hours,
        cost: { ...definition.cost },
        sailShip: null,
      };
      sim.state.buildings.push(building);
      world.sync();
      const store = sim.state.storage.stores['building:' + building.id];
      const bay = VinlandStorage.supplyBays(sim.state, store, 'hay').at(-1);
      const point = Spaces.toWorld(bay, { x: -bay.side * (bay.w / 2 + 0.55), z: 0 });
      standWithSupplies(point);
      const target = world.supplyPlacement(sim.state.people[0], sim.state.people[0].cargo);
      if (target.pileId !== bay.id) throw Error('Wrong indoor target: ' + JSON.stringify(target));
      const door = world.doorControls.entries.get(store.id).door;
      const outside = Spaces.toWorld(door, { x: 0, z: 0.65 });
      const inside = {
        ...Spaces.toWorld(door, { x: 0, z: -0.65 }),
        w: 0.1,
        d: 0.1,
        rotation: door.rotation,
      };
      if (world.canReachSupply(outside, inside)) throw Error('Hand transfer crossed closed door');
      world.doorControls.setOpen(door.id, true);
      if (!world.canReachSupply(outside, inside)) throw Error('Open doorway blocked transfer');
      const acrossWall = Spaces.toWorld(building, { x: definition.w / 2 + 0.5, z: -2 });
      const behindWall = {
        ...Spaces.toWorld(building, { x: definition.w / 2 - 0.5, z: -2 }),
        w: 0.1,
        d: 0.1,
      };
      if (world.canReachSupply(acrossWall, behindWall)) throw Error('Hand transfer crossed wall');
      return { id: store.id, pileId: bay.id };
    });
    await page.waitForFunction(() =>
      document.querySelector('#supply-button').textContent.includes('Store'),
    );
    await page.keyboard.press('g');
    assert.equal(await page.evaluate(() => Vinland.simulation.state.people[0].cargo), null);
    assert.equal(
      await page.evaluate(({ id, pileId }) => {
        const sim = Vinland.simulation,
          piles = VinlandStorage.resourcePiles(sim.state, sim.state.storage.stores[id]);
        return (
          piles.length === 1 &&
          piles[0].id === pileId &&
          piles[0].amount === 15 &&
          Vinland.world.resourcePileMarkers.has(pileId)
        );
      }, manualStore),
      true,
    );
    await page.keyboard.press('g');
    assert.equal(await page.evaluate(() => Vinland.simulation.state.people[0].cargo?.amount), 15);
    await page.evaluate(() => Vinland.view('district'));
    await page.waitForFunction(() => document.querySelector('#supply-button').hidden);
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      'Manual supplies: arrival pickup, exact pile, visible ground placement, indoor bay, doors, walls, save/load and contextual controls passed.',
    );
    if (process.env.VINLAND_MANUAL_SUPPLIES_ONLY) return;
    await page.reload();
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const storeId = await page.evaluate(() => {
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        world = Vinland.world;
      Object.assign(sim.state.resources, { timber: 100, turf: 100, stone: 20, iron: 100 });
      const site = sim.order('storehouse', 70, 60, 0.73);
      if (!site) throw Error('No warehouse fixture');
      sim.state.queue = sim.state.queue.filter((order) => order.id !== site.id);
      sim.state.buildings.push({ ...site, progress: site.hours, condition: 100 });
      world.sync();
      sim.state.resources.firewood = 0;
      const storeId = 'building:' + site.id;
      VinlandStorage.deposit(sim.state, storeId, 'firewood', 100);
      const space = world.usableSpaces().find((space) => space.spaceId === storeId);
      const person = sim.state.people[1];
      const point = world.indoorTarget(space, person);
      if (!point) throw Error('No warehouse route');
      Object.assign(person, point);
      world.agentPositions.set(1, { ...point });
      world.actorCollisions.set('person:1', { ...point, radius: 0.34 });
      Vinland.app.workerControls.select([1]);
      sim.state.time = 8;
      return storeId;
    });
    await page.locator('[data-worker-action="work-menu"]').click();
    await page.locator('[data-worker-action="supply-camp"]').click();
    const transfer = await page.evaluate((storeId) => {
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        world = Vinland.world,
        person = sim.state.people[1];
      if (person.order.type !== 'haul') throw Error('Supply camp did not assign a hauler');
      world.paused = false;
      sim.advanceRealtime(45, world);
      if (sim.state.storage.stores.camp.stock.firewood !== 0)
        throw Error('Camp credited before delivery');
      if (!person.cargo)
        throw Error('No physical cargo after pickup: ' + JSON.stringify(person.order));
      world.animatePeople(0.1, world.elapsed);
      const carried = world.people[1].children.find(
        (child) => child.name === 'carried-firewood',
      )?.visible;
      const inTransit = sim.state.resources.firewood + person.cargo.amount;
      if (!VinlandModel.Simulation.load(sim.serialize()))
        throw Error('In-transit save did not load');
      for (
        let seconds = 0;
        seconds < 480 && !(sim.state.storage.stores.camp.stock.firewood > 0);
        seconds++
      )
        sim.advanceRealtime(1, world);
      world.paused = true;
      const delivered = sim.state.storage.stores.camp.stock.firewood;
      if (!(delivered > 0))
        throw Error('No camp delivery: ' + JSON.stringify({ person, route: world.routes.get(1) }));
      sim.commandWorkers([1], { type: 'stop' });
      const total = sim.state.resources.firewood;
      const saved = VinlandModel.Simulation.load(sim.serialize());
      if (
        !saved ||
        saved.state.storage.stores[storeId].stock.firewood !==
          sim.state.storage.stores[storeId].stock.firewood
      )
        throw Error('Inventory save mismatch');
      return {
        carried,
        delivered,
        inTransit,
        total,
        store: sim.state.storage.stores[storeId].stock.firewood,
      };
    }, storeId);
    assert.equal(transfer.carried, true);
    assert.equal(transfer.inTransit, 100);
    assert.equal(transfer.total, 100);
    await page.locator('.command-strip [data-action="settlement"]').click();
    await page.locator('.window-tabs [data-action="stocks"]').click();
    await page.locator(`[data-action="inventory"][data-store="${storeId}"]`).click();
    assert.match(await page.locator('#modal-content').innerText(), /firewood/);
    assert.match(await page.locator('#modal-content').innerText(), /Reserved for sites/);
    await page.screenshot({ path: '/tmp/vinland-building-inventory.png' });
    await page.keyboard.press('Escape');
    const piles = await page.evaluate((storeId) => {
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        world = Vinland.world,
        Storage = VinlandStorage;
      const store = sim.state.storage.stores[storeId];
      const person = sim.state.people[1];
      const space = world.usableSpaces().find((entry) => entry.spaceId === storeId);
      sim.commandWorkers([1], { type: 'stop' });
      world.sync();
      const pileId = Storage.resourcePiles(sim.state, store).find(
        (pile) => pile.resource === 'firewood',
      ).id;
      const before = world.resourcePileMarkers.get(pileId);
      if (!before || !before.children[0].isInstancedMesh)
        throw Error('No visible indoor wood pieces');
      const oldVolume = before.userData.pile.occupied;
      const original = Storage.storedAmount(sim.state, store, 'firewood');
      const outside = VinlandBuildingSpaces.toWorld(space, { x: 0, z: space.plan.outside.z + 1 });
      Object.assign(person, outside);
      world.agentPositions.set(1, { ...outside });
      world.actorCollisions.set('person:1', { ...outside, radius: 0.34 });
      sim.commandWorkers([1], { type: 'gather', resource: 'firewood', x: 80, z: 80 });
      person.cargo = { resource: 'firewood', amount: 15, moisture: 0.5 };
      world.doorControls.setOpen(storeId, false);
      const destination = world.deliveryPoint('firewood', person);
      if (destination?.id !== storeId || world.spaceAt(destination)?.spaceId !== storeId)
        throw Error('Gatherer did not choose the indoor wood pile');
      world.paused = false;
      let opened = false,
        entered = false,
        handoff = false,
        deposited = false;
      for (let seconds = 0; seconds < 300 && !deposited; seconds += 0.1) {
        sim.advanceRealtime(0.1, world);
        opened ||= VinlandDoors.isOpen(sim.state, storeId);
        entered ||= world.spaceAt(person)?.spaceId === storeId;
        if (
          person.order.phase === 'unloading' &&
          person.order.unloadSeconds > 59.4 &&
          person.cargo
        ) {
          world.animatePeople(0.1, world.elapsed);
          handoff ||= world.people[1].getObjectByName('carried-firewood').position.length() > 0.1;
        }
        deposited = (store.stock.firewood || 0) > original;
      }
      world.paused = true;
      // Both presentation updates run in one frame: no frame may hide the
      // carrier's wood without displaying the newly deposited stack volume.
      world.update(0);
      const after = world.resourcePileMarkers.get(pileId);
      if (!deposited || !opened || !entered || !handoff)
        throw Error(
          'Incomplete physical delivery: ' +
            JSON.stringify({ person, opened, entered, handoff, deposited }),
        );
      if (world.people[1].getObjectByName('carried-firewood').visible)
        throw Error('Delivered wood still shown on the carrier');
      if (
        Math.abs(after.userData.pile.occupied - oldVolume - Storage.volume('firewood', 15)) > 1e-8
      )
        throw Error('Destination pile did not gain the carried wood');
      const stock = store.stock.firewood;
      const loaded = VinlandModel.Simulation.load(sim.serialize());
      if (
        !loaded ||
        JSON.stringify(
          Storage.resourcePiles(loaded.state, loaded.state.storage.stores[storeId]),
        ) !== JSON.stringify(Storage.resourcePiles(sim.state, store))
      )
        throw Error('Visible pile changed across save/load');
      Storage.withdraw(sim.state, storeId, 'firewood', stock);
      world.update(0);
      if (world.resourcePileMarkers.has(pileId)) throw Error('Empty wood pile remains visible');
      const camp = sim.state.storage.stores.camp;
      camp.stock.firewood = 15;
      world.update(0);
      const outdoor = Storage.resourcePiles(sim.state, camp).find(
        (pile) => pile.resource === 'firewood',
      );
      if (!outdoor || outdoor.indoor || !world.resourcePileMarkers.has(outdoor.id))
        throw Error('No visible outdoor wood pile');
      if (world.actorClearAt(outdoor.x, outdoor.z, 0.34, 'person:1'))
        throw Error('Actors can pass through wood piles');
      const location = { x: outdoor.x, z: outdoor.z };
      camp.stock.firewood = 30;
      world.update(0);
      const grown = Storage.resourcePiles(sim.state, camp).find(
        (pile) => pile.resource === 'firewood',
      );
      if (
        grown.x !== location.x ||
        grown.z !== location.z ||
        Math.abs(grown.occupied - Storage.volume('firewood', 30)) > 1e-8
      )
        throw Error('Outdoor pile moved instead of growing');
      camp.stock.firewood = 3000;
      world.update(0);
      const multiple = Storage.resourcePiles(sim.state, camp).filter(
        (pile) => pile.resource === 'firewood',
      );
      const pickup = world.resourceTransferPile(camp, 'firewood');
      if (multiple.length < 2 || pickup.id !== multiple[multiple.length - 1].id)
        throw Error('Worker would collect wood from a different pile than the one that shrinks');
      Storage.withdraw(sim.state, 'camp', 'firewood', 15);
      world.update(0);
      const smaller = Storage.resourcePiles(sim.state, camp).find((pile) => pile.id === pickup.id);
      if (Math.abs(pickup.occupied - smaller.occupied - Storage.volume('firewood', 15)) > 1e-8)
        throw Error('Collection shrank the wrong pile');
      return { opened, entered, handoff, indoorGain: 15, outdoorGain: 15 };
    }, storeId);
    assert.deepEqual(piles, {
      opened: true,
      entered: true,
      handoff: true,
      indoorGain: 15,
      outdoorGain: 15,
    });
    await page.evaluate(() => Vinland.app.workerControls.select([1]));
    await page.locator('[data-worker-action="work-menu"]').click();
    await page.locator('[data-worker-action="haul"]').click();
    assert.equal(await page.evaluate(() => Vinland.app.workerControls.mode), 'haul');
    const destination = await page.evaluate((storeId) => {
      const world = Vinland.world;
      const store = Vinland.simulation.state.storage.stores[storeId];
      world.focus(store.x, store.z, 75);
      world.distance = 75;
      world.updateProjection();
      world.updateCamera(1);
      world.camera.updateMatrixWorld(true);
      const point = world.project(store.x, world.actorElevation(store.x, store.z) + 3, store.z);
      const bounds = world.container.getBoundingClientRect();
      return { x: bounds.left + point.x, y: bounds.top + point.y };
    }, storeId);
    await page.mouse.click(destination.x, destination.y);
    assert.equal(
      await page.evaluate(() => Vinland.simulation.state.people[1].order?.destinationStoreId),
      storeId,
    );
    await page.keyboard.press('Escape');
    await page.evaluate(() => Vinland.app.workerControls.select([1]));
    const deliveredResources = await page.evaluate((storeId) => {
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        world = Vinland.world,
        Storage = VinlandStorage;
      const store = sim.state.storage.stores[storeId],
        person = sim.state.people[1];
      const space = world.usableSpaces().find((entry) => entry.spaceId === storeId);
      sim.commandWorkers([1], { type: 'stop' });
      for (const inventory of Object.values(sim.state.storage.stores))
        for (const key of Storage.KEYS) inventory.stock[key] = 0;
      world.update(0);
      const sourcePoint = VinlandBuildingSpaces.toWorld(space, {
        x: 0,
        z: space.plan.outside.z + 1,
      });
      const source = Storage.cache(sim.state, 'delivery-test', sourcePoint);
      const delivered = [];
      for (const resource of Storage.KEYS) {
        const amount = Storage.loadSize(resource);
        source.stock[resource] = amount;
        sim.commandWorkers([1], {
          type: 'haul',
          destinationStoreId: storeId,
          x: store.x,
          z: store.z,
        });
        Storage.withdraw(sim.state, source.id, resource, amount);
        person.cargo = { resource, amount, sourceStoreId: source.id, destinationStoreId: storeId };
        Object.assign(person, sourcePoint);
        world.agentPositions.set(1, { ...sourcePoint });
        world.actorCollisions.set('person:1', { ...sourcePoint, radius: 0.34 });
        world.doorControls.setOpen(storeId, false);
        world.paused = false;
        world.animatePeople(0.1, world.elapsed);
        if (!world.people[1].getObjectByName('carried-' + resource).visible)
          throw Error('Missing carried ' + resource);
        if (!VinlandModel.Simulation.load(sim.serialize()))
          throw Error('Invalid in-transit ' + resource + ' save');
        let entered = false;
        for (let seconds = 0; seconds < 240 && !(store.stock[resource] > 0); seconds += 0.25) {
          sim.advanceRealtime(0.25, world);
          entered ||= world.spaceAt(person)?.spaceId === storeId;
        }
        world.paused = true;
        world.update(0);
        const pile = Storage.resourcePiles(sim.state, store).find(
          (entry) => entry.resource === resource,
        );
        const marker = pile && world.resourcePileMarkers.get(pile.id);
        if (!entered || !marker || Math.abs(store.stock[resource] - amount) > 1e-8)
          throw Error(
            'Missing physical ' + resource + ' delivery: ' + JSON.stringify(person.order),
          );
        if (world.people[1].getObjectByName('carried-' + resource).visible)
          throw Error('Duplicate carried ' + resource);
        if (Math.abs(pile.occupied - Storage.volume(resource, amount)) > 1e-8)
          throw Error('Wrong occupied volume for ' + resource);
        if (resource === 'water') {
          const original = new THREE.Matrix4();
          marker.getObjectByName('Stored contents').getMatrixAt(0, original);
          Storage.withdraw(sim.state, storeId, resource, amount / 2);
          world.update(0);
          const reduced = new THREE.Matrix4();
          world.resourcePileMarkers
            .get(pile.id)
            .getObjectByName('Stored contents')
            .getMatrixAt(0, reduced);
          if (Math.abs(reduced.elements[5] * 2 - original.elements[5]) > 1e-6)
            throw Error('Water level did not fall with its quantity');
        }
        const loaded = VinlandModel.Simulation.load(sim.serialize());
        if (
          !loaded ||
          JSON.stringify(
            Storage.resourcePiles(loaded.state, loaded.state.storage.stores[storeId]),
          ) !== JSON.stringify(Storage.resourcePiles(sim.state, store))
        )
          throw Error('Stored ' + resource + ' changed across save/load');
        Storage.withdraw(sim.state, storeId, resource, store.stock[resource]);
        world.update(0);
        if (world.resourcePileMarkers.has(pile.id))
          throw Error('Consumed ' + resource + ' remained visible');
        delivered.push(resource);
      }
      return delivered;
    }, storeId);
    assert.equal(deliveredResources.length, 17);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-worker-action="work-menu"]').click();
    assert.equal(await page.locator('[data-worker-action="supply-camp"]').isVisible(), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(JSON.stringify({ ...transfer, deliveredResources }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
