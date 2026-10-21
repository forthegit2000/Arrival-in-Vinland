const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, TYPES } = require('../simulation.js');
const {
  onsiteHours,
  navigation,
  placeWorkers,
  stockBuildingMaterials,
} = require('./work-fixtures.cjs');

test('new arrivals are idle and produce nothing until explicitly ordered', () => {
  const simulation = new Simulation();
  assert.equal(simulation.assigned, 0);
  assert.ok(Object.values(simulation.roster()).every((crew) => crew.length === 0));
  const timber = simulation.state.resources.timber;
  onsiteHours(simulation, 24);
  assert.equal(simulation.state.resources.timber, timber);
});

test('named builders contribute exactly ten person-hours each day and rest overnight', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const building = simulation.order('restore', 0, 0);
  simulation.commandWorkers([1, 2], { type: 'build', buildingId: building.id, x: 0, z: 20 });
  onsiteHours(simulation, 10);
  assert.equal(building.progress, 20);
  assert.equal(simulation.state.people[1].order.workedHours, 10);
  onsiteHours(simulation, 14);
  assert.equal(building.progress, 20);
  onsiteHours(simulation, 24);
  assert.equal(building.progress, 40);
  assert.equal(simulation.estimatedDays(building), (building.hours - 40) / 20);
});

test('specific building orders never double-book workers or start the next site automatically', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const first = simulation.order('sailbudir', 0, 45);
  const second = simulation.order('sailbudir', 30, 45);
  first.hours = 2;
  simulation.commandWorkers([1, 2, 2], { type: 'build', buildingId: first.id, x: 5, z: 45 });
  onsiteHours(simulation, 1);
  assert.ok(simulation.has('sailbudir'));
  assert.equal(second.progress, 0);
  assert.equal(simulation.state.people[1].order, null);
  assert.equal(simulation.assigned, 0);
  onsiteHours(simulation, 24);
  assert.equal(second.progress, 0);
});

test('building crew caps and reassigning or stopping named workers conserve labor', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const building = simulation.order('restore', 0, 0);
  const ids = Array.from({ length: 40 }, (_, index) => index);
  simulation.commandWorkers(ids, { type: 'build', buildingId: building.id, x: 0, z: 20 });
  onsiteHours(simulation, 1);
  assert.equal(building.progress, TYPES.restore.crew);
  simulation.commandWorkers(ids, { type: 'stop' });
  onsiteHours(simulation, 1);
  assert.equal(building.progress, TYPES.restore.crew);
  simulation.commandWorkers([1], { type: 'gather', x: 70, z: -20 });
  simulation.commandWorkers([1], { type: 'build', buildingId: building.id, x: 0, z: 20 });
  assert.equal(simulation.roster().timber.length, 0);
  assert.deepEqual(
    simulation.roster().builders.map((person) => person.id),
    [1],
  );
  simulation.cancel(building.id);
  assert.equal(simulation.state.people[1].order, null);
});

test('calendar-only advancement never invents physical gathering output', () => {
  const simulation = new Simulation();
  simulation.commandWorkers([1], { type: 'gather', x: 70, z: -20 });
  const timber = simulation.state.resources.timber;
  simulation.advance(10);
  assert.equal(simulation.state.resources.timber, timber);
  assert.equal(simulation.state.people[1].order.workedHours, 0);
});

test('orders persist, invalid orders are rejected, and old automatic quotas become idle', () => {
  const simulation = new Simulation();
  simulation.commandWorkers([1], { type: 'gather', x: 70, z: -20 });
  onsiteHours(simulation, 2);
  const saved = JSON.parse(simulation.serialize());
  const loaded = Simulation.load(JSON.stringify(saved));
  assert.deepEqual(loaded.state.people[1].order, simulation.state.people[1].order);
  saved.people[1].order.buildingId = 99999;
  saved.people[1].order.type = 'build';
  assert.equal(Simulation.load(JSON.stringify(saved)), null);
  assert.equal(simulation.commandWorkers([1], { type: 'move', x: Infinity, z: 0 }), 0);
  const legacy = new Simulation();
  const oldSave = JSON.parse(legacy.serialize());
  oldSave.tasks = { timber: 12, fishing: 32 };
  oldSave.politics.delegate = true;
  oldSave.people[2].job = 'fishing';
  delete oldSave.workerOrdersVersion;
  assert.equal(Simulation.load(JSON.stringify(oldSave)).assigned, 0);
});

test('children, absent and unavailable workers cannot receive local orders', () => {
  const simulation = new Simulation({ preset: 'households', children: 0.2 });
  const child = simulation.state.people.find((person) => person.age < 16);
  simulation.state.people[1].away = 'voyage';
  simulation.state.people[2].health = 10;
  assert.equal(
    simulation.commandWorkers([child.id, 1, 2, 9999], { type: 'move', x: 40, z: 40 }),
    0,
  );
});

test('support jobs use only the named people, honor the camp workday, and persist', () => {
  const simulation = new Simulation();
  assert.equal(typeof simulation.setTask, 'undefined');
  assert.equal(typeof simulation.preset, 'undefined');
  assert.equal(typeof simulation.delegate, 'undefined');
  for (const [id, task] of [
    [1, 'fishing'],
    [2, 'foraging'],
    [3, 'herding'],
    [4, 'craft'],
  ]) {
    assert.equal(simulation.commandWorkers([id], { type: 'work', task, x: 45, z: 45 }), 1);
  }
  assert.equal(simulation.commandWorkers([5], { type: 'work', task: 'builders', x: 45, z: 45 }), 0);
  assert.equal(simulation.commandWorkers([5], { type: 'work', task: 'unknown', x: 45, z: 45 }), 0);
  const loaded = Simulation.load(simulation.serialize());
  assert.deepEqual(loaded.state.people[1].order, simulation.state.people[1].order);
  onsiteHours(simulation, 8);
  for (const id of [1, 2, 3, 4]) assert.equal(simulation.state.people[id].order.workedHours, 8);
  onsiteHours(simulation, 16);
  for (const id of [1, 2, 3, 4]) assert.equal(simulation.state.people[id].order.workedHours, 8);
  assert.equal(simulation.roster().fishing[0].id, 1);
  simulation.commandWorkers([1], { type: 'stop' });
  assert.equal(simulation.roster().fishing.length, 0);
  onsiteHours(simulation, 24);
  assert.equal(simulation.roster().fishing.length, 0);
  assert.equal(simulation.assigned, 3);
});

test('old quota saves keep direct orders and progress without reviving automatic crews', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const building = simulation.order('restore', 0, 0);
  simulation.commandWorkers([1], { type: 'build', buildingId: building.id, x: 10, z: 20 });
  onsiteHours(simulation, 2);
  const save = JSON.parse(simulation.serialize());
  save.workerOrdersVersion = 1;
  save.tasks = { builders: 40, fishing: 60, herding: 10 };
  save.politics.delegate = true;
  save.people[2].job = 'fishing';
  const loaded = Simulation.load(JSON.stringify(save));
  assert.ok(loaded);
  assert.equal(loaded.state.queue[0].progress, 2);
  assert.equal(loaded.assigned, 1);
  assert.equal(loaded.state.people[1].order.buildingId, building.id);
  assert.equal(loaded.roster().fishing.length, 0);
  assert.equal(Object.hasOwn(loaded.state, 'tasks'), false);
  assert.equal(Object.hasOwn(loaded.state.politics, 'delegate'), false);
  onsiteHours(loaded, 24);
  assert.equal(loaded.state.queue[0].progress, 12);
  assert.equal(loaded.assigned, 1);
  assert.equal(loaded.roster().fishing.length, 0);
});

test('onsite camp care produces output and charcoal enters a timed batch; stopping leaves no replacements', () => {
  const simulation = new Simulation();
  simulation.state.resources.water = 0;
  simulation.state.buildings.push({
    id: simulation.state.nextId++,
    type: 'charcoal',
    x: 45,
    z: 45,
    condition: 100,
  });
  for (const [id, task] of [
    [1, 'fishing'],
    [2, 'foraging'],
    [3, 'herding'],
    [4, 'craft'],
  ]) {
    simulation.commandWorkers([id], { type: 'work', task, x: 45, z: 45 });
  }
  require('../storage.js').syncStores(simulation.state);
  const pitId = 'building:' + simulation.state.buildings.at(-1).id;
  require('../storage.js').deposit(simulation.state, pitId, 'firewood', 200);
  simulation.state.people[4].order.workplaceId = pitId;
  placeWorkers(simulation);
  simulation.advanceRealtime(6 * 3600, navigation(simulation));
  assert.ok(simulation.state.processing.batches[pitId]);
  assert.equal(simulation.state.flow.production.charcoal || 0, 0);
  for (const output of ['water', 'dairy']) {
    assert.ok(simulation.state.flow.production[output] > 0, output);
  }
  simulation.commandWorkers([1, 2, 3, 4], { type: 'stop' });
  const production = { ...simulation.state.flow.production };
  onsiteHours(simulation, 1);
  assert.deepEqual(simulation.state.flow.production, production);
  assert.equal(simulation.assigned, 0);
});

test('stopping or moving named workers never recruits an unordered replacement', () => {
  const simulation = new Simulation();
  simulation.commandWorkers([1, 2], { type: 'gather', x: 70, z: -20 });
  simulation.commandWorkers([1], { type: 'stop' });
  assert.deepEqual(
    simulation.roster().timber.map((person) => person.id),
    [2],
  );
  simulation.commandWorkers([2], { type: 'move', x: 45, z: 45 });
  assert.equal(simulation.roster().timber.length, 0);
  onsiteHours(simulation, 24);
  assert.equal(simulation.roster().timber.length, 0);
});

test('dedicated fuel orders consume finite wood without generating timber', () => {
  const simulation = new Simulation();
  // Test material conservation in safe cutting weather, independently of gale stops.
  Object.defineProperty(simulation, 'weather', {
    get: () => ({ temp: 8, feels: 8, rain: false, wind: 10, daylight: 16, factor: 1 }),
  });
  simulation.commandWorkers([1], { type: 'gather', resource: 'firewood', x: 10, z: 20 });
  placeWorkers(simulation);
  const timber = simulation.state.resources.timber;
  const wood = simulation.state.ecology.wood;
  simulation.advanceRealtime(3 * 3600, navigation(simulation));
  assert.ok(simulation.state.flow.production.firewood > 0);
  assert.equal(simulation.state.resources.timber, timber);
  const carried = simulation.state.people[1].cargo?.amount || 0;
  assert.ok(
    Math.abs(
      (wood - simulation.state.ecology.wood) * 500 -
        simulation.state.flow.production.firewood -
        carried,
    ) < 1e-7,
  );
});

test('gathering orders validate resources, upgrade old log orders and respect hay limits', () => {
  const simulation = new Simulation();
  assert.equal(
    simulation.commandWorkers([1], { type: 'gather', resource: 'iron', x: 70, z: 45 }),
    0,
  );
  simulation.commandWorkers([1], { type: 'gather', x: 70, z: 45 });
  const saved = JSON.parse(simulation.serialize());
  delete saved.people[1].order.resource;
  saved.people[1].order.phase = 'forest';
  const loaded = Simulation.load(JSON.stringify(saved));
  assert.equal(loaded.state.people[1].order.resource, 'timber');
  assert.equal(loaded.state.people[1].order.phase, 'site');
  saved.people[1].order.resource = 'iron';
  assert.equal(Simulation.load(JSON.stringify(saved)), null);
  simulation.commandWorkers([1], { type: 'gather', resource: 'hay', x: 45, z: 45 });
  simulation.state.resources.hay = simulation.hayCapacity;
  onsiteHours(simulation, 1);
  assert.ok(simulation.state.resources.hay <= simulation.hayCapacity);
  simulation.state.time = 100 * 24 + 8;
  const production = simulation.state.flow.production.hay || 0;
  onsiteHours(simulation, 1);
  assert.equal(simulation.state.flow.production.hay || 0, production);
});
