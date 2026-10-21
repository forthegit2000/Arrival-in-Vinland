/** Physical harvesting. Source material, ground bundles and carried loads are
 * separate from usable stores. All durations are simulation seconds. */
(function (root) {
  'use strict';
  const Processes =
    typeof module !== 'undefined'
      ? require('./production-processes.js')
      : root.VinlandProductionProcesses;
  const Timing =
    typeof module !== 'undefined' ? require('./work-timing.js') : root.VinlandWorkTiming;
  const RULES = Timing.RULES;
  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  const Storage = typeof module !== 'undefined' ? require('./storage.js') : root.VinlandStorage;
  const Logistics =
    typeof module !== 'undefined' ? require('./logistics.js') : root.VinlandLogistics;
  const STEP_SECONDS = 0.1;
  const UNLOAD_SECONDS = 60;
  const PATCH_AREA = 36;
  const HAY_YIELD = 0.2; // kg dry matter per m²; a calibration, not a site survey.

  function initialize(state) {
    if (!state.harvest) {
      state.harvest = { version: 1, nodes: {}, piles: [], nextPileId: 1, revision: 0 };
      for (const person of state.people) {
        if (person.order?.type === 'gather') {
          // Old cosmetic carrying animations did not contain real material.
          person.order.phase = 'site';
          delete person.order.waitSeconds;
        }
      }
    }
    if (state.harvest.timingVersion !== 2) {
      for (const node of Object.values(state.harvest.nodes)) {
        if (node.kind !== 'tree') continue;
        const oldFraction = Math.min(1, node.fellingHours / (node.volume / 0.3));
        const budget = Timing.treeBudget(node);
        node.fellingHours = oldFraction * budget.fellingHours;
        node.clearingHours = oldFraction || node.felled ? budget.clearingHours : 0;
        // Existing fallen trees already represented processed work. Keep it.
        node.limbingHours = node.felled ? budget.limbingHours : 0;
        node.buckingHours = node.felled ? budget.buckingHours : 0;
        node.processingHours = Math.min(
          node.processingHours,
          RULES.timber.load / RULES.timber.rate,
        );
      }
      state.harvest.timingVersion = 2;
    }
    state.realtimeRemainderSeconds ??= 0;
    state.workSeconds ??= {};
  }

  function resourceFor(order) {
    if (order?.type === 'gather') return order.resource || 'timber';
    if (order?.type === 'work' && order.task === 'fishing') return 'freshFish';
    if (order?.type === 'work' && order.task === 'foraging') return 'plants';
    return null;
  }

  function sourceId(kind, x, z) {
    return kind + ':' + x.toFixed(3) + ':' + z.toFixed(3);
  }

  function registerSource(simulation, source) {
    const state = simulation.state.harvest;
    if (state.nodes[source.id]) return state.nodes[source.id];
    const tree = source.kind === 'tree';
    const node = {
      id: source.id,
      kind: source.kind,
      x: source.x,
      z: source.z,
      volume: tree ? source.volume : source.kind === 'turf' ? PATCH_AREA * 0.1 : PATCH_AREA,
      remaining: tree ? source.volume : source.kind === 'turf' ? PATCH_AREA * 0.1 : PATCH_AREA,
      height: source.height || 0,
      radius: source.radius || 0,
      felled: false,
      species: source.species || 'conifer',
      clearingHours: 0,
      limbingHours: 0,
      buckingHours: 0,
      fellingHours: 0,
      processingHours: 0,
      freshHay: 0,
      dryHay: 0,
      dryingHours: 0,
      cutAt: null,
    };
    state.nodes[node.id] = node;
    return node;
  }

  function sourceAvailable(simulation, source, resource) {
    const node = simulation.state.harvest.nodes[source.id];
    if (!node) return true;
    if (resource === 'hay') return node.dryHay > 0.00001 || node.remaining > 0.00001;
    return node.remaining > 0.00001;
  }

  function dropCargo(simulation, person) {
    if (person.carriedFirewood > 0) {
      const cache = Storage.cache(
        simulation.state,
        'handwood:' + simulation.state.harvest.nextPileId++,
        person,
      );
      Storage.deposit(
        simulation.state,
        cache.id,
        'firewood',
        person.carriedFirewood,
        person.carriedWoodMoisture ?? 0.2,
      );
      person.carriedFirewood = 0;
    }
    if (!person.cargo) return;
    if (person.cargo.sourceStoreId) return Logistics.dropCargo(simulation, person);
    const harvest = simulation.state.harvest;
    harvest.piles.push({
      id: 'pile:' + harvest.nextPileId++,
      x: person.x,
      z: person.z,
      resource: person.cargo.resource,
      amount: person.cargo.amount,
      ...(person.cargo.resource === 'firewood' ? { moisture: person.cargo.moisture ?? 0.5 } : {}),
    });
    person.cargo = null;
    harvest.revision++;
  }

  function workFactor(simulation, person, resource) {
    const skill = person.skills[RULES[resource].task];
    const health = Math.max(0.3, Math.min(1, person.health / 80));
    const fatigue = Math.max(0.5, Math.min(1, (125 - person.fatigue) / 100));
    const trust = person.trust < 25 ? 0.6 : 1;
    return (0.66 + skill * 0.55) * health * fatigue * trust * simulation.weather.factor;
  }

  function updateLandscape(simulation, seconds) {
    for (const node of Object.values(simulation.state.harvest.nodes)) {
      if (node.dryHay > 0 && simulation.weather.rain) {
        node.freshHay += node.dryHay;
        node.dryHay = 0;
        node.dryingHours = Math.max(0, Timing.HAY_FAIR_DAYLIGHT_HOURS - 1);
        simulation.state.harvest.revision++;
      }
      if (node.freshHay > 0) {
        const weather = simulation.weather;
        const daylight = weather.daylight || 12;
        const inDaylight =
          simulation.hour >= (weather.sunriseHour ?? 12 - daylight / 2) &&
          simulation.hour < (weather.sunsetHour ?? 12 + daylight / 2);
        const drying = weather.temp <= 1 ? 0 : weather.rain ? -2 : inDaylight ? 1 : 0;
        node.dryingHours = Math.max(0, node.dryingHours + (seconds / 3600) * drying);
        if (node.dryingHours >= Timing.HAY_FAIR_DAYLIGHT_HOURS) {
          node.dryHay += node.freshHay;
          node.freshHay = 0;
          node.dryingHours = 0;
          simulation.state.harvest.revision++;
        }
      }
      // Mown meadow can grow back during the growing season. Stripped turf
      // and felled trees do not spontaneously regenerate in this campaign.
      if (
        ['hay', 'plants'].includes(node.kind) &&
        node.cutAt !== null &&
        simulation.season !== 'winter' &&
        simulation.state.time - node.cutAt >= 21 * 24 &&
        !node.freshHay &&
        !node.dryHay
      ) {
        node.remaining = node.volume;
        node.cutAt = null;
        simulation.state.harvest.revision++;
      }
    }
  }

  function assignSite(simulation, person, resource, navigation) {
    const target = navigation.findHarvestTarget?.(resource, person);
    if (!target) {
      person.order.status = 'No reachable source and storage route.';
      person.order.retrySeconds = 30;
      return false;
    }
    person.order.x = target.x;
    person.order.z = target.z;
    person.order.nodeId =
      target.source.kind === 'pile'
        ? target.source.id
        : registerSource(simulation, target.source).id;
    person.order.phase = 'site';
    delete person.order.status;
    delete person.order.activity;
    return true;
  }

  function availableLoad(node, resource) {
    if (resource === 'timber') return node.remaining;
    if (resource === 'firewood') return node.remaining * 500;
    if (resource === 'hay') return node.dryHay;
    if (resource === 'plants') return node.remaining * 0.2;
    if (resource === 'freshFish') return node.remaining;
    return node.remaining;
  }

  function toolCare(order, seconds) {
    if (order.toolCareSeconds > 0) {
      order.toolCareSeconds = Math.max(0, order.toolCareSeconds - seconds);
      order.activity = 'sharpening';
      return true;
    }
    if (!Timing.AXE_ACTIVITIES.has(order.activity)) return false;
    order.toolWorkSeconds = (order.toolWorkSeconds || 0) + seconds;
    if (order.toolWorkSeconds < Timing.TOOL_WORK_SECONDS) return false;
    order.toolWorkSeconds = 0;
    order.toolCareSeconds = Timing.TOOL_CARE_SECONDS;
    order.activity = 'sharpening';
    return true;
  }

  function hayDryingReason(simulation) {
    if (simulation.weather.temp <= 1) return 'Waiting for warmer weather to dry the hay.';
    if (simulation.weather.rain) return 'Waiting for dry weather to cure the hay.';
    return 'Waiting for the hay to dry.';
  }

  function harvestLoad(simulation, person, node, resource, seconds) {
    const order = person.order;
    if (node.kind === 'tree' && !node.felled && simulation.weather.wind >= 40) {
      order.status = 'Too windy to fell a tree safely.';
      order.retrySeconds = 30;
      return;
    }
    if (resource === 'turf' && simulation.weather.temp <= 0) {
      order.status = 'The turf is frozen.';
      order.retrySeconds = 30;
      return;
    }
    if (resource === 'plants' && simulation.season === 'winter') {
      order.status = 'No edible plants available in winter.';
      order.retrySeconds = 30;
      return;
    }
    const seasonal =
      resource === 'plants'
        ? simulation.season === 'spring'
          ? 0.7
          : simulation.season === 'autumn'
            ? 0.65
            : 1
        : 1;
    const hours = (seconds / 3600) * workFactor(simulation, person, resource) * seasonal;
    if (node.kind === 'tree') {
      if (node.fellAt !== undefined && simulation.state.time - node.fellAt < 3 / 3600) {
        order.status = 'Stand clear: the tree is falling.';
        return;
      }
      const budget = Timing.treeBudget(node);
      for (const [field, activity] of [
        ['clearingHours', 'clearing'],
        ['fellingHours', 'felling'],
        ['limbingHours', 'limbing'],
        ['buckingHours', 'bucking'],
      ]) {
        if (field === 'fellingHours' && node.felled) continue;
        if ((node[field] || 0) + 1e-10 >= budget[field]) continue;
        order.activity = activity;
        if (toolCare(order, seconds)) return;
        const maintainedTools =
          ['limbing', 'bucking'].includes(activity) && simulation.has('workshop') ? 1.25 : 1;
        node[field] = Math.min(budget[field], (node[field] || 0) + hours * maintainedTools);
        if (field === 'fellingHours' && node[field] + 1e-10 >= budget[field]) {
          node.felled = true;
          node.fellAt = simulation.state.time;
          simulation.state.harvest.revision++;
        }
        return;
      }
    }
    if (resource === 'hay' && !node.dryHay) {
      order.activity = node.remaining > 0 ? 'mowing' : 'drying';
      if (node.remaining <= 0) {
        order.status = hayDryingReason(simulation);
        return;
      }
      if (simulation.season === 'winter') {
        order.status = 'The meadow is dormant for winter.';
        return;
      }
      if (simulation.weather.temp <= 1) {
        order.status = 'Too cold to mow grass.';
        return;
      }
      const cutArea = Math.min(node.remaining, hours * Timing.MOW_SQUARE_METRES_PER_HOUR);
      node.remaining -= cutArea;
      node.freshHay += cutArea * HAY_YIELD;
      node.cutAt = simulation.state.time;
      // Drying begins once a swath has been cut; continued mowing starts a
      // new conservative drying period for the combined windrow.
      node.dryingHours = 0;
      if (node.remaining <= 0.00001) simulation.state.harvest.revision++;
      return;
    }
    order.activity =
      node.kind === 'tree'
        ? resource === 'firewood'
          ? 'splitting'
          : 'loading'
        : resource === 'freshFish'
          ? 'fishing'
          : resource === 'plants'
            ? 'foraging'
            : resource === 'hay'
              ? 'loading'
              : 'cutting';
    if (node.kind === 'tree' && toolCare(order, seconds)) return;
    const woodLimit =
      resource === 'timber'
        ? simulation.state.ecology.wood
        : resource === 'firewood'
          ? simulation.state.ecology.wood * 500
          : Infinity;
    const amount = Math.min(RULES[resource].load, availableLoad(node, resource), woodLimit);
    if (amount <= 0.00001) return;
    const equipment =
      node.kind === 'tree' && resource === 'firewood' && simulation.has('workshop')
        ? 1.25
        : resource === 'freshFish' && simulation.has('fishing')
          ? 1.25
          : 1;
    const fishSupply =
      resource === 'freshFish'
        ? simulation.state.ecology.fish * (simulation.season === 'winter' ? 0.55 : 1)
        : 1;
    if (node.kind === 'tree' && node.processingResource && node.processingResource !== resource)
      node.processingHours = 0;
    if (node.kind === 'tree') node.processingResource = resource;
    node.processingHours += hours * equipment * fishSupply;
    const requiredHours = Timing.loadHours(node, resource, amount);
    if (node.processingHours + 1e-10 < requiredHours) return;
    node.processingHours = Math.max(0, node.processingHours - requiredHours);
    const removed =
      resource === 'firewood' ? amount / 500 : resource === 'plants' ? amount / 0.2 : amount;
    if (resource === 'freshFish')
      simulation.state.ecology.fish = Math.max(
        0.15,
        simulation.state.ecology.fish - amount / 240000,
      );
    if (resource === 'plants') node.cutAt = simulation.state.time;
    if (resource === 'hay') node.dryHay = Math.max(0, node.dryHay - amount);
    else node.remaining = Math.max(0, node.remaining - removed);
    if (resource === 'timber' || resource === 'firewood') {
      simulation.state.ecology.wood = Math.max(0, simulation.state.ecology.wood - removed);
      simulation.state.metrics.woodHarvested += removed;
    }
    if (resource === 'hay')
      simulation.state.ecology.pasture = Math.max(0, simulation.state.ecology.pasture - amount * 4);
    person.cargo = { resource, amount, ...(resource === 'firewood' ? { moisture: 0.5 } : {}) };
    order.phase = 'store';
    order.unloadSeconds = 0;
    delete order.storePoint; // Reconsider newly built stores on each loaded trip.
    simulation.state.harvest.revision++;
  }

  function travel(person, target, seconds, navigation, destination) {
    const order = person.order;
    order.phase = destination === 'store' ? 'store' : 'site';
    delete order.activity;
    const moved = navigation.movePerson(person, target, seconds);
    if (moved === false || person.moving === false)
      order.status =
        destination === 'store'
          ? 'Waiting for a clear route to storage.'
          : 'Waiting for a clear route to the gathering site.';
    else delete order.status;
  }

  function deposit(simulation, person, seconds, navigation) {
    const order = person.order;
    const cargo = person.cargo;
    const store = navigation.deliveryPoint?.(cargo.resource, person);
    if (!store) {
      order.status = 'No reachable storage.';
      order.retrySeconds = 30;
      return;
    }
    order.storeId = store.id;
    if (Math.hypot(person.x - store.x, person.z - store.z) > 0.8) {
      travel(person, store, seconds, navigation, 'store');
      return;
    }
    delete order.status;
    delete order.activity;
    order.phase = 'unloading';
    order.unloadSeconds = (order.unloadSeconds || 0) + seconds;
    if (order.unloadSeconds + 1e-8 < UNLOAD_SECONDS) return;
    const amount = Math.min(
      Storage.roomFor(simulation.state, simulation.state.storage.stores[store.id], cargo.resource),
      cargo.resource === 'hay'
        ? Math.min(
            cargo.amount,
            Math.max(0, simulation.hayCapacity - simulation.state.resources.hay),
          )
        : cargo.amount,
    );
    if (amount <= 0.000001) {
      order.status = 'Storage is full.';
      return;
    }
    Storage.deposit(simulation.state, store.id, cargo.resource, amount, cargo.moisture ?? 0.2);
    simulation.flow('production', cargo.resource, amount);
    cargo.amount -= amount;
    simulation.state.harvest.revision++;
    if (cargo.amount <= 0.000001) {
      person.cargo = null;
      order.phase = 'site';
      order.unloadSeconds = 0;
      delete order.status;
    }
  }

  function stepWorker(simulation, person, seconds, navigation, occupied) {
    const order = person.order;
    const resource = resourceFor(order);
    const activeHours = order.type === 'work' ? simulation.state.politics.workHours : 10;
    if (simulation.hour < 8 || simulation.hour >= 8 + activeHours) return;
    if (order.retrySeconds > 0) {
      order.retrySeconds = Math.max(0, order.retrySeconds - seconds);
      return;
    }
    order.workedHours += seconds / 3600;
    if (person.cargo) {
      deposit(simulation, person, seconds, navigation);
      return;
    }
    let node = simulation.state.harvest.nodes[order.nodeId];
    const pile = simulation.state.harvest.piles.find((entry) => entry.id === order.nodeId);
    if (pile && pile.amount > 0 && pile.resource === resource) {
      if (Math.hypot(person.x - order.x, person.z - order.z) > 0.8)
        travel(person, order, seconds, navigation, 'site');
      else {
        order.phase = 'working';
        delete order.status;
        order.activity = 'loading';
        order.pickupSeconds = (order.pickupSeconds || 0) + seconds;
        if (order.pickupSeconds < 30) return;
        order.pickupSeconds = 0;
        const amount = Math.min(pile.amount, resource === 'hay' ? 12 : Storage.loadSize(resource));
        pile.amount -= amount;
        person.cargo = {
          resource,
          amount,
          ...(resource === 'firewood' ? { moisture: pile.moisture ?? 0.5 } : {}),
        };
        order.phase = 'store';
        simulation.state.harvest.revision++;
      }
      return;
    }
    if (!node || !sourceAvailable(simulation, node, resource)) {
      if (!assignSite(simulation, person, resource, navigation)) {
        // Keep searching as before, but explain why this worker's cut hay
        // cannot be collected yet instead of calling the meadow unreachable.
        if (resource === 'hay' && node?.freshHay > 0) order.status = hayDryingReason(simulation);
        return;
      }
      node = simulation.state.harvest.nodes[order.nodeId];
      if (!node) return; // A newly selected ground bundle is picked up next step.
    }
    if (Math.hypot(person.x - order.x, person.z - order.z) > 0.8) {
      travel(person, order, seconds, navigation, 'site');
      return;
    }
    const workers = occupied.get(node.id) || 0;
    const limit = node.kind === 'tree' && !node.felled ? 1 : 2;
    if (workers >= limit) {
      order.status = 'Waiting for space at this source.';
      return;
    }
    occupied.set(node.id, workers + 1);
    delete order.status;
    order.phase = 'working';
    harvestLoad(simulation, person, node, resource, seconds);
  }

  function advance(simulation, seconds, navigation) {
    if (
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      simulation.state.gameOver ||
      simulation.state.ended
    )
      return;
    initialize(simulation.state);
    simulation.state.realtimeRemainderSeconds += seconds;
    while (
      simulation.state.realtimeRemainderSeconds + 1e-9 >= STEP_SECONDS &&
      !simulation.state.gameOver &&
      !simulation.state.ended
    ) {
      simulation.state.realtimeRemainderSeconds -= STEP_SECONDS;
      if (simulation.state.realtimeRemainderSeconds < 1e-9)
        simulation.state.realtimeRemainderSeconds = 0;
      navigation?.preparePeople?.();
      navigation?.stepLeader?.(STEP_SECONDS);
      const Arrival = typeof module !== 'undefined' ? require('./arrival.js') : root.VinlandArrival;
      Arrival.step(simulation, STEP_SECONDS, navigation);
      updateLandscape(simulation, STEP_SECONDS);
      const occupied = new Map();
      for (const person of simulation.availablePeople) {
        if (person.order?.type === 'arrival') continue;
        person.moving = false;
        if (!person.order || person.id === simulation.conversationPersonId) continue;
        const resting =
          person.order.type === 'shelter'
            ? navigation?.shelterDestination?.(person)
            : navigation?.restDestination?.(person);
        if (resting) {
          delete person.order.status;
          if (Math.hypot(person.x - resting.x, person.z - resting.z) > 0.2)
            navigation.movePerson(person, resting, STEP_SECONDS);
          continue;
        }
        if (person.order.type === 'shelter') {
          person.order.status = 'No reachable shelter place.';
          continue;
        }
        if (resourceFor(person.order)) {
          if (navigation) stepWorker(simulation, person, STEP_SECONDS, navigation, occupied);
        } else {
          const order = person.order;
          if (
            order.type !== 'move' &&
            (simulation.hour < 8 ||
              simulation.hour >=
                8 + (order.type === 'work' ? simulation.state.politics.workHours : 10))
          )
            continue;
          if (navigation && order.type === 'haul') {
            Logistics.haul(simulation, person, STEP_SECONDS, navigation);
            order.workedHours += STEP_SECONDS / 3600;
            continue;
          }
          if (navigation && order.type === 'build') {
            order.supplying = Logistics.build(simulation, person, STEP_SECONDS, navigation);
            if (order.supplying) continue;
          }
          const target = navigation?.workDestination ? navigation.workDestination(person) : order;
          if (!target) continue;
          if (Math.hypot(person.x - target.x, person.z - target.z) > 0.8)
            navigation?.movePerson(person, target, STEP_SECONDS);
          else if (order.type === 'work') {
            Processes.work(simulation, person, STEP_SECONDS);
            simulation.state.workSeconds[person.id] =
              (simulation.state.workSeconds[person.id] || 0) + STEP_SECONDS;
            order.workedHours += STEP_SECONDS / 3600;
          } else if (order.type === 'move') {
            person.order = null;
            person.job = null;
            simulation.invalidateRoster();
          }
        }
      }
      if (navigation?.preparePeople) {
        for (const person of simulation.presentPeople)
          person.indoorWarmthSeconds =
            (person.indoorWarmthSeconds || 0) + (person.shelterWarmth || 0) * STEP_SECONDS;
      }
      simulation.advanceConstruction(STEP_SECONDS);
      simulation.advance(STEP_SECONDS / 3600, false);
    }
    simulation.refreshFood();
    simulation.emit();
  }

  function validState(state) {
    if (!state.harvest) return state.people.every((person) => !person.cargo); // Legacy save.
    const harvest = state.harvest;
    if (state.interiorSimulation !== undefined && typeof state.interiorSimulation !== 'boolean')
      return false;
    if (
      harvest.version !== 1 ||
      (harvest.timingVersion !== undefined && harvest.timingVersion !== 2) ||
      !harvest.nodes ||
      Array.isArray(harvest.nodes) ||
      !Array.isArray(harvest.piles) ||
      !Number.isInteger(harvest.nextPileId) ||
      harvest.nextPileId < 1 ||
      !Number.isInteger(harvest.revision) ||
      harvest.revision < 0 ||
      !Number.isFinite(state.realtimeRemainderSeconds) ||
      state.realtimeRemainderSeconds < 0 ||
      state.realtimeRemainderSeconds >= STEP_SECONDS + 0.00001
    )
      return false;
    for (const [id, node] of Object.entries(harvest.nodes)) {
      for (const key of ['clearingHours', 'limbingHours', 'buckingHours'])
        if (
          node[key] !== undefined &&
          (!Number.isFinite(node[key]) || node[key] < 0 || node[key] > 1000000)
        )
          return false;
      if (node.fellAt !== undefined && (!Number.isFinite(node.fellAt) || node.fellAt < 0))
        return false;
      if (node.species !== undefined && !['conifer', 'birch'].includes(node.species)) return false;
      if (
        node.processingResource !== undefined &&
        !['timber', 'firewood'].includes(node.processingResource)
      )
        return false;
      if (
        id !== node.id ||
        !['tree', 'turf', 'hay', 'fish', 'plants'].includes(node.kind) ||
        !Number.isFinite(node.x) ||
        !Number.isFinite(node.z) ||
        !Meadows.containsPoint(node.x, node.z) ||
        ![
          'volume',
          'remaining',
          'fellingHours',
          'processingHours',
          'freshHay',
          'dryHay',
          'dryingHours',
          'height',
          'radius',
        ].every((key) => Number.isFinite(node[key]) && node[key] >= 0) ||
        node.remaining > node.volume + 0.00001 ||
        node.volume <= 0 ||
        node.volume > 100 ||
        typeof node.felled !== 'boolean' ||
        (node.cutAt !== null && !Number.isFinite(node.cutAt))
      )
        return false;
    }
    const pileIds = new Set();
    for (const pile of harvest.piles) {
      if (
        !/^pile:[1-9][0-9]*$/.test(pile.id) ||
        Number(pile.id.slice(5)) >= harvest.nextPileId ||
        pileIds.has(pile.id) ||
        !RULES[pile.resource] ||
        !Number.isFinite(pile.amount) ||
        pile.amount < 0 ||
        !Number.isFinite(pile.x) ||
        !Number.isFinite(pile.z) ||
        !Meadows.containsPoint(pile.x, pile.z)
      )
        return false;
      pileIds.add(pile.id);
    }
    if (
      !state.workSeconds ||
      typeof state.workSeconds !== 'object' ||
      Array.isArray(state.workSeconds)
    )
      return false;
    for (const [id, seconds] of Object.entries(state.workSeconds)) {
      if (
        !state.people.some((person) => String(person.id) === id) ||
        !Number.isFinite(seconds) ||
        seconds < 0 ||
        seconds > 3600.1
      )
        return false;
    }
    for (const person of state.people) {
      const manualCargo =
        person.cargo?.manual === true && person.id === state.leader.id && !person.order;
      if (person.cargo?.manual !== undefined && !manualCargo) return false;
      if (person.cargo?.sourceStoreId) {
        const cargo = person.cargo;
        if (typeof cargo.sourceStoreId !== 'string' || !state.storage?.stores[cargo.sourceStoreId])
          return false;
        if (
          person.order?.type === 'build' &&
          (cargo.siteId !== person.order.buildingId ||
            !state.queue.some(
              (site) => site.id === cargo.siteId && site.materials?.[cargo.resource],
            ))
        )
          return false;
        if (
          person.order?.type === 'haul' &&
          cargo.destinationStoreId !== person.order.destinationStoreId
        )
          return false;
      }
      if (
        person.restRetryAt !== undefined &&
        (!Number.isFinite(person.restRetryAt) || person.restRetryAt < 0)
      )
        return false;
      if (
        person.shelterWarmth !== undefined &&
        (!Number.isFinite(person.shelterWarmth) ||
          person.shelterWarmth < 0 ||
          person.shelterWarmth > 1)
      )
        return false;
      if (
        person.insideSpace !== undefined &&
        person.insideSpace !== null &&
        typeof person.insideSpace !== 'string'
      )
        return false;
      if (
        person.restPlace &&
        (!Meadows.containsPoint(person.restPlace.x, person.restPlace.z) ||
          typeof person.restPlace.spaceId !== 'string' ||
          !Number.isInteger(person.restPlace.slot) ||
          person.restPlace.slot < 0 ||
          !Number.isFinite(person.restPlace.warmth) ||
          person.restPlace.warmth < 0 ||
          person.restPlace.warmth > 1)
      )
        return false;
      if (
        person.cargo &&
        ((!person.cargo.sourceStoreId &&
          (!resourceFor(person.order) || resourceFor(person.order) !== person.cargo.resource)) ||
          !Meadows.containsPoint(person.x, person.z) ||
          !Storage.KEYS.includes(person.cargo.resource) ||
          (person.cargo.moisture !== undefined &&
            (!Number.isFinite(person.cargo.moisture) ||
              person.cargo.moisture < 0.05 ||
              person.cargo.moisture > 0.65)) ||
          !Number.isFinite(person.cargo.amount) ||
          person.cargo.amount <= 0 ||
          person.cargo.amount >
            (person.cargo.sourceStoreId
              ? Storage.loadSize(person.cargo.resource)
              : ['freshFish', 'plants'].includes(person.cargo.resource)
                ? 15
                : RULES[person.cargo.resource]?.load || 0) +
              0.00001 ||
          (person.cargo.sourceStoreId &&
            !manualCargo &&
            !['build', 'haul'].includes(person.order?.type)))
      )
        return false;
    }
    return true;
  }

  const api = {
    RULES,
    STEP_SECONDS,
    UNLOAD_SECONDS,
    initialize,
    resourceFor,
    sourceId,
    registerSource,
    sourceAvailable,
    dropCargo,
    workFactor,
    loadHours: Timing.loadHours,
    treeBudget: Timing.treeBudget,
    advance,
    validState,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandGathering = api;
})(typeof window !== 'undefined' ? window : globalThis);
