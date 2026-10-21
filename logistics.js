/** Assigned builders and haulers move real loads; travel never advances work. */
(function (root) {
  'use strict';
  const Storage = typeof module !== 'undefined' ? require('./storage.js') : root.VinlandStorage;
  const Content = typeof module !== 'undefined' ? require('./content.js') : root.VinlandContent;
  const LOAD_SECONDS = 30;
  const UNLOAD_SECONDS = 60;
  const EPSILON = 1e-7;

  function pointFor(simulation, store, person, navigation, resource) {
    if (!Storage.operational(simulation.state, store)) return null;
    return navigation.storagePoint
      ? navigation.storagePoint(store.id, person, resource)
      : { id: store.id, x: store.x, z: store.z };
  }
  function arrive(person, point, seconds, navigation) {
    if (!point) return false;
    if (Math.hypot(person.x - point.x, person.z - point.z) <= 0.35) return true;
    navigation.movePerson(person, point, seconds);
    return false;
  }
  function wait(person, seconds, duration) {
    person.order.loadSeconds = (person.order.loadSeconds || 0) + seconds;
    if (person.order.loadSeconds + EPSILON < duration) return true;
    person.order.loadSeconds = 0;
    return false;
  }
  function dropCargo(simulation, person) {
    const cargo = person.cargo;
    const state = simulation.state;
    const id = 'dropped:' + state.harvest.nextPileId++;
    const cache = Storage.cache(state, id, person);
    const site = state.queue.find((order) => order.id === cargo.siteId);
    if (site?.materials?.[cargo.resource]) {
      site.materials[cargo.resource].reservations.push({ storeId: id, amount: cargo.amount });
    } else cache.stock[cargo.resource] = cargo.amount;
    if (cargo.resource === 'firewood') cache.woodMoisture = cargo.moisture ?? 0.2;
    person.cargo = null;
    state.harvest.revision++;
  }

  function build(simulation, person, seconds, navigation) {
    const site = simulation.state.queue.find((order) => order.id === person.order.buildingId);
    if (!site) return false;
    const cargo = person.cargo;
    if (cargo?.siteId === site.id) {
      person.order.status = 'Carrying ' + cargo.resource + ' to the building site.';
      if (!arrive(person, person.order, seconds, navigation)) return true;
      if (wait(person, seconds, UNLOAD_SECONDS)) return true;
      site.materials[cargo.resource].delivered += cargo.amount;
      person.cargo = null;
      delete person.order.status;
      return true;
    }
    if (Storage.suppliedFraction(site) >= 1 - EPSILON) return false;
    const choices = [];
    for (const [key, material] of Object.entries(site.materials || {})) {
      for (const reservation of material.reservations) {
        const store = simulation.state.storage.stores[reservation.storeId];
        if (reservation.amount > EPSILON && Storage.operational(simulation.state, store))
          choices.push({ key, reservation, store });
      }
    }
    choices.sort(
      (a, b) =>
        Math.hypot(a.store.x - person.x, a.store.z - person.z) -
        Math.hypot(b.store.x - person.x, b.store.z - person.z),
    );
    for (const { key, reservation, store } of choices) {
      const point = pointFor(simulation, store, person, navigation, key);
      if (!point) continue;
      person.order.status = 'Fetching ' + key + ' from ' + store.type + '.';
      if (!arrive(person, point, seconds, navigation)) return true;
      if (wait(person, seconds, LOAD_SECONDS)) return true;
      const amount = Math.min(Storage.loadSize(key), reservation.amount);
      reservation.amount -= amount;
      person.cargo = { resource: key, amount, siteId: site.id, sourceStoreId: store.id };
      return true;
    }
    // Other builders may be carrying the last loads. Work can use the
    // material already delivered, but can never run ahead of that fraction.
    person.order.status = 'Waiting for building supplies.';
    return false;
  }

  function wanted(simulation, store, key) {
    if (!Storage.accepts(store, key)) return 0;
    if (store.id === 'camp') {
      if (Storage.FOOD_KEYS.includes(key))
        return (
          (simulation.campPopulation * 6000) / (Storage.FOOD_KEYS.length * Content.FOOD[key].kcal)
        );
      return (
        {
          water: Math.max(1800, simulation.campPopulation * 10),
          firewood: Math.max(100, simulation.fuelDemand * 7),
          hay: simulation.hayDemand * 7,
          timber: 2,
          turf: 2,
          stone: 0.1,
          iron: 10,
          charcoal: 10,
          seeds: 4,
          cloth: 5,
        }[key] || 0
      );
    }
    if (store.type === 'woodshed')
      return (store.capacity * (key === 'timber' ? 0.7 : 0.3)) / Storage.volume(key, 1);
    if (store.type === 'haybarn') return store.capacity * 90;
    if (store.type !== 'storehouse') {
      const buffers = {
        workshop: { firewood: 100, charcoal: 25 },
        smithy: { firewood: 100, charcoal: 25 },
        charcoal: { firewood: 240 },
        smokehouse: { freshFish: 50, firewood: 25 },
        garden: { seeds: 2, water: 100 },
        byre: { hay: 100, water: 100 },
        hearth: { firewood: 12, water: 16, grain: 2, plants: 1, freshFish: 1, meat: 1 },
        carehut: { firewood: 100, water: 50, grain: 2, plants: 1, freshFish: 1, meat: 1 },
        turfhouse: { firewood: 100, water: 50, grain: 2, plants: 1, freshFish: 1, meat: 1 },
        longhouse: { firewood: 100, water: 50, grain: 2, plants: 1, freshFish: 1, meat: 1 },
      };
      return buffers[store.type]?.[key] || 0;
    }
    return store.capacity / Storage.KEYS.length / Storage.volume(key, 1);
  }
  function haul(simulation, person, seconds, navigation) {
    const state = simulation.state;
    const target = state.storage.stores[person.order.destinationStoreId];
    if (!Storage.operational(state, target)) {
      person.order.status = 'Destination store is unavailable.';
      return;
    }
    if (person.cargo) {
      const point = pointFor(simulation, target, person, navigation, person.cargo.resource);
      person.order.status = 'Delivering ' + person.cargo.resource + ' to ' + target.type + '.';
      if (!arrive(person, point, seconds, navigation) || wait(person, seconds, UNLOAD_SECONDS))
        return;
      const accepted = Storage.deposit(
        state,
        target.id,
        person.cargo.resource,
        person.cargo.amount,
        person.cargo.moisture ?? 0.2,
      );
      person.cargo.amount -= accepted;
      if (person.cargo.amount < EPSILON) person.cargo = null;
      else person.order.status = 'Destination store is full.';
      return;
    }
    if (person.order.retrySeconds > 0) {
      person.order.retrySeconds = Math.max(0, person.order.retrySeconds - seconds);
      return;
    }
    const candidates = [];
    for (const key of Storage.KEYS) {
      const incoming = state.people
        .filter(
          (other) => other.cargo?.destinationStoreId === target.id && other.cargo.resource === key,
        )
        .reduce((sum, other) => sum + other.cargo.amount, 0);
      const desired = wanted(simulation, target, key);
      const deficit = Math.min(
        desired - (target.stock[key] || 0) - incoming,
        Storage.roomFor(state, target, key),
      );
      if (deficit <= EPSILON) continue;
      for (const store of Object.values(state.storage.stores)) {
        if (
          store.id === target.id ||
          !Storage.operational(state, store) ||
          !(store.stock[key] > EPSILON)
        )
          continue;
        candidates.push({ store, key, deficit, priority: deficit / Math.max(EPSILON, desired) });
      }
    }
    candidates.sort(
      (a, b) =>
        b.priority - a.priority ||
        Math.hypot(a.store.x - person.x, a.store.z - person.z) -
          Math.hypot(b.store.x - person.x, b.store.z - person.z),
    );
    for (const { store, key, deficit } of candidates) {
      const sourcePoint = pointFor(simulation, store, person, navigation, key);
      if (!sourcePoint) continue;
      person.order.status = 'Fetching ' + key + ' for ' + target.type + '.';
      if (!arrive(person, sourcePoint, seconds, navigation) || wait(person, seconds, LOAD_SECONDS))
        return;
      const amount = Storage.withdraw(
        state,
        store.id,
        key,
        Math.min(Storage.loadSize(key), deficit),
      );
      if (amount > EPSILON)
        person.cargo = {
          resource: key,
          amount,
          sourceStoreId: store.id,
          ...(key === 'firewood' ? { moisture: store.woodMoisture ?? 0.2 } : {}),
          destinationStoreId: target.id,
        };
      return;
    }
    person.order.status = 'No reachable supplies needed by this store.';
    person.order.retrySeconds = 30;
  }
  const api = { build, haul, dropCargo, LOAD_SECONDS, UNLOAD_SECONDS };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandLogistics = api;
})(typeof window === 'undefined' ? globalThis : window);
