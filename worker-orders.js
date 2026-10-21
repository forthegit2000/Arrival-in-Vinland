/** Serializable orders for named workers. No DOM, renderer or autonomous jobs. */
(function (root) {
  'use strict';

  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  const WORKDAY_START = 8;
  const WORKDAY_HOURS = 10;
  const ORDER_TYPES = ['move', 'gather', 'build', 'work', 'shelter', 'haul', 'arrival'];
  const WORK = {
    fishing: { label: 'Fishing' },
    foraging: { label: 'Foraging' },
    herding: { label: 'Camp care' },
    craft: { label: 'Crafting' },
  };
  const GATHERING = {
    timber: { label: 'logs', task: 'timber' },
    firewood: { label: 'firewood', task: 'timber' },
    turf: { label: 'turf', task: 'turf' },
    hay: { label: 'hay', task: 'hay' },
  };

  function resourceForOrder(order) {
    return order?.resource || 'timber';
  }

  function isWorkingHour(hour) {
    return hour >= WORKDAY_START && hour < WORKDAY_START + WORKDAY_HOURS;
  }

  function taskForOrder(order) {
    switch (order?.type) {
      case 'gather':
        return GATHERING[resourceForOrder(order)]?.task;
      case 'build':
        return 'builders';
      case 'work':
        return order.task;
      default:
        return null;
    }
  }

  function gatheringBlockedReason(simulation, resource) {
    const state = simulation.state;
    if (!Object.hasOwn(GATHERING, resource)) {
      return 'Unknown gathering resource.';
    }
    if (['timber', 'firewood'].includes(resource) && state.ecology.wood <= 0) {
      return 'The accessible woodland is depleted.';
    }
    if (resource === 'hay') {
      if (simulation.season === 'winter') {
        return 'Hay cannot be gathered in winter.';
      }
      if (state.resources.hay >= simulation.hayCapacity) {
        return 'Hay storage is full.';
      }
      if (state.ecology.pasture <= 0) {
        return 'The meadow needs time to recover.';
      }
    }
    return '';
  }

  function validOrder(order, state) {
    if (order === undefined || order === null) {
      return true;
    }
    if (
      !ORDER_TYPES.includes(order.type) ||
      !Number.isFinite(order.x) ||
      !Number.isFinite(order.z)
    ) {
      return false;
    }
    if (!Meadows.containsPoint(order.x, order.z)) {
      return false;
    }
    if (!Number.isFinite(order.workedHours) || order.workedHours < 0) {
      return false;
    }
    if (order.type === 'gather' && !Object.hasOwn(GATHERING, resourceForOrder(order))) {
      return false;
    }
    if (order.type === 'work' && !Object.hasOwn(WORK, order.task)) return false;
    if (
      order.type === 'arrival' &&
      (!state.arrival || !['land', 'row', 'unload', 'pitch', 'livestock'].includes(order.action))
    )
      return false;
    if (
      order.type === 'haul' &&
      (typeof order.destinationStoreId !== 'string' ||
        !state.storage?.stores[order.destinationStoreId])
    )
      return false;
    if (
      order.phase !== undefined &&
      !['site', 'working', 'forest', 'cutting', 'store', 'unloading'].includes(order.phase)
    ) {
      return false;
    }
    if (
      order.waitSeconds !== undefined &&
      (!Number.isFinite(order.waitSeconds) || order.waitSeconds < 0 || order.waitSeconds > 60)
    ) {
      return false;
    }
    for (const key of [
      'retrySeconds',
      'unloadSeconds',
      'indoorRetryAt',
      'loadSeconds',
      'pickupSeconds',
      'toolWorkSeconds',
      'toolCareSeconds',
    ]) {
      if (order[key] !== undefined && (!Number.isFinite(order[key]) || order[key] < 0))
        return false;
    }
    if (order.workplaceId !== undefined && typeof order.workplaceId !== 'string') return false;
    if (order.nodeId !== undefined && typeof order.nodeId !== 'string') return false;
    for (const key of ['storePoint', 'logisticsPoint'])
      if (
        order[key] &&
        (!Meadows.containsPoint(order[key].x, order[key].z) || typeof order[key].id !== 'string')
      )
        return false;
    if (order.supplying !== undefined && typeof order.supplying !== 'boolean') return false;
    return (
      order.type !== 'build' || state.queue.some((building) => building.id === order.buildingId)
    );
  }

  function initialize(state) {
    // Older saves used automatic quotas. Keep their settlement and progress,
    // but require fresh orders instead of silently resuming autonomous jobs.
    delete state.tasks;
    delete state.politics.delegate;
    state.workerOrdersVersion = 2;
    for (const person of state.people) {
      person.job = null;
      if (person.order?.type === 'gather') {
        person.order.resource ||= 'timber';
        if (person.order.phase === 'forest') {
          person.order.phase = 'site';
        } else if (person.order.phase === 'cutting') {
          person.order.phase = 'working';
        }
      }
    }
  }

  function releasePlaces(person) {
    delete person.restPlace;
    delete person.restRetryAt;
    if (person.order) {
      delete person.order.workplaceId;
      delete person.order.indoorRetryAt;
    }
  }

  function command(simulation, ids, request) {
    simulation.roster();
    const available = new Set(simulation.availablePeople.map((person) => person.id));
    const people = [...new Set(ids)]
      .map((id) => simulation.state.people[id])
      .filter((person) => person && available.has(person.id));
    if (!people.length) {
      return 0;
    }
    const order = request.type === 'stop' ? null : { ...request, workedHours: 0 };
    if (!validOrder(order, simulation.state)) {
      return 0;
    }
    if (order?.type === 'gather') {
      order.resource ||= 'timber';
    }
    let applied = 0;
    for (const person of people) {
      if (simulation.state.arrival) {
        const Arrival =
          typeof module !== 'undefined' ? require('./arrival.js') : root.VinlandArrival;
        if (
          person.arrivalFerry &&
          simulation.state.arrival.ferry.phase !== 'idle' &&
          request.type !== 'stop'
        )
          continue;
        if (!Arrival.interrupt(simulation, person)) continue;
        if (
          (Number.isInteger(person.arrivalShip) || person.arrivalFerry) &&
          order &&
          order.type !== 'arrival'
        )
          continue;
      }
      simulation.dropGatheringCargo(person);
      releasePlaces(person);
      person.order = order ? { ...order } : null;
      person.holdPosition = !order;
      person.job = taskForOrder(person.order);
      applied++;
    }
    simulation.invalidateRoster();
    simulation.rosterCache = null;
    simulation.emit();
    return applied;
  }

  function releaseFinishedBuilders(simulation) {
    const active = new Set(simulation.state.queue.map((building) => building.id));
    for (const person of simulation.state.people) {
      if (person.order?.type === 'build' && !active.has(person.order.buildingId)) {
        simulation.dropGatheringCargo(person);
        releasePlaces(person);
        person.order = null;
        person.holdPosition = true;
        person.job = null;
      }
    }
    simulation.rosterCache = null;
  }

  const api = {
    GATHERING,
    WORK,
    resourceForOrder,
    gatheringBlockedReason,
    WORKDAY_HOURS,
    isWorkingHour,
    taskForOrder,
    validOrder,
    initialize,
    command,
    releaseFinishedBuilders,
    releasePlaces,
  };
  if (typeof module !== 'undefined') {
    module.exports = api;
  } else {
    root.VinlandWorkerOrders = api;
  }
})(typeof window === 'undefined' ? globalThis : window);
