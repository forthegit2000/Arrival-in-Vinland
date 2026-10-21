/** Real opening, explicit ferry orders, persistent manifests and empty shoreline. */
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startDefaultCampaign } = require('./browser-session.cjs');

async function checkUnloadingDestinations(page) {
  const { saved, initialTotals } = await page.evaluate(() => {
    // Complete passenger transport without rendering the crossing. The timed
    // workload below uses real navigation, collisions and the full expedition.
    const sim = new VinlandModel.Simulation();
    VinlandArrival.start(sim);
    VinlandArrival.leaderAshore(sim);
    for (let i = 0; i < 600 && VinlandArrival.aboard(sim.state.people[0]); i++)
      VinlandArrival.step(sim, 1);
    const speaker = sim.availablePeople.find(
      (p) => p.id !== 0 && !VinlandArrival.aboard(p) && !p.order,
    );
    VinlandArrival.requestLanding(sim, speaker.id, 'land');
    for (let i = 0; i < 12000 && sim.state.people.some((p) => p.order?.action === 'land'); i++)
      VinlandArrival.step(sim, 1);
    Vinland.replaceSimulation(sim);
    Vinland.setPaused(true);
    const world = Vinland.world;
    for (const person of sim.state.people.filter((p) => !VinlandArrival.aboard(p))) {
      Object.assign(person, world.arrivalAssemblyTarget(person.id));
      world.syncArrivalPerson(person);
    }
    const leader = sim.state.people[0];
    Object.assign(sim.state.leader, { x: leader.x, z: leader.z });
    world.update(0);
    if (sim.state.people.length !== 160 || sim.state.people.some((p) => p.order?.action === 'land'))
      throw Error('Full-expedition fixture did not finish landing');
    return {
      saved: sim.serialize(),
      initialTotals: Object.fromEntries(
        VinlandStorage.KEYS.map((resource) => [
          resource,
          VinlandStorage.total(sim.state, resource),
        ]),
      ),
    };
  });

  await page.evaluate(() => {
    const sim = Vinland.simulation,
      world = Vinland.world,
      person = sim.availablePeople.find((p) => p.id !== 0 && !VinlandArrival.aboard(p)),
      camp = sim.state.storage.stores.camp;
    VinlandArrival.order(sim, [person.id], 'unload');
    person.arrivalCarry = { resource: 'water', amount: 15 };
    const originalPath = world.path;
    let searches = 0;
    world.path = function (...args) {
      searches++;
      return originalPath.apply(this, args);
    };
    function destination() {
      const point = world.arrivalDropPoint('water', person);
      if (!point) throw Error('Expected a reachable unloading destination');
      return point;
    }
    function mustSearch(label, change) {
      destination();
      searches = 0;
      change();
      destination();
      if (!searches) throw Error(label + ' reused stale route validation');
    }
    try {
      const first = destination();
      if (!searches) throw Error('First delivery did not validate its route');
      searches = 0;
      for (let i = 0; i < 20; i++) destination();
      if (searches) throw Error('Unchanged destination repeated route searches');
      mustSearch('New load', () => (person.arrivalCarry = { resource: 'water', amount: 15 }));
      mustSearch('New order', () => (person.order = { ...person.order }));
      mustSearch('Changed building geometry', () => (world.geometrySignature += ':test'));
      mustSearch('Changed terrain', () => sim.state.harvest.revision++);
      mustSearch('Blocked movement', () => (person.arrivalBlocked = true));
      delete person.arrivalBlocked;

      const previous = destination();
      world.actorCollisions.set('test-unloading-obstruction', { ...previous, radius: 0.4 });
      const alternative = destination();
      if (Math.hypot(alternative.x - previous.x, alternative.z - previous.z) < 0.1)
        throw Error('Unloader reused an occupied destination');
      world.actorCollisions.remove('test-unloading-obstruction');

      // A moved pile must be found again even with the same resource and order.
      const plot = camp.resourcePlots.find((p) => p.resource === 'water');
      plot.x += 6;
      const moved = destination();
      if (Math.hypot(moved.x - first.x, moved.z - first.z) < 1)
        throw Error('Unloader kept delivering to the old pile location');
      camp.capacity = 0;
      if (world.arrivalDropPoint('water', person) !== null)
        throw Error('Unloader reused a destination in full storage');
    } finally {
      world.path = originalPath;
      world.actorCollisions.remove('test-unloading-obstruction');
    }
  });

  const runs = [];
  for (const reuse of [false, true]) {
    await page.evaluate(
      ({ saved, reuse }) => {
        Vinland.replaceSimulation(VinlandModel.Simulation.load(saved));
        Vinland.setPaused(true);
        const sim = Vinland.simulation,
          world = Vinland.world;
        world.update(0);
        const stats = { deliverySearches: 0, deliveryChecks: 0, milliseconds: 0 };
        world.unloadingTestStats = stats;
        const path = world.path,
          storagePoint = world.resourceStoragePoint;
        let checkingDestination = false;
        world.path = function (...args) {
          if (checkingDestination) stats.deliverySearches++;
          return path.apply(this, args);
        };
        world.resourceStoragePoint = function (...args) {
          stats.deliveryChecks++;
          checkingDestination = true;
          try {
            return storagePoint.apply(this, args);
          } finally {
            checkingDestination = false;
          }
        };
        if (!reuse) {
          // The previous implementation, as a control for the same workload.
          world.arrivalDropPoint = function (resource, person) {
            return this.resourceStoragePoint(sim.state.storage.stores.camp, resource, person, true);
          };
        }
        const speaker = sim.availablePeople.find((p) => !p.order && !VinlandArrival.aboard(p));
        if (!VinlandArrival.requestLanding(sim, speaker.id, 'unload').count)
          throw Error('Could not assign unloading helpers');
        const helpers = sim.state.people.filter((p) => p.order?.action === 'unload');
        const accessPoints = helpers.map((person) => world.arrivalPersonTarget(0, person.id));
        for (let i = 0; i < helpers.length; i++) {
          const person = helpers[i],
            point = accessPoints[i];
          if (
            !world.actorClearAt(point.x, point.z, 0.34, 'person:' + person.id) ||
            !world.path(person, point).length
          )
            throw Error('Unloading helper cannot reach its shore access point');
          for (let j = 0; j < i; j++)
            if (Math.hypot(point.x - accessPoints[j].x, point.z - accessPoints[j].z) < 1.5)
              throw Error('Unloading helpers share a crowded return point');
        }
      },
      { saved, reuse },
    );
    let deliverySave = null;
    for (let i = 0; i < 45; i++) {
      const currentDelivery = await page.evaluate((needsSave) => {
        const sim = Vinland.simulation,
          start = performance.now();
        sim.advanceRealtime(5, Vinland.world);
        Vinland.world.unloadingTestStats.milliseconds += performance.now() - start;
        if (
          needsSave &&
          sim.state.people.some(
            (p) =>
              p.arrivalCarry &&
              p.order?.storePoint &&
              Math.hypot(p.x - p.order.storePoint.x, p.z - p.order.storePoint.z) > 1,
          )
        )
          return sim.serialize();
        return null;
      }, reuse && !deliverySave);
      deliverySave ||= currentDelivery;
    }
    const result = await page.evaluate(() => {
      const sim = Vinland.simulation;
      return {
        ...Vinland.world.unloadingTestStats,
        delivered: sim.state.storage.stores.camp.stock,
        totals: Object.fromEntries(
          VinlandStorage.KEYS.map((resource) => [
            resource,
            VinlandStorage.total(sim.state, resource) +
              sim.state.people.reduce(
                (sum, p) =>
                  sum + (p.arrivalCarry?.resource === resource ? p.arrivalCarry.amount : 0),
                0,
              ),
          ]),
        ),
        valid: !!VinlandModel.Simulation.load(sim.serialize()),
      };
    });
    assert.equal(result.valid, true, 'Full-expedition unloading save');
    assert.ok(
      Object.values(result.delivered).some((amount) => amount > 0),
      'Cargo reaches shore',
    );
    for (const key of Object.keys(initialTotals))
      assert.ok(Math.abs(initialTotals[key] - result.totals[key]) < 1e-6, key + ' conserved');
    if (reuse) assert.ok(deliverySave, 'Workload includes a delivery in progress');
    runs.push({ ...result, deliverySave });
  }
  const [before, after] = runs;
  assert.ok(after.deliveryChecks > 20, 'Regression exercises repeated destination checks');
  // Count expensive operations instead of imposing a machine-dependent FPS or
  // elapsed-time limit. Different routes may produce different delivery timing.
  assert.ok(
    after.deliverySearches < before.deliverySearches * 0.25,
    JSON.stringify({ before: before.deliverySearches, after: after.deliverySearches }),
  );
  await page.evaluate((saved) => {
    const loaded = VinlandModel.Simulation.load(saved);
    Vinland.replaceSimulation(loaded);
    Vinland.setPaused(true);
    const sim = Vinland.simulation,
      world = Vinland.world,
      person = sim.state.people.find(
        (p) =>
          p.arrivalCarry &&
          p.order?.storePoint &&
          Math.hypot(p.x - p.order.storePoint.x, p.z - p.order.storePoint.z) > 1,
      );
    if (!person) throw Error('Expected an in-progress delivery to reload');
    const originalPath = world.path;
    let searches = 0;
    world.path = function (...args) {
      searches++;
      return originalPath.apply(this, args);
    };
    try {
      if (!world.arrivalDropPoint(person.arrivalCarry.resource, person) || !searches)
        throw Error('Loaded delivery did not validate its route again');
    } finally {
      world.path = originalPath;
    }
    sim.advanceRealtime(60, world);
    if (!VinlandModel.Simulation.load(sim.serialize()))
      throw Error('Resumed unloading save rejected');
  }, after.deliverySave);
  console.log('Unloading destination invalidation and full-expedition regression passed:', {
    before: { searches: before.deliverySearches, milliseconds: before.milliseconds },
    after: { searches: after.deliverySearches, milliseconds: after.milliseconds },
  });
}

async function completeArrivalOnFoot(page) {
  // A smaller manifest and finite cargo keep the full physical trip/labour
  // regression practical. The opening above still checks the real 160 people.
  await page.evaluate(() => {
    const sim = new VinlandModel.Simulation({
      population: 16,
      children: 0.25,
      tents: 1,
      cattle: 1,
      sheep: 1,
      goats: 1,
    });
    VinlandArrival.start(sim);
    for (let i = 0; i < 4; i++) sim.state.storage.stores['ship:' + i].stock = { water: 40 };
    Object.assign(sim.state.storage.stores['ship:0'].stock, { iron: 15, grain: 15 });
    sim.state.storage.stores['ship:3'].stock.hay = 8;
    Vinland.replaceSimulation(sim);
    Vinland.setPaused(true);
  });
  async function advanceUntil(stage, maxBatches) {
    for (let i = 0; i < maxBatches; i++) {
      const result = await page.evaluate((stage) => {
        const sim = Vinland.simulation,
          w = Vinland.world;
        if (w.view !== 'walk') throw Error('The walk-only arrival changed view');
        sim.advanceRealtime(60, w);
        w.update(0);
        const arrival = sim.state.arrival;
        const done = {
          scout: !VinlandArrival.aboard(sim.state.people[0]),
          passengers: sim.state.people.every(
            (p) => p.id === arrival.ferry.workerId || !VinlandArrival.aboard(p),
          ),
          cargo:
            Object.values(sim.state.storage.stores)
              .filter((s) => ['ship', 'ferry'].includes(s.type))
              .every((s) => Object.values(s.stock).every((n) => n < 1e-7)) &&
            !sim.state.people.some((p) => p.arrivalCarry) &&
            arrival.tents.every((t) => !['packed', 'transit'].includes(t.status)),
          animals: arrival.animals.every((a) => a.shipId === null),
          tent: arrival.tents.every((t) => t.status === 'pitched'),
        };
        return {
          done: done[stage],
          valid: !!VinlandModel.Simulation.load(sim.serialize()),
          ferry: arrival.ferry,
          remaining: Object.values(sim.state.storage.stores)
            .filter((store) => ['ship', 'ferry'].includes(store.type))
            .map((store) => ({ id: store.id, stock: store.stock })),
          orders: sim.state.people
            .filter((p) => p.order)
            .map((p) => ({
              id: p.id,
              position: { x: p.x, z: p.z },
              order: p.order,
              load: p.arrivalCarry,
            })),
        };
      }, stage);
      assert.equal(result.valid, true, stage + ' save');
      if (result.done) return;
      if (i === maxBatches - 1) assert.fail(stage + ' did not finish: ' + JSON.stringify(result));
    }
  }
  async function speakToAnAdult() {
    await page.evaluate(() => {
      const sim = Vinland.simulation,
        w = Vinland.world,
        leader = sim.state.leader;
      for (const person of sim.presentPeople.filter(
        (p) => p.id !== leader.id && p.age >= 16 && !VinlandArrival.aboard(p),
      )) {
        for (let angle = 0; angle < 8; angle++) {
          const point = {
            x: person.x + Math.sin((angle * Math.PI) / 4) * 1.1,
            z: person.z + Math.cos((angle * Math.PI) / 4) * 1.1,
          };
          if (!w.actorClearAt(point.x, point.z, 0.34, 'person:' + leader.id)) continue;
          Object.assign(leader, point);
          Object.assign(sim.state.people[leader.id], point);
          w.syncArrivalPerson(sim.state.people[leader.id]);
          w.previousWalkPose = w.currentWalkPose = null;
          if (w.nearby()?.type === 'person' && sim.state.people[w.nearby().id].age >= 16) return;
        }
      }
      throw Error('No adult can be approached');
    });
    await page.keyboard.press('e');
    assert.equal(await page.locator('#walk-conversation').isVisible(), true);
  }
  await page.keyboard.press('e');
  await advanceUntil('scout', 4);
  await speakToAnAdult();
  assert.equal(await page.locator('[data-conversation="arrival-land"]').isVisible(), true);
  assert.equal(await page.locator('[data-conversation="arrival-livestock"]').isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scale of [1, 1.3]) {
    await page.evaluate(
      (scale) => document.documentElement.style.setProperty('--text-scale', scale),
      scale,
    );
    const layout = await page.locator('#walk-conversation').evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        box: box.toJSON(),
        fits:
          box.left >= 0 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight &&
          [...element.querySelectorAll('button:not([hidden])')].every(
            (button) => button.getBoundingClientRect().width <= box.width,
          ),
      };
    });
    assert.equal(
      layout.fits,
      true,
      'landing conversation fits mobile at ' + scale + ': ' + JSON.stringify(layout),
    );
  }
  await page.evaluate(() => document.documentElement.style.setProperty('--text-scale', 1));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.screenshot({ path: '/tmp/vinland-walk-landing-orders.png' });
  await page.keyboard.press('Digit1');
  assert.equal(await page.locator('#walk-conversation').isVisible(), false);
  await advanceUntil('passengers', 30);
  console.log('Walk-only: all passengers, including children, landed.');
  await speakToAnAdult();
  await page.keyboard.press('Digit2');
  assert.equal(await page.locator('#walk-conversation').isVisible(), false);
  await advanceUntil('cargo', 50);
  console.log('Walk-only: all supplies and tent equipment delivered.');
  await speakToAnAdult();
  await page.keyboard.press('Digit3');
  assert.equal(await page.locator('#walk-conversation').isVisible(), false);
  await advanceUntil('animals', 18);
  await speakToAnAdult();
  await page.keyboard.press('Digit4');
  assert.equal(await page.locator('#walk-conversation').isVisible(), false);
  assert.equal(await page.evaluate(() => Vinland.app.conversation.placingTent), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => Vinland.world.walkTentPreview), null);
  assert.equal(
    await page.evaluate(() =>
      Vinland.simulation.state.people.some((p) => p.order?.action === 'pitch'),
    ),
    false,
  );
  await speakToAnAdult();
  await page.keyboard.press('Digit4');
  await page.evaluate(() => {
    const sim = Vinland.simulation,
      w = Vinland.world,
      landing = sim.state.arrival.landing;
    for (let x = -16; x <= 28; x += 4)
      for (let z = -24; z <= 24; z += 4) {
        const site = { x: landing.x + x, z: landing.z + z };
        if (!w.canPitchArrivalTent(site)) continue;
        const stance = { x: site.x, z: site.z - 8 };
        if (!w.actorClearAt(stance.x, stance.z, 0.34, 'person:0')) continue;
        const helpers = sim.availablePeople.filter((p) => !p.order && !VinlandArrival.aboard(p));
        if (
          !helpers.some(
            (p) =>
              w.path(p, { x: site.x + 2.8, z: site.z + ((p.id % 5) - 2) * 1.05 }, 'person:' + p.id)
                .length,
          )
        )
          continue;
        Object.assign(sim.state.leader, stance);
        Object.assign(sim.state.people[0], stance);
        w.syncArrivalPerson(sim.state.people[0]);
        w.walkYaw = 0;
        w.previousWalkPose = w.currentWalkPose = null;
        w.updateWalkTentPlacement();
        return;
      }
    throw Error('No reachable walk placement fixture');
  });
  assert.equal(await page.evaluate(() => Vinland.world.walkTentPlacement.valid), true);
  await page.keyboard.press('e');
  assert.equal(await page.evaluate(() => Vinland.app.conversation.placingTent), false);
  assert.equal(await page.evaluate(() => Vinland.world.walkTentPreview), null);
  await page.evaluate(() => {
    const loaded = VinlandModel.Simulation.load(Vinland.simulation.serialize());
    if (!loaded) throw Error('Walk tent order save rejected');
    Vinland.replaceSimulation(loaded);
    Vinland.setPaused(true);
  });
  await advanceUntil('tent', 135);
  const result = await page.evaluate(() => ({
    view: Vinland.world.view,
    shelter: Vinland.simulation.shelter,
    childrenAshore: Vinland.simulation.state.people
      .filter((p) => p.age < 16)
      .every((p) => !VinlandArrival.aboard(p)),
    valid: !!VinlandModel.Simulation.load(Vinland.simulation.serialize()),
  }));
  assert.deepEqual(result, { view: 'walk', shelter: 8, childrenAshore: true, valid: true });
  console.log('Walk-only arrival completed: people, cargo, livestock, tent labour and save/load.');
}
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1512, height: 982 } }),
      errors = [],
      requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route(/^https?:/, (r) => {
      requests.push(r.request().url());
      return r.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page, { arrival: true });
    if (process.env.WALK_ARRIVAL_ONLY) {
      await completeArrivalOnFoot(page);
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
      return;
    }
    await page.evaluate(() => Vinland.setPaused(true));
    const opening = await page.evaluate(() => {
      const sim = Vinland.simulation,
        w = Vinland.world;
      w.update(0);
      return {
        aboard: sim.state.people.filter((p) => Number.isInteger(p.arrivalShip)).length,
        tents: w.tents.filter((t) => t.visible).length,
        livestock: sim.state.arrival.animals.filter((a) => a.shipId === 3).length,
        shorePiles: w.resourcePileMarkers.size,
        view: w.view,
        shelter: sim.shelter,
        valid: !!VinlandModel.Simulation.load(sim.serialize()),
        errors: document.querySelector('#error-message').textContent,
      };
    });
    assert.deepEqual(
      { ...opening, errors: '' },
      {
        aboard: 160,
        tents: 0,
        livestock: 32,
        shorePiles: 0,
        view: 'walk',
        shelter: 0,
        valid: true,
        errors: '',
      },
    );
    await page.waitForFunction(
      () => document.querySelector('#interact-button').textContent === 'E · Go ashore',
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/vinland-arrival-aboard.png' });
    await page.keyboard.press('e');
    const crossing = await page.evaluate(() => {
      const sim = Vinland.simulation;
      sim.advanceRealtime(35, Vinland.world);
      const phase = sim.state.arrival.ferry.phase;
      const loaded = VinlandModel.Simulation.load(sim.serialize());
      if (!loaded) throw Error('Crossing save rejected');
      Vinland.replaceSimulation(loaded);
      Vinland.setPaused(true);
      return phase;
    });
    assert.equal(crossing, 'outbound');
    const scout = await page.evaluate(() => {
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        w = Vinland.world;
      sim.advanceRealtime(180, w);
      w.update(0.1);
      const leader = sim.state.people[0];
      return {
        ashore: leader.arrivalShip === null && !leader.arrivalFerry,
        landed: sim.state.people.filter((p) => !VinlandArrival.aboard(p)).length,
        livestock: sim.state.arrival.animals.filter((a) => a.shipId === 3).length,
        hall: sim.state.arrival.hallDiscovered,
        valid: !!VinlandModel.Simulation.load(sim.serialize()),
      };
    });
    assert.equal(scout.ashore, true, JSON.stringify({ scout, errors }));
    assert.equal(scout.landed, 2);
    assert.equal(scout.livestock, 32);
    assert.equal(scout.hall, false);
    assert.equal(scout.valid, true);
    const unload = await page.evaluate(() => {
      const sim = Vinland.simulation,
        w = Vinland.world;
      const worker = sim.state.people.find((p) => p.id !== 0 && !VinlandArrival.aboard(p));
      Vinland.view('district');
      Vinland.setPaused(true);
      Vinland.app.workerControls.select([worker.id]);
      return worker.id;
    });
    await page.locator('[data-worker-action="arrival-unload"]').click();
    const cargo = await page.evaluate(() => {
      const sim = Vinland.simulation,
        w = Vinland.world;
      for (let i = 0; i < 180 && !(sim.state.storage.stores.camp.stock.iron > 0); i++)
        sim.advanceRealtime(2, w);
      w.update(0.1);
      return {
        stock: { ...sim.state.storage.stores.camp.stock },
        tents: sim.state.arrival.tents.filter((t) => t.status === 'landed').length,
        visible: w.resourcePileMarkers.size,
        order: sim.state.people.find((p) => p.order?.action === 'unload')?.order,
        valid: !!VinlandModel.Simulation.load(sim.serialize()),
      };
    });
    assert.ok(cargo.stock.iron > 0, JSON.stringify({ cargo, errors }));
    assert.ok(cargo.visible > 0);
    assert.ok(cargo.tents > 0);
    assert.equal(cargo.valid, true);
    console.log('Opening, crossing save and cargo delivery passed.');
    await page.evaluate(() => {
      const sim = Vinland.simulation;
      const loaded = VinlandModel.Simulation.load(sim.serialize());
      if (!loaded) throw Error('Save rejected');
      Vinland.replaceSimulation(loaded);
      Vinland.setPaused(true);
    });
    const passengers = await page.evaluate(() => {
      const sim = Vinland.simulation;
      const ids = sim.state.people
        .filter((p) => p.arrivalShip === 3 && !p.arrivalFerry)
        .slice(0, 2)
        .map((p) => p.id);
      VinlandArrival.order(sim, ids, 'land');
      return ids;
    });
    for (let i = 0; i < 8; i++) {
      const landed = await page.evaluate((ids) => {
        const sim = Vinland.simulation;
        sim.advanceRealtime(60, Vinland.world);
        return ids.every((id) => !VinlandArrival.aboard(sim.state.people[id]));
      }, passengers);
      if (landed) break;
    }
    assert.equal(
      await page.evaluate(
        (ids) => ids.every((id) => !VinlandArrival.aboard(Vinland.simulation.state.people[id])),
        passengers,
      ),
      true,
    );
    console.log('Livestock handlers landed.');
    await page.evaluate((ids) => Vinland.app.workerControls.select(ids), passengers);
    await page.locator('[data-worker-action="arrival-livestock"]').click();
    for (let i = 0; i < 7; i++)
      await page.evaluate(() => Vinland.simulation.advanceRealtime(60, Vinland.world));
    const animals = await page.evaluate(() => {
      Vinland.world.update(0.1);
      const sim = Vinland.simulation;
      return {
        deployment: sim.state.arrival.deployment?.phase,
        landed: sim.state.arrival.animals.filter((a) => a.shipId === null).length,
        ramp: Vinland.world.arrivalGangway.visible,
        valid: !!VinlandModel.Simulation.load(sim.serialize()),
        orders: sim.state.people
          .filter((p) => p.order?.action === 'livestock')
          .map((p) => ({ x: p.x, z: p.z, status: p.order.status })),
      };
    });
    assert.equal(animals.deployment, 'unloading', JSON.stringify(animals));
    assert.ok(animals.landed > 0, JSON.stringify(animals));
    assert.equal(animals.ramp, true);
    assert.equal(animals.valid, true);
    console.log('Livestock unloading passed.');
    const tentSite = await page.evaluate((id) => {
      const sim = Vinland.simulation,
        w = Vinland.world,
        landing = sim.state.arrival.landing;
      for (let x = -12; x <= 24; x += 4)
        for (let z = -20; z <= 20; z += 4) {
          const site = { x: landing.x + x, z: landing.z + z };
          if (!w.canPitchArrivalTent(site)) continue;
          const worker = sim.state.people[id];
          const workPoint = { x: site.x + 2.8, z: site.z + ((id % 5) - 2) * 1.05 };
          if (!w.path(worker, workPoint, 'person:' + id).length) continue;
          VinlandArrival.order(sim, [id], 'pitch', site);
          return site;
        }
      throw Error('No tent site found');
    }, passengers[1]);
    for (let i = 0; i < 4; i++)
      await page.evaluate(() => Vinland.simulation.advanceRealtime(60, Vinland.world));
    const tentProgress = await page.evaluate((site) => {
      const sim = Vinland.simulation,
        w = Vinland.world;
      w.update(0.1);
      const tent = sim.state.arrival.tents.find((t) => Math.hypot(t.x - site.x, t.z - site.z) < 1);
      return {
        status: tent?.status,
        progress: tent?.progress,
        tent,
        site,
        shelter: sim.shelter,
        orders: sim.state.people
          .filter((p) => p.order?.action === 'pitch')
          .map((p) => ({ x: p.x, z: p.z, status: p.order.status })),
        valid: !!VinlandModel.Simulation.load(sim.serialize()),
      };
    }, tentSite);
    assert.equal(tentProgress.status, 'pitching', JSON.stringify(tentProgress));
    assert.ok(tentProgress.progress > 0);
    assert.equal(tentProgress.shelter, 0);
    assert.equal(tentProgress.valid, true);
    await checkUnloadingDestinations(page);
    await completeArrivalOnFoot(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      JSON.stringify({ opening, crossing, scout, cargo, animals, tentProgress, offline: true }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
