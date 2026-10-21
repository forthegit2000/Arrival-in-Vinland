const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, TYPES } = require('../simulation.js');
const Cheats = require('../cheats.js');
const Storage = require('../storage.js');
const Hearths = require('../hearths.js');
const Spaces = require('../building-spaces.js');
const { navigation } = require('./work-fixtures.cjs');

function site(sim, type) {
  for (let x = -90; x <= 90; x += 15)
    for (let z = -90; z <= 90; z += 15) if (sim.canPlace(type, x, z, 0.37)) return { x, z };
  throw Error('No valid test site for ' + type);
}
function enable(sim) {
  Cheats.configure(sim, { enabled: true });
}

test('weather presets require opt-in, remain physically consistent and do not advance work', () => {
  const sim = new Simulation();
  const natural = sim.weather;
  const before = sim.serialize();
  assert.equal(Cheats.setWeather(sim, 'snow'), false);
  assert.equal(sim.serialize(), before);
  enable(sim);
  const time = sim.state.time;
  const labor = sim.state.flow.labor;
  for (const [preset, name] of Object.entries(Cheats.WEATHER_PRESETS)) {
    assert.equal(Cheats.setWeather(sim, preset), true);
    const weather = sim.weather;
    if (preset === 'natural') assert.deepEqual(weather, natural);
    else assert.equal(weather.name, name.toUpperCase());
    assert.equal(weather.daylight, natural.daylight);
    assert.equal(weather.sunriseHour, natural.sunriseHour);
    assert.equal(weather.sunsetHour, natural.sunsetHour);
    assert.equal(weather.feels, weather.temp - Math.max(0, weather.wind - 12) * 0.12);
    if (preset === 'snow') {
      assert.ok(weather.temp <= -2);
      assert.ok(weather.rain && weather.snow && !weather.gale);
    }
    if (preset === 'rain') {
      assert.ok(weather.temp >= 3);
      assert.ok(weather.rain && !weather.snow && !weather.gale);
    }
    if (preset === 'gale') assert.ok(weather.gale && weather.rain);
    if (preset === 'fair') assert.ok(!weather.rain && !weather.snow && !weather.gale);
    assert.equal(sim.state.time, time);
    assert.equal(sim.state.flow.labor, labor);
  }
  const valid = sim.serialize();
  for (const preset of ['unknown', '', '__proto__', null, {}, ['snow']])
    assert.equal(Cheats.setWeather(sim, preset), false);
  assert.equal(sim.serialize(), valid);
});

test('weather overrides persist, disable cleanly and accept older saves without a preset', () => {
  const sim = new Simulation();
  const natural = sim.weather;
  enable(sim);
  Cheats.setWeather(sim, 'snow');
  const loaded = Simulation.load(sim.serialize());
  assert.ok(loaded);
  assert.deepEqual(loaded.weather, sim.weather);
  assert.equal(loaded.state.cheats.used, true);
  Cheats.configure(loaded, { enabled: false });
  assert.deepEqual(loaded.weather, natural);
  Cheats.configure(loaded, { enabled: true });
  assert.equal(loaded.weather.name, 'SNOW');
  Cheats.setWeather(loaded, 'natural');
  assert.deepEqual(loaded.weather, natural);
  const state = JSON.parse(loaded.serialize());
  delete state.cheats.weather;
  assert.ok(Simulation.load(JSON.stringify(state)));
  for (const preset of ['unknown', null, {}, 3]) {
    state.cheats.weather = preset;
    assert.equal(Simulation.load(JSON.stringify(state)), null);
  }
});

test('cheats default off, reject disabled commands and never change ordinary affordability', () => {
  const sim = new Simulation();
  const before = sim.serialize(),
    point = site(sim, 'longhouse');
  assert.equal(Cheats.settings(sim.state).enabled, false);
  assert.equal(Cheats.spawn(sim, 'firewood', 25, point), null);
  assert.equal(Cheats.build(sim, 'longhouse', point.x, point.z), null);
  assert.equal(Cheats.repairAll(sim), false);
  assert.equal(Cheats.heal(sim), false);
  assert.equal(sim.serialize(), before);
  assert.equal(Cheats.configure(sim, { enabled: 'yes' }), false);
});

test('every building completes immediately for free with no workers, including fabric shelters', () => {
  for (const type of Object.keys(TYPES)) {
    const sim = new Simulation();
    for (const key of Storage.MATERIALS) sim.state.resources[key] = 0;
    sim.state.resources.tents = sim.state.resources.sails = 0;
    for (const ship of sim.state.ships) ship.sail = false;
    enable(sim);
    const point = site(sim, type),
      before = { ...sim.state.resources },
      time = sim.state.time;
    const building = sim.order(type, point.x, point.z, 0.37);
    assert.ok(building, type);
    assert.equal(sim.state.queue.length, 0, type);
    assert.equal(sim.state.flow.labor, 0, type);
    assert.equal(sim.state.time, time, type);
    assert.deepEqual({ ...sim.state.resources }, before, type);
    if (type === 'restore') assert.equal(sim.state.hallReady, true);
    else {
      assert.equal(sim.state.buildings.at(-1).progress, TYPES[type].hours);
      assert.equal(sim.state.buildings.at(-1).rotation, 0.37);
      assert.ok(sim.state.storage.stores['building:' + building.id]);
    }
    assert.ok(Simulation.load(sim.serialize()), type + ' save');
  }
});

test('free construction respects geography and collisions, and disabling restores normal costs', () => {
  const sim = new Simulation();
  enable(sim);
  assert.equal(sim.order('longhouse', 0, 0), null, 'Hall overlap stays blocked');
  assert.equal(sim.order('not-a-building', 45, 45), null);
  const point = site(sim, 'longhouse');
  assert.ok(sim.order('longhouse', point.x, point.z));
  assert.equal(sim.order('longhouse', point.x, point.z), null);
  Cheats.configure(sim, { enabled: false });
  sim.state.resources.timber = 0;
  assert.match(sim.blockedReason('longhouse'), /timber/);
  assert.equal(Cheats.settings(sim.state).used, true);
});

test('dismantling a free fabric shelter cannot create tents or return an unreserved sail', () => {
  for (const type of ['sailbudir', 'tentbudir']) {
    const sim = new Simulation();
    enable(sim);
    const before = { ...sim.state.resources },
      sails = sim.state.ships.map((ship) => ship.sail);
    const point = site(sim, type),
      building = sim.order(type, point.x, point.z);
    assert.equal(sim.dismantle(building.id), true);
    assert.deepEqual({ ...sim.state.resources }, before);
    assert.deepEqual(
      sim.state.ships.map((ship) => ship.sail),
      sails,
    );
  }
});

test('resource piles are real local inventories, conserve moisture and can be picked up normally', () => {
  const sim = new Simulation();
  enable(sim);
  const person = sim.state.people[0],
    point = { x: 45, z: 45 };
  Object.assign(person, point);
  const before = sim.state.resources.firewood;
  const store = Cheats.spawn(sim, 'firewood', 25, point, null, 0.5);
  assert.ok(store.cheatPile);
  assert.equal(store.stock.firewood, 25);
  assert.equal(sim.state.resources.firewood, before + 25);
  assert.equal(Hearths.pickupWood(sim, person, 2), '');
  assert.equal(store.stock.firewood, 23);
  assert.equal(person.carriedFirewood, 2);
  assert.equal(person.carriedWoodMoisture, 0.5);
  for (const amount of [-1, 0, Infinity, NaN, 1000001])
    assert.equal(Cheats.spawn(sim, 'firewood', amount, point), null);
  assert.equal(Cheats.spawn(sim, 'sails', 1, point), null);
  assert.ok(Simulation.load(sim.serialize()));
});

test('instant repairs charge no materials; finishing existing work returns reservations and releases crew', () => {
  const sim = new Simulation(),
    point = site(sim, 'turfhouse');
  Object.assign(sim.state.resources, { timber: 1000, turf: 1000, stone: 1000 });
  const before = sim.state.resources.timber;
  const order = sim.order('turfhouse', point.x, point.z);
  sim.commandWorkers([1], { type: 'build', buildingId: order.id, x: point.x, z: point.z });
  sim.state.time = 8;
  Object.assign(sim.state.people[1], { x: 0, z: 20 });
  sim.advanceRealtime(40, navigation(sim));
  assert.ok(sim.state.people[1].cargo);
  enable(sim);
  assert.equal(Cheats.finishSites(sim), 1);
  assert.equal(sim.state.queue.length, 0);
  assert.equal(sim.state.people[1].order, null);
  assert.equal(sim.state.people[1].cargo, null);
  assert.ok(Math.abs(sim.state.resources.timber - before) < 1e-8);
  const building = sim.state.buildings[0];
  building.condition = 20;
  const resources = { ...sim.state.resources };
  assert.equal(sim.repair(building.id), true);
  assert.equal(building.condition, 100);
  sim.state.ships[0].condition = 20;
  assert.equal(sim.repair(0, true), true);
  assert.equal(sim.state.ships[0].condition, 100);
  assert.deepEqual({ ...sim.state.resources }, resources);
  assert.ok(Simulation.load(sim.serialize()));
});

test('hearth shortcuts stock the actual room and finish a pot without advancing the clock', () => {
  const sim = new Simulation();
  enable(sim);
  const person = sim.state.people[0],
    hearth = Hearths.definitions(sim.state).find((item) => item.id === 'hall:II');
  Object.assign(person, Spaces.toWorld(hearth.room, { x: 1, z: 0 }));
  assert.equal(Cheats.supplyHearth(sim, person), true);
  assert.equal(sim.state.storage.stores[hearth.storeId].stock.water, 24);
  assert.equal(Hearths.startSoup(sim, person, hearth.id, 'fish', 4), '');
  const time = sim.state.time;
  assert.equal(Cheats.finishSoup(sim, person), true);
  const pot = Hearths.view(sim, hearth.id).pot;
  assert.equal(Hearths.ready(pot), true);
  assert.equal(sim.state.time, time);
  assert.equal(Hearths.serve(sim, person, hearth.id), '');
  assert.ok(Simulation.load(sim.serialize()));
});

test('bulk repairs leave unrelated construction in progress', () => {
  const sim = new Simulation();
  Object.assign(sim.state.resources, { timber: 1000, turf: 1000, stone: 1000 });
  const point = site(sim, 'turfhouse');
  const order = sim.order('turfhouse', point.x, point.z);
  enable(sim);
  assert.equal(Cheats.repairAll(sim), true);
  assert.equal(sim.state.hallReady, true);
  assert.deepEqual(
    sim.state.queue.map((item) => item.id),
    [order.id],
  );
  assert.equal(sim.state.buildings.length, 0);
  assert.ok(Simulation.load(sim.serialize()));
});

test('protection and lighting shortcuts persist, validate, and stop when disabled', () => {
  const sim = new Simulation();
  sim.state.people[0].health = 10;
  Cheats.configure(sim, { enabled: true, protectCrew: true });
  assert.equal(sim.state.people[0].health, 100);
  sim.state.people[0].health = 15;
  sim.advance(1);
  assert.equal(sim.state.people[0].health, 100);
  const labor = sim.state.flow.labor;
  assert.equal(Cheats.setHour(sim, 12), true);
  assert.equal(sim.hour, 12);
  assert.equal(sim.state.flow.labor, labor);
  assert.equal(Cheats.setHour(sim, 24), false);
  assert.deepEqual(Simulation.load(sim.serialize()).state.cheats, sim.state.cheats);
  for (const cheats of [null, [], { enabled: 'yes' }, { ...sim.state.cheats, instantBuild: 1 }]) {
    const state = JSON.parse(sim.serialize());
    state.cheats = cheats;
    assert.equal(Simulation.load(JSON.stringify(state)), null);
  }
  Cheats.configure(sim, { enabled: false });
  sim.state.people[0].health = 15;
  sim.advance(1);
  assert.ok(sim.state.people[0].health < 20);
});
