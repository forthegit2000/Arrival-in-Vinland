const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, TYPES } = require('../simulation.js');
const Storage = require('../storage.js');
const Spaces = require('../building-spaces.js');
const { navigation, stockBuildingMaterials } = require('./work-fixtures.cjs');

function completed(simulation, type, x = 10, z = 20) {
  const building = {
    id: simulation.state.nextId++,
    type,
    x,
    z,
    rotation: 0,
    condition: 100,
    hours: TYPES[type].hours,
    progress: TYPES[type].hours,
    cost: { ...TYPES[type].cost },
    sailShip: null,
  };
  simulation.state.buildings.push(building);
  Storage.syncStores(simulation.state);
  return simulation.state.storage.stores['building:' + building.id];
}
function smallSite(simulation) {
  const site = {
    id: simulation.state.nextId++,
    type: 'well',
    x: 10,
    z: 20,
    rotation: 0,
    progress: 0,
    hours: 1,
    cost: { timber: 0.03 },
    sailShip: null,
    assigned: 0,
  };
  assert.equal(Storage.reserveSite(simulation.state, site), true);
  simulation.state.queue.push(site);
  simulation.commandWorkers([1], { type: 'build', buildingId: site.id, x: 10, z: 20 });
  Object.assign(simulation.state.people[1], { x: 0, z: 20 });
  return site;
}

test('wood storage measures the stack including gaps without changing the wood quantity', () => {
  assert.ok(Math.abs(Storage.volume('timber', 0.7) - 1) < 1e-9);
  assert.ok(Math.abs(Storage.volume('firewood', 350) - 1) < 1e-9);
  const sim = new Simulation();
  const store = completed(sim, 'woodshed');
  store.capacity = 1;
  assert.ok(Math.abs(Storage.deposit(sim.state, store.id, 'firewood', 500) - 350) < 1e-9);
  assert.ok(Storage.roomFor(sim.state, store, 'timber') < 1e-9);
  assert.ok(Math.abs(store.stock.firewood - 350) < 1e-9);
});

test('shared indoor bays limit stacking height and keep the doorway and aisle free at any rotation', () => {
  const sim = new Simulation();
  const store = completed(sim, 'woodshed');
  const building = sim.state.buildings[0];
  building.rotation = 0.73;
  store.capacity = 1000; // Even an oversized numeric capacity cannot bypass floor space.
  const bays = Storage.indoorBays(sim.state, store);
  const expected =
    bays.reduce((sum, bay) => sum + bay.w * bay.d * bay.h, 0) / Storage.volume('firewood', 1);
  const accepted = Storage.deposit(sim.state, store.id, 'firewood', 10000);
  assert.ok(Math.abs(accepted - expected) < 1e-8);
  assert.equal(Storage.deposit(sim.state, store.id, 'firewood', 1), 0);
  for (const pile of Storage.resourcePiles(sim.state, store)) {
    const local = Spaces.toLocal(building, pile);
    assert.ok(Math.abs(local.x) - pile.w / 2 > 0.7, 'central aisle stays clear');
    assert.ok(local.z + pile.d / 2 < Spaces.plan(building.type).inside.z - 0.5);
    assert.equal(pile.h, Storage.STACK_HEIGHT);
    assert.ok(Math.abs(pile.occupied - pile.w * pile.d * pile.h) < 1e-9);
  }
});

test('new arrivals have no prepared firewood; old fuel stock and wood pile locations survive migration', () => {
  const sim = new Simulation();
  assert.equal(sim.state.resources.firewood, 0);
  const state = JSON.parse(sim.serialize());
  state.resources.firewood = 2200;
  state.storage.stores.camp.stock.firewood = 2200;
  state.storage.stores.camp.woodPlots = [{ resource: 'firewood', x: 40, z: 40 }];
  const loaded = Simulation.load(JSON.stringify(state));
  assert.ok(loaded);
  assert.equal(loaded.state.resources.firewood, 2200);
  assert.deepEqual(
    loaded.state.storage.stores.camp.resourcePlots,
    state.storage.stores.camp.woodPlots,
  );
  assert.equal(loaded.state.storage.stores.camp.woodPlots, undefined);
});

test('mixed resources compete for the same storage bays and retain their own positions', () => {
  const sim = new Simulation();
  const store = completed(sim, 'storehouse');
  store.capacity = 1000;
  Storage.deposit(sim.state, store.id, 'grain', 100);
  const grain = Storage.resourcePiles(sim.state, store).find((pile) => pile.resource === 'grain');
  Storage.deposit(sim.state, store.id, 'water', 80);
  Storage.deposit(sim.state, store.id, 'turf', 0.2);
  assert.deepEqual(
    Storage.resourcePiles(sim.state, store).find((pile) => pile.resource === 'grain'),
    grain,
  );
  const timber = Storage.deposit(sim.state, store.id, 'timber', 1000);
  assert.ok(timber > 0);
  assert.equal(Storage.roomFor(sim.state, store, 'hay'), 0);
  const piles = Storage.resourcePiles(sim.state, store);
  assert.equal(new Set(piles.map((pile) => pile.id)).size, piles.length);
  Storage.withdraw(sim.state, store.id, 'grain', 100);
  assert.ok(
    Storage.roomFor(sim.state, store, 'hay') > 0,
    'an emptied bay can hold a different material',
  );
  const loaded = Simulation.load(sim.serialize());
  assert.ok(loaded);
  assert.deepEqual(
    Storage.resourcePiles(loaded.state, loaded.state.storage.stores[store.id]),
    Storage.resourcePiles(sim.state, store),
  );
});

test('reserved wood stays in its source pile until pickup and pile locations survive save/load', () => {
  const sim = new Simulation();
  const camp = sim.state.storage.stores.camp;
  sim.state.resources.timber = 0.06;
  sim.state.resources.firewood = 0;
  camp.resourcePlots = [{ resource: 'timber', x: 40, z: 40 }];
  const before = Storage.resourcePiles(sim.state, camp);
  const site = smallSite(sim);
  assert.deepEqual(Storage.resourcePiles(sim.state, camp), before);
  sim.advanceRealtime(30, navigation(sim));
  const remaining = Storage.resourcePiles(sim.state, camp);
  assert.ok(Math.abs(remaining[0].occupied - Storage.volume('timber', 0.03)) < 1e-9);
  assert.equal(site.materials.timber.reservations[0].amount, 0);
  const loaded = Simulation.load(sim.serialize());
  assert.ok(loaded);
  assert.deepEqual(
    Storage.resourcePiles(loaded.state, loaded.state.storage.stores.camp),
    remaining,
  );
  const malformed = JSON.parse(sim.serialize());
  malformed.storage.stores.camp.resourcePlots[0].x = null;
  assert.equal(Simulation.load(JSON.stringify(malformed)), null);
});

test('occupied outdoor piles prevent building overlap, while emptied bays can be reused', () => {
  const sim = new Simulation();
  const camp = sim.state.storage.stores.camp;
  sim.state.resources.timber = 0;
  sim.state.resources.firewood = 15;
  camp.resourcePlots = [{ resource: 'firewood', x: 70, z: 60 }];
  assert.equal(sim.canPlace('well', 70, 60), false);
  Storage.withdraw(sim.state, 'camp', 'firewood', 15);
  assert.equal(sim.canPlace('well', 70, 60), true);
  stockBuildingMaterials(sim);
  assert.ok(sim.order('well', 70, 60));
  Storage.syncStores(sim.state);
  assert.deepEqual(camp.resourcePlots, []);
});

test('inventory totals are projections of named stores and deposits respect capacity and role', () => {
  const sim = new Simulation();
  const store = completed(sim, 'woodshed');
  const before = sim.state.resources.timber;
  assert.equal(Storage.deposit(sim.state, store.id, 'timber', 1), 1);
  assert.equal(sim.state.resources.timber, before + 1);
  assert.equal(Storage.deposit(sim.state, store.id, 'grain', 100), 0);
  store.capacity = 1;
  assert.equal(Storage.deposit(sim.state, store.id, 'timber', 0.1), 0);
  assert.equal(store.stock.timber, 1);
  assert.ok(Simulation.load(sim.serialize()));
});

test('remote food and water cannot satisfy camp consumption', () => {
  const sim = new Simulation();
  const store = completed(sim, 'storehouse');
  const stock = sim.state.storage.stores.camp.stock;
  for (const key of Storage.FOOD_KEYS) stock[key] = 0;
  Storage.deposit(sim.state, store.id, 'driedFish', 100);
  assert.ok(sim.foodDays > 0);
  assert.equal(sim.campFoodDays, 0);
  assert.equal(sim.consumeFood(3000), 0);
  assert.equal(store.stock.driedFish, 100);
  assert.ok(sim.alerts.some((alert) => alert.key === 'camp-supplies'));
});

test('builders collect reserved loads, travel and unload before earning onsite work', () => {
  const sim = new Simulation();
  stockBuildingMaterials(sim);
  const site = smallSite(sim);
  const nav = navigation(sim);
  sim.advanceRealtime(30, nav);
  assert.equal(site.progress, 0);
  assert.equal(site.materials.timber.delivered, 0);
  assert.equal(sim.state.people[1].cargo.amount, 0.03);
  const loaded = Simulation.load(sim.serialize());
  assert.ok(loaded, 'in-transit reservations survive loading');
  loaded.advanceRealtime(120, navigation(loaded));
  const restoredSite = loaded.state.queue.find((order) => order.id === site.id);
  assert.equal(restoredSite.materials.timber.delivered, 0.03);
  assert.ok(restoredSite.progress > 0 && restoredSite.progress < 120 / 3600);
  assert.equal(loaded.state.people[1].cargo, null);
});

test('interrupted construction cargo remains reserved in a cache at the worker position', () => {
  const sim = new Simulation();
  stockBuildingMaterials(sim);
  const site = smallSite(sim);
  sim.advanceRealtime(35, navigation(sim));
  const person = sim.state.people[1];
  assert.ok(person.cargo);
  const point = { x: person.x, z: person.z };
  sim.commandWorkers([1], { type: 'stop' });
  const reservation = site.materials.timber.reservations.find((entry) =>
    entry.storeId.startsWith('dropped:'),
  );
  const cache = sim.state.storage.stores[reservation.storeId];
  assert.equal(reservation.amount, 0.03);
  assert.deepEqual({ x: cache.x, z: cache.z }, point);
  assert.ok(Simulation.load(sim.serialize()));
  sim.commandWorkers([1], { type: 'build', buildingId: site.id, x: 10, z: 20 });
  sim.advanceRealtime(140, navigation(sim));
  assert.equal(site.materials.timber.delivered, 0.03);
});

test('cancelling work refunds uncollected stock to its source and keeps carried stock on the ground', () => {
  const sim = new Simulation();
  stockBuildingMaterials(sim);
  const initial = sim.state.resources.timber;
  const site = smallSite(sim);
  sim.advanceRealtime(35, navigation(sim));
  assert.equal(sim.cancel(site.id), true);
  assert.ok(Math.abs(sim.state.resources.timber - initial) < 1e-8);
  assert.equal(sim.state.people[1].cargo, null);
  assert.equal(sim.state.queue.length, 0);
  assert.ok(
    Object.values(sim.state.storage.stores).some(
      (store) => store.id.startsWith('dropped:') && store.stock.timber > 0,
    ),
  );
  assert.ok(Simulation.load(sim.serialize()));
});

test('hauling is a physical transfer, conserves stock and feeds camp only after unloading', () => {
  const sim = new Simulation();
  const store = completed(sim, 'storehouse');
  sim.state.resources.firewood = 0;
  Storage.deposit(sim.state, store.id, 'firewood', 30);
  sim.commandWorkers([1], { type: 'haul', destinationStoreId: 'camp', x: 0, z: 20 });
  Object.assign(sim.state.people[1], { x: 0, z: 20 });
  sim.advanceRealtime(45, navigation(sim));
  assert.equal(sim.state.storage.stores.camp.stock.firewood, 0);
  assert.ok(sim.state.people[1].cargo);
  assert.equal(sim.state.resources.firewood + sim.state.people[1].cargo.amount, 30);
  assert.ok(Simulation.load(sim.serialize()));
  sim.advanceRealtime(70, navigation(sim));
  assert.equal(sim.state.storage.stores.camp.stock.firewood, 15);
  assert.equal(sim.state.resources.firewood + (sim.state.people[1].cargo?.amount || 0), 30);
});

test('partially supplied cancelled work salvages only delivered material not already used', () => {
  const sim = new Simulation();
  stockBuildingMaterials(sim);
  const site = smallSite(sim);
  site.materials.timber.delivered = 0.015;
  site.materials.timber.reservations[0].amount = 0.015;
  site.progress = 0.25;
  sim.cancel(site.id);
  assert.ok(Math.abs(sim.state.storage.stores['salvage:' + site.id].stock.timber - 0.0075) < 1e-9);
});

test('unreachable and ruined stores never supply a hauling worker', () => {
  const sim = new Simulation();
  const store = completed(sim, 'storehouse');
  sim.state.resources.firewood = 0;
  Storage.deposit(sim.state, store.id, 'firewood', 30);
  sim.commandWorkers([1], { type: 'haul', destinationStoreId: 'camp', x: 0, z: 20 });
  const nav = navigation(sim);
  nav.storagePoint = () => null;
  sim.advanceRealtime(120, nav);
  assert.equal(store.stock.firewood, 30);
  assert.equal(sim.state.people[1].cargo, undefined);
  sim.state.buildings[0].condition = 10;
  assert.equal(Storage.available(sim.state, 'firewood'), 0);
  assert.equal(Storage.withdraw(sim.state, store.id, 'firewood', 1), 0);
});

test('charcoal preparation consumes only the actual pit buffer, not a remote warehouse', () => {
  const sim = new Simulation();
  const remote = completed(sim, 'storehouse');
  const pit = completed(sim, 'charcoal', 30, 20);
  sim.state.resources.firewood = 0;
  Storage.deposit(sim.state, remote.id, 'firewood', 200);
  const person = sim.state.people[1];
  sim.commandWorkers([1], { type: 'work', task: 'craft', workplaceId: pit.id, x: 30, z: 20 });
  const Processes = require('../production-processes.js');
  Processes.work(sim, person, 60);
  assert.equal(sim.state.processing.batches[pit.id], undefined);
  Storage.deposit(sim.state, pit.id, 'firewood', 200);
  Processes.work(sim, person, 60);
  assert.ok(sim.state.processing.batches[pit.id]);
  assert.equal(pit.stock.firewood, 0);
  assert.equal(pit.stock.charcoal || 0, 0);
  assert.equal(remote.stock.firewood, 200);
});

test('old saves migrate once; inconsistent inventory projections and material reservations are rejected', () => {
  const sim = new Simulation();
  stockBuildingMaterials(sim);
  smallSite(sim);
  const state = JSON.parse(sim.serialize());
  delete state.storage;
  const migrated = Simulation.load(JSON.stringify(state));
  assert.ok(migrated);
  assert.equal(Storage.suppliedFraction(migrated.state.queue[0]), 1);
  assert.ok(Simulation.load(migrated.serialize()));
  const wrongTotal = JSON.parse(sim.serialize());
  wrongTotal.resources.timber += 1;
  assert.equal(Simulation.load(JSON.stringify(wrongTotal)), null);
  const wrongReservation = JSON.parse(sim.serialize());
  wrongReservation.queue[0].materials.timber.reservations[0].amount += 1;
  assert.equal(Simulation.load(JSON.stringify(wrongReservation)), null);
});

const Supplies = require('../supplies.js');

test('manual pickup shrinks only the chosen physical pile, carries 15 kg and survives save/load', () => {
  const sim = new Simulation(),
    person = sim.state.people[0];
  const store = Storage.cache(sim.state, 'manual-test', { x: 45, z: 45 });
  store.resourcePlots = [
    { resource: 'firewood', x: 45, z: 45 },
    { resource: 'firewood', x: 50, z: 45 },
  ];
  Storage.deposit(sim.state, store.id, 'firewood', 2000);
  const before = Storage.resourcePiles(sim.state, store);
  assert.equal(before.length, 2);
  Object.assign(person, { x: 45, z: 46.4 });
  assert.equal(Supplies.pickup(sim, person, before[0].id), '');
  const after = Storage.resourcePiles(sim.state, store);
  assert.equal(after[0].amount, before[0].amount - 15);
  assert.equal(after[1].amount, before[1].amount);
  assert.equal(person.cargo.amount, 15);
  const restored = Simulation.load(sim.serialize());
  assert.ok(restored);
  assert.deepEqual(restored.state.people[0].cargo, person.cargo);
  assert.deepEqual(
    Storage.resourcePiles(restored.state, restored.state.storage.stores[store.id]).map(
      (p) => p.amount,
    ),
    after.map((p) => p.amount),
  );
  const invalid = JSON.parse(sim.serialize());
  invalid.people[1].cargo = invalid.people[0].cargo;
  invalid.people[0].cargo = null;
  assert.equal(Simulation.load(JSON.stringify(invalid)), null);
});

test('hand loads conserve quantities through blocked placement, ground piles and partial storage', () => {
  const sim = new Simulation(),
    person = sim.state.people[0];
  Object.assign(person, { x: 45, z: 45 });
  const source = Storage.cache(sim.state, 'source', { x: 45, z: 46.5 });
  source.resourcePlots = [{ resource: 'stone', x: 45, z: 46.5 }];
  Storage.deposit(sim.state, source.id, 'stone', 1);
  assert.equal(Supplies.pickup(sim, person), '');
  assert.equal(person.cargo.amount, Storage.loadSize('stone'));
  sim.navigation = { canPlaceSupply: () => false };
  const amount = person.cargo.amount;
  assert.ok(Supplies.place(sim, person, { point: { x: 45, z: 43.5 } }));
  assert.equal(person.cargo.amount, amount);
  sim.navigation.canPlaceSupply = () => true;
  assert.equal(Supplies.place(sim, person, { point: { x: 45, z: 43.5 } }), '');
  assert.equal(person.cargo, null);
  const pileStore = Object.values(sim.state.storage.stores).find((s) => s.id.startsWith('hand:'));
  assert.equal(pileStore.stock.stone, amount);
  assert.equal(Storage.resourcePiles(sim.state, pileStore)[0].amount, amount);
  assert.equal(Supplies.pickup(sim, person, Storage.resourcePiles(sim.state, pileStore)[0].id), '');
  source.capacity = Storage.storeVolume(sim.state, source) + Storage.volume('stone', amount / 2);
  assert.equal(
    Supplies.place(sim, person, {
      storeId: source.id,
      pileId: Storage.resourcePiles(sim.state, source)[0].id,
    }),
    '',
  );
  assert.ok(Math.abs(person.cargo.amount - amount / 2) < 1e-7);
  assert.ok(Math.abs(source.stock.stone + pileStore.stock.stone + person.cargo.amount - 1) < 1e-7);
});

test('all arrival resources use their actual units and manual cargo cannot exceed carrying capacity', () => {
  for (const key of Storage.KEYS) {
    const sim = new Simulation(),
      person = sim.state.people[0];
    const store = Storage.cache(sim.state, 'arrival', { x: 45, z: 45 });
    store.resourcePlots = [{ resource: key, x: 45, z: 45 }];
    Storage.deposit(sim.state, store.id, key, Storage.loadSize(key) * 2);
    Object.assign(person, { x: 45, z: 46.4 });
    assert.equal(Supplies.pickup(sim, person), '', key);
    assert.equal(person.cargo.amount, Storage.loadSize(key), key);
    assert.ok(Simulation.load(sim.serialize()), key);
    person.cargo.amount *= 2;
    assert.equal(Simulation.load(sim.serialize()), null, key);
  }
});

test('targeted indoor placement uses the chosen empty bay instead of the first free bay', () => {
  const sim = new Simulation(),
    store = completed(sim, 'storehouse', 45, 45);
  const target = Storage.supplyBays(sim.state, store, 'grain').at(-1);
  assert.ok(target);
  assert.equal(Storage.deposit(sim.state, store.id, 'grain', 15, 0.2, target.id), 15);
  const piles = Storage.resourcePiles(sim.state, store);
  assert.equal(piles.length, 1);
  assert.equal(piles[0].id, target.id);
  assert.equal(piles[0].amount, 15);
  const restored = Simulation.load(sim.serialize());
  assert.ok(restored);
  assert.equal(
    Storage.resourcePiles(restored.state, restored.state.storage.stores[store.id])[0].id,
    target.id,
  );
});
