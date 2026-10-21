const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, TYPES, FOOD } = require('../simulation.js');
const { onsiteHours, provision, stockBuildingMaterials } = require('./work-fixtures.cjs');
const snapshot = (simulation) => JSON.parse(simulation.serialize());
function finish(simulation, predicate, max = 40) {
  for (let i = 0; i < max && !predicate(); i++) {
    onsiteHours(simulation, 24);
  }
  assert.ok(predicate(), 'Work completed within a plausible weather and staffing window');
}
function completed(simulation, type, x = 45, z = 45) {
  const buildingDefinition = TYPES[type];
  const b = {
    id: simulation.state.nextId++,
    type,
    x,
    z,
    rotation: 0,
    hours: buildingDefinition.hours,
    progress: buildingDefinition.hours,
    cost: {
      ...buildingDefinition.cost,
    },
    condition: 100,
    quality: 1,
    site: simulation.siteInfo(x, z),
    sailShip: null,
  };
  simulation.state.buildings.push(b);
  return b;
}
test('original scenario retains the full arrival manifest and physical food energy', () => {
  const simulation = new Simulation();
  assert.equal(simulation.date.toISOString(), '1005-08-01T00:00:00.000Z');
  assert.equal(simulation.state.people.length, 160);
  assert.equal(simulation.state.ships.length, 4);
  assert.deepEqual(simulation.state.livestock, {
    cattle: 8,
    sheep: 12,
    goats: 12,
  });
  assert.equal(simulation.state.resources.tents, 10);
  assert.equal(simulation.shelter, 80);
  assert.ok(Math.abs(simulation.state.resources.food - 2400) < 1e-6);
  for (const key of ['timber', 'turf', 'stone', 'firewood'])
    assert.equal(simulation.state.resources[key], 0, key + ' must be gathered after landing');
  for (const key of ['water', 'hay', 'iron', 'seeds', 'cloth'])
    assert.ok(simulation.state.resources[key] > 0, key + ' remains arrival cargo');
  assert.equal(simulation.assigned, 0);
});
test('arrival provisions follow the chosen supplies while saved building materials remain intact', () => {
  const normal = new Simulation();
  const supplied = new Simulation({ supplies: 2 });
  assert.ok(supplied.state.resources.food > normal.state.resources.food);
  assert.ok(supplied.state.resources.hay > normal.state.resources.hay);
  assert.ok(supplied.state.resources.iron > normal.state.resources.iron);
  for (const key of ['timber', 'turf', 'stone', 'firewood'])
    assert.equal(supplied.state.resources[key], 0);
  assert.equal(normal.order('well', 70, 60), null, 'construction must wait for gathered materials');
  const gathered = { timber: 18, turf: 18, stone: 2.5, firewood: 140 };
  Object.assign(normal.state.resources, gathered);
  const saved = Simulation.load(normal.serialize());
  assert.ok(saved);
  for (const [key, amount] of Object.entries(gathered))
    assert.equal(saved.state.resources[key], amount);
});
test('every quoted labor breakdown balances', () => {
  for (const t of Object.values(TYPES)) {
    assert.equal(
      t.stages.reduce((a, v) => a + v[1], 0),
      t.hours,
      t.name,
    );
    assert.ok(t.crew > 0 && t.hours > 0);
  }
});
test('named agents and household membership are persistent and unique', () => {
  const simulation = new Simulation();
  assert.equal(new Set(simulation.state.people.map((p) => p.id)).size, 160);
  assert.equal(simulation.state.households.flatMap((household) => household.members).length, 160);
  assert.equal(simulation.state.people[0].name, 'Þorfinn Karlsefni');
  assert.equal(simulation.state.people[1].name, 'Guðríðr');
});
test('a seeded scenario recreates identical starting state', () => {
  const a = new Simulation({
    preset: 'households',
    seed: 42,
  });
  const b = new Simulation({
    preset: 'households',
    seed: 42,
  });
  assert.equal(a.serialize(), b.serialize());
  assert.notEqual(
    new Simulation({
      preset: 'households',
      seed: 43,
    }).serialize(),
    b.serialize(),
  );
  const c = new Simulation({
    ...a.state.config,
  });
  assert.equal(c.state.config.seed, a.state.config.seed);
  assert.deepEqual(c.state.people, a.state.people);
});
test('alternative campaigns change population, workforce, ships and inherited architecture', () => {
  const simulation = new Simulation({
    preset: 'households',
  });
  assert.equal(simulation.state.population, 120);
  assert.ok(simulation.workforce < 120);
  assert.equal(simulation.state.ships.length, 3);
  assert.equal(simulation.state.config.inheritedHall, false);
  assert.equal(simulation.order('restore', 0, 0), null);
  const capped = new Simulation({
    population: 240,
    ships: 1,
  });
  assert.equal(capped.state.population, 60);
});
test('construction respects staffing caps, site costs, stages and night rest', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const order = simulation.order('restore', 0, 0);
  simulation.commandWorkers(
    Array.from({ length: 16 }, (_, id) => id),
    { type: 'build', buildingId: order.id, x: 10, z: 20 },
  );
  onsiteHours(simulation, 10);
  const work = order.progress;
  assert.ok(work > 0 && work < 16 * 8 * 1.3);
  onsiteHours(simulation, 14);
  assert.equal(order.progress, work);
  finish(simulation, () => simulation.state.hallReady);
  assert.equal(simulation.winterShelter, 32);
  assert.equal(simulation.shelter, 112);
});
test('tent conversion cannot duplicate fabric or existing berths', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const order = simulation.order('tentbudir', 0, 45);
  assert.ok(order);
  assert.equal(simulation.state.resources.tents, 9);
  assert.equal(simulation.shelter, 72);
  simulation.advance(8);
  assert.equal(simulation.cancel(order.id), true);
  assert.equal(simulation.state.resources.tents, 10);
  assert.equal(simulation.shelter, 80);
  assert.equal(simulation.cancel(order.id), false);
});
test('sail shelter reserves a real anchored ship sail and recovers it on dismantling', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const order = simulation.order('sailbudir', 0, 45);
  assert.ok(order);
  simulation.commandWorkers([1, 2, 3, 4, 5, 6], {
    type: 'build',
    buildingId: order.id,
    x: 6,
    z: 45,
  });
  assert.equal(simulation.state.resources.sails, 3);
  assert.equal(simulation.state.ships[order.sailShip].sail, false);
  finish(simulation, () => simulation.has('sailbudir'));
  assert.equal(simulation.shelter, 96);
  assert.equal(simulation.dismantle(order.id), true);
  assert.equal(simulation.state.resources.sails, 4);
  assert.equal(simulation.state.ships[order.sailShip].sail, true);
});
test('invalid sites and unaffordable structures spend nothing', () => {
  const simulation = new Simulation();
  const before = simulation.serialize();
  assert.equal(simulation.order('longhouse', 40, 40), null);
  assert.equal(simulation.order('sailbudir', -110, 0), null);
  assert.equal(simulation.order('sailbudir', 0, 0), null);
  assert.equal(simulation.serialize(), before);
});
test('parallel construction never double-books the same people', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const a = simulation.order('sailbudir', 0, 45);
  const b = simulation.order('tentbudir', 15, 50);
  assert.ok(a && b);
  simulation.commandWorkers([0, 1, 2, 3, 4, 5], { type: 'build', buildingId: a.id, x: 6, z: 45 });
  simulation.commandWorkers([6, 7, 8, 9], { type: 'build', buildingId: b.id, x: 22, z: 50 });
  onsiteHours(simulation, 8);
  assert.equal(simulation.state.flow.labor, 80);
  assert.equal(
    simulation.crewDistribution().reduce((n, c) => n + c.assigned, 0),
    10,
  );
});
test('accelerated and fractional clocks produce the same whole-hour world', () => {
  const a = new Simulation();
  const b = new Simulation();
  stockBuildingMaterials(a);
  stockBuildingMaterials(b);
  a.order('restore', 0, 0);
  b.order('restore', 0, 0);
  a.advance(24 * 35);
  for (let i = 0; i < 35 * 24 * 10; i++) {
    b.advance(0.1);
  }
  const sa = snapshot(a);
  const sb = snapshot(b);
  sa.time = Math.round(sa.time);
  sb.time = Math.round(sb.time);
  assert.deepEqual(sa, sb);
});
test('named orders cannot double-book adults or recruit children', () => {
  const simulation = new Simulation({ preset: 'households' });
  const ids = simulation.state.people.map((person) => person.id);
  assert.equal(
    simulation.commandWorkers([...ids, ...ids], { type: 'work', task: 'fishing', x: 0, z: 20 }),
    simulation.workforce,
  );
  assert.equal(simulation.assigned, simulation.workforce);
  simulation.commandWorkers(ids, { type: 'gather', resource: 'hay', x: 45, z: 45 });
  assert.equal(simulation.roster().fishing.length, 0);
  assert.equal(simulation.assigned, simulation.workforce);
});
test('survey parties reserve food and actual people, then return dated knowledge', () => {
  const simulation = new Simulation();
  const food = simulation.state.foods.driedFish;
  const w = simulation.workforce;
  assert.equal(simulation.scout('woodland'), true);
  assert.equal(simulation.workforce, w - 4);
  assert.ok(simulation.state.foods.driedFish < food);
  simulation.advance(24 * 4);
  assert.equal(simulation.state.scouts.length, 0);
  assert.equal(simulation.workforce, w);
  assert.equal(simulation.state.regions.find((r) => r.id === 'woodland').known, true);
  assert.equal(simulation.state.metrics.scoutReturns, 1);
});
test(
  'a voyage removes ship, crew, cargo and provisions, then returns a single ' + 'physical shipment',
  () => {
    const simulation = new Simulation();
    stockBuildingMaterials(simulation);
    simulation.commandWorkers(
      Array.from({ length: 70 }, (_, id) => id),
      { type: 'work', task: 'fishing', x: 0, z: 20 },
    );
    simulation.commandWorkers(
      Array.from({ length: 40 }, (_, id) => id + 70),
      { type: 'work', task: 'foraging', x: 48, z: -37 },
    );
    simulation.commandWorkers(
      Array.from({ length: 20 }, (_, id) => id + 110),
      { type: 'work', task: 'herding', x: -38, z: 32 },
    );
    simulation.commandWorkers(
      Array.from({ length: 20 }, (_, id) => id + 130),
      { type: 'gather', resource: 'timber', x: 70, z: 45 },
    );
    const wood = simulation.state.resources.timber;
    const food = simulation.state.foods.driedFish;
    const w = simulation.workforce;
    const v = simulation.launch(0, 'greenland', 8, 6);
    assert.ok(v);
    assert.equal(simulation.state.resources.timber, wood - 6);
    assert.ok(simulation.state.foods.driedFish < food);
    assert.equal(simulation.workforce, w - 8);
    assert.equal(simulation.state.ships[0].status, 'at sea');
    assert.equal(simulation.launch(0, 'greenland', 8, 6), null);
    provision(simulation);
    simulation.advance(24 * 55);
    assert.equal(simulation.state.voyages.length, 0);
    assert.equal(simulation.state.ships[0].status, 'anchored');
    assert.equal(simulation.state.metrics.tradeReturns, 1);
    assert.ok(simulation.state.resources.iron > 40);
    simulation.advance(24 * 3);
    assert.equal(simulation.state.metrics.tradeReturns, 1);
  },
);
test('payload and voyage food constraints reject unsafe departures', () => {
  const simulation = new Simulation();
  simulation.state.resources.timber = 100;
  assert.match(simulation.voyageQuote(0, 'iceland', 16, 40).reason, /payload/);
  simulation.state.foods.driedFish = 0;
  assert.match(simulation.voyageQuote(0, 'greenland', 8, 1).reason, /provisions/);
  simulation.state.ships[0].sail = false;
  assert.match(simulation.voyageQuote(0, 'greenland', 8, 1).reason, /sail/);
});
test('assembly consent resolves a supported shorter work day without automatic law unlocks', () => {
  const simulation = new Simulation();
  assert.equal(simulation.propose('workHours', 6), true);
  assert.equal(simulation.state.politics.workHours, 8);
  assert.equal(simulation.propose('workHours', 10), false);
  simulation.advance(24);
  assert.equal(simulation.state.politics.workHours, 6);
  assert.equal(simulation.state.metrics.assemblies, 1);
  assert.equal(simulation.state.politics.proposal, null);
});
test('households can reject an unpopular demand', () => {
  const simulation = new Simulation();
  simulation.state.people.forEach((person) => (person.trust = 25));
  assert.equal(simulation.propose('workHours', 10), true);
  simulation.advance(24);
  assert.equal(simulation.state.politics.workHours, 8);
  assert.match(simulation.state.journal.at(-1).text, /declines/);
});
test('cold-season fodder use follows actual species and selective slaughter', () => {
  const simulation = new Simulation();
  simulation.state.time = 100 * 24 + 8;
  simulation.state.resources.hay = 1000;
  completed(simulation, 'byre');
  simulation.advance(24);
  assert.ok(Math.abs(simulation.state.resources.hay - 900) < 1e-6);
  const meat = simulation.state.foods.meat;
  assert.equal(simulation.cull('cattle', 1), true);
  assert.equal(simulation.state.livestock.cattle, 7);
  assert.ok(Math.abs(simulation.state.foods.meat - meat - 140) < 1e-6);
  assert.equal(simulation.hayDemand, 92);
  assert.equal(simulation.cull('goats', 20), false);
});
test('camp water and camp care have traceable health consequences', () => {
  const a = new Simulation({
    preset: 'traders',
  });
  const b = new Simulation({
    preset: 'traders',
  });
  for (const s of [a, b]) {
    s.state.time = 170 * 24 + 8;
    s.state.foods.driedFish = 5000;
    completed(s, 'longhouse');
    completed(s, 'longhouse', 55, 0);
    s.state.resources.firewood = 5000;
    s.commandWorkers([1, 2, 3, 4, 5, 6, 7, 8], { type: 'work', task: 'herding', x: -38, z: 32 });
  }
  b.state.resources.firewood = 0;
  b.state.resources.water = 0;
  b.commandWorkers([1, 2, 3, 4, 5, 6, 7, 8], { type: 'stop' });
  onsiteHours(a, 24 * 4);
  onsiteHours(b, 24 * 4);
  assert.ok(a.state.health > b.state.health);
  assert.equal(a.state.lastWarmth, b.state.lastWarmth, 'Stocked wood alone supplies no heat');
  assert.ok(a.state.lastWater > b.state.lastWater);
});
test('summer returns after a full calendar cycle rather than permanent winter', () => {
  const simulation = new Simulation();
  simulation.state.time = 100 * 24 + 8;
  assert.equal(simulation.season, 'winter');
  simulation.state.time = 365 * 24 + 8;
  assert.equal(simulation.season, 'summer');
  assert.ok(simulation.weather.temp > 0);
  assert.equal(simulation.date.getUTCFullYear(), 1006);
});
test(
  'a provisioned, housed harbour in mild weather can complete a full year with stocks and skills ' +
    'retained',
  () => {
    const simulation = new Simulation({
      preset: 'traders',
    });
    // Isolate calendar and provisions from the separately tested fire-tending model.
    const weather = Object.getOwnPropertyDescriptor(Simulation.prototype, 'weather').get;
    Object.defineProperty(simulation, 'weather', {
      get() {
        return { ...weather.call(this), temp: 18, feels: 18, snow: false };
      },
    });
    completed(simulation, 'longhouse', 0, 50);
    completed(simulation, 'longhouse', 45, 20);
    completed(simulation, 'smokehouse', -40, 20);
    completed(simulation, 'well', 45, -25);
    completed(simulation, 'woodshed', 10, -45);
    simulation.commandWorkers(
      Array.from({ length: 28 }, (_, id) => id),
      { type: 'work', task: 'fishing', x: 0, z: 20 },
    );
    simulation.commandWorkers(
      Array.from({ length: 10 }, (_, id) => id + 28),
      { type: 'gather', resource: 'timber', x: 70, z: 45 },
    );
    simulation.commandWorkers(
      Array.from({ length: 8 }, (_, id) => id + 38),
      { type: 'work', task: 'herding', x: -38, z: 32 },
    );
    provision(simulation);
    simulation.advance(24 * 366);
    assert.equal(simulation.day, 366);
    assert.equal(simulation.state.population, 48);
    assert.ok(simulation.state.health > 50);
    assert.equal(simulation.state.lastYear, 1006);
    assert.equal(simulation.state.ledger.length, 366);
    assert.ok(Simulation.load(simulation.serialize()));
  },
);
test('garden yields require a planted spring and cannot repeat an autumn harvest', () => {
  const simulation = new Simulation({
    preset: 'households',
  });
  const building = completed(simulation, 'garden');
  const Storage = require('../storage.js');
  Storage.syncStores(simulation.state);
  Storage.withdraw(simulation.state, 'camp', 'seeds', 2);
  Storage.deposit(simulation.state, 'building:' + building.id, 'seeds', 2);
  simulation.advance(24);
  assert.equal(building.plantedYear, 1005);
  simulation.state.time = ((Date.UTC(1005, 8, 1) - simulation.state.startDate) / 86400000) * 24 + 8;
  simulation.advance(24);
  assert.equal(building.harvested, true);
  const harvests = simulation.state.journal.filter(
    (j) => j.kind === 'farming' && j.text.includes('harvest'),
  ).length;
  simulation.advance(24);
  assert.equal(
    simulation.state.journal.filter((j) => j.kind === 'farming' && j.text.includes('harvest'))
      .length,
    harvests,
  );
});
test('saves round-trip all systems and reject broken people, stock and crew reservations', () => {
  const simulation = new Simulation();
  simulation.scout('woodland');
  simulation.order('sailbudir', 0, 45);
  simulation.advance(10);
  assert.equal(Simulation.load(simulation.serialize()).serialize(), simulation.serialize());
  const x = snapshot(simulation);
  x.resources.firewood = -1;
  assert.equal(Simulation.load(JSON.stringify(x)), null);
  const y = snapshot(simulation);
  y.people[1].id = 0;
  assert.equal(Simulation.load(JSON.stringify(y)), null);
  const z = snapshot(simulation);
  z.scouts.push({
    ...z.scouts[0],
    id: 999,
  });
  assert.equal(Simulation.load(JSON.stringify(z)), null);
  assert.equal(Simulation.load('garbage'), null);
});
test('legacy save migration preserves fabric reservations and repair progress', () => {
  const old = {
    version: 1,
    time: 32,
    population: 160,
    resources: {
      food: 2000,
      timber: 10,
      turf: 30,
      stone: 2,
      iron: 40,
      sails: 3,
      tents: 10,
      hay: 1000,
      charcoal: 0,
    },
    tasks: {
      builders: 40,
      fishing: 32,
      foraging: 24,
      timber: 20,
      turf: 20,
      hay: 16,
      herding: 8,
      craft: 0,
    },
    buildings: [],
    queue: [
      {
        id: 1,
        type: 'sailbudir',
        x: 0,
        z: 45,
        rotation: 0,
        progress: 80,
        assigned: 8,
      },
    ],
    nextId: 2,
    journal: [],
    hallReady: false,
  };
  const s = Simulation.load(JSON.stringify(old));
  assert.ok(s);
  assert.equal(s.state.queue[0].progress, 80);
  assert.equal(s.state.ships[0].sail, false);
  s.cancel(1);
  assert.equal(s.state.ships[0].sail, true);
  assert.equal(s.state.resources.sails, 4);
});
test('all stocks remain finite and nonnegative over multiple seeds and seasons', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const simulation = new Simulation({
      preset: 'traders',
      seed,
    });
    for (let month = 0; month < 18 && !simulation.state.gameOver; month++) {
      simulation.advance(24 * 30);
      for (const v of Object.values(simulation.state.resources)) {
        assert.ok(Number.isFinite(v) && v >= -1e-7);
      }
      for (const v of Object.values(simulation.state.foods)) {
        assert.ok(Number.isFinite(v) && v >= -1e-7);
      }
      assert.ok(simulation.assigned <= simulation.workforce);
      assert.ok(Simulation.load(simulation.serialize()));
    }
  }
});
