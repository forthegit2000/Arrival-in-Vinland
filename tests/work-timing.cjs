const { test } = require('node:test');
const assert = require('node:assert/strict');
const Timing = require('../work-timing.js');
const Gathering = require('../gathering.js');
const Processes = require('../production-processes.js');
const Storage = require('../storage.js');
const { Simulation, TYPES } = require('../simulation.js');
const { navigation, provision } = require('./work-fixtures.cjs');

test('gathering state reports the saved job without mutating it or mistaking conversation for rest', () => {
  const sim = new Simulation();
  sim.state.time = 9;
  const person = sim.state.people[1];
  sim.commandWorkers([1], { type: 'gather', resource: 'timber', x: 10, z: 20 });
  Object.assign(person.order, { phase: 'working', activity: 'felling' });
  sim.conversationPersonId = 1;
  const saved = sim.serialize();
  assert.deepEqual(Timing.gatheringState(sim, person), { phase: 'working', activity: 'felling' });
  assert.equal(Timing.isWorking(sim, person), false);
  assert.equal(sim.serialize(), saved);
  person.order.status = 'Too windy to fell a tree safely.';
  assert.deepEqual(Timing.gatheringState(sim, person), {
    phase: 'waiting',
    reason: person.order.status,
  });
  sim.state.time = 18;
  assert.deepEqual(Timing.gatheringState(sim, person), { phase: 'resting' });
  person.order = null;
  assert.equal(Timing.gatheringState(sim, person), null);
});

function field(resource = 'timber') {
  const sim = new Simulation();
  provision(sim);
  Object.defineProperty(sim, 'weather', {
    configurable: true,
    get: () => ({ temp: 8, feels: 8, rain: false, wind: 15, daylight: 16, factor: 1 }),
  });
  sim.state.time = 8;
  const person = sim.state.people[1];
  person.skills.timber = 0.34 / 0.55;
  person.fatigue = 0;
  sim.commandWorkers([1], { type: 'gather', resource, x: 10, z: 20 });
  Object.assign(person, { x: 10, z: 20 });
  const nav = navigation(sim),
    node = sim.registerHarvestSource(nav.findHarvestTarget(resource).source);
  person.order.nodeId = node.id;
  return { sim, person, nav, node };
}
function factory(type) {
  const sim = new Simulation();
  provision(sim);
  sim.state.time = 8;
  Object.defineProperty(sim, 'weather', {
    configurable: true,
    get: () => ({ temp: 5, feels: 5, rain: false, wind: 20, daylight: 16, factor: 1 }),
  });
  const definition = TYPES[type],
    building = {
      id: sim.state.nextId++,
      type,
      x: 45,
      z: 45,
      rotation: 0,
      condition: 100,
      quality: 1,
      cost: { ...definition.cost },
      progress: definition.hours,
      hours: definition.hours,
      sailShip: null,
    };
  sim.state.buildings.push(building);
  Storage.syncStores(sim.state);
  const store = sim.state.storage.stores['building:' + building.id];
  const person = sim.state.people[1],
    task = type === 'charcoal' ? 'craft' : 'herding';
  Object.assign(person, { x: 45, z: 45, fatigue: 0 });
  person.skills[task] = 0.34 / 0.55;
  sim.commandWorkers([1], { type: 'work', task, workplaceId: store.id, x: 45, z: 45 });
  return { sim, person, store };
}

test('axe felling scales with trunk cross-section and species, independently of delivered volume', () => {
  const small = { radius: 0.1, height: 6, volume: 0.08, species: 'conifer' };
  const twenty = Timing.treeBudget(small);
  assert.equal(twenty.fellingHours * 60, 4.5);
  const forty = Timing.treeBudget({ ...small, radius: 0.2 });
  assert.equal(forty.fellingHours * 60, 16.5);
  assert.ok(Timing.treeBudget({ ...small, species: 'birch' }).fellingHours > twenty.fellingHours);
  assert.equal(
    Timing.treeBudget({ ...small, volume: 0.5, height: 12 }).fellingHours,
    twenty.fellingHours,
  );
  assert.ok(Timing.treeBudget({ ...small, height: 12 }).limbingHours > twenty.limbingHours);
});

test('a small tree falls in minutes, then requires branch removal and cross-cutting before delivery', () => {
  const f = field(),
    budget = Timing.treeBudget(f.node);
  const before = f.sim.state.resources.timber;
  f.sim.advanceRealtime((budget.clearingHours + budget.fellingHours) * 3600 + 1, f.nav);
  assert.equal(f.node.felled, true);
  assert.equal(f.node.limbingHours, 0);
  assert.equal(f.sim.state.resources.timber, before);
  assert.equal(f.node.remaining, f.node.volume);
  f.sim.advanceRealtime(12 * 60, f.nav);
  assert.ok(f.node.limbingHours >= budget.limbingHours - 1e-8);
  assert.ok(f.node.buckingHours >= budget.buckingHours - 1e-8);
  assert.ok(f.sim.state.flow.production.timber > 0);
});

test('forestry stages and delivered timber match at 1×, 3× and 8×', () => {
  const fixtures = [field(), field(), field()];
  for (const [index, speed] of [1, 3, 8].entries()) {
    const fixture = fixtures[index];
    for (let elapsed = 0; elapsed < 1200; elapsed += speed)
      fixture.sim.advanceRealtime(speed, fixture.nav);
  }
  assert.ok(fixtures[0].sim.state.flow.production.timber > 0);
  assert.equal(fixtures[0].sim.serialize(), fixtures[1].sim.serialize());
  assert.equal(fixtures[0].sim.serialize(), fixtures[2].sim.serialize());
});

test('one person fells at a time; tool care, off-duty hours and gales cannot look like active chopping', () => {
  const f = field();
  f.sim.commandWorkers([2], { ...f.person.order });
  Object.assign(f.sim.state.people[2], { x: 10, z: 20 });
  f.node.clearingHours = Timing.treeBudget(f.node).clearingHours;
  f.sim.advanceRealtime(10, f.nav);
  assert.ok(Math.abs(f.node.fellingHours - 10 / 3600) < 1e-8);
  assert.match(f.sim.state.people[2].order.status, /space/);
  f.person.order.toolWorkSeconds = Timing.TOOL_WORK_SECONDS - 0.1;
  f.sim.advanceRealtime(0.2, f.nav);
  assert.equal(f.person.order.activity, 'sharpening');
  assert.ok(f.person.order.toolCareSeconds > 0);
  assert.equal(Timing.AXE_ACTIVITIES.has(f.person.order.activity), false);
  f.sim.state.time = 18;
  f.person.order.activity = 'felling';
  assert.equal(Timing.isWorking(f.sim, f.person), false);
  f.sim.state.time = 8;
  Object.defineProperty(f.sim, 'weather', {
    get: () => ({ temp: 8, rain: true, wind: 46, factor: 0.55 }),
  });
  const progress = f.node.fellingHours;
  f.sim.advanceRealtime(2, f.nav);
  assert.equal(f.node.fellingHours, progress);
  assert.match(f.person.order.status, /windy/);
  assert.equal(Timing.isWorking(f.sim, f.person), false);
});

test('new forestry stage progress saves exactly and legacy tree progress migrates once', () => {
  const f = field('firewood');
  f.sim.advanceRealtime(180, f.nav);
  const saved = f.sim.serialize(),
    loaded = Simulation.load(saved);
  assert.ok(loaded);
  assert.deepEqual(loaded.state.harvest, f.sim.state.harvest);
  const old = JSON.parse(saved);
  delete old.harvest.timingVersion;
  const node = old.harvest.nodes[f.node.id];
  node.fellingHours = node.volume / 0.3 / 2;
  for (const key of ['clearingHours', 'limbingHours', 'buckingHours', 'species']) delete node[key];
  const migrated = Simulation.load(JSON.stringify(old));
  assert.ok(migrated);
  assert.ok(
    Math.abs(
      migrated.state.harvest.nodes[node.id].fellingHours / Timing.treeBudget(node).fellingHours -
        0.5,
    ) < 1e-8,
  );
  assert.deepEqual(Simulation.load(migrated.serialize()).state.harvest, migrated.state.harvest);
});

test('fish and plant trips return useful small catches instead of waiting for a ten-kilo load', () => {
  assert.equal(Timing.RULES.freshFish.load, 1);
  assert.equal(Timing.RULES.plants.load, 1);
  assert.equal(Timing.RULES.freshFish.rate, 3);
  assert.equal(Timing.RULES.plants.rate, 2);
  // Already carried old ten-kilo loads must remain valid after migration.
  const f = field();
  f.sim.commandWorkers([1], { type: 'work', task: 'fishing', x: 10, z: 20 });
  f.person.cargo = { resource: 'freshFish', amount: 10 };
  assert.ok(Simulation.load(f.sim.serialize()));
});

test('charcoal needs preparation, a multi-day burn, cooling and workers to unload it', () => {
  const f = factory('charcoal');
  Storage.deposit(f.sim.state, f.store.id, 'firewood', 200, 0.2);
  Processes.work(f.sim, f.person, 4.5 * 3600);
  let batch = f.sim.state.processing.batches[f.store.id];
  assert.equal(batch.phase, 'processing');
  assert.equal(f.store.stock.firewood, 0);
  assert.equal(f.store.stock.charcoal || 0, 0);
  Processes.advance(f.sim, 47);
  assert.equal(batch.phase, 'processing');
  Processes.advance(f.sim, 1);
  assert.equal(batch.phase, 'cooling');
  Processes.advance(f.sim, 48);
  assert.equal(batch.phase, 'unloading');
  assert.equal(f.store.stock.charcoal || 0, 0);
  Processes.work(f.sim, f.person, 2 * 3600);
  assert.ok(Math.abs(f.store.stock.charcoal - 40) < 1e-8);
  assert.equal(f.sim.state.processing.batches[f.store.id], undefined);
  assert.ok(Simulation.load(f.sim.serialize()));
});

test('fish drying takes weeks of suitable weather, pauses in rain and cannot make instant stockfish', () => {
  const f = factory('smokehouse');
  Storage.deposit(f.sim.state, f.store.id, 'freshFish', 10);
  Processes.work(f.sim, f.person, 3600);
  const batch = f.sim.state.processing.batches[f.store.id];
  assert.equal(batch.phase, 'processing');
  Processes.advance(f.sim, 24);
  assert.equal(f.store.stock.driedFish || 0, 0);
  assert.equal(batch.elapsedHours, 24);
  Object.defineProperty(f.sim, 'weather', {
    configurable: true,
    get: () => ({ temp: 5, rain: true, wind: 20 }),
  });
  Processes.advance(f.sim, 24);
  assert.equal(batch.elapsedHours, 24);
  Object.defineProperty(f.sim, 'weather', { get: () => ({ temp: 5, rain: false, wind: 20 }) });
  Processes.advance(f.sim, Processes.FISH_DRYING_HOURS - 24);
  assert.equal(batch.phase, 'unloading');
  assert.equal(f.store.stock.driedFish || 0, 0);
  Processes.work(f.sim, f.person, 1800);
  assert.ok(Math.abs(f.store.stock.driedFish - 2.4) < 1e-8);
  assert.ok(Simulation.load(f.sim.serialize()));
});

test('warm weather ruins curing fish and incomplete raw preparations do not last forever', () => {
  for (const prepared of [true, false]) {
    const f = factory('smokehouse');
    Storage.deposit(f.sim.state, f.store.id, 'freshFish', 10);
    Processes.work(f.sim, f.person, prepared ? 3600 : 1);
    if (prepared)
      Object.defineProperty(f.sim, 'weather', { get: () => ({ temp: 18, rain: false, wind: 20 }) });
    Processes.advance(f.sim, prepared ? 24 : 49);
    assert.equal(f.sim.state.processing.batches[f.store.id], undefined);
    assert.equal(f.store.stock.driedFish || 0, 0);
    assert.equal(f.sim.state.flow.losses.curingFish, 10);
  }
});

test('batch progress survives save/load and malformed timing is rejected', () => {
  const f = factory('charcoal');
  Storage.deposit(f.sim.state, f.store.id, 'firewood', 200);
  Processes.work(f.sim, f.person, 4.5 * 3600);
  Processes.advance(f.sim, 12.345);
  const loaded = Simulation.load(f.sim.serialize());
  assert.ok(loaded);
  assert.deepEqual(loaded.state.processing, f.sim.state.processing);
  for (const [key, value] of [
    ['elapsedHours', -1],
    ['phase', 'ready-now'],
    ['processHours', null],
  ]) {
    const state = JSON.parse(f.sim.serialize());
    state.processing.batches[f.store.id][key] = value;
    assert.equal(Simulation.load(JSON.stringify(state)), null);
  }
});
