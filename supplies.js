/** Manual supply carrying. Inventories own the stock; Karlsefni owns one real load. */
(function (root) {
  'use strict';
  const Storage = typeof module !== 'undefined' ? require('./storage.js') : root.VinlandStorage;
  const Spaces =
    typeof module !== 'undefined' ? require('./building-spaces.js') : root.VinlandBuildingSpaces;
  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  const REACH = 1.6;
  const EPSILON = 1e-7;
  const LABELS = {
    timber: 'logs',
    turf: 'turf',
    stone: 'stone',
    iron: 'iron',
    hay: 'hay',
    charcoal: 'charcoal',
    firewood: 'firewood',
    water: 'water',
    seeds: 'seeds',
    cloth: 'cloth',
    freshFish: 'fresh fish',
    driedFish: 'dried fish',
    meat: 'meat',
    plants: 'plants',
    grain: 'grain',
    dairy: 'dairy',
    fat: 'fat',
  };

  function carried(person) {
    if (person.cargo) return person.cargo;
    if (person.carriedFirewood > EPSILON)
      return {
        resource: 'firewood',
        amount: person.carriedFirewood,
        moisture: person.carriedWoodMoisture ?? 0.2,
        legacy: true,
      };
    return null;
  }
  function label(resource) {
    return LABELS[resource] || resource;
  }
  function describe(load) {
    const digits = ['timber', 'turf', 'stone'].includes(load.resource) ? 3 : 1;
    return (
      load.amount.toFixed(digits) + ' ' + Storage.unit(load.resource) + ' ' + label(load.resource)
    );
  }
  function edgePoint(person, pile) {
    const local = Spaces.toLocal(pile, person);
    return Spaces.toWorld(pile, {
      x: Math.max(-pile.w / 2, Math.min(pile.w / 2, local.x)),
      z: Math.max(-pile.d / 2, Math.min(pile.d / 2, local.z)),
    });
  }
  function reachable(simulation, person, pile) {
    const point = edgePoint(person, pile);
    return (
      Math.hypot(person.x - point.x, person.z - point.z) <= REACH + 1e-9 &&
      (!simulation.navigation?.canReachSupply || simulation.navigation.canReachSupply(person, pile))
    );
  }
  function nearest(simulation, person, resource = null) {
    let nearest = null;
    for (const store of Object.values(simulation.state.storage.stores)) {
      if (!Storage.operational(simulation.state, store)) continue;
      for (const pile of Storage.resourcePiles(simulation.state, store)) {
        if (resource && pile.resource !== resource) continue;
        if (!(store.stock[pile.resource] > EPSILON) || !reachable(simulation, person, pile))
          continue;
        const point = edgePoint(person, pile);
        const distance = Math.hypot(person.x - point.x, person.z - point.z);
        if (!nearest || distance < nearest.distance) nearest = { store, pile, distance };
      }
    }
    return nearest;
  }
  function pickup(simulation, person, pileId) {
    if (person.id !== simulation.state.leader.id)
      return 'Only Karlsefni can carry supplies by hand.';
    if (carried(person)) return 'Put down the load you are carrying first.';
    let source = null;
    if (pileId) {
      for (const store of Object.values(simulation.state.storage.stores)) {
        const pile = Storage.resourcePiles(simulation.state, store).find(
          (entry) => entry.id === pileId,
        );
        if (
          pile &&
          Storage.operational(simulation.state, store) &&
          reachable(simulation, person, pile)
        )
          source = { store, pile };
      }
    } else source = nearest(simulation, person);
    if (!source) return 'Stand beside a reachable supply pile.';
    const { store, pile } = source;
    const amount = Storage.withdraw(
      simulation.state,
      store.id,
      pile.resource,
      Storage.loadSize(pile.resource),
      pile.id,
    );
    if (amount <= EPSILON) return 'These supplies are reserved for construction.';
    if (person.order) simulation.commandWorkers([person.id], { type: 'stop' });
    person.cargo = {
      resource: pile.resource,
      amount,
      sourceStoreId: store.id,
      manual: true,
      ...(pile.resource === 'firewood' ? { moisture: store.woodMoisture ?? 0.2 } : {}),
    };
    return '';
  }
  function reduceLoad(person, amount) {
    if (person.cargo) {
      person.cargo.amount = Math.max(0, person.cargo.amount - amount);
      if (person.cargo.amount <= EPSILON) person.cargo = null;
    } else person.carriedFirewood = Math.max(0, (person.carriedFirewood || 0) - amount);
  }
  function place(simulation, person, target) {
    const load = carried(person);
    if (person.id !== simulation.state.leader.id || !load) return 'You are not carrying supplies.';
    if (!target || target.error)
      return target?.error || 'Choose clear ground ahead or stand beside a storage bay.';
    let store, pileId;
    if (target.storeId) {
      store = simulation.state.storage.stores[target.storeId];
      if (!Storage.operational(simulation.state, store)) return 'This storage is unavailable.';
      const pile = Storage.supplyBays(simulation.state, store, load.resource).find(
        (entry) => entry.id === target.pileId && entry.resource === load.resource,
      );
      if (!pile || !reachable(simulation, person, pile))
        return 'Stand beside a reachable storage bay with room.';
      pileId = pile.id;
    } else {
      const point = target.point;
      const pile = { ...point, ...Storage.OUTDOOR_STORAGE_BAY };
      if (
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.z) ||
        !Meadows.containsPoint(point.x, point.z) ||
        !reachable(simulation, person, pile) ||
        !simulation.navigation?.canPlaceSupply?.(person, point)
      )
        return 'There is no clear, reachable ground for this load.';
      if (Object.keys(simulation.state.storage.stores).length >= 1000)
        return 'There are too many separate supply piles.';
      const id = 'hand:' + simulation.state.harvest.nextPileId++;
      store = Storage.cache(simulation.state, id, point);
      store.resourcePlots = [{ resource: load.resource, x: point.x, z: point.z }];
      pileId = id + ':yard:0';
    }
    const accepted = Storage.deposit(
      simulation.state,
      store.id,
      load.resource,
      load.amount,
      load.moisture ?? 0.2,
      pileId,
    );
    if (accepted <= EPSILON) return 'This storage has no room for the load.';
    reduceLoad(person, accepted);
    return '';
  }
  const api = { REACH, carried, label, describe, edgePoint, reachable, nearest, pickup, place };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandSupplies = api;
})(typeof window === 'undefined' ? globalThis : window);
