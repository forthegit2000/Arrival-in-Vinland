/** Explicit testing commands. Normal simulation rules remain the default. */
(function (root) {
  'use strict';
  const Content = typeof module !== 'undefined' ? require('./content.js') : root.VinlandContent;
  const Storage = typeof module !== 'undefined' ? require('./storage.js') : root.VinlandStorage;
  const Hearths = typeof module !== 'undefined' ? require('./hearths.js') : root.VinlandHearths;
  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  const DEFAULTS = Object.freeze({
    enabled: false,
    instantBuild: true,
    protectCrew: false,
    used: false,
  });
  const WEATHER_PRESETS = Object.freeze({
    natural: 'Natural weather',
    fair: 'Fair winds',
    rain: 'Coastal rain',
    gale: 'Atlantic gale',
    snow: 'Snow',
  });
  function settings(state) {
    return state.cheats || DEFAULTS;
  }
  function instant(state) {
    return settings(state).enabled && settings(state).instantBuild;
  }
  function configure(sim, values) {
    if (
      Object.entries(values).some(
        ([key, value]) =>
          !['enabled', 'instantBuild', 'protectCrew'].includes(key) || typeof value !== 'boolean',
      )
    )
      return false;
    sim.state.cheats = { ...settings(sim.state), ...values };
    protect(sim);
    sim.emit();
    return true;
  }
  function markUsed(sim) {
    sim.state.cheats = { ...settings(sim.state), used: true };
  }
  function validate(state) {
    if (state.cheats === undefined) return true;
    return (
      state.cheats &&
      !Array.isArray(state.cheats) &&
      Object.keys(DEFAULTS).every((key) => typeof state.cheats[key] === 'boolean') &&
      Object.keys(state.cheats).every((key) => Object.hasOwn(DEFAULTS, key) || key === 'weather') &&
      (state.cheats.weather === undefined ||
        (typeof state.cheats.weather === 'string' &&
          Object.hasOwn(WEATHER_PRESETS, state.cheats.weather)))
    );
  }
  function setWeather(sim, preset) {
    if (
      !settings(sim.state).enabled ||
      typeof preset !== 'string' ||
      !Object.hasOwn(WEATHER_PRESETS, preset)
    )
      return false;
    sim.state.cheats = { ...settings(sim.state), weather: preset };
    markUsed(sim);
    sim.emit();
    return true;
  }
  function weatherPreset(state) {
    const cheats = settings(state);
    return cheats.enabled && Object.hasOwn(WEATHER_PRESETS, cheats.weather)
      ? cheats.weather
      : 'natural';
  }
  function build(sim, type, x, z, rotation = 0) {
    if (!instant(sim.state) || sim.blockedReason(type) || !sim.canPlace(type, x, z, rotation))
      return null;
    const state = sim.state,
      definition = Content.TYPES[type];
    const building = {
      id: state.nextId++,
      type,
      x,
      z,
      rotation,
      hours: definition.hours,
      progress: definition.hours,
      assigned: 0,
      cost: {},
      materials: {},
      sailShip: null,
      site: sim.siteInfo(x, z),
      condition: 100,
      quality: 1,
      owner: state.politics.tenure === 'households' ? 'household' : 'camp',
      plantedYear: null,
      cheatCreated: true,
    };
    if (type === 'restore') {
      state.hallReady = true;
      sim.survey();
    } else state.buildings.push(building);
    // Free fabric shelters own no paid-for tent or ship sail. Dismantling
    // therefore cannot refund fabric that was never reserved.
    Storage.syncStores(state);
    Hearths.initialize(state);
    markUsed(sim);
    sim.notify(definition.name + ' completed instantly (cheat).', 'construction');
    sim.emit();
    return building;
  }
  function repair(sim, id, ship = false) {
    if (!instant(sim.state)) return false;
    const target = (ship ? sim.state.ships : sim.state.buildings).find((item) => item.id === id);
    if (!target || (ship && target.status !== 'anchored')) return false;
    for (const order of [...sim.state.queue])
      if (order.kind === 'repair' && order.targetId === id && order.shipRepair === ship)
        sim.cancel(order.id);
    target.condition = 100;
    markUsed(sim);
    sim.emit();
    return true;
  }
  function finishSites(sim) {
    if (!instant(sim.state)) return 0;
    let completed = 0;
    for (const order of [...sim.state.queue]) {
      // Normal cancellation returns uncollected reservations and leaves real
      // carried/delivered supplies on the ground. Never erase cargo or stock.
      sim.cancel(order.id);
      if (order.kind === 'repair')
        completed += Number(repair(sim, order.targetId, order.shipRepair));
      else completed += Number(!!build(sim, order.type, order.x, order.z, order.rotation));
    }
    return completed;
  }
  function repairAll(sim) {
    if (!instant(sim.state)) return false;
    for (const order of [...sim.state.queue])
      if (order.kind === 'repair' || order.type === 'restore') sim.cancel(order.id);
    if (sim.state.config.inheritedHall && !sim.state.hallReady) build(sim, 'restore', 0, 0);
    for (const building of sim.state.buildings) building.condition = 100;
    for (const ship of sim.state.ships) if (ship.status === 'anchored') ship.condition = 100;
    markUsed(sim);
    sim.emit();
    return true;
  }
  function spawn(sim, resource, amount, point, targetId = null, moisture = 0.2) {
    if (
      !settings(sim.state).enabled ||
      !Storage.KEYS.includes(resource) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 1000000 ||
      !Number.isFinite(moisture) ||
      moisture < 0.05 ||
      moisture > 0.65
    )
      return null;
    let store = targetId && sim.state.storage.stores[targetId];
    if (targetId && !Storage.operational(sim.state, store)) return null;
    if (!targetId) {
      if (
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.z) ||
        !Meadows.containsPoint(point.x, point.z)
      )
        return null;
      const id = 'cheat-pile:' + sim.state.harvest.nextPileId++;
      store = Storage.cache(sim.state, id, point);
      store.cheatPile = true;
    }
    // Testing a full store should not silently place the requested resources
    // somewhere else. Expand this explicit cheat destination as necessary.
    store.capacity = Math.max(
      store.capacity,
      Storage.storeVolume(sim.state, store) + Storage.volume(resource, amount),
    );
    Storage.deposit(sim.state, store.id, resource, amount, moisture);
    markUsed(sim);
    sim.refreshFood();
    sim.emit();
    return store;
  }
  function supplyHearth(sim, person) {
    if (!settings(sim.state).enabled) return false;
    const hearth = Hearths.nearest(sim, person);
    if (!hearth) return false;
    for (const [key, amount] of Object.entries({
      firewood: 12,
      water: 24,
      grain: 4,
      freshFish: 2,
      meat: 2,
      plants: 3,
    }))
      spawn(sim, key, amount, null, hearth.storeId);
    return true;
  }
  function finishSoup(sim, person) {
    if (!settings(sim.state).enabled) return false;
    const hearth = Hearths.nearest(sim, person);
    const pot = hearth && Hearths.view(sim, hearth.id).pot;
    if (!pot) return false;
    pot.waterKg = Math.max(0.5, pot.waterKg);
    pot.energyKJ = Hearths.heatCapacity(pot) * 65;
    pot.maxTemperature = 100;
    pot.cookedSeconds = Hearths.RECIPES[pot.recipe].simmerSeconds;
    pot.spoiled = pot.scorched = false;
    pot.dangerSeconds = 0;
    pot.onFire = false;
    markUsed(sim);
    sim.emit();
    return true;
  }
  function heal(sim) {
    if (!settings(sim.state).enabled) return false;
    for (const person of sim.state.people)
      if (person.alive) {
        person.health = 100;
        person.fatigue = 0;
        person.trust = 90;
      }
    sim.state.health = sim.state.herdHealth = 100;
    sim.state.politics.legitimacy = 90;
    sim.invalidateRoster();
    markUsed(sim);
    return true;
  }
  function protect(sim) {
    if (settings(sim.state).enabled && settings(sim.state).protectCrew) heal(sim);
  }
  function setHour(sim, hour) {
    if (!settings(sim.state).enabled || !Number.isFinite(hour) || hour < 0 || hour >= 24)
      return false;
    // Lighting test only: retain the date and do not earn work or burn fuel.
    sim.state.time = Math.floor(sim.state.time / 24) * 24 + hour;
    sim.state.workSeconds = {};
    sim.invalidateRoster();
    for (const person of sim.state.people) {
      person.thermalComfortSeconds = 0;
      person.indoorWarmthSeconds = 0;
    }
    markUsed(sim);
    sim.emit();
    return true;
  }
  const api = {
    WEATHER_PRESETS,
    settings,
    instant,
    configure,
    validate,
    build,
    repair,
    finishSites,
    repairAll,
    spawn,
    supplyHearth,
    finishSoup,
    heal,
    protect,
    setHour,
    setWeather,
    weatherPreset,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandCheats = api;
})(typeof window === 'undefined' ? globalThis : window);
