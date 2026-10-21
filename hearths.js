/** Fuel, room heat and cooking, in kg, seconds, kJ and °C. No renderer. */
(function (root) {
  'use strict';
  const Content = typeof module !== 'undefined' ? require('./content.js') : root.VinlandContent;
  const Spaces =
    typeof module !== 'undefined' ? require('./building-spaces.js') : root.VinlandBuildingSpaces;
  const Storage = typeof module !== 'undefined' ? require('./storage.js') : root.VinlandStorage;
  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  const Supplies = typeof module !== 'undefined' ? require('./supplies.js') : root.VinlandSupplies;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const PHYSICS = {
    dryWoodMJ: 18.5,
    moisturePenaltyMJ: 2.44,
    charcoalMJ: 32,
    combustionEfficiency: 0.9,
    charYield: 0.12,
    potCapture: 0.15,
    waterHeatKJ: 4.18,
    foodHeatKJ: 3.5,
    ironHeatKJ: 0.46,
    vaporizationKJ: 2257,
    fusionKJ: 334,
    potIronKg: 2.5,
    ignitionSeconds: 120,
    roomCapture: 0.35,
    stoneCapture: 0.08,
  };
  const RECIPES = {
    fish: {
      name: 'Fish & grain soup',
      ingredients: { grain: 0.5, freshFish: 0.5, plants: 0.25 },
      simmerSeconds: 600,
    },
    meat: {
      name: 'Meat & grain soup',
      ingredients: { grain: 0.5, meat: 0.5, plants: 0.25 },
      simmerSeconds: 1800,
    },
    pottage: {
      name: 'Grain & plant pottage',
      ingredients: { grain: 0.75, plants: 0.5 },
      simmerSeconds: 900,
    },
  };
  const definitionCache = new WeakMap();

  function definitions(state) {
    const cached = definitionCache.get(state);
    if (
      cached?.buildings === state.buildings &&
      cached.count === state.buildings.length &&
      cached.hall === state.config.inheritedHall
    )
      return cached.definitions;
    const result = [];
    if (state.config.inheritedHall)
      for (const room of Spaces.HALL_ROOMS) {
        if (!['living', 'kitchen'].includes(room.kind)) continue;
        const rotation = state.config.site === 'meadows' ? Meadows.hallRotation : 0;
        const center = Spaces.toWorld({ x: 0, z: 0, rotation }, room);
        const point = Spaces.toWorld(
          { ...center, rotation },
          room.kind === 'kitchen' ? { x: -1, z: 1 } : { x: 0, z: 0 },
        );
        result.push({
          id: 'hall:' + room.n,
          name: 'Hall F · ' + room.name,
          ...point,
          rotation,
          room: { ...center, rotation, plan: { w: room.w, d: room.d } },
          hall: true,
          storeId: 'hearth:hall:' + room.n,
          maxFuelKg: room.n === 'II' ? 8 : 5,
        });
      }
    for (const building of state.buildings) {
      const plan = Spaces.plan(building.type);
      const hearth = plan?.furniture.find((item) => item.kind === 'hearth');
      if (!hearth) continue;
      const point = Spaces.toWorld(building, hearth);
      result.push({
        id: 'building:' + building.id,
        name: Content.TYPES[building.type].name,
        ...point,
        room: { ...building, plan },
        rotation: building.rotation || 0,
        hall: false,
        storeId: 'building:' + building.id,
        maxFuelKg: building.type === 'longhouse' ? 8 : 5,
      });
    }
    definitionCache.set(state, {
      buildings: state.buildings,
      count: state.buildings.length,
      hall: state.config.inheritedHall,
      definitions: result,
    });
    return result;
  }

  function initialize(state) {
    state.hearths ||= { version: 1, remainderSeconds: 0, fires: {} };
    // An old visual "on" flag never contained fuel. Do not invent firewood
    // during migration; those hearths start cold and can be fuelled normally.
    delete state.hallHearths;
    for (const building of state.buildings) delete building.hearthLit;
    for (const definition of definitions(state))
      if (definition.hall) {
        state.storage.stores[definition.storeId] ||= {
          id: definition.storeId,
          type: 'hearth',
          x: definition.x,
          z: definition.z,
          capacity: 0.5,
          stock: {},
        };
      }
  }
  function heatValue(moisture) {
    return Math.max(0, PHYSICS.dryWoodMJ * (1 - moisture) - PHYSICS.moisturePenaltyMJ * moisture);
  }
  function stateFor(simulation, id) {
    const definition = definitions(simulation.state).find((entry) => entry.id === id);
    if (!definition) return null;
    initialize(simulation.state);
    const ambient = simulation.weather.temp;
    return (simulation.state.hearths.fires[id] ||= {
      fuelKg: 0,
      moisture: 0.2,
      embersKg: 0,
      lit: false,
      ignitionSeconds: 0,
      powerKW: 0,
      flameKW: 0,
      stoneTemperature: ambient,
      airTemperature: ambient,
      wallTemperature: ambient,
      burnedKg: 0,
      releasedMJ: 0,
      heatToPotMJ: 0,
      pot: null,
    });
  }
  function view(simulation, id) {
    return (
      simulation.state.hearths?.fires[id] || {
        fuelKg: 0,
        moisture: 0.2,
        embersKg: 0,
        lit: false,
        powerKW: 0,
        flameKW: 0,
        airTemperature: simulation.weather.temp,
        wallTemperature: simulation.weather.temp,
        stoneTemperature: simulation.weather.temp,
        pot: null,
      }
    );
  }
  function usable(state, definition) {
    return (
      definition.hall ||
      state.buildings.some(
        (building) => 'building:' + building.id === definition.id && building.condition > 15,
      )
    );
  }
  function near(simulation, person, definition) {
    if (
      !definition ||
      !usable(simulation.state, definition) ||
      !Spaces.contains(definition.room, person)
    )
      return false;
    const distance = Math.hypot(person.x - definition.x, person.z - definition.z);
    if (distance > 2.6) return false;
    const approach = {
      x: definition.x + (person.x - definition.x) * Math.min(1, 0.85 / Math.max(0.01, distance)),
      z: definition.z + (person.z - definition.z) * Math.min(1, 0.85 / Math.max(0.01, distance)),
    };
    return (
      !simulation.navigation?.segmentClear ||
      simulation.navigation.segmentClear(person, approach, 0.05)
    );
  }
  function nearest(simulation, person) {
    return (
      definitions(simulation.state)
        .filter((definition) => near(simulation, person, definition))
        .sort(
          (a, b) =>
            Math.hypot(a.x - person.x, a.z - person.z) - Math.hypot(b.x - person.x, b.z - person.z),
        )[0] || null
    );
  }
  function atStore(state, person, store) {
    if (!Storage.operational(state, store)) return false;
    if (store.id.startsWith('building:')) {
      const building = state.buildings.find((entry) => 'building:' + entry.id === store.id);
      return building && Spaces.contains(building, person);
    }
    return Math.hypot(person.x - store.x, person.z - store.z) <= (store.id === 'camp' ? 8 : 1.6);
  }
  function woodStore(simulation, person) {
    const source = Supplies.nearest(simulation, person, 'firewood');
    if (source) return source.store;
    if (simulation.navigation) return null;
    return Object.values(simulation.state.storage.stores)
      .filter((store) => store.stock.firewood > 0 && atStore(simulation.state, person, store))
      .sort(
        (a, b) =>
          Math.hypot(a.x - person.x, a.z - person.z) - Math.hypot(b.x - person.x, b.z - person.z),
      )[0];
  }
  function pickupWood(simulation, person, amount = 2) {
    if (person.cargo) return 'Put down the other load before taking firewood.';
    const store = woodStore(simulation, person);
    if (!store) return 'Walk to a store containing firewood.';
    const taken = Storage.withdraw(
      simulation.state,
      store.id,
      'firewood',
      Math.min(amount, 15 - (person.carriedFirewood || 0)),
      Supplies.nearest(simulation, person, 'firewood')?.pile.id,
    );
    if (!taken) return 'You are carrying the 15 kg limit.';
    const previous = person.carriedFirewood || 0;
    person.carriedWoodMoisture =
      (previous * (person.carriedWoodMoisture ?? 0.2) + taken * (store.woodMoisture ?? 0.2)) /
      (previous + taken);
    person.carriedFirewood = previous + taken;
    return '';
  }
  function addFuel(simulation, person, id, amount) {
    const definition = definitions(simulation.state).find((entry) => entry.id === id);
    if (!near(simulation, person, definition)) return 'Stand beside this hearth.';
    if (!Number.isFinite(amount) || amount <= 0 || amount > 15) return 'Choose a valid wood load.';
    const fire = stateFor(simulation, id);
    const store = simulation.state.storage.stores[definition.storeId];
    const cargo = person.cargo?.resource === 'firewood' ? person.cargo : null;
    const carried = Math.min((person.carriedFirewood || 0) + (cargo?.amount || 0), amount);
    const available = carried + (store?.stock.firewood || 0);
    const added = Math.min(amount, available, definition.maxFuelKg - fire.fuelKg);
    if (added <= 1e-7)
      return available
        ? 'The hearth is full; let it burn down.'
        : 'Carry firewood here, or supply this hearth’s inventory.';
    const fromHands = Math.min(carried, added);
    const fromStore = Storage.withdraw(
      simulation.state,
      definition.storeId,
      'firewood',
      added - fromHands,
    );
    const fromCargo = Math.min(cargo?.amount || 0, fromHands);
    const fromLegacy = fromHands - fromCargo;
    const wetMass =
      fromCargo * (cargo?.moisture ?? 0.2) +
      fromLegacy * (person.carriedWoodMoisture ?? 0.2) +
      fromStore * (store?.woodMoisture ?? 0.2);
    fire.moisture = (fire.fuelKg * fire.moisture + wetMass) / (fire.fuelKg + added);
    fire.fuelKg += added;
    person.carriedFirewood = Math.max(0, (person.carriedFirewood || 0) - fromLegacy);
    if (cargo) {
      cargo.amount -= fromCargo;
      if (cargo.amount <= 1e-7) person.cargo = null;
    }
    return '';
  }
  function light(simulation, person, id) {
    const definition = definitions(simulation.state).find((entry) => entry.id === id);
    if (!near(simulation, person, definition)) return 'Stand beside this hearth.';
    const fire = stateFor(simulation, id);
    if (fire.fuelKg <= 0 && fire.embersKg <= 0.0001) return 'Add firewood first.';
    if (fire.moisture > 0.35 && fire.embersKg < 0.015)
      return 'This wood is too wet to catch cold. Mix in dry wood or use live embers.';
    fire.lit = true;
    if (fire.embersKg > 0.015) fire.ignitionSeconds = PHYSICS.ignitionSeconds;
    return '';
  }
  function bank(simulation, person, id) {
    const definition = definitions(simulation.state).find((entry) => entry.id === id);
    if (!near(simulation, person, definition)) return 'Stand beside this hearth.';
    const fire = stateFor(simulation, id);
    fire.lit = false;
    fire.ignitionSeconds = 0;
    return '';
  }

  function heatCapacity(pot, frozen = false) {
    return (
      pot.waterKg * (frozen ? 2.1 : PHYSICS.waterHeatKJ) +
      pot.foodKg * PHYSICS.foodHeatKJ +
      PHYSICS.potIronKg * PHYSICS.ironHeatKJ
    );
  }
  function potTemperature(pot) {
    if (pot.energyKJ >= 0) return pot.energyKJ / heatCapacity(pot);
    const frozen = pot.waterKg * PHYSICS.fusionKJ;
    return pot.energyKJ >= -frozen ? 0 : (pot.energyKJ + frozen) / heatCapacity(pot, true);
  }
  function startSoup(simulation, person, id, recipeId, litres = 4) {
    const definition = definitions(simulation.state).find((entry) => entry.id === id);
    if (!near(simulation, person, definition)) return 'Stand beside this hearth.';
    const recipe = RECIPES[recipeId];
    if (!Object.hasOwn(RECIPES, recipeId) || ![2, 4, 8].includes(litres))
      return 'Choose a soup and pot size.';
    const fire = stateFor(simulation, id);
    if (fire.pot) return 'Empty the existing pot first.';
    const store = simulation.state.storage.stores[definition.storeId];
    const quantities = {
      water: litres,
      ...Object.fromEntries(
        Object.entries(recipe.ingredients).map(([key, value]) => [key, (value * litres) / 4]),
      ),
    };
    const missing = Object.entries(quantities).filter(
      ([key, value]) => (store?.stock[key] || 0) + 1e-9 < value,
    );
    if (missing.length)
      return (
        'Supply this hearth with ' +
        missing.map(([key, value]) => value + ' ' + Storage.unit(key) + ' ' + key).join(', ') +
        '.'
      );
    let kcal = 0,
      foodKg = 0;
    for (const [key, value] of Object.entries(quantities)) {
      Storage.withdraw(simulation.state, definition.storeId, key, value);
      if (Content.FOOD[key]) {
        kcal += value * Content.FOOD[key].kcal;
        foodKg += value;
      }
    }
    const pot = {
      recipe: recipeId,
      waterKg: litres,
      foodKg,
      kcal,
      energyKJ: 0,
      onFire: true,
      cookedSeconds: 0,
      dangerSeconds: 0,
      maxTemperature: 0,
      spoiled: false,
      scorched: false,
      fuelUsedKg: 0,
      evaporatedKg: 0,
    };
    const ambient = Math.max(-30, fire.airTemperature);
    pot.energyKJ =
      ambient >= 0
        ? heatCapacity(pot) * ambient
        : -litres * PHYSICS.fusionKJ + heatCapacity(pot, true) * ambient;
    fire.pot = pot;
    simulation.refreshFood();
    return '';
  }
  function ready(pot) {
    return (
      !!pot &&
      !pot.spoiled &&
      !pot.scorched &&
      pot.maxTemperature >= 95 &&
      pot.cookedSeconds >= RECIPES[pot.recipe].simmerSeconds
    );
  }
  function serve(simulation, person, id) {
    const definition = definitions(simulation.state).find((entry) => entry.id === id);
    if (!near(simulation, person, definition)) return 'Stand beside this hearth.';
    const fire = stateFor(simulation, id),
      pot = fire.pot;
    if (!ready(pot))
      return pot?.spoiled || pot?.scorched
        ? 'This batch is spoiled or scorched.'
        : 'The soup has not finished cooking.';
    const temperature = potTemperature(pot);
    if (temperature > 65) return 'Lift the pot and let it cool below 65 °C before serving.';
    if ((person.mealCalories || 0) >= 1500) return 'This person has eaten enough for now.';
    const mass = pot.waterKg + pot.foodKg;
    const fraction = Math.min(
      1,
      0.6 / mass,
      (1500 - (person.mealCalories || 0)) / Math.max(1, pot.kcal),
    );
    const calories = pot.kcal * fraction;
    person.mealCalories = (person.mealCalories || 0) + calories;
    person.mealHeatKJ = Math.min(
      150,
      (person.mealHeatKJ || 0) +
        mass * fraction * PHYSICS.foodHeatKJ * Math.max(0, temperature - 37),
    );
    person.drinkingWaterCredit = (person.drinkingWaterCredit || 0) + pot.waterKg * fraction;
    pot.waterKg *= 1 - fraction;
    pot.foodKg *= 1 - fraction;
    pot.kcal *= 1 - fraction;
    // The iron pot remains; remove only the served food's sensible heat.
    pot.energyKJ = heatCapacity(pot) * temperature;
    simulation.flow('consumption', 'soupKcal', calories);
    if (pot.foodKg + pot.waterKg < 0.01) fire.pot = null;
    return '';
  }

  function advancePot(fire, seconds, woodBurned) {
    const pot = fire.pot;
    if (!pot) return { capturedKW: 0, lostKW: 0 };
    const before = potTemperature(pot);
    const capturedKW = pot.onFire && !pot.scorched ? fire.powerKW * PHYSICS.potCapture : 0;
    const lostKW = (pot.onFire ? 0.004 : 0.009) * (before - fire.airTemperature);
    pot.energyKJ += (capturedKW - lostKW) * seconds;
    if (pot.onFire) pot.fuelUsedKg += woodBurned;
    const boiling = 100; // Coastal site; atmospheric variation is below model precision.
    const ceiling = heatCapacity(pot) * boiling;
    if (pot.energyKJ > ceiling && pot.waterKg > 0) {
      const evaporated = Math.min(pot.waterKg, (pot.energyKJ - ceiling) / PHYSICS.vaporizationKJ);
      pot.waterKg -= evaporated;
      pot.evaporatedKg += evaporated;
      pot.energyKJ = heatCapacity(pot) * boiling;
    }
    const temperature = potTemperature(pot);
    pot.maxTemperature = Math.max(pot.maxTemperature, temperature);
    if (temperature >= 85) pot.cookedSeconds += seconds * clamp((temperature - 80) / 15, 0, 1);
    if (temperature > 5 && temperature < 60) pot.dangerSeconds += seconds;
    if (pot.dangerSeconds > 7200) pot.spoiled = true;
    if (pot.waterKg < 0.02 && pot.onFire && fire.powerKW > 0.5) pot.scorched = true;
    fire.heatToPotMJ += (capturedKW * seconds) / 1000;
    return { capturedKW, lostKW };
  }

  function fuelRate(definition, fire) {
    if (!fire.lit) return 0;
    const damp = clamp(1 - (fire.moisture - 0.2) * 2.1, 0.15, 1.1);
    const ignition =
      fire.embersKg > 0.015 ? 1 : clamp(fire.ignitionSeconds / PHYSICS.ignitionSeconds, 0, 1);
    const maximum = definition.maxFuelKg === 8 ? 4.5 : 3;
    return maximum * (1 - Math.exp(-fire.fuelKg / 0.8)) * damp * ignition;
  }

  function seasonWood(state, weather) {
    for (const store of Object.values(state.storage.stores)) {
      if (!store.stock.firewood) continue;
      const covered = [
        'camp',
        'hearth',
        'woodshed',
        'storehouse',
        'longhouse',
        'turfhouse',
        'carehut',
      ].includes(store.type);
      const target = !covered && weather.rain ? 0.4 : 0.2;
      const days = store.type === 'woodshed' ? 45 : 90;
      const rate = (weather.temp <= 0 ? 0.15 : 1) / (24 * days);
      const previous = store.woodMoisture ?? 0.2;
      store.woodMoisture = previous + (target - previous) * (1 - Math.exp(-rate));
      // Seasoning removes water, not dry wood. Holding wet mass constant here
      // would create combustible material as the moisture fraction fell.
      store.stock.firewood *= (1 - previous) / (1 - store.woodMoisture);
    }
  }

  function stepFire(simulation, definition, fire, seconds, weather) {
    if (!usable(simulation.state, definition)) fire.lit = false;
    if (fire.lit) fire.ignitionSeconds += seconds;
    const rate = fuelRate(definition, fire);
    const woodBurned = Math.min(fire.fuelKg, fire.lit ? (rate * seconds) / 3600 : 0);
    const charMade = woodBurned * (1 - fire.moisture) * PHYSICS.charYield;
    fire.fuelKg = Math.max(0, fire.fuelKg - woodBurned);
    fire.embersKg += charMade;
    const charBurned = Math.min(
      fire.embersKg,
      ((fire.lit ? 0.35 : 0.025) * Math.sqrt(fire.embersKg / 0.1) * seconds) / 3600,
    );
    fire.embersKg = Math.max(0, fire.embersKg - charBurned);
    const flameMJ =
      Math.max(0, woodBurned * heatValue(fire.moisture) - charMade * PHYSICS.charcoalMJ) *
      PHYSICS.combustionEfficiency;
    const emberMJ = charBurned * PHYSICS.charcoalMJ * PHYSICS.combustionEfficiency;
    fire.flameKW = (flameMJ * 1000) / seconds;
    fire.powerKW = ((flameMJ + emberMJ) * 1000) / seconds;
    fire.burnedKg += woodBurned;
    fire.releasedMJ += flameMJ + emberMJ;
    if (woodBurned) simulation.flow('consumption', 'firewood', woodBurned);
    if (fire.fuelKg < 0.00001 && fire.embersKg < 0.00001) fire.lit = false;
    const pot = advancePot(fire, seconds, woodBurned);
    const area = definition.room.plan.w * definition.room.plan.d;
    const surface = 2 * area + 5 * (definition.room.plan.w + definition.room.plan.d);
    const repaired = definition.hall ? simulation.state.hallReady : true;
    const airCapacity = area * 3 * 1.2 + area * 8;
    const wallCapacity = surface * 0.08 * 900 * 1.2;
    const ventilation = (area * 3 * 1.2 * ((repaired ? 4 : 10) + weather.wind / 20)) / 3600;
    const wallConductance = surface * (repaired ? 0.0009 : 0.002);
    const airToWall = surface * 0.008;
    const stoneReleaseKW = (fire.stoneTemperature - fire.airTemperature) * 0.008;
    fire.stoneTemperature +=
      ((fire.powerKW * PHYSICS.stoneCapture - stoneReleaseKW) * seconds) / 100;
    const roomPower = fire.powerKW * PHYSICS.roomCapture + stoneReleaseKW + pot.lostKW;
    fire.airTemperature +=
      ((roomPower -
        ventilation * (fire.airTemperature - weather.temp) -
        airToWall * (fire.airTemperature - fire.wallTemperature)) *
        seconds) /
      airCapacity;
    fire.wallTemperature +=
      ((airToWall * (fire.airTemperature - fire.wallTemperature) -
        wallConductance * (fire.wallTemperature - weather.temp)) *
        seconds) /
      wallCapacity;
  }

  function comfort(simulation, person, weather = simulation.weather) {
    const definition = definitions(simulation.state).find((entry) =>
      Spaces.contains(entry.room, person),
    );
    const fire = definition && view(simulation, definition.id);
    let temperature = person.shelterWarmth > 0 ? weather.temp : weather.feels;
    if (fire) {
      temperature = fire.airTemperature;
      const radius = Math.max(0.85, Math.hypot(person.x - definition.x, person.z - definition.z));
      temperature += Math.min(
        12,
        (((fire.powerKW * 0.3) / (4 * Math.PI * radius * radius)) * 0.7) / 0.015,
      );
    }
    temperature += (person.mealHeatKJ || 0) / ((person.age < 16 ? 35 : 70) * PHYSICS.foodHeatKJ);
    return clamp(1 - Math.max(0, 18 - temperature) / 35, 0, 1);
  }
  function advance(simulation, seconds) {
    const state = simulation.state;
    const fires = state.hearths.fires;
    const weather = simulation.weather;
    if (Object.keys(fires).length) {
      state.hearths.remainderSeconds += seconds;
      while (state.hearths.remainderSeconds + 1e-8 >= 1) {
        state.hearths.remainderSeconds -= 1;
        if (state.hearths.remainderSeconds < 1e-8) state.hearths.remainderSeconds = 0;
        for (const definition of definitions(state)) {
          const fire = fires[definition.id];
          if (fire) stepFire(simulation, definition, fire, 1, weather);
        }
      }
    }
    for (const person of simulation.presentPeople) {
      if (person.mealHeatKJ) person.mealHeatKJ *= Math.exp(-seconds / 1800);
      if (state.interiorSimulation)
        person.thermalComfortSeconds =
          (person.thermalComfortSeconds || 0) + comfort(simulation, person, weather) * seconds;
    }
  }

  function estimate(simulation, id, recipeId, litres) {
    const recipe = RECIPES[recipeId],
      fire = view(simulation, id);
    const foodKg =
      (Object.values(recipe.ingredients).reduce((sum, amount) => sum + amount, 0) * litres) / 4;
    const heatKJ =
      (litres * PHYSICS.waterHeatKJ +
        foodKg * PHYSICS.foodHeatKJ +
        PHYSICS.potIronKg * PHYSICS.ironHeatKJ) *
      Math.max(0, 98 - fire.airTemperature);
    const definition = definitions(simulation.state).find((entry) => entry.id === id);
    const maximumKgPerHour = definition.maxFuelKg === 8 ? 4.5 : 3;
    const damp = clamp(1 - (fire.moisture - 0.2) * 2.1, 0.15, 1.1);
    const steadyPowerKW =
      (maximumKgPerHour * damp * heatValue(fire.moisture) * PHYSICS.combustionEfficiency) / 3.6;
    // An open hearth cannot throttle itself to the pot's needs. Excess power
    // during simmering evaporates water, and still costs wood.
    const holdingKJ =
      Math.max(0.004 * Math.max(0, 98 - fire.airTemperature), steadyPowerKW * PHYSICS.potCapture) *
      recipe.simmerSeconds;
    return (
      (heatKJ + holdingKJ) /
      (heatValue(fire.moisture) * 1000 * PHYSICS.combustionEfficiency * PHYSICS.potCapture)
    );
  }

  function validate(state) {
    for (const person of state.people)
      for (const [key, limit] of Object.entries({
        carriedFirewood: 15,
        carriedWoodMoisture: 0.65,
        mealCalories: 1500,
        mealHeatKJ: 150,
        drinkingWaterCredit: 20,
        thermalComfortSeconds: 3600.1,
      }))
        if (
          person[key] !== undefined &&
          (!Number.isFinite(person[key]) || person[key] < 0 || person[key] > limit)
        )
          return false;

    if (state.hearths === undefined) return true;
    if (
      !state.hearths ||
      state.hearths.version !== 1 ||
      !state.hearths.fires ||
      typeof state.hearths.fires !== 'object' ||
      Array.isArray(state.hearths.fires) ||
      !Number.isFinite(state.hearths.remainderSeconds) ||
      state.hearths.remainderSeconds < 0 ||
      state.hearths.remainderSeconds >= 1.000001
    )
      return false;
    const ids = new Set(definitions(state).map((definition) => definition.id));
    for (const [id, fire] of Object.entries(state.hearths.fires)) {
      if (!ids.has(id) || !fire || typeof fire.lit !== 'boolean') return false;
      for (const key of [
        'fuelKg',
        'embersKg',
        'ignitionSeconds',
        'powerKW',
        'flameKW',
        'burnedKg',
        'releasedMJ',
        'heatToPotMJ',
      ])
        if (!Number.isFinite(fire[key]) || fire[key] < 0) return false;
      if (
        fire.fuelKg > 8.000001 ||
        fire.embersKg > 2 ||
        !Number.isFinite(fire.moisture) ||
        fire.moisture < 0.05 ||
        fire.moisture > 0.65
      )
        return false;
      for (const key of ['stoneTemperature', 'airTemperature', 'wallTemperature'])
        if (!Number.isFinite(fire[key]) || fire[key] < -100 || fire[key] > 1500) return false;
      const pot = fire.pot;
      if (pot) {
        if (
          !Object.hasOwn(RECIPES, pot.recipe) ||
          typeof pot.onFire !== 'boolean' ||
          typeof pot.spoiled !== 'boolean' ||
          typeof pot.scorched !== 'boolean' ||
          !Number.isFinite(pot.energyKJ) ||
          Math.abs(pot.energyKJ) > 100000
        )
          return false;
        for (const key of [
          'waterKg',
          'foodKg',
          'kcal',
          'cookedSeconds',
          'dangerSeconds',
          'fuelUsedKg',
          'evaporatedKg',
        ])
          if (!Number.isFinite(pot[key]) || pot[key] < 0) return false;
        if (
          pot.waterKg > 8 ||
          pot.foodKg > 3 ||
          pot.kcal > 20000 ||
          !Number.isFinite(pot.maxTemperature) ||
          pot.maxTemperature > 1500
        )
          return false;
      }
    }
    return true;
  }
  const api = {
    PHYSICS,
    RECIPES,
    definitions,
    initialize,
    heatValue,
    stateFor,
    view,
    near,
    nearest,
    woodStore,
    pickupWood,
    addFuel,
    light,
    bank,
    startSoup,
    ready,
    serve,
    potTemperature,
    heatCapacity,
    advance,
    comfort,
    estimate,
    fuelRate,
    seasonWood,
    validate,
  };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandHearths = api;
})(typeof window === 'undefined' ? globalThis : window);
