const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../simulation.js');
const Hearths = require('../hearths.js');
const Storage = require('../storage.js');
const Spaces = require('../building-spaces.js');
const { navigation, provision } = require('./work-fixtures.cjs');

function fixture(room = 'II', moisture = 0.2) {
  const sim = new Simulation();
  provision(sim);
  const definition = Hearths.definitions(sim.state).find((item) => item.id === 'hall:' + room);
  const person = sim.state.people[0];
  Object.assign(
    person,
    Spaces.toWorld(definition.room, { x: room === 'IV' ? 0.1 : 1, z: room === 'IV' ? 1 : 0 }),
  );
  Storage.deposit(sim.state, definition.storeId, 'firewood', 20, moisture);
  for (const [key, amount] of Object.entries({
    water: 16,
    grain: 4,
    freshFish: 4,
    plants: 4,
    meat: 4,
  }))
    Storage.deposit(sim.state, definition.storeId, key, amount);
  return { sim, definition, person, id: definition.id };
}
function ignite(fixture, kg = 2) {
  const { sim, person, id } = fixture;
  assert.equal(Hearths.addFuel(sim, person, id, kg), '');
  assert.equal(Hearths.light(sim, person, id), '');
  return Hearths.stateFor(sim, id);
}

test('every Hall F hearth can burn before repairs; only local or hand-carried wood is consumed', () => {
  for (const room of ['I', 'II', 'III', 'IV']) {
    const f = fixture(room),
      camp = f.sim.state.storage.stores.camp.stock.firewood;
    assert.equal(f.sim.state.hallReady, false);
    const fire = ignite(f);
    f.sim.advance(3 / 60);
    assert.ok(fire.powerKW > 1 && fire.airTemperature > f.sim.weather.temp);
    assert.equal(f.sim.state.storage.stores.camp.stock.firewood, camp);
    assert.ok(Math.abs(fire.fuelKg + fire.burnedKg - 2) < 1e-9);
    assert.ok(f.sim.state.flow.consumption.firewood > 0);
    assert.ok(Simulation.load(f.sim.serialize()));
  }
});

test('stock does not heat people or disappear until someone actually loads and lights a hearth', () => {
  const f = fixture(),
    wood = f.sim.state.resources.firewood;
  f.sim.advance(1);
  assert.equal(f.sim.state.resources.firewood, wood);
  assert.equal(Hearths.view(f.sim, f.id).powerKW, 0);
  Object.assign(f.person, { x: 0, z: 20 });
  assert.equal(Hearths.pickupWood(f.sim, f.person, 2), '');
  assert.equal(f.person.carriedFirewood, 2);
  assert.match(Hearths.addFuel(f.sim, f.person, f.id, 2), /beside/);
  Object.assign(f.person, Spaces.toWorld(f.definition.room, { x: 1, z: 0 }));
  f.sim.state.storage.stores[f.definition.storeId].stock.firewood = 0;
  assert.equal(Hearths.addFuel(f.sim, f.person, f.id, 2), '');
  assert.equal(f.person.carriedFirewood, 0);
  assert.equal(Hearths.view(f.sim, f.id).fuelKg, 2);
});

test('larger loads raise bounded output; wet wood yields less heat and requires dry ignition material', () => {
  const small = fixture(),
    large = fixture(),
    wet = fixture('II', 0.5);
  ignite(small, 0.5);
  ignite(large, 4);
  assert.equal(Hearths.addFuel(wet.sim, wet.person, wet.id, 2), '');
  assert.match(Hearths.light(wet.sim, wet.person, wet.id), /wet/);
  Hearths.stateFor(wet.sim, wet.id).embersKg = 0.02;
  assert.equal(Hearths.light(wet.sim, wet.person, wet.id), '');
  for (const f of [small, large, wet]) f.sim.advance(5 / 60);
  assert.ok(Hearths.view(large.sim, large.id).powerKW > Hearths.view(small.sim, small.id).powerKW);
  assert.ok(Hearths.view(large.sim, large.id).powerKW < 20);
  assert.ok(Hearths.view(wet.sim, wet.id).powerKW < Hearths.view(large.sim, large.id).powerKW);
  assert.ok(Hearths.heatValue(0.5) < Hearths.heatValue(0.2));
});

test('refuelling conserves wood, room heat is local, embers and stones cool after combustion', () => {
  const f = fixture(),
    fire = ignite(f, 2);
  f.sim.state.hallReady = true;
  f.sim.advance(0.5);
  const warm = Hearths.comfort(f.sim, f.person);
  assert.ok(warm > Hearths.comfort(f.sim, { ...f.person, x: 100, z: 100, shelterWarmth: 0 }));
  assert.equal(Hearths.addFuel(f.sim, f.person, f.id, 2), '');
  f.sim.advance(0.5);
  assert.ok(fire.powerKW > 1);
  const hotStone = fire.stoneTemperature;
  f.sim.advance(10);
  assert.ok(fire.fuelKg < 0.0001 && fire.embersKg < 0.0001 && fire.powerKW < 0.01);
  assert.ok(fire.stoneTemperature < hotStone);
  assert.ok(
    fire.releasedMJ <=
      fire.burnedKg * Hearths.heatValue(fire.moisture) * Hearths.PHYSICS.combustionEfficiency +
        1e-6,
  );
});

test('a four-litre soup needs actual sensible heat, simmer time and a plausible wood load', () => {
  const f = fixture(),
    fire = ignite(f, 4);
  const beforeGrain = f.sim.state.foods.grain;
  assert.equal(Hearths.startSoup(f.sim, f.person, f.id, 'fish', 4), '');
  assert.equal(f.sim.state.foods.grain, beforeGrain - 0.5);
  const kcal = fire.pot.kcal;
  f.sim.advance(10 / 60);
  assert.ok(Hearths.potTemperature(fire.pot) > 40 && Hearths.potTemperature(fire.pot) < 95);
  assert.equal(Hearths.ready(fire.pot), false);
  f.sim.advance(15 / 60);
  assert.equal(Hearths.ready(fire.pot), true);
  assert.ok(Hearths.potTemperature(fire.pot) <= 100.00001);
  assert.ok(fire.pot.fuelUsedKg > 1 && fire.pot.fuelUsedKg < 3);
  assert.ok(fire.heatToPotMJ > 1.5);
  assert.ok(fire.pot.evaporatedKg > 0);
  assert.match(Hearths.serve(f.sim, f.person, f.id), /cool/);
  fire.pot.onFire = false;
  f.sim.advance(25 / 60);
  assert.ok(Hearths.potTemperature(fire.pot) < 65);
  assert.equal(Hearths.serve(f.sim, f.person, f.id), '');
  assert.ok(f.person.mealCalories > 0 && f.person.drinkingWaterCredit > 0);
  assert.ok(Math.abs(f.person.mealCalories + fire.pot.kcal - kcal) < 1e-8);
  const credit = f.person.mealCalories;
  f.sim.advance(0.2);
  assert.ok(f.person.mealCalories < credit, 'A served bowl replaces subsequent camp rations');
});

test('an unlit pot does not cook; lifted soup cools and unrefrigerated soup eventually spoils', () => {
  const f = fixture();
  assert.equal(Hearths.startSoup(f.sim, f.person, f.id, 'pottage', 4), '');
  const pot = Hearths.view(f.sim, f.id).pot;
  f.sim.advance(2.1);
  assert.equal(pot.cookedSeconds, 0);
  assert.equal(pot.spoiled, true);
  assert.equal(Hearths.ready(pot), false);
  assert.match(Hearths.serve(f.sim, f.person, f.id), /spoiled/);
});

test('frozen water absorbs fusion energy before rising above zero', () => {
  const pot = { waterKg: 4, foodKg: 1.25, energyKJ: -4 * Hearths.PHYSICS.fusionKJ };
  assert.equal(Hearths.potTemperature(pot), 0);
  pot.energyKJ /= 2;
  assert.equal(Hearths.potTemperature(pot), 0);
  pot.energyKJ = Hearths.heatCapacity(pot) * 50;
  assert.ok(Math.abs(Hearths.potTemperature(pot) - 50) < 1e-10);
});

test('seasoning loses water mass without creating dry wood, and a woodshed dries faster', () => {
  const sim = new Simulation();
  const covered = Storage.cache(sim.state, 'wood-test:covered', { x: 40, z: 40 });
  covered.type = 'woodshed';
  const outside = Storage.cache(sim.state, 'wood-test:outside', { x: 42, z: 40 });
  for (const store of [covered, outside]) Storage.deposit(sim.state, store.id, 'firewood', 20, 0.5);
  for (let hour = 0; hour < 30 * 24; hour++)
    Hearths.seasonWood(sim.state, { temp: 15, rain: false });
  for (const store of [covered, outside]) {
    assert.ok(store.stock.firewood < 20 && store.woodMoisture < 0.5);
    assert.ok(Math.abs(store.stock.firewood * (1 - store.woodMoisture) - 10) < 1e-9);
  }
  assert.ok(covered.woodMoisture < outside.woodMoisture);
});

test('smothering leaves live embers; save/load retains exact fuel, room heat and pot state', () => {
  const f = fixture(),
    fire = ignite(f, 4);
  Hearths.startSoup(f.sim, f.person, f.id, 'meat', 4);
  f.sim.advance(12 / 60);
  assert.equal(Hearths.bank(f.sim, f.person, f.id), '');
  f.sim.advance(1 / 3600);
  assert.equal(fire.flameKW, 0);
  assert.ok(fire.powerKW > 0 && fire.embersKg > 0);
  const loaded = Simulation.load(f.sim.serialize());
  assert.ok(loaded);
  assert.deepEqual(loaded.state.hearths, f.sim.state.hearths);
  f.sim.advance(0.1);
  loaded.advance(0.1);
  assert.deepEqual(loaded.state.hearths, f.sim.state.hearths);
  for (const mutate of [
    (state) => (state.hearths.fires[f.id].fuelKg = -1),
    (state) => (state.hearths.fires[f.id].moisture = 2),
    (state) => (state.hearths.fires[f.id].pot.energyKJ = null),
    (state) => (state.people[0].carriedFirewood = 100),
  ]) {
    const state = JSON.parse(f.sim.serialize());
    mutate(state);
    assert.equal(Simulation.load(JSON.stringify(state)), null);
  }
});

test('1×, 3× and 8× run the identical combustion and cooking timeline', () => {
  const results = [];
  for (const speed of [1, 3, 8]) {
    const f = fixture();
    ignite(f, 2);
    Hearths.startSoup(f.sim, f.person, f.id, 'fish', 4);
    const nav = navigation(f.sim);
    for (let elapsed = 0; elapsed < 24; elapsed++) f.sim.advanceRealtime(speed, nav);
    // Advance each run to exactly 192 simulated seconds.
    f.sim.advanceRealtime(192 - 24 * speed, nav);
    results.push(f.sim.state.hearths);
  }
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
});

test('hearths consume manual firewood with its moisture and preserve other hand loads', () => {
  const f = fixture();
  const store = f.sim.state.storage.stores[f.definition.storeId];
  store.stock.firewood = 0;
  f.person.cargo = {
    resource: 'firewood',
    amount: 3,
    moisture: 0.3,
    sourceStoreId: 'camp',
    manual: true,
  };
  assert.equal(Hearths.addFuel(f.sim, f.person, f.id, 2), '');
  assert.equal(f.person.cargo.amount, 1);
  assert.equal(Hearths.stateFor(f.sim, f.id).moisture, 0.3);
  assert.equal(Hearths.addFuel(f.sim, f.person, f.id, 1), '');
  assert.equal(f.person.cargo, null);
  f.person.cargo = { resource: 'grain', amount: 3, sourceStoreId: 'camp', manual: true };
  assert.match(Hearths.addFuel(f.sim, f.person, f.id, 1), /Carry firewood/);
  assert.equal(f.person.cargo.amount, 3);
});
