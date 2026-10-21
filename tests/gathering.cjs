const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../simulation.js');
const Gathering = require('../gathering.js');
const { activityLine } = require('../conversation.js');
const Timing = require('../work-timing.js');
const Storage = require('../storage.js');
const { navigation, placeWorkers, stockBuildingMaterials } = require('./work-fixtures.cjs');

function field(resource = 'turf', distance = 10, ids = [1]) {
  const simulation = new Simulation();
  const nav = navigation(simulation, distance);
  const order = ['freshFish', 'plants'].includes(resource)
    ? { type: 'work', task: resource === 'freshFish' ? 'fishing' : 'foraging' }
    : { type: 'gather', resource };
  simulation.commandWorkers(ids, { ...order, x: distance, z: 20 });
  placeWorkers(simulation);
  Object.defineProperty(simulation, 'weather', {
    configurable: true,
    get: () => ({ factor: 1, temp: 15, rain: false, feels: 15, wind: 10, daylight: 16 }),
  });
  for (const id of ids) {
    const person = simulation.state.people[id];
    person.skills[Gathering.RULES[resource].task] = 0.34 / 0.55;
    person.fatigue = 0;
  }
  const source = nav.findHarvestTarget(resource).source;
  const node = simulation.registerHarvestSource(source);
  for (const id of ids) simulation.state.people[id].order.nodeId = node.id;
  return { simulation, nav, node, person: simulation.state.people[ids[0]] };
}
function nearlyReady(fixture, resource) {
  const { node } = fixture;
  node.felled = node.kind === 'tree';
  if (node.kind === 'tree') Object.assign(node, Gathering.treeBudget(node));
  if (resource === 'hay') {
    node.remaining = 0;
    node.dryHay = 7.2;
  }
  const amount = resource === 'hay' ? 7.2 : Gathering.RULES[resource].load;
  node.processingHours = Gathering.loadHours(node, resource, amount) - 0.001;
  return amount;
}

test('a partially full store accepts only the fitting volume and leaves the rest on its carrier', () => {
  for (const resource of Object.keys(Gathering.RULES)) {
    const fixture = field(resource);
    const { simulation, person, nav } = fixture;
    const amount = nearlyReady(fixture, resource);
    const camp = simulation.state.storage.stores.camp;
    for (const key of Storage.KEYS) camp.stock[key] = 0;
    camp.capacity = Storage.volume(resource, amount / 2);
    simulation.advanceRealtime(120, nav);
    assert.ok(Math.abs(camp.stock[resource] - amount / 2) < 1e-8, resource);
    assert.ok(Math.abs(person.cargo.amount - amount / 2) < 1e-8, resource);
    assert.equal(person.order.status, 'Storage is full.', resource);
    const loaded = Simulation.load(simulation.serialize());
    assert.ok(loaded, resource);
    assert.ok(
      Math.abs(
        loaded.state.people[1].cargo.amount +
          loaded.state.storage.stores.camp.stock[resource] -
          amount,
      ) < 1e-8,
      resource,
    );
  }
});

test('blocked felling reports the reason, saves it, and resumes the real stage after retry', () => {
  for (const resource of ['timber', 'firewood']) {
    const { simulation, person, node, nav } = field(resource);
    node.clearingHours = Gathering.treeBudget(node).clearingHours;
    Object.defineProperty(simulation, 'weather', {
      configurable: true,
      get: () => ({ factor: 0.55, temp: 8, wind: 46, rain: true }),
    });
    simulation.advanceRealtime(1, nav);
    assert.equal(activityLine(person, simulation), 'Too windy to fell a tree safely.');
    assert.equal(node.fellingHours, 0);
    const loaded = Simulation.load(simulation.serialize());
    assert.ok(loaded);
    assert.equal(activityLine(loaded.state.people[1], loaded), person.order.status);
    Object.defineProperty(simulation, 'weather', {
      get: () => ({ factor: 1, temp: 8, wind: 15, rain: false }),
    });
    simulation.advanceRealtime(31, nav);
    assert.ok(node.fellingHours > 0);
    assert.equal(person.order.status, undefined);
    assert.equal(activityLine(person, simulation), 'Felling the tree.');
  }
});

test('blocked travel reports the actual destination and clears its warning when movement resumes', () => {
  for (const carrying of [false, true]) {
    const { simulation, person, nav } = field('turf', 30);
    person.x = 10;
    if (carrying) person.cargo = { resource: 'turf', amount: 0.02 };
    const move = nav.movePerson;
    nav.movePerson = () => false;
    simulation.advanceRealtime(1, nav);
    assert.equal(
      activityLine(person, simulation),
      carrying
        ? 'Waiting for a clear route to storage.'
        : 'Waiting for a clear route to the gathering site.',
    );
    assert.equal(simulation.state.flow.production.turf || 0, 0);
    nav.movePerson = move;
    simulation.advanceRealtime(1, nav);
    assert.equal(person.order.status, undefined);
    assert.deepEqual(Timing.gatheringState(simulation, person), {
      phase: 'travelling',
      destination: carrying ? 'store' : 'site',
    });
  }
});

test('a recovered store reports unloading instead of retaining the old storage warning', () => {
  const fixture = field();
  const { simulation, person, nav } = fixture;
  nearlyReady(fixture, 'turf');
  nav.deliveryPoint = () => null;
  simulation.advanceRealtime(5, nav);
  assert.equal(activityLine(person, simulation), 'No reachable storage.');
  nav.deliveryPoint = () => ({ id: 'camp', x: person.x, z: person.z });
  simulation.advanceRealtime(31, nav);
  assert.equal(person.order.status, undefined);
  assert.equal(activityLine(person, simulation), "I'm unloading turf at the store.");
  assert.equal(simulation.state.flow.production.turf || 0, 0);
  simulation.advanceRealtime(60, nav);
  assert.equal(simulation.state.flow.production.turf, 0.02);
});

test('ground bundle pickup has a saved loading stage and credits nothing before delivery', () => {
  const fixture = field();
  const { simulation, person, nav } = fixture;
  nearlyReady(fixture, 'turf');
  simulation.advanceRealtime(5, nav);
  const point = { x: person.x, z: person.z };
  simulation.commandWorkers([1], { type: 'stop' });
  simulation.commandWorkers([1], { type: 'gather', resource: 'turf', ...point });
  simulation.advanceRealtime(1, nav);
  assert.equal(activityLine(person, simulation), "I'm loading turf.");
  assert.equal(person.cargo, null);
  assert.equal(simulation.state.flow.production.turf || 0, 0);
  assert.ok(Simulation.load(simulation.serialize()));
  simulation.advanceRealtime(35, nav);
  assert.equal(person.cargo.resource, 'turf');
  assert.equal(activityLine(person, simulation), "I'm bringing turf to the store.");
});

test('hay reports cold and wet-weather waits, then clears them when conditions improve', () => {
  const { simulation, person, node, nav } = field('hay');
  Object.defineProperty(simulation, 'weather', {
    configurable: true,
    get: () => ({ factor: 1, temp: -2, wind: 10, rain: false }),
  });
  simulation.advanceRealtime(1, nav);
  assert.equal(activityLine(person, simulation), 'Too cold to mow grass.');
  assert.equal(node.remaining, node.volume);
  Object.defineProperty(simulation, 'weather', {
    configurable: true,
    get: () => ({ factor: 1, temp: 15, wind: 10, rain: false }),
  });
  simulation.advanceRealtime(1, nav);
  assert.equal(activityLine(person, simulation), 'Mowing grass.');
  assert.equal(person.order.status, undefined);
  node.remaining = 0;
  Object.defineProperty(simulation, 'weather', {
    get: () => ({ factor: 1, temp: 15, wind: 10, rain: true }),
  });
  simulation.advanceRealtime(1, nav);
  assert.equal(activityLine(person, simulation), 'Waiting for dry weather to cure the hay.');
  Object.defineProperty(simulation, 'weather', {
    get: () => ({ factor: 1, temp: 15, wind: 10, rain: false }),
  });
  node.dryingHours = Timing.HAY_FAIR_DAYLIGHT_HOURS - 1 / 3600;
  simulation.advanceRealtime(31, nav);
  assert.equal(person.order.status, undefined);
  assert.equal(activityLine(person, simulation), "I'm bringing hay to the store.");
});

test('cut material is carried and only credited after reaching storage and unloading', () => {
  for (const resource of Object.keys(Gathering.RULES)) {
    const fixture = field(resource);
    const { simulation, nav, person } = fixture;
    const amount = nearlyReady(fixture, resource);
    const before = simulation.state.flow.production[resource] || 0;
    simulation.advanceRealtime(5, nav);
    assert.equal(simulation.state.flow.production[resource] || 0, before, resource);
    assert.equal(person.cargo.resource, resource);
    assert.ok(Math.abs(person.cargo.amount - amount) < 1e-8);
    assert.ok(person.cargo.amount * Gathering.RULES[resource].density <= 15);
    simulation.advanceRealtime(55, nav);
    assert.equal(simulation.state.flow.production[resource] || 0, before);
    assert.equal(person.order.phase, 'unloading');
    simulation.advanceRealtime(30, nav);
    assert.ok(Math.abs(simulation.state.flow.production[resource] - before - amount) < 1e-8);
    assert.equal(person.cargo, null);
  }
});

test('longer return trips delay inventory and an inaccessible store retains cargo', () => {
  for (const distance of [10, 300]) {
    const fixture = field('turf', distance);
    nearlyReady(fixture, 'turf');
    fixture.simulation.advanceRealtime(100, fixture.nav);
    assert.equal((fixture.simulation.state.flow.production.turf || 0) > 0, distance === 10);
  }
  const fixture = field();
  nearlyReady(fixture, 'turf');
  fixture.nav.deliveryPoint = () => null;
  fixture.simulation.advanceRealtime(120, fixture.nav);
  assert.equal(fixture.simulation.state.flow.production.turf || 0, 0);
  assert.equal(fixture.person.cargo.amount, 0.02);
  assert.match(fixture.person.order.status, /storage/);
});

test('felling removes no inventory; finite trees cannot be double spent', () => {
  const fixture = field('timber', 10, [1, 2]);
  const { simulation, node, nav } = fixture;
  node.clearingHours = Gathering.treeBudget(node).clearingHours;
  node.fellingHours = Gathering.treeBudget(node).fellingHours - 0.001;
  simulation.advanceRealtime(5, nav);
  assert.equal(node.felled, true);
  assert.equal(node.remaining, node.volume);
  assert.equal(simulation.state.flow.production.timber || 0, 0);
  simulation.advanceRealtime(3 * 3600, nav);
  const cargo = simulation.state.people.reduce(
    (sum, person) => sum + (person.cargo?.amount || 0),
    0,
  );
  assert.ok(
    Math.abs(
      (simulation.state.flow.production.timber || 0) + cargo + node.remaining - node.volume,
    ) < 1e-7,
  );
  assert.ok(node.remaining <= 0.00001);
  assert.equal(simulation.state.flow.production.firewood || 0, 0);
});

test('retasking leaves a recoverable bundle; picking it up creates no extra stock', () => {
  const fixture = field();
  const { simulation, nav, person } = fixture;
  nearlyReady(fixture, 'turf');
  simulation.advanceRealtime(5, nav);
  const position = { x: person.x, z: person.z };
  simulation.commandWorkers([1], { type: 'stop' });
  assert.equal(person.cargo, null);
  assert.equal(simulation.state.harvest.piles.length, 1);
  assert.deepEqual(
    { x: simulation.state.harvest.piles[0].x, z: simulation.state.harvest.piles[0].z },
    position,
  );
  simulation.commandWorkers([1], { type: 'gather', resource: 'turf', ...position });
  simulation.advanceRealtime(120, nav);
  assert.equal(simulation.state.harvest.piles[0].amount, 0);
  assert.equal(simulation.state.flow.production.turf, 0.02);
});

test('mid-trip loads, scars, partial work and fractional clock survive save/load', () => {
  const fixture = field();
  nearlyReady(fixture, 'turf');
  fixture.simulation.advanceRealtime(5.035, fixture.nav);
  const saved = fixture.simulation.serialize();
  const loaded = Simulation.load(saved);
  assert.ok(loaded);
  assert.deepEqual(loaded.state.people[1].cargo, fixture.person.cargo);
  assert.deepEqual(loaded.state.people[1].order, fixture.person.order);
  assert.deepEqual(loaded.state.harvest, fixture.simulation.state.harvest);
  assert.equal(
    loaded.state.realtimeRemainderSeconds,
    fixture.simulation.state.realtimeRemainderSeconds,
  );
  loaded.advanceRealtime(120, navigation(loaded));
  assert.equal(loaded.state.flow.production.turf, 0.02);
  assert.ok(loaded.state.harvest.nodes[fixture.node.id].remaining < fixture.node.volume);
  for (const mutate of [
    (state) => {
      state.people[1].cargo.amount = 500;
    },
    (state) => {
      state.harvest.nodes[fixture.node.id].remaining = -1;
    },
    (state) => {
      state.realtimeRemainderSeconds = NaN;
    },
    (state) => {
      state.workSeconds[1] = -1;
    },
    (state) => {
      state.people[1].order.storePoint = { id: 'camp', x: Infinity, z: 0 };
    },
  ]) {
    const state = JSON.parse(saved);
    mutate(state);
    assert.equal(Simulation.load(JSON.stringify(state)), null);
  }
});

test('mowing leaves wet hay in the field, rain slows drying and frost stops it', () => {
  const fixture = field('hay');
  const { simulation, node, nav } = fixture;
  simulation.advanceRealtime(60, nav);
  assert.ok(node.remaining < node.volume);
  assert.ok(node.freshHay > 0);
  assert.equal(node.dryHay, 0);
  assert.equal(simulation.state.flow.production.hay || 0, 0);
  node.remaining = 0;
  node.dryingHours = 15.99;
  simulation.advanceRealtime(60, nav);
  assert.equal(node.freshHay, 0);
  assert.ok(node.dryHay > 0);
  const other = field('hay');
  other.node.remaining = 0;
  other.node.freshHay = 7.2;
  other.node.dryingHours = 1;
  // No worker is needed for passive drying.
  other.simulation.commandWorkers([1], { type: 'stop' });
  Object.defineProperty(other.simulation, 'weather', {
    configurable: true,
    get: () => ({ factor: 1, temp: 15, rain: true, feels: 15 }),
  });
  other.simulation.advanceRealtime(600, other.nav);
  assert.ok(Math.abs(other.node.dryingHours - (1 - 1 / 3)) < 1e-8);
  Object.defineProperty(other.simulation, 'weather', {
    get: () => ({ factor: 1, temp: -2, rain: false, feels: -2 }),
  });
  other.simulation.advanceRealtime(600, other.nav);
  assert.ok(Math.abs(other.node.dryingHours - (1 - 1 / 3)) < 1e-8);
});

test('1×, 3× and 8× partitions run the identical physical timeline', () => {
  const fixtures = [field(), field(), field()];
  fixtures.forEach((fixture) => nearlyReady(fixture, 'turf'));
  for (const [index, speed] of [1, 3, 8].entries()) {
    const fixture = fixtures[index];
    for (let time = 0; time < 120; time += speed)
      fixture.simulation.advanceRealtime(speed, fixture.nav);
  }
  assert.equal(fixtures[0].simulation.serialize(), fixtures[1].simulation.serialize());
  assert.equal(fixtures[0].simulation.serialize(), fixtures[2].simulation.serialize());
  assert.ok(Math.abs(fixtures[0].simulation.hour - (8 + 120 / 3600)) < 1e-8);
});

test('builders consume only onsite seconds and sleep outside their ten-hour shift', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const building = simulation.order('restore', 0, 0);
  for (const material of Object.values(building.materials)) {
    material.delivered = material.required;
    material.reservations = [];
  }
  simulation.commandWorkers([1], { type: 'build', buildingId: building.id, x: 10, z: 20 });
  Object.assign(simulation.state.people[1], { x: 0, z: 20 });
  simulation.advanceRealtime(60, navigation(simulation));
  assert.ok(building.progress > 0 && building.progress < 60 / 3600);
  const progress = building.progress;
  simulation.state.time = 18;
  simulation.advanceRealtime(60, navigation(simulation));
  assert.equal(building.progress, progress);
});

test('frozen turf and winter plants produce no material even with nearly completed work', () => {
  for (const resource of ['turf', 'plants']) {
    const fixture = field(resource);
    nearlyReady(fixture, resource);
    if (resource === 'plants') fixture.simulation.state.time = 100 * 24 + 8;
    else
      Object.defineProperty(fixture.simulation, 'weather', {
        get: () => ({ factor: 1, temp: -2 }),
      });
    fixture.simulation.advanceRealtime(120, fixture.nav);
    assert.equal(fixture.person.cargo, undefined);
    assert.equal(fixture.node.remaining, fixture.node.volume);
    assert.match(fixture.person.order.status, /frozen|winter/);
  }
});

test('existing workshop and fishing bonuses improve work without bypassing delivery', () => {
  const ordinary = field('firewood');
  const equipped = field('firewood');
  ordinary.node.felled = equipped.node.felled = true;
  for (const fixture of [ordinary, equipped])
    Object.assign(fixture.node, Gathering.treeBudget(fixture.node));
  equipped.simulation.state.buildings.push({ type: 'workshop', condition: 100 });
  for (const fixture of [ordinary, equipped]) fixture.simulation.advanceRealtime(900, fixture.nav);
  assert.equal(ordinary.simulation.state.flow.production.firewood || 0, 0);
  assert.equal(equipped.simulation.state.flow.production.firewood, 15);
  for (const bonus of [false, true]) {
    const fixture = field('freshFish');
    fixture.node.processingHours = 1 / 3 - 0.1;
    if (bonus) fixture.simulation.state.buildings.push({ type: 'fishing', condition: 100 });
    fixture.simulation.advanceRealtime(300, fixture.nav);
    assert.equal(!!fixture.person.cargo, bonus);
    assert.equal(fixture.simulation.state.flow.production.freshFish || 0, 0);
  }
});
