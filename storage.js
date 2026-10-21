/** Physical inventories and material reservations. No renderer dependency. */
(function (root) {
  'use strict';
  const Content = typeof module !== 'undefined' ? require('./content.js') : root.VinlandContent;
  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  const Spaces =
    typeof module !== 'undefined' ? require('./building-spaces.js') : root.VinlandBuildingSpaces;
  const MATERIALS = [
    'timber',
    'turf',
    'stone',
    'iron',
    'hay',
    'charcoal',
    'firewood',
    'water',
    'seeds',
    'cloth',
  ];
  const FOOD_KEYS = Object.keys(Content.FOOD);
  const KEYS = [...MATERIALS, ...FOOD_KEYS];
  const DENSITY = { timber: 500, turf: 750, stone: 1000 };
  const EPSILON = 1e-7;
  // A simulation calibration, not a universal property of all wood stacks.
  // UNECE/FAO JWEE manual: 1 stacked m³ split firewood ≈ 0.7 solid m³.
  // https://unece.org/sites/default/files/2023-01/JWEE21-manual.pdf
  const WOOD_SOLID_FRACTION = 0.7;
  const STACK_HEIGHT = 1.4;
  const OUTDOOR_STORAGE_BAY = { w: 2.4, d: 1.2, h: STACK_HEIGHT };
  const WOOD_KEYS = ['timber', 'firewood'];
  // Effective stored densities include packing gaps or container space.
  // These are explicit game calibrations, not measurements of Norse stores.
  // Hay: https://www.fao.org/4/s4314e/s4314e0q.htm
  // Charcoal: https://www.fao.org/4/q1085e/q1085e0c.htm
  // Grain: barley is roughly 690 kg/m³ before sacks and handling space.
  const STORED_DENSITY = {
    iron: 4500,
    hay: 90,
    charcoal: 180,
    water: 800,
    seeds: 600,
    cloth: 160,
    freshFish: 550,
    driedFish: 200,
    meat: 650,
    plants: 140,
    grain: 600,
    dairy: 850,
    fat: 750,
  };

  function volume(key, amount) {
    if (key === 'timber') return amount / WOOD_SOLID_FRACTION;
    if (key === 'firewood') return amount / 500 / WOOD_SOLID_FRACTION;
    if (key === 'turf') return amount / 0.85;
    if (key === 'stone') return amount / 1.56; // tonnes of loose stone, including voids.
    return amount / STORED_DENSITY[key];
  }
  function loadSize(key) {
    return 15 / (DENSITY[key] || 1);
  }
  function unit(key) {
    return ['timber', 'turf'].includes(key)
      ? 'm³'
      : key === 'stone'
        ? 't'
        : key === 'water'
          ? 'L'
          : 'kg';
  }
  function total(state, key) {
    return Object.values(state.storage.stores).reduce(
      (sum, store) => sum + (store.stock[key] || 0),
      0,
    );
  }
  function storeVolume(state, store) {
    let used = Object.entries(store.stock).reduce(
      (sum, [key, amount]) => sum + volume(key, amount),
      0,
    );
    for (const order of state.queue) {
      for (const [key, material] of Object.entries(order.materials || {}))
        for (const reservation of material.reservations)
          if (reservation.storeId === store.id) used += volume(key, reservation.amount);
    }
    return used;
  }
  function storedAmount(state, store, key) {
    // Reserved supplies still occupy their source stack until a carrier
    // actually picks them up. They are unavailable, but have not moved yet.
    let amount = store.stock[key] || 0;
    for (const order of state.queue)
      for (const reservation of order.materials?.[key]?.reservations || [])
        if (reservation.storeId === store.id) amount += reservation.amount;
    return amount;
  }
  function indoorBays(state, store) {
    const building = state.buildings.find((entry) => 'building:' + entry.id === store.id);
    if (!building || !['woodshed', 'storehouse', 'haybarn'].includes(building.type)) return [];
    const plan = Spaces.plan(building.type);
    const start = -plan.d / 2 + plan.thickness / 2 + 0.15;
    const length = -start;
    const cells = Math.max(1, Math.floor(length / 0.5));
    const depth = length / cells;
    const bays = [];
    for (const side of [-1, 1]) {
      for (let row = 0; row < cells; row++) {
        const point = Spaces.toWorld(building, {
          x: side * (plan.w / 2 - 1.1),
          z: start + (row + 0.5) * depth,
        });
        bays.push({
          ...point,
          rotation: building.rotation,
          side,
          w: 1.2,
          d: depth,
          h: STACK_HEIGHT,
          indoor: true,
          id: store.id + ':slot:' + bays.length,
        });
      }
    }
    return bays;
  }

  function pileLayout(state, store, incomingResource = null, incomingAmount = 0) {
    const indoor = indoorBays(state, store).map((bay, index) => ({
      ...bay,
      stockKey: 'slot:' + index,
      resource: store.storageSlots?.[index] || null,
    }));
    const outdoor = (store.resourcePlots || []).map((plot, index) => ({
      ...plot,
      ...OUTDOOR_STORAGE_BAY,
      id: store.id + ':yard:' + index,
      // Coordinates keep the pile's contents attached to its location even
      // when an unused plot elsewhere is removed from the saved array.
      stockKey: 'yard:' + plot.resource + ':' + plot.x + ':' + plot.z,
    }));
    const entries = [...indoor, ...outdoor].map((bay) => {
      const previous = store.pileStock?.[bay.stockKey];
      const amount =
        previous?.resource === bay.resource
          ? Math.min(previous.amount, (bay.w * bay.d * bay.h) / volume(bay.resource, 1))
          : 0;
      return { ...bay, amount };
    });
    // Aggregate inventories remain authoritative. Existing consumers and
    // reservations can change them directly; reconcile only the difference,
    // keeping all other piles where they are.
    for (const resource of KEYS) {
      const piles = entries.filter((entry) => entry.resource === resource);
      let excess =
        piles.reduce((sum, entry) => sum + entry.amount, 0) - storedAmount(state, store, resource);
      for (const entry of piles.reverse()) {
        const removed = Math.min(entry.amount, Math.max(0, excess));
        entry.amount -= removed;
        excess -= removed;
      }
    }
    if (store.pileStock)
      for (const entry of entries)
        if (entry.indoor && entry.amount <= EPSILON) entry.resource = null;

    function fill(resource, amount, layout) {
      const candidates = [
        ...layout.filter((entry) => entry.indoor && entry.resource === resource),
        ...layout.filter(
          (entry) => entry.indoor && entry.resource === null && accepts(store, resource),
        ),
        ...layout.filter((entry) => !entry.indoor && entry.resource === resource),
      ];
      for (const entry of candidates) {
        if (amount <= EPSILON) break;
        const room = (entry.w * entry.d * entry.h) / volume(resource, 1) - entry.amount;
        const added = Math.min(amount, Math.max(0, room));
        if (added <= EPSILON) continue;
        entry.resource = resource;
        entry.amount += added;
        amount -= added;
      }
    }
    for (const resource of KEYS) {
      const represented = entries
        .filter((entry) => entry.resource === resource)
        .reduce((sum, entry) => sum + entry.amount, 0);
      fill(resource, Math.max(0, storedAmount(state, store, resource) - represented), entries);
    }
    for (const entry of entries) if (entry.indoor && entry.amount <= EPSILON) entry.resource = null;
    if (indoor.length)
      store.storageSlots = entries.filter((entry) => entry.indoor).map((entry) => entry.resource);
    if (entries.length || store.pileStock)
      store.pileStock = Object.fromEntries(
        entries
          .filter((entry) => entry.amount > EPSILON)
          .map((entry) => [entry.stockKey, { resource: entry.resource, amount: entry.amount }]),
      );
    if (incomingResource && incomingAmount > 0) {
      const preview = entries.map((entry) => ({ ...entry }));
      fill(incomingResource, incomingAmount, preview);
      return preview;
    }
    return entries;
  }

  function outdoorResourceVolume(state, store, resource, incoming = 0) {
    const layout = pileLayout(state, store, resource, incoming);
    const covered = layout
      .filter((entry) => entry.indoor && entry.resource === resource)
      .reduce((sum, entry) => sum + volume(resource, entry.amount), 0);
    return Math.max(0, volume(resource, storedAmount(state, store, resource) + incoming) - covered);
  }

  function resourcePiles(state, store, incomingResource = null, incomingAmount = 0) {
    if (['ship', 'ferry'].includes(store.type)) return [];
    return pileLayout(state, store, incomingResource, incomingAmount)
      .filter((entry) => entry.amount > EPSILON)
      .map((entry) => ({
        ...entry,
        occupied: volume(entry.resource, entry.amount),
        storeId: store.id,
      }));
  }
  function supplyBays(state, store, resource) {
    if (!operational(state, store) || !accepts(store, resource)) return [];
    const available = roomFor(state, store, resource);
    return pileLayout(state, store)
      .filter((entry) => entry.resource === resource || entry.resource === null)
      .map((entry) => ({
        ...entry,
        resource,
        storeId: store.id,
        room: Math.min(
          available,
          (entry.w * entry.d * entry.h) / volume(resource, 1) - entry.amount,
        ),
      }))
      .filter((entry) => entry.room > EPSILON);
  }
  function operational(state, store) {
    if (!store) return false;
    if (!store.id.startsWith('building:')) return true;
    return state.buildings.some(
      (building) => 'building:' + building.id === store.id && building.condition > 15,
    );
  }
  function accepts(store, key) {
    if (store.type === 'woodshed') return ['timber', 'firewood'].includes(key);
    if (store.type === 'haybarn') return key === 'hay';
    return KEYS.includes(key);
  }
  function roomFor(state, store, key) {
    if (!store) return 0;
    if (!operational(state, store) || !accepts(store, key)) return 0;
    let free = Math.max(0, store.capacity - storeVolume(state, store));
    const bays = indoorBays(state, store);
    if (bays.length) {
      const layout = pileLayout(state, store);
      const usable = layout
        .filter((entry) => entry.indoor && (entry.resource === key || entry.resource === null))
        .reduce((sum, entry) => sum + entry.w * entry.d * entry.h - volume(key, entry.amount), 0);
      free = Math.min(free, Math.max(0, usable));
    }
    return free / volume(key, 1);
  }
  function syncStores(state) {
    const camp = state.storage.stores.camp;
    Object.assign(camp, state.timberDropoff || { x: 0, z: 20 });
    for (const building of state.buildings) {
      const id = 'building:' + building.id;
      const definition = Content.TYPES[building.type];
      const warehouse = ['storehouse', 'woodshed', 'haybarn'].includes(building.type);
      state.storage.stores[id] ||= {
        id,
        type: building.type,
        x: building.x,
        z: building.z,
        capacity: definition.w * definition.d * (warehouse ? 0.54 : 0.04),
        stock: {},
      };
      if (warehouse) {
        const store = state.storage.stores[id];
        const usable = indoorBays(state, store).reduce(
          (sum, bay) => sum + bay.w * bay.d * bay.h,
          0,
        );
        store.capacity = Math.min(store.capacity, usable);
      }
    }
    // An emptied outdoor bay is walkable and can be built over. Forget its
    // saved location before a later delivery tries to reuse that ground.
    for (const store of Object.values(state.storage.stores)) {
      // Wood-only saves keep their existing outdoor locations on migration.
      if (store.woodPlots && !store.resourcePlots) store.resourcePlots = store.woodPlots;
      delete store.woodPlots;
      if (!store.resourcePlots?.length) continue;
      const occupied = new Set(resourcePiles(state, store).map((pile) => pile.id));
      store.resourcePlots = store.resourcePlots.filter((plot, index) => {
        if (occupied.has(store.id + ':yard:' + index)) return true;
        return ![...state.buildings, ...state.queue].some((building) => {
          const definition = Content.TYPES[building.type];
          if (!definition || building.type === 'restore' || building.kind) return false;
          const local = Spaces.toLocal(building, plot);
          return (
            Math.abs(local.x) < definition.w / 2 + OUTDOOR_STORAGE_BAY.w / 2 + 1 &&
            Math.abs(local.z) < definition.d / 2 + OUTDOOR_STORAGE_BAY.w / 2 + 1
          );
        });
      });
    }
  }
  function deposit(state, id, key, amount, moisture = 0.2, pileId = null) {
    const store = state.storage.stores[id];
    if (!store || !KEYS.includes(key) || !Number.isFinite(amount) || amount <= 0) return 0;
    let accepted = Math.min(amount, roomFor(state, store, key));
    let destination = null;
    if (pileId) {
      destination = pileLayout(state, store).find((entry) => entry.id === pileId);
      if (!destination || (destination.resource !== null && destination.resource !== key)) return 0;
      accepted = Math.min(
        accepted,
        (destination.w * destination.d * destination.h) / volume(key, 1) - destination.amount,
      );
    }
    if (accepted <= EPSILON) return 0;
    if (key === 'firewood' && accepted > 0) {
      const previous = store.stock.firewood || 0;
      store.woodMoisture =
        (previous * (store.woodMoisture ?? 0.2) + accepted * moisture) / (previous + accepted);
    }
    store.stock[key] = (store.stock[key] || 0) + accepted;
    if (destination?.indoor) store.storageSlots[Number(destination.stockKey.slice(5))] = key;
    if (destination && accepted > EPSILON)
      store.pileStock[destination.stockKey] = {
        resource: key,
        amount: destination.amount + accepted,
      };
    return accepted;
  }
  function withdraw(state, id, key, amount, pileId = null) {
    const store = state.storage.stores[id];
    if (!operational(state, store) || !Number.isFinite(amount) || amount <= 0) return 0;
    const source =
      pileId &&
      resourcePiles(state, store).find((pile) => pile.id === pileId && pile.resource === key);
    if (pileId && !source) return 0;
    const taken = Math.min(store.stock[key] || 0, amount, source ? source.amount : Infinity);
    store.stock[key] = Math.max(0, (store.stock[key] || 0) - taken);
    if (source) store.pileStock[source.stockKey].amount = Math.max(0, source.amount - taken);
    return taken;
  }
  function available(state, key, landOnly = false) {
    return Object.values(state.storage.stores)
      .filter(
        (store) =>
          operational(state, store) && (!landOnly || !['ship', 'ferry'].includes(store.type)),
      )
      .reduce((sum, store) => sum + (store.stock[key] || 0), 0);
  }
  function cache(state, id, point) {
    return (state.storage.stores[id] ||= {
      id,
      type: 'cache',
      x: point.x,
      z: point.z,
      capacity: 100000,
      stock: {},
    });
  }
  function addAt(state, id, key, amount) {
    if (!KEYS.includes(key) || !Number.isFinite(amount) || amount <= 0) return 0;
    const accepted = deposit(state, id, key, amount);
    if (accepted + EPSILON < amount) {
      const source = state.storage.stores[id] || state.storage.stores.camp;
      const overflow = cache(state, 'overflow:' + id, source);
      overflow.stock[key] = (overflow.stock[key] || 0) + amount - accepted;
    }
    return amount;
  }
  function bindTotals(state) {
    // These public fields remain compatible with the HUD and scenario tools.
    // Their values are derived from stores, never a second spendable pool.
    // Absolute writes are for scenario/debug edits; game transactions below
    // always name a physical store and respect its capacity/access.
    for (const key of KEYS) {
      const object = FOOD_KEYS.includes(key) ? state.foods : state.resources;
      Object.defineProperty(object, key, {
        enumerable: true,
        configurable: true,
        get: () => total(state, key),
        set(value) {
          if (!Number.isFinite(value) || value < 0) throw Error('Invalid inventory total: ' + key);
          let difference = value - total(state, key);
          const camp = state.storage.stores.camp;
          if (difference >= 0) {
            camp.stock[key] = (camp.stock[key] || 0) + difference;
            camp.capacity = Math.max(camp.capacity, storeVolume(state, camp) * 1.1);
          } else {
            for (const store of Object.values(state.storage.stores)) {
              const taken = Math.min(store.stock[key] || 0, -difference);
              store.stock[key] = (store.stock[key] || 0) - taken;
              difference += taken;
              if (difference >= -EPSILON) break;
            }
          }
        },
      });
    }
  }
  function initialize(state) {
    if (!state.storage) {
      const stock = Object.fromEntries(
        KEYS.map((key) => [
          key,
          (FOOD_KEYS.includes(key) ? state.foods : state.resources)[key] || 0,
        ]),
      );
      const capacity = Math.max(
        100,
        Object.entries(stock).reduce((sum, [key, value]) => sum + volume(key, value), 0) * 1.1,
      );
      state.storage = {
        version: 1,
        stores: { camp: { id: 'camp', type: 'camp', x: 0, z: 20, capacity, stock } },
      };
      // Older work was already paid for. Keep its materials at the site.
      for (const order of state.queue)
        order.materials = Object.fromEntries(
          Object.entries(order.cost)
            .filter(([key]) => MATERIALS.includes(key))
            .map(([key, required]) => [key, { required, delivered: required, reservations: [] }]),
        );
    }
    syncStores(state);
    bindTotals(state);
  }
  function reserveSite(state, order) {
    const costs = Object.entries(order.cost).filter(([key]) => MATERIALS.includes(key));
    if (costs.some(([key, amount]) => available(state, key, true) + EPSILON < amount)) return false;
    order.materials = {};
    for (const [key, required] of costs) {
      const material = { required, delivered: 0, reservations: [] };
      let remaining = required;
      const stores = Object.values(state.storage.stores)
        .filter((store) => operational(state, store) && !['ship', 'ferry'].includes(store.type))
        .sort(
          (a, b) =>
            Math.hypot(a.x - order.x, a.z - order.z) - Math.hypot(b.x - order.x, b.z - order.z),
        );
      for (const store of stores) {
        const amount = withdraw(state, store.id, key, remaining);
        if (amount > 0) material.reservations.push({ storeId: store.id, amount });
        remaining -= amount;
        if (remaining < EPSILON) break;
      }
      order.materials[key] = material;
    }
    return true;
  }
  function suppliedFraction(order) {
    return Math.min(
      1,
      ...Object.values(order.materials || {})
        .filter((entry) => entry.required > 0)
        .map((entry) => entry.delivered / entry.required),
    );
  }
  function cancelSite(state, order) {
    const salvage = cache(state, 'salvage:' + order.id, order);
    for (const [key, material] of Object.entries(order.materials || {})) {
      for (const reservation of material.reservations) {
        const store = state.storage.stores[reservation.storeId];
        if (store) store.stock[key] = (store.stock[key] || 0) + reservation.amount;
      }
      salvage.stock[key] = Math.max(
        0,
        material.delivered - (material.required * order.progress) / order.hours,
      );
    }
  }
  function validate(state) {
    if (state.storage === undefined) return true; // Migration happens once on load.
    const storage = state.storage;
    if (
      !storage ||
      storage.version !== 1 ||
      !storage.stores ||
      !storage.stores.camp ||
      Object.keys(storage.stores).length > 1000
    )
      return false;
    for (const [id, store] of Object.entries(storage.stores)) {
      if (
        !store ||
        store.id !== id ||
        typeof store.type !== 'string' ||
        !Number.isFinite(store.x) ||
        !Number.isFinite(store.z) ||
        !Meadows.containsPoint(store.x, store.z) ||
        !Number.isFinite(store.capacity) ||
        store.capacity <= 0 ||
        !store.stock ||
        Array.isArray(store.stock)
      )
        return false;
      if (
        store.woodMoisture !== undefined &&
        (!Number.isFinite(store.woodMoisture) ||
          store.woodMoisture < 0.05 ||
          store.woodMoisture > 0.65)
      )
        return false;
      for (const [key, value] of Object.entries(store.stock))
        if (!KEYS.includes(key) || !Number.isFinite(value) || value < 0) return false;
      if (store.pileStock !== undefined) {
        if (
          !store.pileStock ||
          Array.isArray(store.pileStock) ||
          Object.keys(store.pileStock).length > 2048
        )
          return false;
        for (const entry of Object.values(store.pileStock))
          if (
            !entry ||
            !KEYS.includes(entry.resource) ||
            !Number.isFinite(entry.amount) ||
            entry.amount < 0
          )
            return false;
      }
      if (
        store.storageSlots !== undefined &&
        (!Array.isArray(store.storageSlots) ||
          store.storageSlots.length > 1024 ||
          store.storageSlots.some((key) => key !== null && !KEYS.includes(key)))
      )
        return false;
      for (const plots of [store.resourcePlots, store.woodPlots]) {
        if (plots === undefined) continue;
        if (!Array.isArray(plots) || plots.length > 1000) return false;
        for (const plot of plots)
          if (
            !plot ||
            !KEYS.includes(plot.resource) ||
            !Number.isFinite(plot.x) ||
            !Number.isFinite(plot.z) ||
            !Meadows.containsPoint(plot.x, plot.z)
          )
            return false;
      }
    }
    for (const key of KEYS) {
      const recorded = (FOOD_KEYS.includes(key) ? state.foods : state.resources)[key];
      if (Math.abs(recorded - total(state, key)) > Math.max(EPSILON, recorded * 1e-9)) return false;
    }
    for (const order of state.queue) {
      if (!order.materials) return false;
      if (
        Object.entries(order.cost).some(
          ([key, amount]) =>
            MATERIALS.includes(key) &&
            (!order.materials[key] || !Number.isFinite(amount) || amount < 0),
        )
      )
        return false;
      for (const [key, material] of Object.entries(order.materials)) {
        if (
          !MATERIALS.includes(key) ||
          material.required !== order.cost[key] ||
          !Number.isFinite(material.delivered) ||
          material.delivered < 0 ||
          material.delivered > material.required + EPSILON ||
          !Array.isArray(material.reservations)
        )
          return false;
        let outstanding = material.delivered;
        for (const reservation of material.reservations) {
          if (
            !storage.stores[reservation.storeId] ||
            !Number.isFinite(reservation.amount) ||
            reservation.amount < 0
          )
            return false;
          outstanding += reservation.amount;
        }
        outstanding += state.people
          .filter((person) => person.cargo?.siteId === order.id && person.cargo.resource === key)
          .reduce((sum, person) => sum + person.cargo.amount, 0);
        // Dropped loads remain recoverable ground bundles; a site may wait
        // for replacement supplies after a worker is interrupted.
        if (outstanding > material.required + EPSILON) return false;
      }
    }
    return true;
  }
  const api = {
    MATERIALS,
    unit,
    FOOD_KEYS,
    KEYS,
    volume,
    WOOD_SOLID_FRACTION,
    STACK_HEIGHT,
    WOOD_KEYS,
    OUTDOOR_STORAGE_BAY,
    storedAmount,
    indoorBays,
    STORED_DENSITY,
    outdoorResourceVolume,
    resourcePiles,
    supplyBays,
    loadSize,
    total,
    storeVolume,
    operational,
    accepts,
    roomFor,
    syncStores,
    deposit,
    withdraw,
    available,
    cache,
    addAt,
    initialize,
    reserveSite,
    suppliedFraction,
    cancelSite,
    validate,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandStorage = api;
})(typeof window === 'undefined' ? globalThis : window);
