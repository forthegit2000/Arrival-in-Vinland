/** Persistent landfall: manifests, a crewed tender, unloading and camp establishment. */
(function (root) {
  'use strict';
  const Storage = typeof module !== 'undefined' ? require('./storage.js') : root.VinlandStorage;
  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  const Content = typeof module !== 'undefined' ? require('./content.js') : root.VinlandContent;
  const TENT_HOURS = 2; // Scenario estimate for a small canvas tent, including poles and pegging.
  const TENDER = { people: 6, cargoKg: 200, speed: 1.1, loadingSeconds: 30, loadKg: 15 };
  const ACTIONS = ['land', 'row', 'unload', 'pitch', 'livestock'];
  const EPSILON = 1e-7;
  const point = (x, z) => ({ x, z });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const mass = (key, amount) => amount * ({ timber: 500, turf: 750, stone: 1000 }[key] || 1);
  const storeId = (ship) => 'ship:' + ship;
  const aboard = (person) => Number.isInteger(person.arrivalShip) || person.arrivalFerry === true;

  function transform(frame, local) {
    const c = Math.cos(frame.rotation),
      s = Math.sin(frame.rotation);
    return { x: frame.x + c * local.x + s * local.z, z: frame.z - s * local.x + c * local.z };
  }
  function initialPose(state, index) {
    const p = state.config.site === 'meadows' ? Meadows.anchorage(index) : [-108, -45 + index * 24];
    return { x: p[0], z: p[1], rotation: -0.24 + index * 0.04 };
  }
  function animalKinds(state) {
    return Object.entries(state.livestock).flatMap(([kind, count]) => Array(count).fill(kind));
  }
  function start(simulation) {
    const state = simulation.state;
    if (state.arrival) return true;
    const kinds = animalKinds(state);
    if (kinds.length && state.ships.length < 2) return false;
    const livestockShip = kinds.length ? state.ships.length - 1 : null;
    const passengerShips = Math.max(1, state.ships.length - (kinds.length ? 1 : 0));
    const handlerCount =
      livestockShip === null ? 0 : Math.min(8, Math.floor(state.people.length / 12));
    if (state.people.length - handlerCount > passengerShips * 60) return false;
    const poses = state.ships.map((_, index) => initialPose(state, index));
    state.arrival = {
      version: 1,
      livestockShip,
      shipPoses: poses,
      landing: null,
      waterLanding: null,
      hallDiscovered: !state.config.inheritedHall,
      seatsPrepared: false,
      tents: Array.from({ length: state.resources.tents }, (_, id) => ({
        id,
        shipId: id % passengerShips,
        status: 'packed',
        progress: 0,
        x: 0,
        z: 0,
        rotation: 0,
      })),
      animals: kinds.map((kind, id) => ({
        id,
        kind,
        shipId: livestockShip,
        progress: 0,
        x: 0,
        z: 0,
      })),
      deployment: null,
      ferry: {
        phase: 'idle',
        workerId: null,
        sourceShip: 0,
        passengers: [],
        tents: [],
        elapsed: 0,
        x: poses[0].x + 4,
        z: poses[0].z,
        from: point(poses[0].x + 4, poses[0].z),
        to: point(poses[0].x + 4, poses[0].z),
        duration: 0,
      },
    };
    const camp = state.storage.stores.camp;
    const startingStock = { ...camp.stock };
    camp.stock = {};
    delete camp.resourcePlots;
    delete camp.pileStock;
    state.ships.forEach((ship, index) => {
      ship.role = index === livestockShip ? 'livestock' : 'passengers';
      ship.name = index === livestockShip ? 'Livestock knarr' : 'Knarr ' + (index + 1);
      state.storage.stores[storeId(index)] = {
        id: storeId(index),
        type: 'ship',
        ...poses[index],
        capacity: 100,
        stock: {},
      };
    });
    state.storage.stores.ferry = {
      id: 'ferry',
      type: 'ferry',
      ...state.arrival.ferry,
      capacity: 4,
      stock: {},
    };
    for (const [key, amount] of Object.entries(startingStock)) {
      if (['hay'].includes(key) && livestockShip !== null) {
        state.storage.stores[storeId(livestockShip)].stock[key] = amount;
      } else {
        const ships =
          key === 'water' && livestockShip !== null ? state.ships.length : passengerShips;
        for (let ship = 0; ship < ships; ship++)
          state.storage.stores[storeId(ship)].stock[key] = amount / ships;
      }
    }
    const handlers = livestockShip === null ? 0 : Math.min(8, Math.floor(state.people.length / 12));
    const passengerCount = state.people.length - handlers;
    for (const person of state.people) {
      const ship = person.id >= passengerCount ? livestockShip : person.id % passengerShips;
      person.arrivalShip = ship;
      person.arrivalFerry = false;
      person.order = null;
      person.holdPosition = true;
      person.job = null;
      const rank = Math.floor(person.id / passengerShips);
      person.arrivalSeat = { x: ((rank % 4) - 1.5) * 0.72, z: (Math.floor(rank / 4) - 6) * 0.8 };
      Object.assign(person, transform(poses[ship], person.arrivalSeat));
    }
    const leader = state.people[state.leader.id];
    Object.assign(state.leader, {
      x: leader.x,
      z: leader.z,
      heading: poses[0].rotation,
      walking: true,
    });
    state.journal = state.journal.filter((entry) => entry.kind !== 'arrival');
    simulation.log(
      state.ships.length +
        ' knarrs lie at anchor. People and packed supplies remain aboard' +
        (livestockShip === null ? '.' : '; the livestock have their own knarr.'),
      'arrival',
    );
    simulation.invalidateRoster();
    return true;
  }

  function shoreNormal(x, z) {
    const dx = Meadows.shoreDistance(x + 1, z) - Meadows.shoreDistance(x - 1, z);
    const dz = Meadows.shoreDistance(x, z + 1) - Meadows.shoreDistance(x, z - 1);
    const length = Math.hypot(dx, dz) || 1;
    return { x: dx / length, z: dz / length };
  }
  function canLand(state, p) {
    if (!p || !Meadows.containsPoint(p.x, p.z)) return false;
    const d = state.config.site === 'meadows' ? Meadows.shoreDistance(p.x, p.z) : p.x + 83;
    return (
      d >= 3 &&
      d <= 30 &&
      (state.config.site !== 'meadows' || Meadows.freshwaterDistance(p.x, p.z) > 3)
    );
  }
  function defaultLanding(state) {
    const base = state.config.site === 'meadows' ? point(...Meadows.landing) : point(-68, 0);
    for (let radius = 0; radius < 50; radius += 3) {
      for (let step = 0; step < 16; step++) {
        const p = {
          x: base.x + Math.sin((step * Math.PI) / 8) * radius,
          z: base.z + Math.cos((step * Math.PI) / 8) * radius,
        };
        if (canLand(state, p)) return p;
      }
    }
    return base;
  }
  function setLanding(simulation, p, navigation) {
    const state = simulation.state,
      a = state.arrival;
    if (
      !a ||
      a.ferry.phase !== 'idle' ||
      a.deployment ||
      a.animals.some((animal) => animal.shipId === null) ||
      a.tents.some((t) => t.status !== 'packed') ||
      Storage.storeVolume(state, state.storage.stores.camp) > EPSILON ||
      !canLand(state, p) ||
      (navigation?.arrivalLandingClear && !navigation.arrivalLandingClear(p))
    )
      return false;
    a.landing = point(p.x, p.z);
    const normal = state.config.site === 'meadows' ? shoreNormal(p.x, p.z) : point(1, 0);
    const d = state.config.site === 'meadows' ? Meadows.shoreDistance(p.x, p.z) : p.x + 83;
    a.waterLanding = { x: p.x - normal.x * (d + 1.7), z: p.z - normal.z * (d + 1.7) };
    const stores = { x: p.x + normal.x * 10, z: p.z + normal.z * 10 };
    Object.assign(state.storage.stores.camp, stores);
    state.timberDropoff = { ...stores, label: 'Landing stores' };
    return true;
  }
  function ensureLanding(simulation, navigation) {
    if (simulation.state.arrival.landing) return true;
    const candidate = navigation?.suggestArrivalLanding?.() || defaultLanding(simulation.state);
    return setLanding(simulation, candidate, navigation);
  }
  function order(simulation, ids, action, target) {
    if (!simulation.state.arrival || !ACTIONS.includes(action)) return 0;
    const a = simulation.state.arrival;
    const p = target || a.landing || defaultLanding(simulation.state);
    ids = ids.filter((id) => {
      const person = simulation.state.people[id];
      return (
        person &&
        (action !== 'land' || (Number.isInteger(person.arrivalShip) && !person.arrivalFerry)) &&
        (!['pitch', 'livestock'].includes(action) || !aboard(person))
      );
    });
    return simulation.commandWorkers(ids, { type: 'arrival', action, x: p.x, z: p.z });
  }
  function leaderAshore(simulation, navigation) {
    const state = simulation.state,
      a = state.arrival,
      leader = state.people[state.leader.id];
    if (
      !a ||
      leader.arrivalFerry ||
      !Number.isInteger(leader.arrivalShip) ||
      !ensureLanding(simulation, navigation)
    )
      return false;
    let rower = state.people.find(
      (p) =>
        p.alive &&
        !p.away &&
        p.id !== leader.id &&
        p.arrivalShip === leader.arrivalShip &&
        !p.order,
    );
    if (!rower) return false;
    order(simulation, [rower.id], 'row');
    leader.order = { type: 'arrival', action: 'land', ...a.landing, workedHours: 0 };
    const companion = state.people.find(
      (p) =>
        p.id !== leader.id && p.id !== rower.id && p.arrivalShip === leader.arrivalShip && !p.order,
    );
    if (companion) order(simulation, [companion.id], 'land');
    return true;
  }

  // Landing requests relay explicit orders to named people. They never replace
  // an existing job, and passengers do not have to qualify as labourers.
  function landingHelpers(simulation, speakerId) {
    const speaker = simulation.state.people[speakerId];
    return simulation.availablePeople
      .filter((person) => !aboard(person) && !person.order)
      .sort(
        (left, right) =>
          Number(right.id === speakerId) - Number(left.id === speakerId) ||
          distance(left, speaker) - distance(right, speaker),
      );
  }
  function landingOptions(simulation, speakerId) {
    const state = simulation.state,
      arrival = state.arrival;
    const speaker = state.people[speakerId];
    if (
      !arrival ||
      !speaker?.alive ||
      speaker.away ||
      speaker.age < 16 ||
      speaker.health < 35 ||
      aboard(speaker) ||
      aboard(state.people[state.leader.id])
    )
      return [];
    const helpers = landingHelpers(simulation, speakerId);
    const rower = state.people[arrival.ferry.workerId];
    const hasRower =
      !!(rower?.alive && !rower.away && rower.order?.type === 'arrival') ||
      simulation.availablePeople.some(
        (person) => person.order?.type === 'arrival' && person.order.action === 'row',
      );
    const needRower = hasRower ? 0 : 1;
    const passengers = simulation.presentPeople.filter(
      (person) =>
        Number.isInteger(person.arrivalShip) &&
        !person.arrivalFerry &&
        person.id !== arrival.ferry.workerId,
    );
    const cargo = Object.values(state.storage.stores).some(
      (store) =>
        ['ship', 'ferry'].includes(store.type) &&
        Object.values(store.stock).some((amount) => amount > EPSILON),
    );
    const packed = arrival.tents.some((tent) => ['packed', 'transit'].includes(tent.status));
    const unloading = state.people.filter(
      (person) => person.order?.type === 'arrival' && person.order.action === 'unload',
    ).length;
    const handling = state.people.filter(
      (person) =>
        !aboard(person) && person.order?.type === 'arrival' && person.order.action === 'livestock',
    ).length;
    const helperReason =
      'No idle helpers ashore. Bring more people ashore, or ask someone to stop first.';
    return [
      {
        action: 'land',
        visible: passengers.length > 0,
        reason: !passengers.some((person) => !person.order)
          ? 'The remaining passengers already have orders.'
          : helpers.length < needRower
            ? 'An idle person ashore is needed to row the landing boat.'
            : '',
      },
      {
        action: 'unload',
        visible: cargo || packed || state.people.some((person) => person.arrivalCarry),
        reason:
          unloading >= 4
            ? 'Four helpers are already unloading.'
            : helpers.length < 1 + needRower
              ? helperReason
              : '',
      },
      {
        action: 'livestock',
        visible: arrival.animals.some((animal) => animal.shipId !== null),
        reason:
          handling >= 2
            ? 'The livestock handlers are already working.'
            : helpers.length < 2 - handling
              ? 'Two available handlers must be ashore. Bring more people over, or ask someone to stop first.'
              : '',
      },
      {
        action: 'pitch',
        visible: arrival.tents.some((tent) =>
          ['packed', 'transit', 'landed'].includes(tent.status),
        ),
        reason: !arrival.tents.some((tent) => tent.status === 'landed')
          ? 'Unload a packed tent first.'
          : !helpers.length
            ? helperReason
            : '',
      },
    ].filter((option) => option.visible);
  }
  function requestLanding(simulation, speakerId, action, target, navigation) {
    const option = landingOptions(simulation, speakerId).find((item) => item.action === action);
    if (!option || option.reason)
      return { count: 0, reason: option?.reason || 'That landing task is unavailable.' };
    const state = simulation.state,
      arrival = state.arrival;
    const helpers = landingHelpers(simulation, speakerId);
    if (action === 'pitch') {
      if (
        !target ||
        !Meadows.containsPoint(target.x, target.z) ||
        (navigation?.canPitchArrivalTent && !navigation.canPitchArrivalTent(target))
      )
        return { count: 0, reason: 'Choose clear, dry ground with room to work beside the tent.' };
      const reachable = [];
      for (const person of helpers) {
        if (reachable.some((helper) => helper.id % 5 === person.id % 5)) continue;
        const workPoint = { x: target.x + 2.8, z: target.z + ((person.id % 5) - 2) * 1.05 };
        if (
          !navigation?.path ||
          distance(person, workPoint) <= 0.8 ||
          navigation.path(person, workPoint, 'person:' + person.id).length
        )
          reachable.push(person);
        if (reachable.length === 2) break;
      }
      if (!reachable.length)
        return { count: 0, reason: 'No idle helper can reach that tent site.' };
      const count = order(
        simulation,
        reachable.map((person) => person.id),
        'pitch',
        target,
      );
      return { count, reason: count ? '' : 'The tent helpers are no longer available.' };
    }
    if (['land', 'unload'].includes(action)) {
      const rower = state.people[arrival.ferry.workerId];
      if (
        !(rower?.alive && !rower.away && rower.order?.type === 'arrival') &&
        !simulation.availablePeople.some(
          (person) => person.order?.type === 'arrival' && person.order.action === 'row',
        )
      )
        order(simulation, [helpers.shift().id], 'row');
    }
    if (action === 'land') {
      const passengers = simulation.presentPeople.filter(
        (person) => Number.isInteger(person.arrivalShip) && !person.arrivalFerry && !person.order,
      );
      for (const person of passengers) {
        person.order = {
          type: 'arrival',
          action: 'land',
          assemble: true,
          ...(arrival.landing || defaultLanding(state)),
          workedHours: 0,
        };
        person.holdPosition = false;
      }
      simulation.invalidateRoster();
      simulation.emit();
      return { count: passengers.length, reason: '' };
    }
    const alreadyAssigned = state.people.filter(
      (person) => person.order?.type === 'arrival' && person.order.action === action,
    ).length;
    const count = order(
      simulation,
      helpers
        .slice(0, (action === 'livestock' ? 2 : 4) - alreadyAssigned)
        .map((person) => person.id),
      action,
    );
    return { count, reason: count ? '' : 'No idle helpers are available.' };
  }
  function finishOrder(simulation, person) {
    person.order = null;
    person.job = null;
    person.holdPosition = true;
    simulation.invalidateRoster();
  }
  function interrupt(simulation, person) {
    const a = simulation.state.arrival;
    if (!a) return true;
    delete person.arrivalBlocked;
    if (person.arrivalFerry && a.ferry.phase !== 'idle') {
      person.arrivalStop = true;
      return false; // Complete the safe crossing before changing the passenger's location.
    }
    if (person.arrivalTent !== undefined) {
      const tent = a.tents.find((t) => t.id === person.arrivalTent);
      if (tent) {
        Object.assign(tent, { status: 'landed', ...(tent.pickup || point(person.x, person.z)) });
        delete tent.pickup;
      }
      delete person.arrivalTent;
    }
    delete person.arrivalReturning;
    if (person.arrivalCarry) {
      const load = person.arrivalCarry;
      const store = Storage.cache(
        simulation.state,
        'arrival-interrupted:' + simulation.state.harvest.nextPileId++,
        person,
      );
      Storage.deposit(simulation.state, store.id, load.resource, load.amount, load.moisture ?? 0.2);
      delete person.arrivalCarry;
    }
    if (a.ferry.workerId === person.id) {
      person.arrivalFerry = false;
      if (a.landing && distance(a.ferry, a.waterLanding) < 3) {
        person.arrivalShip = null;
        Object.assign(person, a.landing);
      }
      a.ferry.workerId = null;
    }
    return true;
  }
  function move(person, target, seconds, navigation) {
    if (distance(person, target) <= 0.35) return true;
    if (navigation?.moveArrivalPerson) return navigation.moveArrivalPerson(person, target, seconds);
    const d = distance(person, target),
      step = Math.min(d, seconds * 1.1);
    person.x += ((target.x - person.x) / d) * step;
    person.z += ((target.z - person.z) / d) * step;
    person.moving = step > 0;
    return d - step <= 0.35;
  }
  function feedBeforeCrossing(simulation, person, sourceShip) {
    if ((person.mealCalories || 0) < 250) {
      const ratio = simulation.consumeFood(250, storeId(sourceShip));
      person.mealCalories = (person.mealCalories || 0) + 250 * ratio;
    }
    const water = Storage.withdraw(
      simulation.state,
      storeId(sourceShip),
      'water',
      Math.max(0, 0.5 - (person.drinkingWaterCredit || 0)),
    );
    person.drinkingWaterCredit = (person.drinkingWaterCredit || 0) + water;
    simulation.flow('consumption', 'water', water);
  }
  function beginTravel(f, phase, target) {
    f.phase = phase;
    f.elapsed = 0;
    f.from = point(f.x, f.z);
    f.to = point(target.x, target.z);
    f.duration = Math.max(1, distance(f.from, target) / TENDER.speed);
  }
  function sourceDock(a, index) {
    return transform(a.shipPoses[index], { x: 3.4, z: -4 });
  }
  function selectTask(state) {
    const availableShip = (id) =>
      !(id === state.arrival.livestockShip && state.arrival.deployment?.phase === 'approaching');
    const people = state.people.filter((p) => p.alive && !p.away && p.order?.type === 'arrival');
    const passenger = people.find(
      (p) =>
        ['land', 'unload'].includes(p.order.action) &&
        Number.isInteger(p.arrivalShip) &&
        !p.arrivalFerry &&
        availableShip(p.arrivalShip),
    );
    if (passenger) return { mode: 'people', ship: passenger.arrivalShip };
    if (people.some((p) => p.order.action === 'unload')) {
      const ship = state.ships.findIndex(
        (_, i) =>
          availableShip(i) &&
          (Storage.storeVolume(state, state.storage.stores[storeId(i)]) > EPSILON ||
            state.arrival.tents.some((t) => t.shipId === i && t.status === 'packed')),
      );
      if (ship >= 0) return { mode: 'cargo', ship };
    }
    return null;
  }
  function loadFerry(simulation) {
    const state = simulation.state,
      a = state.arrival,
      f = a.ferry;
    const worker = state.people[f.workerId];
    worker.arrivalFerry = true;
    if (f.mode === 'people') {
      f.passengers = state.people
        .filter(
          (p) =>
            p.id !== worker.id &&
            p.arrivalShip === f.sourceShip &&
            !p.arrivalFerry &&
            p.order?.type === 'arrival' &&
            ['land', 'unload'].includes(p.order.action),
        )
        .slice(0, TENDER.people - 1)
        .map((p) => p.id);
      for (const id of f.passengers) {
        const p = state.people[id];
        p.arrivalFerry = true;
        feedBeforeCrossing(simulation, p, f.sourceShip);
      }
    } else {
      let room = TENDER.cargoKg;
      for (const tent of a.tents
        .filter((t) => t.shipId === f.sourceShip && t.status === 'packed')
        .slice(0, 2)) {
        tent.status = 'transit';
        tent.shipId = null;
        f.tents.push(tent.id);
        room -= 15;
      }
      const source = state.storage.stores[storeId(f.sourceShip)];
      for (const key of Storage.KEYS) {
        const amount = Storage.withdraw(
          state,
          source.id,
          key,
          Math.min(source.stock[key] || 0, room / mass(key, 1)),
        );
        Storage.deposit(state, 'ferry', key, amount, source.woodMoisture ?? 0.2);
        room -= mass(key, amount);
      }
    }
    feedBeforeCrossing(simulation, worker, f.sourceShip);
    beginTravel(f, 'outbound', a.waterLanding);
  }
  function putAshore(simulation, person, index, navigation) {
    const a = simulation.state.arrival;
    person.arrivalShip = null;
    person.arrivalFerry = false;
    const p = navigation?.arrivalPersonTarget?.(index, person.id) || {
      x: a.landing.x + (index % 5) * 0.8,
      z: a.landing.z + Math.floor(index / 5) * 0.8,
    };
    Object.assign(person, p);
    if (person.id === simulation.state.leader.id) Object.assign(simulation.state.leader, p);
    navigation?.syncArrivalPerson?.(person);
    if (person.order?.action === 'land' && person.order.assemble && !person.arrivalStop) {
      person.order.arrivalAssembly = navigation?.arrivalAssemblyTarget?.(person.id) || {
        x: a.landing.x + 20 + (person.id % 8) * 1.6,
        z: a.landing.z + Math.floor(person.id / 8) * 1.6,
      };
      person.order.status = 'Walking clear of the landing.';
    } else if (person.order?.action === 'land' || person.arrivalStop) {
      delete person.arrivalStop;
      finishOrder(simulation, person);
    }
  }
  function unload(simulation, seconds, navigation) {
    const state = simulation.state,
      a = state.arrival,
      f = a.ferry;
    const store = state.storage.stores.ferry;
    const workers = state.people.filter(
      (p) =>
        p.id !== simulation.conversationPersonId &&
        p.order?.type === 'arrival' &&
        p.order.action === 'unload' &&
        !aboard(p),
    );
    if (!workers.length && f.workerId !== null) {
      const rower = state.people[f.workerId];
      if (rower.id === simulation.conversationPersonId) return;
      if (rower.arrivalFerry) putAshore(simulation, rower, 0, navigation);
      workers.push(rower);
    }
    for (const p of workers) {
      if (p.arrivalCarry) {
        const target = navigation?.arrivalDropPoint?.(p.arrivalCarry.resource, p) || a.landing;
        if (!target || !move(p, target, seconds, navigation)) continue;
        const amount = Storage.deposit(
          state,
          'camp',
          p.arrivalCarry.resource,
          p.arrivalCarry.amount,
          p.arrivalCarry.moisture ?? 0.2,
        );
        p.arrivalCarry.amount -= amount;
        if (p.arrivalCarry.amount > EPSILON) {
          p.order.status = 'Landing storage is full.';
          continue;
        }
        delete p.arrivalCarry;
        p.arrivalReturning = true;
      }
      const dock = navigation?.arrivalPersonTarget?.(0, p.id) || a.landing;
      if (!move(p, dock, seconds, navigation)) continue;
      p.arrivalReturning = false;
      p.order.status = 'Unloading the landing boat.';
      p.arrivalLoadSeconds = (p.arrivalLoadSeconds || 0) + seconds;
      if (p.arrivalLoadSeconds < 8) continue;
      p.arrivalLoadSeconds = 0;
      if (f.tents.length) {
        const tentId = f.tents.shift();
        const tent = a.tents.find((t) => t.id === tentId);
        Object.assign(tent, { shipId: null, status: 'landed', x: dock.x + 1, z: dock.z + 1 });
        continue;
      }
      const key = Storage.KEYS.find((key) => (store.stock[key] || 0) > EPSILON);
      if (!key) continue;
      const amount = Storage.withdraw(state, 'ferry', key, Storage.loadSize(key));
      p.arrivalFerry = false;
      p.arrivalShip = null;
      p.arrivalCarry = { resource: key, amount, moisture: store.woodMoisture ?? 0.2 };
    }
    const remaining =
      Storage.storeVolume(state, store) > EPSILON ||
      f.tents.length ||
      state.people.some((p) => p.arrivalCarry || p.arrivalReturning);
    if (!remaining) {
      const rower = state.people[f.workerId];
      if (rower) {
        rower.arrivalFerry = true;
        rower.arrivalShip = null;
        if (rower.arrivalStop) {
          putAshore(simulation, rower, 0, navigation);
          f.workerId = null;
        }
      }
      f.phase = 'idle';
      f.elapsed = 0;
    }
  }
  function ferryStep(simulation, seconds, navigation) {
    const state = simulation.state,
      a = state.arrival,
      f = a.ferry;
    if (f.workerId === null) {
      const rower = state.people.find(
        (p) => p.order?.type === 'arrival' && p.order.action === 'row',
      );
      const unloader = state.people.find(
        (p) => p.order?.type === 'arrival' && p.order.action === 'unload' && !aboard(p),
      );
      const p = rower || unloader;
      if (!p) return;
      if (Number.isInteger(p.arrivalShip) && distance(f, sourceDock(a, p.arrivalShip)) > 6) {
        p.order.status = 'Waiting for the landing boat.';
        return;
      }
      f.workerId = p.id;
      p.arrivalFerry = true;
    }
    const rower = state.people[f.workerId];
    if (!rower?.alive || rower.away) {
      f.workerId = null;
      return;
    }
    if (rower.id === simulation.conversationPersonId && f.phase !== 'unloading') return;
    if (f.phase === 'idle') {
      const task = selectTask(state);
      if (!task) {
        rower.order.status = 'Landing boat moored; awaiting orders.';
        for (const p of state.people.filter(
          (p) => p.order?.type === 'arrival' && p.order.action === 'unload',
        )) {
          if (p.id === f.workerId) {
            putAshore(simulation, p, 0, navigation);
            f.workerId = null;
          }
          finishOrder(simulation, p);
        }
        return;
      }
      f.sourceShip = task.ship;
      f.mode = task.mode;
      beginTravel(f, 'positioning', sourceDock(a, task.ship));
    } else if (f.phase === 'positioning' || f.phase === 'outbound') {
      f.elapsed = Math.min(f.duration, f.elapsed + seconds);
      const t = f.elapsed / f.duration;
      f.x = f.from.x + (f.to.x - f.from.x) * t;
      f.z = f.from.z + (f.to.z - f.from.z) * t;
      if (t === 1) {
        if (f.phase === 'positioning') {
          f.phase = 'loading';
          f.elapsed = 0;
        } else {
          f.passengers.forEach((id, i) =>
            putAshore(simulation, state.people[id], i + 1, navigation),
          );
          f.passengers = [];
          f.phase = 'unloading';
          f.elapsed = 0;
        }
      }
    } else if (f.phase === 'loading') {
      f.elapsed += seconds;
      if (f.elapsed >= TENDER.loadingSeconds) loadFerry(simulation);
    } else if (f.phase === 'unloading') unload(simulation, seconds, navigation);
    if (rower.order && rower.id !== simulation.conversationPersonId)
      rower.order.status =
        f.phase === 'unloading'
          ? 'Landing cargo.'
          : f.phase === 'loading'
            ? 'Loading the landing boat.'
            : 'Rowing the landing boat.';
    for (const id of [f.workerId, ...f.passengers]) {
      const p = state.people[id];
      if (!p?.arrivalFerry) continue;
      const seat = id === f.workerId ? 0 : 1 + f.passengers.indexOf(id);
      const heading = Math.atan2(f.to.x - f.from.x, f.to.z - f.from.z);
      Object.assign(
        p,
        transform(
          { x: f.x, z: f.z, rotation: heading },
          { x: seat % 2 ? -0.4 : 0.4, z: -1.5 + Math.floor(seat / 2) * 1.1 },
        ),
      );
      if (id === state.leader.id) Object.assign(state.leader, { x: p.x, z: p.z, heading });
      navigation?.syncArrivalPerson?.(p);
    }
    Object.assign(state.storage.stores.ferry, { x: f.x, z: f.z });
  }
  function pitchStep(simulation, person, seconds, navigation) {
    const a = simulation.state.arrival;
    if (aboard(person)) {
      person.order.status = 'Go ashore before pitching a tent.';
      return;
    }
    let tent = a.tents.find((t) => t.id === person.order.tentId);
    if (!tent || tent.status === 'landed') {
      const target = person.order;
      tent =
        a.tents.find(
          (t) => ['carried', 'pitching'].includes(t.status) && distance(t, target) < 1,
        ) || a.tents.find((t) => t.status === 'landed');
      if (!tent) {
        person.order.status = 'Unload a packed tent first.';
        return;
      }
      if (tent.status === 'landed') {
        if (navigation?.canPitchArrivalTent && !navigation.canPitchArrivalTent(target)) {
          person.order.status = 'Choose clear, dry ground for the tent.';
          return;
        }
        Object.assign(tent, {
          status: 'carried',
          pickup: point(tent.x, tent.z),
          x: target.x,
          z: target.z,
          rotation: target.rotation || 0,
        });
        person.arrivalTent = tent.id;
      }
      person.order.tentId = tent.id;
    }
    if (tent.status === 'pitched') {
      finishOrder(simulation, person);
      return;
    }
    const workPoint = { x: tent.x + 2.8, z: tent.z + ((person.id % 5) - 2) * 1.05 };
    if (tent.status === 'carried') {
      if (person.arrivalTent !== tent.id) {
        person.order.status = 'Waiting for the tent equipment to reach the site.';
        move(person, workPoint, seconds, navigation);
        return;
      }
      if (tent.pickup) {
        person.order.status = 'Walking to collect the packed tent.';
        if (!move(person, tent.pickup, seconds, navigation)) return;
        delete tent.pickup;
      }
      person.order.status = 'Carrying tent equipment to the site.';
      if (!move(person, workPoint, seconds, navigation)) return;
      delete person.arrivalTent;
      tent.status = 'pitching';
    }
    if (!move(person, workPoint, seconds, navigation)) {
      person.order.status = 'Carrying tent equipment to the site.';
      return;
    }
    person.order.status =
      'Pitching tent: ' +
      Math.ceil(Math.max(0, TENT_HOURS - tent.progress) * 60) +
      ' person-minutes remaining.';
    const earned = Math.min(seconds / 3600, TENT_HOURS - tent.progress);
    person.order.workedHours += earned;
    simulation.state.flow.labor += earned;
    tent.progress += earned;
    if (tent.progress >= TENT_HOURS - EPSILON) {
      tent.status = 'pitched';
      finishOrder(simulation, person);
    }
  }
  function livestockStep(simulation, seconds, navigation) {
    const state = simulation.state,
      a = state.arrival;
    const handlers = state.people.filter(
      (p) =>
        p.id !== simulation.conversationPersonId &&
        !aboard(p) &&
        p.order?.type === 'arrival' &&
        p.order.action === 'livestock',
    );
    if (!handlers.length) return;
    if (handlers.length < 2) {
      handlers[0].order.status = 'Select at least two handlers for the livestock.';
      return;
    }
    const normal =
      state.config.site === 'meadows' ? shoreNormal(a.landing.x, a.landing.z) : point(1, 0);
    if (!a.deployment) {
      let ready = true;
      handlers.slice(0, 2).forEach((p, i) => {
        const target = {
          x: a.landing.x + normal.x * 3 - normal.z * (i ? 1.5 : -1.5),
          z: a.landing.z + normal.z * 3 + normal.x * (i ? 1.5 : -1.5),
        };
        if (!move(p, target, seconds, navigation)) ready = false;
        p.order.status = 'Walking to the livestock landing.';
      });
      if (!ready) return;
    }
    if (!a.deployment) {
      if (
        a.ferry.sourceShip === a.livestockShip &&
        ['positioning', 'loading'].includes(a.ferry.phase)
      ) {
        handlers.forEach(
          (p) => (p.order.status = 'Waiting for the landing boat to clear the livestock knarr.'),
        );
        return;
      }
      const normal =
        state.config.site === 'meadows' ? shoreNormal(a.landing.x, a.landing.z) : point(1, 0);
      const d =
        state.config.site === 'meadows'
          ? Meadows.shoreDistance(a.landing.x, a.landing.z)
          : a.landing.x + 83;
      const destination = {
        x: a.landing.x - normal.x * (d + 4),
        z: a.landing.z - normal.z * (d + 4),
        rotation: Math.atan2(-normal.z, normal.x),
      };
      a.deployment = {
        phase: 'approaching',
        elapsed: 0,
        duration: 180,
        from: { ...a.shipPoses[a.livestockShip] },
        to: destination,
      };
    }
    const deployment = a.deployment;
    handlers.forEach(
      (p) =>
        (p.order.status =
          deployment.phase === 'approaching'
            ? 'Bringing the livestock knarr to the landing.'
            : 'Leading livestock ashore.'),
    );
    if (deployment.phase === 'approaching') {
      deployment.elapsed = Math.min(deployment.duration, deployment.elapsed + seconds);
      const t = deployment.elapsed / deployment.duration,
        pose = a.shipPoses[a.livestockShip];
      for (const key of ['x', 'z', 'rotation'])
        pose[key] = deployment.from[key] + (deployment.to[key] - deployment.from[key]) * t;
      for (const p of state.people.filter(
        (p) => p.arrivalShip === a.livestockShip && !p.arrivalFerry,
      )) {
        const local = p.arrivalSeat || { x: 0, z: -6 };
        Object.assign(p, transform(pose, local));
        if (p.id === state.leader.id) Object.assign(state.leader, { x: p.x, z: p.z });
      }
      Object.assign(state.storage.stores[storeId(a.livestockShip)], pose);
      if (t === 1) deployment.phase = 'unloading';
      return;
    }
    const animal = a.animals.find((animal) => animal.shipId !== null);
    if (!animal) {
      handlers.forEach((p) => finishOrder(simulation, p));
      return;
    }
    const index = a.animals.indexOf(animal);
    animal.target ||= navigation?.arrivalAnimalTarget?.(index) || {
      x: a.landing.x + 12 + (index % 6) * 2,
      z: a.landing.z + Math.floor(index / 6) * 2,
    };
    const from = transform(a.shipPoses[a.livestockShip], { x: 2.3, z: 0 });
    const total = Math.max(15, distance(from, animal.target) / 0.55);
    animal.progress = Math.min(1, animal.progress + seconds / total);
    animal.x = from.x + (animal.target.x - from.x) * animal.progress;
    animal.z = from.z + (animal.target.z - from.z) * animal.progress;
    // Handlers receive each animal at the dry end of the ramp, then lead inland.
    // They walk to their positions rather than snapping from animal to animal.
    const shoreProgress = Math.max(0, (animal.progress - 0.5) * 2);
    const target = {
      x: a.landing.x + (animal.target.x - a.landing.x) * shoreProgress + normal.x,
      z: a.landing.z + (animal.target.z - a.landing.z) * shoreProgress + normal.z,
    };
    move(handlers[0], target, seconds, navigation);
    if (animal.progress === 1) animal.shipId = null;
  }
  function step(simulation, seconds, navigation) {
    const a = simulation.state.arrival;
    if (!a || !ensureLanding(simulation, navigation)) return;
    for (const person of simulation.state.people)
      if (person.order?.type === 'arrival') person.moving = false;
    // Merely starting a campaign never moves anyone. Every activity below
    // requires a named person's current order.
    ferryStep(simulation, seconds, navigation);
    for (const p of simulation.state.people) {
      if (
        p.order?.type === 'arrival' &&
        p.order.action === 'land' &&
        p.order.arrivalAssembly &&
        !aboard(p) &&
        p.id !== simulation.conversationPersonId
      ) {
        if (move(p, p.order.arrivalAssembly, seconds, navigation)) finishOrder(simulation, p);
      }
      if (
        p.order?.type === 'arrival' &&
        p.id !== simulation.conversationPersonId &&
        p.order.action === 'pitch' &&
        simulation.hour >= 8 &&
        simulation.hour < 18
      )
        pitchStep(simulation, p, seconds, navigation);
    }
    if (a.livestockShip !== null) livestockStep(simulation, seconds, navigation);
    for (const person of simulation.state.people) {
      if (
        person.id !== simulation.conversationPersonId &&
        person.arrivalBlocked &&
        person.order?.type === 'arrival'
      )
        person.order.status = 'Waiting for a clear route to the landing task.';
    }
    if (
      !a.hallDiscovered &&
      simulation.state.config.inheritedHall &&
      !aboard(simulation.state.people[simulation.state.leader.id]) &&
      Math.hypot(simulation.state.leader.x, simulation.state.leader.z) < 22
    ) {
      a.hallDiscovered = true;
      simulation.log(
        'Karlsefni discovers Hall F. Inspect its rooms and surviving hearths before deciding how to use it.',
        'discovery',
      );
    }
  }
  function pitched(state) {
    return state.arrival
      ? state.arrival.tents.filter((t) => t.status === 'pitched').length
      : state.resources.tents;
  }
  function consumeTent(state) {
    if (!state.arrival) return true;
    const tent =
      state.arrival.tents.find((t) => t.status === 'landed') ||
      state.arrival.tents.find((t) => t.status === 'pitched');
    if (!tent) return false;
    state.arrival.tents = state.arrival.tents.filter((t) => t !== tent);
    return { ...tent };
  }
  function returnTent(state, source) {
    if (!state.arrival || !source.arrivalTent) return;
    state.arrival.tents.push({
      ...source.arrivalTent,
      shipId: null,
      status: 'landed',
      progress: 0,
      x: source.x,
      z: source.z,
    });
  }
  function foodStore(state, person) {
    if (person.arrivalFerry)
      return state.arrival.ferry.phase === 'idle' &&
        state.arrival.landing &&
        distance(state.arrival.ferry, state.arrival.waterLanding) < 3
        ? 'camp'
        : 'ferry';
    return Number.isInteger(person.arrivalShip) ? storeId(person.arrivalShip) : 'camp';
  }
  function eat(simulation, meals, portion) {
    const groups = new Map(),
      ratios = new Map();
    for (const p of simulation.presentPeople) {
      const id = foodStore(simulation.state, p),
        meal = meals.get(p.id);
      groups.set(id, (groups.get(id) || 0) + meal.need * portion - meal.eaten);
    }
    for (const [id, energy] of groups)
      ratios.set(id, energy ? simulation.consumeFood(energy, id) : 1);
    return new Map(
      simulation.presentPeople.map((p) => [p.id, ratios.get(foodStore(simulation.state, p))]),
    );
  }
  function drink(simulation, credits = new Map()) {
    const state = simulation.state,
      needs = new Map(),
      ratios = new Map();
    for (const p of simulation.presentPeople) {
      const id = foodStore(state, p);
      needs.set(id, (needs.get(id) || 0) + 3 / 24 - (credits.get(p.id) || 0));
    }
    for (const animal of state.arrival.animals) {
      const id = animal.shipId === null ? 'camp' : storeId(animal.shipId);
      needs.set(id, (needs.get(id) || 0) + (animal.kind === 'cattle' ? 40 : 4) / 24);
    }
    let total = 0;
    for (const [id, need] of needs) {
      const used = Storage.withdraw(state, id, 'water', need);
      ratios.set(id, need ? used / need : 1);
      total += used;
    }
    return {
      used: total,
      ratios: new Map(
        simulation.presentPeople.map((p) => {
          const credit = credits.get(p.id) || 0;
          return [
            p.id,
            (credit + (3 / 24 - credit) * (ratios.get(foodStore(state, p)) ?? 0)) / (3 / 24),
          ];
        }),
      ),
    };
  }
  function consumeHay(state, amount, grazed = 0) {
    const animals = state.arrival.animals;
    let used = 0;
    const groups = new Map();
    for (const animal of animals) {
      const id = animal.shipId === null ? 'camp' : storeId(animal.shipId);
      groups.set(id, (groups.get(id) || 0) + (animal.kind === 'cattle' ? 8 : 1));
    }
    const weight = [...groups.values()].reduce((s, v) => s + v, 0);
    for (const [id, share] of groups)
      used += Storage.withdraw(
        state,
        id,
        'hay',
        Math.max(0, (amount * share) / Math.max(1, weight) - (id === 'camp' ? grazed : 0)),
      );
    return used;
  }
  function validate(state) {
    const a = state.arrival;
    if (a === undefined) return true; // Established saves retain their original camp.
    const finite = (n) => Number.isFinite(n),
      position = (p) => p && Meadows.containsPoint(p.x, p.z);
    if (
      !a ||
      a.version !== 1 ||
      !Array.isArray(a.shipPoses) ||
      a.shipPoses.length !== state.ships.length ||
      !a.shipPoses.every((p) => position(p) && finite(p.rotation)) ||
      !(
        a.livestockShip === null ||
        (Number.isInteger(a.livestockShip) && a.livestockShip === state.ships.length - 1)
      ) ||
      typeof a.hallDiscovered !== 'boolean' ||
      typeof a.seatsPrepared !== 'boolean' ||
      (a.landing !== null && !position(a.landing)) ||
      (a.waterLanding !== null && !position(a.waterLanding)) ||
      !Array.isArray(a.tents) ||
      a.tents.length > 30 ||
      !Array.isArray(a.animals) ||
      a.animals.length > 120
    )
      return false;
    const ship = (id) =>
      id === null || (Number.isInteger(id) && id >= 0 && id < state.ships.length);
    const tentIds = new Set();
    for (const t of a.tents) {
      if (
        !Number.isInteger(t.id) ||
        tentIds.has(t.id) ||
        !ship(t.shipId) ||
        !['packed', 'transit', 'landed', 'carried', 'pitching', 'pitched'].includes(t.status) ||
        !finite(t.progress) ||
        t.progress < 0 ||
        t.progress > TENT_HOURS + EPSILON ||
        !position(t) ||
        !finite(t.rotation) ||
        (t.pickup !== undefined && !position(t.pickup))
      )
        return false;
      if ((t.status === 'packed') !== (t.shipId !== null)) return false;
      tentIds.add(t.id);
    }
    if (a.tents.length !== state.resources.tents) return false;
    for (const tent of a.tents) {
      const carriers = state.people.filter((p) => p.arrivalTent === tent.id);
      if (carriers.length !== (tent.status === 'carried' ? 1 : 0)) return false;
    }
    const animalIds = new Set();
    for (const animal of a.animals) {
      if (
        !Number.isInteger(animal.id) ||
        animalIds.has(animal.id) ||
        !Object.hasOwn(state.livestock, animal.kind) ||
        !ship(animal.shipId) ||
        (animal.shipId !== null && animal.shipId !== a.livestockShip) ||
        !finite(animal.progress) ||
        animal.progress < 0 ||
        animal.progress > 1 ||
        !position(animal) ||
        (animal.target !== undefined && !position(animal.target))
      )
        return false;
      animalIds.add(animal.id);
    }
    for (const [kind, count] of Object.entries(state.livestock))
      if (a.animals.filter((a) => a.kind === kind).length !== count) return false;
    const f = a.ferry;
    if (
      !f ||
      !['idle', 'positioning', 'loading', 'outbound', 'unloading'].includes(f.phase) ||
      !position(f) ||
      !position(f.from) ||
      !position(f.to) ||
      !finite(f.elapsed) ||
      f.elapsed < 0 ||
      !finite(f.duration) ||
      f.duration < 0 ||
      !ship(f.sourceShip) ||
      f.sourceShip === null ||
      !Array.isArray(f.passengers) ||
      f.passengers.length > TENDER.people - 1 ||
      new Set(f.passengers).size !== f.passengers.length ||
      !f.passengers.every((id) => Number.isInteger(id) && state.people[id] && id !== f.workerId) ||
      !(f.workerId === null || (Number.isInteger(f.workerId) && state.people[f.workerId])) ||
      !Array.isArray(f.tents) ||
      f.tents.length > 2 ||
      new Set(f.tents).size !== f.tents.length ||
      !f.tents.every((id) => a.tents.some((t) => t.id === id && t.status === 'transit'))
    )
      return false;
    const cargo = state.storage.stores.ferry;
    if (
      !cargo ||
      Object.entries(cargo.stock).reduce((sum, [key, amount]) => sum + mass(key, amount), 0) +
        f.tents.length * 15 >
        TENDER.cargoKg + 0.001
    )
      return false;
    for (let i = 0; i < state.ships.length; i++)
      if (
        !state.storage.stores[storeId(i)] ||
        state.ships[i].role !== (i === a.livestockShip ? 'livestock' : 'passengers')
      )
        return false;
    for (const p of state.people) {
      if (
        !ship(p.arrivalShip) ||
        typeof p.arrivalFerry !== 'boolean' ||
        (p.arrivalTent !== undefined && !tentIds.has(p.arrivalTent)) ||
        (p.arrivalSeat && (!finite(p.arrivalSeat.x) || !finite(p.arrivalSeat.z))) ||
        (p.order?.assemble !== undefined && typeof p.order.assemble !== 'boolean') ||
        (p.order?.arrivalAssembly !== undefined && !position(p.order.arrivalAssembly)) ||
        (p.arrivalFerry && ![f.workerId, ...f.passengers].includes(p.id)) ||
        (p.arrivalCarry &&
          (!Storage.KEYS.includes(p.arrivalCarry.resource) ||
            !finite(p.arrivalCarry.amount) ||
            p.arrivalCarry.amount <= 0 ||
            p.arrivalCarry.amount > Storage.loadSize(p.arrivalCarry.resource) + EPSILON))
      )
        return false;
    }
    if (
      a.deployment &&
      (!['approaching', 'unloading'].includes(a.deployment.phase) ||
        !position(a.deployment.from) ||
        !position(a.deployment.to) ||
        !finite(a.deployment.elapsed) ||
        a.deployment.elapsed < 0 ||
        a.deployment.duration !== 180)
    )
      return false;
    return true;
  }
  const api = {
    start,
    step,
    validate,
    order,
    leaderAshore,
    landingOptions,
    requestLanding,
    interrupt,
    aboard,
    storeId,
    initialPose,
    transform,
    canLand,
    defaultLanding,
    setLanding,
    shoreNormal,
    pitched,
    consumeTent,
    returnTent,
    eat,
    drink,
    consumeHay,
    foodStore,
    mass,
    TENT_HOURS,
    TENDER,
    ACTIONS,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandArrival = api;
})(typeof window === 'undefined' ? globalThis : window);
