/**
 * Authoritative campaign model. This file has no DOM or Three.js dependency.
 * advance() crosses whole-hour boundaries; onHour() and onDay() apply outcomes
 * in a fixed order. Rendering must never decide resource or survival outcomes.
 * The serializable state and version-3 save format are public data contracts.
 */
(function (root) {
  'use strict';

  const Content = typeof module !== 'undefined' ? require('./content.js') : root.VinlandContent;
  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  const Solar = typeof module !== 'undefined' ? require('./solar.js') : root.VinlandSolar;
  const Doors = typeof module !== 'undefined' ? require('./doors.js') : root.VinlandDoors;
  const { TYPES, TASKS, FOOD, PRESETS, REGIONS, RULES, NAMES } = Content;
  const Gathering =
    typeof module !== 'undefined' ? require('./gathering.js') : root.VinlandGathering;
  const Processes =
    typeof module !== 'undefined'
      ? require('./production-processes.js')
      : root.VinlandProductionProcesses;
  const Cheats = typeof module !== 'undefined' ? require('./cheats.js') : root.VinlandCheats;
  const Hearths = typeof module !== 'undefined' ? require('./hearths.js') : root.VinlandHearths;
  const Storage = typeof module !== 'undefined' ? require('./storage.js') : root.VinlandStorage;
  const WorkerOrders =
    typeof module !== 'undefined' ? require('./worker-orders.js') : root.VinlandWorkerOrders;
  const Arrival = typeof module !== 'undefined' ? require('./arrival.js') : root.VinlandArrival;
  const IdlePeople =
    typeof module !== 'undefined' ? require('./idle-people.js') : root.VinlandIdlePeople;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const copyState = (v) => JSON.parse(JSON.stringify(v));
  const CALORIES_PER_ADULT_RATION = 3000;
  function hashSeed(value) {
    let hashValue = 2166136261;
    for (const c of String(value)) {
      hashValue ^= c.charCodeAt(0);
      hashValue = Math.imul(hashValue, 16777619);
    }
    return hashValue >>> 0;
  }
  function createSeededRandom(seed) {
    let x = hashSeed(seed);
    return () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }
  function normalizeScenarioConfig(input = {}) {
    const preset = hasOwn(PRESETS, input.preset) ? input.preset : 'karlsefni';
    const scenario = {
      ...PRESETS[preset],
      ...input,
      preset,
    };
    scenario.ships = clamp(Math.round(Number(scenario.ships) || 4), 1, 6);
    scenario.population = clamp(
      Math.round(Number(scenario.population) || 160),
      16,
      Math.min(240, scenario.ships * 60),
    );
    for (const key of ['tents', 'cattle', 'sheep', 'goats']) {
      scenario[key] = clamp(Math.round(Number(scenario[key]) || 0), 0, key === 'tents' ? 30 : 40);
    }
    scenario.seed = isFiniteNumber(Number(scenario.seed))
      ? Number(scenario.seed) >>> 0
      : hashSeed(scenario.seed);
    scenario.supplies = clamp(Number(scenario.supplies) || 1, 0.5, 2);
    scenario.children = clamp(Number(scenario.children) || 0, 0, 0.3);
    scenario.year = clamp(Math.round(Number(scenario.year) || 1005), 995, 1030);
    scenario.month = clamp(Math.round(Number(scenario.month) || 8), 1, 12);
    scenario.day = clamp(Math.round(Number(scenario.day) || 1), 1, 28);
    scenario.site = ['meadows', 'bay', 'estuary'].includes(scenario.site)
      ? scenario.site
      : 'meadows';
    scenario.inheritedHall = Boolean(scenario.inheritedHall && scenario.site === 'meadows');
    scenario.severity = clamp(Number(scenario.severity) || 1, 0.6, 1.4);
    scenario.legacy = Boolean(scenario.legacy);
    return scenario;
  }
  function coast(
    z,
    scenario = {
      site: 'meadows',
      seed: 0,
    },
  ) {
    if (scenario.site === 'meadows') {
      return Meadows.coastAtZ(z);
    }
    const phase = scenario.site === 'meadows' ? 0 : (scenario.seed % 37) * 0.03;
    return (
      -83 +
      Math.sin(z * 0.034 + phase) * (scenario.site === 'estuary' ? 13 : 7) +
      Math.sin(z * 0.093) * 2
    );
  }
  function elevation(
    x,
    z,
    scenario = {
      site: 'meadows',
      seed: 0,
    },
  ) {
    if (scenario.site === 'meadows') {
      return Meadows.elevation(x, z);
    }
    const noise =
      Math.sin(x * 0.083 + Math.cos(z * 0.044) * 2) * Math.cos(z * 0.093) * 0.55 +
      Math.sin(x * 0.21 - z * 0.18) * 0.2 +
      Math.sin(x * 0.51 + z * 0.34) * 0.09;
    const r = Math.hypot(x, z);
    const hills = Math.max(0, (r - 48) / 42);
    const ridge =
      (Math.sin(x * 0.025 + z * 0.011) + Math.cos(z * 0.038) * 0.6 + 1.3) *
      hills *
      (scenario.site === 'bay' ? 1.8 : 2.8);
    const edge = coast(z, scenario);
    if (x < edge) {
      return -0.55 - Math.min(2, (edge - x) * 0.12);
    }
    if (x < edge + 10) {
      return -0.3 + ((x - edge) / 10) * 1.4 + noise * 0.1;
    }
    return 1.15 + noise * 0.28 + Math.max(0, ridge);
  }
  function landDistance(x, z, scenario = PRESETS.karlsefni) {
    return scenario.site === 'meadows' ? Meadows.waterDistance(x, z) : x - coast(z, scenario);
  }

  function createStartingFoodStocks(rations) {
    const shares = {
      freshFish: 0.08,
      driedFish: 0.45,
      grain: 0.32,
      meat: 0.05,
      plants: 0.035,
      dairy: 0.025,
      fat: 0.04,
    };
    return Object.fromEntries(
      Object.keys(FOOD).map((key) => [
        key,
        (rations * CALORIES_PER_ADULT_RATION * shares[key]) / FOOD[key].kcal,
      ]),
    );
  }
  class Simulation {
    constructor(input = {}) {
      this.listeners = [];
      this.rosterCache = null;
      if (input.version === 3) {
        this.state = input;
        Storage.initialize(this.state);
        Hearths.initialize(this.state);
        Processes.initialize(this.state);
        Doors.initialize(this.state);
        WorkerOrders.initialize(this.state);
        Gathering.initialize(this.state);
        this.refreshFood();
        return;
      }
      const scenario = normalizeScenarioConfig(input);
      const rng = createSeededRandom(scenario.seed);
      const adults = scenario.population - Math.floor(scenario.population * scenario.children);
      const people = [];
      for (let i = 0; i < scenario.population; i++) {
        const child = i >= adults;
        const age = child ? 5 + Math.floor(rng() * 10) : 18 + Math.floor(rng() * 40);
        const skills = {};
        for (const key of Object.keys(TASKS)) {
          skills[key] = 0.3 + rng() * 0.6;
        }
        if (i === 0) {
          skills.builders = 0.72;
          skills.craft = 0.68;
        }
        people.push({
          id: i,
          name:
            i === 0
              ? 'Þorfinn Karlsefni'
              : i === 1
                ? 'Guðríðr'
                : NAMES[i % NAMES.length] +
                  (i >= NAMES.length ? ' ' + (Math.floor(i / NAMES.length) + 1) : ''),
          age: i === 0 ? 35 : age,
          household: Math.floor(i / 5),
          health: 100,
          fatigue: 10,
          trust: 55 + rng() * 15,
          skills,
          navigation: i === 0 ? 0.82 : 0.3 + rng() * 0.65,
          away: null,
          alive: true,
          job: null,
          memory: [],
          lastVisit: -1,
          preference: rng() > 0.5 ? 'commons' : 'households',
        });
      }
      const households = [];
      for (let i = 0; i < Math.ceil(scenario.population / 5); i++) {
        households.push({
          id: i,
          name: people[i * 5].name + '’s household',
          members: people.filter((person) => person.household === i).map((p) => p.id),
          trust: 62,
          health: 100,
          diet: 1,
          warmth: 1,
          water: 1,
          claims: [],
          petitions: 0,
        });
      }
      const count = scenario.population / 160;
      const supply = scenario.supplies;
      this.state = {
        version: 3,
        workerOrdersVersion: 2,
        config: scenario,
        startDate: Date.UTC(scenario.year, scenario.month - 1, scenario.day),
        time: 8,
        population: scenario.population,
        health: 100,
        herdHealth: 100,
        livestock: {
          cattle: scenario.cattle,
          sheep: scenario.sheep,
          goats: scenario.goats,
        },
        resources: {
          food: scenario.population * 15 * supply,
          // Local building materials must be gathered after landing.
          timber: 0,
          turf: 0,
          stone: 0,
          iron: 40 * count * supply,
          sails: scenario.ships,
          tents: scenario.tents,
          hay: Math.max(300, 1200 * count * supply),
          charcoal: 0,
          // The landing site has no prepared fuel stockpile. The crew must
          // gather it; saved campaigns retain the supplies they already own.
          firewood: 0,
          water: 1800 * count,
          seeds: 18 * count,
          cloth: 40 * count,
        },
        foods: createStartingFoodStocks(scenario.population * 15 * supply),
        people,
        households,
        buildings: [],
        queue: [],
        nextId: 1,
        hallReady: false,
        surveyed: false,
        gameOver: false,
        ended: false,
        ships: Array.from(
          {
            length: scenario.ships,
          },
          (_, i) => ({
            id: i,
            name: i === scenario.ships - 1 ? 'Livestock knarr' : 'Knarr ' + (i + 1),
            status: 'anchored',
            sail: true,
            condition: 90 + Math.floor(rng() * 10),
            capacity: 12000,
            voyage: null,
          }),
        ),
        voyages: [],
        scouts: [],
        regions: REGIONS.map((r) => ({
          ...r,
          known: r.id === 'home' || r.kind === 'trade',
          confidence: r.id === 'home' ? 1 : r.kind === 'trade' ? 0.65 : 0,
          reportDay: null,
        })),
        neighbours: {
          present: rng() > 0.12,
          known: false,
          trust: 30,
          access: 'unnegotiated',
          food: 1000 + rng() * 800,
          capacity: 20 + rng() * 15,
          stance: 'cautious',
          pressure: 0,
          received: 0,
          sent: 0,
          lastReport: 0,
          agreement: false,
        },
        politics: {
          legitimacy: 64,
          workHours: 8,
          ration: 'standard',
          tenure: 'compact',
          watch: 'none',
          proposal: null,
          steward: null,
        },
        ecology: {
          wood: 800,
          initialWood: 800,
          fish: 1,
          pasture: 140000,
          initialPasture: 140000,
        },
        leader: {
          id: 0,
          x: 10,
          z: 17,
          heading: 0,
          walking: false,
        },
        rng: hashSeed(scenario.seed),
        ledger: [],
        flow: {
          production: {},
          consumption: {},
          losses: {},
          labor: 0,
          refused: 0,
        },
        journal: [],
        notifications: [],
        nextNotification: 1,
        metrics: {
          tradeReturns: 0,
          scoutReturns: 0,
          assemblies: 0,
          peopleLost: 0,
          animalsCulled: 0,
          woodHarvested: 0,
          daysFed: 0,
          daysWarm: 0,
        },
        chronicle: [],
        lastYear: scenario.year,
      };
      Gathering.initialize(this.state);
      Storage.initialize(this.state);
      Hearths.initialize(this.state);
      Processes.initialize(this.state);
      Doors.initialize(this.state);
      this.refreshFood();
      const landfallNames = {
        meadows: 'L’Anse aux Meadows',
        bay: 'a timber-rich bay',
        estuary: 'a sheltered estuary',
      };
      const animalCount = scenario.cattle + scenario.sheep + scenario.goats;
      this.log(
        scenario.population +
          ' people reach ' +
          landfallNames[scenario.site] +
          ' in ' +
          scenario.ships +
          ' knarrs. ' +
          scenario.tents +
          ' tents and ' +
          animalCount +
          ' animals come ashore.',
        'arrival',
      );
    }

    random() {
      this.state.rng = (Math.imul(this.state.rng, 1664525) + 1013904223) >>> 0;
      return this.state.rng / 4294967296;
    }

    get day() {
      return Math.floor((this.state.time + 1e-7) / 24);
    }

    get hour() {
      return ((this.state.time % 24) + 24) % 24;
    }

    get date() {
      return new Date(this.state.startDate + this.day * 86400000);
    }

    get season() {
      const m = this.date.getUTCMonth();
      return m >= 10 || m <= 2 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
    }

    get winterDays() {
      const d = this.date;
      let next = Date.UTC(d.getUTCFullYear(), 10, 1);
      if (d.getUTCMonth() >= 10 || d.getUTCMonth() <= 2) {
        return 0;
      }
      if (d.getTime() >= next) {
        next = Date.UTC(d.getUTCFullYear() + 1, 10, 1);
      }
      return Math.ceil((next - d.getTime()) / 86400000);
    }

    get weather() {
      const d = this.date;
      const sunlight = Solar.daylight(d);
      const doy = Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);
      const seed = this.state.config.seed;
      const noise = createSeededRandom(seed + ':weather:' + this.day)();
      const severity = this.state.config.severity;
      let temp = Math.round(
        4 + 9 * Math.cos(((doy - 205) / 365.25) * Math.PI * 2) + (noise - 0.5) * 7 * severity,
      );
      let gale = noise > 0.9;
      let rain = !gale && noise > 0.69;
      const preset = Cheats.weatherPreset(this.state);
      if (preset !== 'natural') {
        gale = preset === 'gale';
        rain = preset === 'rain' || preset === 'snow';
        // Testing precipitation outside its usual season still needs consistent
        // temperatures for snow cover, exposure and the precipitation renderer.
        if (preset === 'snow') temp = Math.min(temp, -2);
        if (preset === 'rain') temp = Math.max(temp, 3);
      }
      const snow = temp <= 1 && (gale || rain);
      const wind = Math.round((gale ? 46 : rain ? 23 : 9 + noise * 16) * severity);
      return {
        name: gale ? 'ATLANTIC GALE' : snow ? 'SNOW' : rain ? 'COASTAL RAIN' : 'FAIR WINDS',
        factor: (gale ? 0.55 : rain ? 0.72 : 1) * (temp < -2 ? 0.82 : 1),
        temp,
        rain: rain || gale,
        snow,
        gale,
        wind,
        feels: temp - Math.max(0, wind - 12) * 0.12,
        daylight: sunlight.hours,
        sunriseHour: sunlight.sunriseHour,
        sunsetHour: sunlight.sunsetHour,
      };
    }

    get presentPeople() {
      return this.state.people.filter((person) => person.alive && !person.away);
    }

    get availablePeople() {
      const leader = this.state.leader;
      const watch =
        this.state.politics.watch === 'guarded' ? 6 : this.state.politics.watch === 'light' ? 2 : 0;
      return this.presentPeople
        .filter(
          (person) =>
            person.age >= 16 && person.health >= 35 && !(leader.walking && person.id === leader.id),
        )
        .slice(watch);
    }

    get campPopulation() {
      return this.presentPeople.length;
    }

    get workforce() {
      return this.availablePeople.length;
    }

    get assigned() {
      return this.availablePeople.filter((person) => person.order).length;
    }

    get shelter() {
      return (
        Arrival.pitched(this.state) * 8 +
        (this.state.hallReady ? 32 : 0) +
        this.state.buildings.reduce(
          (a, building) => a + (building.condition > 15 ? TYPES[building.type].shelter || 0 : 0),
          0,
        )
      );
    }

    get winterShelter() {
      return (
        (this.state.hallReady ? 32 : 0) +
        this.state.buildings.reduce(
          (a, building) => a + (building.condition > 15 ? TYPES[building.type].winter || 0 : 0),
          0,
        )
      );
    }

    get insulation() {
      const capacity =
        (this.state.hallReady ? 32 : 0) +
        this.state.buildings.reduce(
          (a, building) =>
            a +
            (TYPES[building.type].winter || 0) *
              (building.quality || 1) *
              clamp(building.condition / 100, 0, 1),
          0,
        );
      return capacity / Math.max(1, this.winterShelter);
    }

    get hayCapacity() {
      Storage.syncStores(this.state);
      return (
        this.state.resources.hay +
        Object.values(this.state.storage.stores)
          .filter((store) => ['camp', 'storehouse', 'haybarn'].includes(store.type))
          .reduce((sum, store) => sum + Storage.roomFor(this.state, store, 'hay'), 0)
      );
    }

    get foodDays() {
      return this.state.resources.food / Math.max(1, this.campPopulation);
    }
    get campFoodDays() {
      return (
        Object.entries(this.state.storage.stores.camp.stock).reduce(
          (sum, [key, amount]) =>
            sum + (FOOD[key] ? (amount * FOOD[key].kcal) / CALORIES_PER_ADULT_RATION : 0),
          0,
        ) / Math.max(1, this.campPopulation)
      );
    }

    get hayDemand() {
      const l = this.state.livestock;
      return l.cattle * 8 + (l.sheep + l.goats) * 1.5;
    }

    get fuelDemand() {
      // A projection of the current burn, assuming the player keeps refuelling.
      return Hearths.definitions(this.state).reduce(
        (sum, definition) =>
          sum + Hearths.fuelRate(definition, Hearths.view(this, definition.id)) * 24,
        0,
      );
    }

    get meanTrust() {
      const live = this.state.people.filter((person) => person.alive);
      return live.reduce((a, person) => a + person.trust, 0) / Math.max(1, live.length);
    }

    get homeName() {
      return this.state.config.site === 'meadows'
        ? 'L’Anse aux Meadows'
        : this.state.config.site === 'bay'
          ? 'Timber bay'
          : 'Sheltered estuary';
    }

    get alerts() {
      const state = this.state;
      const out = [];
      const stock = state.storage.stores.camp.stock;
      const shortages =
        this.campFoodDays < 2 && this.foodDays > this.campFoodDays + 0.1 ? ['food'] : [];
      const localNeeds = {
        water: this.campPopulation * 3,
        hay: this.season === 'winter' || this.weather.temp < 1 ? this.hayDemand : 0,
      };
      for (const [key, need] of Object.entries(localNeeds))
        if ((stock[key] || 0) < need && state.resources[key] > (stock[key] || 0) + 0.01)
          shortages.push(key);
      if (shortages.length)
        out.push({
          key: 'camp-supplies',
          title: 'Camp needs deliveries',
          value: shortages.join(' · '),
          cause:
            'Stock in remote stores cannot supply camp services until selected workers deliver it. Use Work → Supply camp.',
        });
      if (this.foodDays < 7) {
        out.push({
          key: 'food',
          title: 'Food reserve',
          value: this.foodDays.toFixed(1) + ' days',
          cause: 'Daily catch, diet consumption and spoilage determine the remaining reserve.',
        });
      }
      if (this.shelter < this.campPopulation) {
        out.push({
          key: 'shelter',
          title: 'Shelter shortage',
          value: this.campPopulation - this.shelter + ' people',
          cause: 'Pitched tents and completed dwellings provide the current berths.',
        });
      }
      if (this.winterDays < 70 && this.winterShelter < this.campPopulation) {
        out.push({
          key: 'warmth',
          title: 'Warm housing',
          value: this.winterShelter + ' / ' + this.campPopulation,
          cause: 'Canvas shelters do not provide insulated winter accommodation.',
        });
      }
      if (this.hayDemand && state.resources.hay < this.hayDemand * 100 && this.winterDays < 70) {
        out.push({
          key: 'hay',
          title: 'Winter fodder',
          value: Math.floor(state.resources.hay / this.hayDemand) + ' herd-days',
          cause: 'Haymaking, meadow pressure and the number of animals determine fodder security.',
        });
      }
      if (state.resources.firewood < Math.max(100, this.fuelDemand * 7)) {
        out.push({
          key: 'fuel',
          title: 'Heating fuel',
          value: Math.floor(state.resources.firewood) + ' kg',
          cause:
            'Hearths need wood delivered locally, loaded and lit. Damp wood gives less useful heat.',
        });
      }
      if (state.politics.proposal) {
        out.push({
          key: 'council',
          title: 'Assembly pending',
          value: 'Decision tomorrow',
          cause: 'Household consent determines whether the proposed rule takes effect.',
        });
      }
      if (state.neighbours.known && !state.neighbours.agreement) {
        out.push({
          key: 'access',
          title: 'Coastal access',
          value: state.neighbours.access,
          cause:
            'A survey does not establish territorial permission. Envoys can negotiate ' +
            'seasonal access.',
        });
      }
      return out;
    }

    has(type) {
      return this.state.buildings.some(
        (building) => building.type === type && building.condition > 15,
      );
    }

    count(type) {
      return this.state.buildings.filter(
        (building) => building.type === type && building.condition > 15,
      ).length;
    }

    onChange(fn) {
      this.listeners.push(fn);
    }

    emit() {
      this.listeners.forEach((fn) => fn(this));
    }

    log(text, kind = 'report') {
      const state = this.state;
      const entry = {
        time: this.eventTime ?? state.time,
        text,
        kind,
      };
      state.journal.push(entry);
      state.journal = state.journal.slice(-240);
      if (kind !== 'report') {
        state.chronicle.push(entry);
        state.chronicle = state.chronicle.slice(-120);
      }
    }

    notify(text, kind = 'info') {
      const state = this.state;
      state.notifications.push({
        id: state.nextNotification++,
        time: this.eventTime ?? state.time,
        text,
        kind,
      });
      state.notifications = state.notifications.slice(-30);
      this.log(text, kind);
    }

    flow(kind, key, amount) {
      if (!amount) {
        return;
      }
      const f = this.state.flow[kind];
      f[key] = (f[key] || 0) + amount;
    }

    addFood(key, kg, storeId = 'camp') {
      if (kg <= 0) {
        return;
      }
      Storage.addAt(this.state, storeId, key, kg);
      this.flow('production', key, kg);
    }

    refreshFood() {
      this.state.resources.food = Object.entries(this.state.foods).reduce(
        (a, [key, v]) => a + (v * FOOD[key].kcal) / CALORIES_PER_ADULT_RATION,
        0,
      );
    }

    invalidateRoster() {
      this.rosterCache = null;
    }

    commandWorkers(ids, request) {
      return WorkerOrders.command(this, ids, request);
    }

    roster() {
      if (this.rosterCache) return this.rosterCache;
      const assignments = Object.fromEntries(Object.keys(TASKS).map((key) => [key, []]));
      for (const person of this.state.people) person.job = null;
      for (const person of this.availablePeople) {
        if (person.id === this.conversationPersonId) continue;
        const task = WorkerOrders.taskForOrder(person.order);
        if (task) {
          assignments[task].push(person);
          person.job = task;
        }
      }
      this.rosterCache = assignments;
      return assignments;
    }

    productivity(key) {
      return this.roster()[key].reduce(
        (sum, person) =>
          sum +
          (0.66 + person.skills[key] * 0.55) *
            clamp(person.health / 80, 0.3, 1) *
            clamp((125 - person.fatigue) / 100, 0.5, 1) *
            (person.trust < 25 ? 0.6 : 1),
        0,
      );
    }

    steward() {
      const person = this.state.people.find((p) => p.id === this.state.politics.steward);
      return person && person.alive && !person.away ? person : null;
    }

    survey() {
      if (!this.state.config.inheritedHall) {
        return false;
      }
      if (!this.state.surveyed) {
        this.state.surveyed = true;
        this.log(
          'Hall F surveyed: three living rooms, a kitchen, two storerooms and an open ' +
            'boat-repair shed.',
          'survey',
        );
        this.emit();
      }
      return true;
    }

    siteInfo(x, z) {
      const c = this.state.config;
      const distanceFromWater = landDistance(x, z, c);
      const height = elevation(x, z, c);
      const distance = Math.hypot(x, z);
      const exposure = clamp((28 - distanceFromWater) / 28, 0, 1);
      const wet =
        c.site === 'meadows'
          ? clamp(
              0.12 +
                Math.max(0, 4.5 - height) * 0.1 +
                Math.max(0, 18 - Meadows.freshwaterDistance(x, z)) * 0.025,
              0,
              1,
            )
          : clamp(
              0.18 +
                Math.max(0, 0.95 - height) * 0.35 +
                (Math.sin(x * 0.053 + z * 0.07) > 0.8 ? 0.35 : 0),
              0,
              1,
            );
      return {
        height,
        exposure,
        wet,
        travel: distance,
        workFactor: clamp(1 - distance / 500 - wet * 0.15, 0.6, 1),
      };
    }

    canPlace(type, x, z, rotation = 0) {
      if (
        !hasOwn(TYPES, type) ||
        !isFiniteNumber(x) ||
        !isFiniteNumber(z) ||
        !isFiniteNumber(rotation)
      ) {
        return false;
      }
      if (type === 'restore') {
        return this.state.config.inheritedHall;
      }
      const d = TYPES[type];
      const w = Math.abs(Math.cos(rotation)) * d.w + Math.abs(Math.sin(rotation)) * d.d;
      const depth = Math.abs(Math.sin(rotation)) * d.w + Math.abs(Math.cos(rotation)) * d.d;
      const c = this.state.config;
      const tooCloseToWater =
        c.site === 'meadows'
          ? landDistance(x, z, c) < Math.hypot(w, depth) / 2 + 3
          : x - w / 2 < coast(z, c) + 13;
      if (Math.hypot(x, z) > 104 || tooCloseToWater) {
        return false;
      }
      const hallAngle = c.site === 'meadows' ? Meadows.hallRotation : 0;
      const hallWidth = Math.abs(Math.cos(hallAngle)) * 15 + Math.abs(Math.sin(hallAngle)) * 28;
      const hallDepth = Math.abs(Math.sin(hallAngle)) * 15 + Math.abs(Math.cos(hallAngle)) * 28;
      if (
        c.inheritedHall &&
        Math.abs(x) < (hallWidth + w) / 2 + 2 &&
        Math.abs(z) < (hallDepth + depth) / 2 + 2
      ) {
        return false;
      }
      for (const building of [...this.state.buildings, ...this.state.queue]) {
        if (building.type === 'restore' || building.kind) {
          continue;
        }
        const buildingDefinition = TYPES[building.type];
        const bw =
          Math.abs(Math.cos(building.rotation)) * buildingDefinition.w +
          Math.abs(Math.sin(building.rotation)) * buildingDefinition.d;
        const bd =
          Math.abs(Math.sin(building.rotation)) * buildingDefinition.w +
          Math.abs(Math.cos(building.rotation)) * buildingDefinition.d;
        if (
          Math.abs(x - building.x) < (w + bw) / 2 + 2 &&
          Math.abs(z - building.z) < (depth + bd) / 2 + 2
        ) {
          return false;
        }
      }
      for (const store of Object.values(this.state.storage.stores)) {
        for (const pile of Storage.resourcePiles(this.state, store)) {
          if (pile.indoor) continue;
          if (
            Math.abs(x - pile.x) < (w + pile.w) / 2 + 1 &&
            Math.abs(z - pile.z) < (depth + pile.d) / 2 + 1
          )
            return false;
        }
      }
      for (let i = 0; i < (this.state.arrival ? 0 : this.state.resources.tents); i++) {
        const a = (i / Math.max(10, this.state.config.tents)) * Math.PI * 2;
        const r = 26 + (i % 2) * 7;
        const tx = Math.sin(a) * r;
        const tz = Math.cos(a) * r;
        if (Math.abs(x - tx) < (w + 6) / 2 + 1 && Math.abs(z - tz) < (depth + 6) / 2 + 1) {
          return false;
        }
      }
      for (const tent of this.state.arrival?.tents || []) {
        if (!['pitching', 'pitched'].includes(tent.status)) continue;
        if (Math.abs(x - tent.x) < (w + 6) / 2 + 1 && Math.abs(z - tent.z) < (depth + 6) / 2 + 1)
          return false;
      }
      for (const dx of [-w / 2, w / 2]) {
        for (const dz of [-depth / 2, depth / 2]) {
          if (Math.abs(elevation(x + dx, z + dz, c) - elevation(x, z, c)) > 2.2) {
            return false;
          }
        }
      }
      return true;
    }

    blockedReason(type) {
      if (!hasOwn(TYPES, type)) {
        return 'Unknown building.';
      }
      if (
        type === 'restore' &&
        (!this.state.config.inheritedHall ||
          this.state.hallReady ||
          this.state.queue.some((order) => order.type === 'restore'))
      ) {
        return 'Hall F is unavailable or already being repaired.';
      }
      if (Cheats.instant(this.state)) return '';
      if (type === 'restore' && this.state.arrival && !this.state.arrival.hallDiscovered)
        return 'Go ashore and inspect Hall F first.';
      if (
        TYPES[type].cost.tents &&
        this.state.arrival &&
        !this.state.arrival.tents.some((t) => ['landed', 'pitched'].includes(t.status))
      )
        return 'Unload a tent before using its canvas.';
      const missing = Object.entries(TYPES[type].cost)
        .filter(
          ([key, v]) =>
            (Storage.MATERIALS.includes(key)
              ? Storage.available(this.state, key, true)
              : this.state.resources[key]) +
              1e-8 <
            v,
        )
        .map(
          ([key, v]) =>
            `${key}: ${(v - (Storage.MATERIALS.includes(key) ? Storage.available(this.state, key, true) : this.state.resources[key])).toFixed(1)} more`,
        );
      if (
        TYPES[type].cost.sails &&
        !this.state.ships.some((s) => s.status === 'anchored' && s.sail)
      ) {
        missing.push('an anchored ship with its sail');
      }
      return missing.length ? 'Needed: ' + missing.join(', ') : '';
    }

    canAfford(type) {
      return this.blockedReason(type) === '';
    }

    order(type, x, z, rotation = 0) {
      if (Cheats.instant(this.state)) return Cheats.build(this, type, x, z, rotation);
      if (type === 'restore' && this.state.arrival && !this.state.arrival.hallDiscovered)
        return null;
      if (!this.canAfford(type) || !this.canPlace(type, x, z, rotation)) {
        return null;
      }
      const def = TYPES[type];
      const state = this.state;
      const order = {
        id: state.nextId++,
        type,
        x,
        z,
        rotation,
        progress: 0,
        assigned: 0,
        hours: def.hours,
        cost: copyState(def.cost),
        site: this.siteInfo(x, z),
        sailShip: null,
      };
      Storage.syncStores(state);
      if (!Storage.reserveSite(state, order)) return null;
      if (state.arrival && def.cost.tents) order.arrivalTent = Arrival.consumeTent(state);
      for (const [key, v] of Object.entries(order.cost))
        if (!Storage.MATERIALS.includes(key)) state.resources[key] -= v;
      if (order.cost.sails) {
        const ship = state.ships.find((b) => b.status === 'anchored' && b.sail);
        ship.sail = false;
        order.sailShip = ship.id;
      }
      state.queue.push(order);
      if (type === 'restore') {
        this.survey();
      }
      this.log(
        `${def.name} ordered: ${def.hours.toLocaleString()} nominal person-hours.`,
        'construction',
      );
      this.emit();
      return order;
    }

    cancel(id) {
      const state = this.state;
      const i = state.queue.findIndex((order) => order.id === id);
      if (i < 0) {
        return false;
      }
      const order = state.queue[i];
      const reclaim = clamp(1 - order.progress / order.hours, 0, 1);
      Storage.cancelSite(state, order);
      Arrival.returnTent(state, order);
      for (const [key, v] of Object.entries(order.cost)) {
        if (!Storage.MATERIALS.includes(key))
          state.resources[key] += v * (key === 'sails' || key === 'tents' ? 1 : reclaim);
      }
      if (order.sailShip !== null) {
        const ship = state.ships.find((v) => v.id === order.sailShip);
        if (ship) {
          ship.sail = true;
        }
      }
      state.queue.splice(i, 1);
      WorkerOrders.releaseFinishedBuilders(this);
      this.log('Work cancelled; unused materials and fabric recovered.', 'construction');
      this.emit();
      return true;
    }

    dismantle(id) {
      const state = this.state;
      const i = state.buildings.findIndex((b) => b.id === id);
      if (i < 0) {
        return false;
      }
      const b = state.buildings[i];
      if (!['sailbudir', 'tentbudir'].includes(b.type)) {
        return false;
      }
      Arrival.returnTent(state, b);
      for (const [key, v] of Object.entries(b.cost)) {
        if (Storage.MATERIALS.includes(key)) {
          const cache = Storage.cache(state, 'salvage:' + b.id, b);
          cache.stock[key] = (cache.stock[key] || 0) + v * 0.5;
        } else state.resources[key] += v;
      }
      if (b.sailShip !== null) {
        state.ships.find((v) => v.id === b.sailShip).sail = true;
      }
      const oldStore = state.storage.stores['building:' + b.id];
      if (oldStore) {
        const salvage = Storage.cache(state, 'salvage:' + b.id, b);
        for (const [key, amount] of Object.entries(oldStore.stock)) {
          salvage.stock[key] = (salvage.stock[key] || 0) + amount;
          oldStore.stock[key] = 0;
        }
        for (const order of state.queue)
          for (const material of Object.values(order.materials || {}))
            for (const reservation of material.reservations)
              if (reservation.storeId === oldStore.id) reservation.storeId = salvage.id;
      }
      state.buildings.splice(i, 1);
      this.log(TYPES[b.type].name + ' dismantled; fabric returned.', 'construction');
      this.emit();
      return true;
    }

    repair(id, ship = false) {
      if (Cheats.instant(this.state)) return Cheats.repair(this, id, ship);
      const state = this.state;
      const target = ship
        ? state.ships.find((b) => b.id === id)
        : state.buildings.find((b) => b.id === id);
      if (
        !target ||
        target.condition >= 99 ||
        (ship && target.status !== 'anchored') ||
        state.queue.some(
          (order) => order.kind === 'repair' && order.targetId === id && order.shipRepair === ship,
        )
      ) {
        return false;
      }
      const loss = (100 - target.condition) / 100;
      const cost = {
        timber: Math.max(0.2, (ship ? 4 : TYPES[target.type].cost.timber || 2) * loss),
        iron: ship ? Math.max(0.1, 2 * loss) : 0,
      };
      if (Object.entries(cost).some(([key, v]) => Storage.available(state, key) < v)) {
        return false;
      }
      state.queue.push({
        id: state.nextId++,
        type: ship ? 'boatyard' : target.type,
        kind: 'repair',
        shipRepair: ship,
        targetId: id,
        x: ship ? -65 : target.x,
        z: ship ? 0 : target.z,
        rotation: 0,
        progress: 0,
        hours: Math.max(40, (ship ? 800 : TYPES[target.type].hours * 0.25) * loss),
        cost,
        assigned: 0,
        site: {
          workFactor: 1,
        },
        sailShip: null,
      });
      Storage.reserveSite(state, state.queue.at(-1));
      this.emit();
      return true;
    }

    crewDistribution() {
      const builders = this.roster().builders;
      return this.state.queue
        .filter((order) => !order.paused)
        .map((order) => {
          const crew = builders
            .filter((person) => person.order?.buildingId === order.id)
            .slice(0, TYPES[order.type].crew);
          return {
            q: order,
            assigned: crew.length,
            crew,
          };
        });
    }

    estimatedDays(order) {
      const workers = this.crewDistribution().find((item) => item.q.id === order.id)?.assigned || 0;
      return workers
        ? (order.hours - order.progress) / (workers * WorkerOrders.WORKDAY_HOURS)
        : Infinity;
    }

    advanceRealtime(seconds, navigation) {
      Gathering.advance(this, seconds, navigation);
      IdlePeople.advance(this, seconds, navigation);
    }

    registerHarvestSource(source) {
      return Gathering.registerSource(this, source);
    }

    dropGatheringCargo(person) {
      Gathering.dropCargo(this, person);
    }

    advance(hours, notify = true) {
      if (!isFiniteNumber(hours) || hours <= 0 || this.state.gameOver || this.state.ended) {
        return;
      }
      const end = this.state.time + Math.min(hours, 24 * 366);
      let ticks = 0;
      while (this.state.time < end - 1e-8 && !this.state.gameOver && !this.state.ended) {
        const boundary = Math.floor(this.state.time + 1e-7) + 1;
        const next = Math.min(end, boundary);
        const old = this.state.time;
        Hearths.advance(this, (next - old) * 3600);
        Processes.advance(this, next - old);
        this.state.time = next;
        if (next >= boundary - 1e-8) {
          this.eventTime = boundary;
          this.state.time = boundary - 1;
          this.onHour(boundary - 1);
          this.state.time = boundary;
          this.eventTime = null;
          ticks++;
          if (boundary % 24 === 0) {
            this.onDay();
          }
        }
        if (this.state.time === old) {
          break;
        }
      }
      if (notify) {
        this.refreshFood();
        this.emit();
      }
      return ticks;
    }

    consumeFood(energy, storeId = 'camp') {
      let need = energy;
      for (const key of ['dairy', 'plants', 'freshFish', 'meat', 'grain', 'driedFish', 'fat']) {
        const take = Storage.withdraw(this.state, storeId, key, need / FOOD[key].kcal);
        need -= take * FOOD[key].kcal;
        this.flow('consumption', key, take);
        if (need < 0.001) {
          break;
        }
      }
      return clamp(1 - need / Math.max(1, energy), 0, 1);
    }
    // Production precedes consumption. Moving these steps changes game outcomes.
    onHour(hourIndex) {
      const state = this.state;
      const weather = this.weather;
      const clock = hourIndex % 24;
      const isWorkingHour = clock >= 8 && clock < 8 + state.politics.workHours;
      const isDirectWorkHour = WorkerOrders.isWorkingHour(clock);
      this.rosterCache = null;
      const roster = this.roster();
      const effectiveWorkersForTask = (key, limit = Infinity, matches = () => true) =>
        roster[key]
          .filter(matches)
          .filter((person) => (person.order.type === 'work' ? isWorkingHour : isDirectWorkHour))
          .slice(0, limit)
          .reduce(
            (a, person) =>
              a +
              ((this.state.workSeconds[person.id] || 0) / 3600) *
                (0.66 + person.skills[key] * 0.55) *
                clamp(person.health / 80, 0.3, 1) *
                clamp((125 - person.fatigue) / 100, 0.5, 1) *
                (person.trust < 25 ? 0.6 : 1),
            0,
          );
      if (isWorkingHour || isDirectWorkHour) {
        const sites = new Set(
          [...roster.herding, ...roster.craft].map(
            (person) => person.order.workplaceId?.replace(/^hall:.+$/, 'camp') || 'camp',
          ),
        );
        for (const storeId of sites)
          this.produceHourlyResources(
            weather,
            (key, limit = Infinity) =>
              effectiveWorkersForTask(
                key,
                limit,
                (person) =>
                  (person.order.workplaceId?.replace(/^hall:.+$/, 'camp') || 'camp') === storeId,
              ),
            storeId,
          );
      }
      state.workSeconds = {};
      Hearths.seasonWood(state, weather);
      this.consumeHourlySupplies(weather, roster, isWorkingHour);
      Cheats.protect(this);
      this.applyFoodSpoilage(weather);
      state.lastWeather = copyState(weather);
      this.refreshFood();
    }

    produceHourlyResources(weather, effectiveWorkersForTask, storeId = 'camp') {
      const state = this.state;
      Storage.syncStores(state);
      const store = state.storage.stores[storeId];
      if (!Storage.operational(state, store)) return;
      const resources = store.stock;
      for (const key of Storage.KEYS) resources[key] ||= 0;
      // Camp care and crafting rates are quoted per eight-hour fair-weather worker-day.
      const hourlyWeatherFactor = weather.factor / 8;
      const household = ['camp', 'carehut', 'byre'].includes(store.type)
        ? effectiveWorkersForTask('herding')
        : 0;
      const water = household * 180 * hourlyWeatherFactor * (this.has('well') ? 1.35 : 1);
      const collected = Math.min(
        water,
        Math.max(0, Math.max(1800, this.campPopulation * 20) - resources.water),
      );
      Storage.addAt(state, storeId, 'water', collected);
      this.flow('production', 'water', collected);
      const dairyKg =
        Math.min(18, state.livestock.cattle * 2) *
        Math.min(1, household / 8) *
        hourlyWeatherFactor *
        (state.herdHealth / 100) *
        (this.season === 'winter' ? 0.35 : 1);
      this.addFood('dairy', dairyKg, storeId);
      // Drying fish and carbonising wood are timed physical batches, never
      // instantaneous hourly conversions. Ironworking remains an abstract rate.
      if (store.type === 'smithy') {
        const iron = Math.min(
          effectiveWorkersForTask('craft') * 0.12 * hourlyWeatherFactor,
          resources.charcoal / 5,
        );
        Storage.withdraw(state, storeId, 'charcoal', iron * 5);
        Storage.addAt(state, storeId, 'iron', iron);
        this.flow('production', 'iron', iron);
      }
    }

    advanceConstruction(seconds) {
      const clock = this.hour;
      const roster = this.roster();
      const state = this.state;
      for (const { q: order, crew: allocated } of this.crewDistribution()) {
        const crew = WorkerOrders.isWorkingHour(clock)
          ? allocated.filter(
              (person) =>
                !person.cargo &&
                !person.order.supplying &&
                Math.hypot(person.x - person.order.x, person.z - person.order.z) <= 0.8,
            )
          : [];
        order.assigned = crew.length;
        const previous = order.progress;
        order.progress = Math.max(
          previous,
          Math.min(
            order.hours * Storage.suppliedFraction(order),
            order.progress + (crew.length * seconds) / 3600,
          ),
        );
        const earned = Math.max(0, order.progress - previous);
        state.flow.labor += earned;
        for (const person of crew) {
          person.order.workedHours += crew.length ? earned / crew.length : 0;
        }
        for (const person of crew) {
          person.skills.builders = clamp(person.skills.builders + (0.00008 * seconds) / 3600, 0, 1);
        }
      }
      const finished = state.queue.filter((order) => order.progress >= order.hours - 1e-7);
      for (const order of finished) {
        if (order.kind === 'repair') {
          const target = order.shipRepair
            ? state.ships.find((b) => b.id === order.targetId)
            : state.buildings.find((b) => b.id === order.targetId);
          if (target) {
            target.condition = 100;
          }
        } else if (order.type === 'restore') {
          state.hallReady = true;
        } else {
          state.buildings.push({
            ...order,
            condition: 100,
            quality: clamp(
              0.85 + (this.productivity('builders') / Math.max(1, roster.builders.length)) * 0.13,
              0.8,
              1,
            ),
            owner: state.politics.tenure === 'households' ? 'household' : 'camp',
            plantedYear: null,
          });
        }
        state.queue = state.queue.filter((b) => b.id !== order.id);
        Storage.syncStores(state);
        Hearths.initialize(state);
        this.notify(
          (order.kind === 'repair' ? 'Repairs to ' : '') + TYPES[order.type].name + ' completed.',
          'construction',
        );
      }
      if (finished.length) {
        WorkerOrders.releaseFinishedBuilders(this);
      }
    }

    consumeHourlySupplies(weather, roster, isWorkingHour) {
      const state = this.state;
      const resources = state.resources;
      const portion = state.politics.ration === 'reserve' ? 0.85 : 1;
      let foodNeeded = 0,
        waterCredit = 0;
      const meals = new Map(),
        waterCredits = new Map();
      for (const person of this.presentPeople) {
        const need = (person.age < 16 ? 1800 : CALORIES_PER_ADULT_RATION) / 24;
        const eaten = Math.min(person.mealCalories || 0, need * portion);
        person.mealCalories = Math.max(0, (person.mealCalories || 0) - eaten);
        meals.set(person.id, { need, eaten });
        foodNeeded += need * portion - eaten;
        const drunk = Math.min(person.drinkingWaterCredit || 0, 3 / 24);
        person.drinkingWaterCredit = Math.max(0, (person.drinkingWaterCredit || 0) - drunk);
        waterCredit += drunk;
        waterCredits.set(person.id, drunk);
      }
      const arrivalDiet = state.arrival ? Arrival.eat(this, meals, portion) : null;
      const campDiet = arrivalDiet ? 1 : foodNeeded ? this.consumeFood(foodNeeded) : 1;
      const diet =
        [...meals.entries()].reduce(
          (sum, [id, meal]) =>
            sum +
            meal.eaten / meal.need +
            (portion - meal.eaten / meal.need) * (arrivalDiet?.get(id) ?? campDiet),
          0,
        ) / Math.max(1, meals.size);
      const waterNeed =
        (this.campPopulation * 3 +
          state.livestock.cattle * 40 +
          (state.livestock.sheep + state.livestock.goats) * 4) /
        24;
      const arrivalWater = state.arrival ? Arrival.drink(this, waterCredits) : null;
      const waterUsed = arrivalWater
        ? arrivalWater.used
        : Storage.withdraw(state, 'camp', 'water', Math.max(0, waterNeed - waterCredit));
      const waterRatio = waterNeed ? (waterUsed + waterCredit) / waterNeed : 1;
      this.flow('consumption', 'water', waterUsed);
      const cold = Math.max(0, 9 - weather.feels);
      const landedHerd = state.arrival
        ? state.arrival.animals.reduce(
            (sum, a) => sum + (a.shipId === null ? (a.kind === 'cattle' ? 8 : 1) : 0),
            0,
          ) /
          Math.max(1, state.livestock.cattle * 8 + state.livestock.sheep + state.livestock.goats)
        : 1;
      const grazing =
        this.season === 'winter' || weather.temp < 1
          ? 0
          : Math.min(state.ecology.pasture, (this.hayDemand / 24) * 4 * landedHerd);
      const hayNeed = Math.max(0, this.hayDemand / 24 - grazing / 4);
      const hayUsed = state.arrival
        ? Arrival.consumeHay(state, this.hayDemand / 24, grazing / 4)
        : Storage.withdraw(state, 'camp', 'hay', hayNeed);
      state.ecology.pasture -= grazing;
      this.flow('consumption', 'hay', hayUsed);
      const herdRatio = hayNeed ? hayUsed / hayNeed : 1;
      const animalShelter = this.has('byre') || weather.feels > 5;
      state.herdHealth = clamp(
        state.herdHealth + (0.25 - (1 - herdRatio) * 4 - (!animalShelter ? cold * 0.07 : 0)) / 24,
        0,
        100,
      );
      for (const person of this.presentPeople) {
        const work =
          (person.order?.type === 'work' ? isWorkingHour : WorkerOrders.isWorkingHour(this.hour)) &&
          person.job &&
          roster[person.job]?.includes(person);
        const crowding = this.shelter < this.campPopulation ? 0.12 : 0;
        const care =
          this.has('carehut') && roster.herding.length >= Math.ceil(this.campPopulation / 20)
            ? 0.22
            : 0;
        const personalWarmth =
          state.interiorSimulation && person.thermalComfortSeconds !== undefined
            ? clamp(person.thermalComfortSeconds / 3600, 0, 1)
            : Hearths.comfort(this, person);
        person.thermalComfortSeconds = 0;
        const meal = meals.get(person.id);
        const personalDiet =
          meal.eaten / meal.need +
          (portion - meal.eaten / meal.need) * (arrivalDiet?.get(person.id) ?? campDiet);
        const change =
          (personalDiet > 0.995 ? 0.3 + care : -(1 - personalDiet) * 5) -
          (1 - (arrivalWater?.ratios.get(person.id) ?? waterRatio)) * 3 -
          (1 - personalWarmth) * 2 -
          crowding;
        person.health = clamp(
          person.health +
            (change < 0 ? change * (person.age > 50 ? 1.2 : person.age < 16 ? 1.12 : 1) : change) /
              24,
          0,
          100,
        );
        person.fatigue = clamp(
          person.fatigue + (work ? (state.politics.workHours > 8 ? 1.25 : 0.65) : -0.48),
          0,
          100,
        );
        if (work) {
          person.skills[person.job] = clamp(person.skills[person.job] + 0.000025, 0, 1);
        }
        person._diet = personalDiet;
        person._water = arrivalWater?.ratios.get(person.id) ?? waterRatio;
        person._warmth = personalWarmth;
        if (state.interiorSimulation) person.indoorWarmthSeconds = 0;
      }
      state.health =
        this.presentPeople.reduce((a, person) => a + person.health, 0) /
        Math.max(1, this.campPopulation);
      state.lastDiet = diet;
      state.lastWarmth =
        this.presentPeople.reduce((sum, person) => sum + person._warmth, 0) /
        Math.max(1, this.campPopulation);
      state.lastWater = waterRatio;
    }

    applyFoodSpoilage(w) {
      const state = this.state;
      for (const store of Object.values(state.storage.stores))
        for (const [key, food] of Object.entries(FOOD)) {
          const storage =
            store.type === 'storehouse' && Storage.operational(state, store) ? 0.65 : 1;
          const temperature = clamp((w.temp + 8) / 20, 0.15, 1.6);
          const loss =
            (store.stock[key] || 0) * (1 - Math.exp((-food.spoilage * temperature * storage) / 24));
          store.stock[key] = Math.max(0, (store.stock[key] || 0) - loss);
          this.flow('losses', key, loss);
        }
    }
    // Resolve the day before recording its ledger; reset flow counters afterward.
    onDay() {
      const weather = this.weather;
      this.updateHouseholdWellbeing();
      this.regenerateEnvironment(weather);
      this.updateNeighbouringCommunity(weather);
      this.maintainBuildingsAndGardens(weather);
      this.updateTravel();
      this.resolveAssembly();
      this.resolveCampaignStatus();
      this.refreshFood();
      this.recordDailyLedger(weather);
      this.invalidateRoster();
    }

    updateHouseholdWellbeing() {
      const state = this.state;
      for (const household of state.households) {
        const members = state.people.filter(
          (person) => household.members.includes(person.id) && person.alive && !person.away,
        );
        if (!members.length) {
          continue;
        }
        household.health = members.reduce((a, person) => a + person.health, 0) / members.length;
        household.diet = state.lastDiet;
        household.warmth = state.lastWarmth;
        household.water = state.lastWater;
        const fulfilled =
          state.lastDiet > 0.995 && state.lastWater > 0.98 && state.lastWarmth > 0.8;
        for (const person of members) {
          person.trust = clamp(
            person.trust + (fulfilled ? 0.12 : -0.35) - (person.fatigue > 65 ? 0.22 : 0),
            0,
            100,
          );
          if (person.health < 35 && person.memory.at(-1) !== 'Too ill for work') {
            person.memory.push('Too ill for work');
          }
          if (person.health <= 0) {
            this.dropGatheringCargo(person);
            WorkerOrders.releasePlaces(person);
            person.alive = false;
            state.metrics.peopleLost++;
            this.notify(person.name + ' died after sustained illness or exposure.', 'loss');
          }
        }
        household.trust = members.reduce((a, person) => a + person.trust, 0) / members.length;
      }
      state.population = state.people.filter((person) => person.alive).length;
      state.politics.legitimacy = clamp(
        state.politics.legitimacy * 0.98 + this.meanTrust * 0.02,
        0,
        100,
      );
      if (state.lastDiet > 0.99) {
        state.metrics.daysFed++;
      }
      if (state.lastWarmth > 0.8) {
        state.metrics.daysWarm++;
      }
    }

    regenerateEnvironment(w) {
      const state = this.state;
      state.ecology.wood = Math.min(state.ecology.initialWood, state.ecology.wood + 0.08);
      state.ecology.fish = clamp(
        state.ecology.fish + (this.season === 'spring' ? 0.0025 : 0.0012),
        0.15,
        1,
      );
      if (this.season === 'spring' || this.season === 'summer') {
        state.ecology.pasture = Math.min(
          state.ecology.initialPasture,
          state.ecology.pasture + Math.max(0, w.temp) * 95,
        );
      }
    }

    updateNeighbouringCommunity(weather) {
      const state = this.state;
      const neighbours = state.neighbours;
      if (neighbours.present) {
        const pressure =
          this.state.regions.find((r) => r.id === 'estuary').known && !neighbours.agreement
            ? 0.015
            : 0;
        neighbours.pressure = clamp(neighbours.pressure + pressure - 0.005, 0, 1);
        neighbours.food = Math.max(0, neighbours.food + 6 * weather.factor - 5.7);
        if (neighbours.pressure > 0.5) {
          neighbours.access = 'closed';
          neighbours.stance = 'protecting access';
          neighbours.trust = Math.max(0, neighbours.trust - 0.08);
        } else {
          neighbours.stance =
            neighbours.food < 250
              ? 'seeking provisions'
              : neighbours.trust > 60
                ? 'open to exchange'
                : 'cautious';
        }
      }
    }

    maintainBuildingsAndGardens(w) {
      const state = this.state;
      for (const building of state.buildings) {
        building.condition = clamp(
          building.condition -
            0.04 -
            (w.gale ? (building.site?.exposure || 0) * 0.8 : 0) -
            (building.site?.wet || 0) * 0.025,
          0,
          100,
        );
        if (building.type === 'garden') {
          const year = this.date.getUTCFullYear();
          const m = this.date.getUTCMonth();
          const storeId = 'building:' + building.id;
          Storage.syncStores(state);
          if (
            m >= 3 &&
            m <= 5 &&
            building.plantedYear !== year &&
            (state.storage.stores[storeId].stock.seeds || 0) >= 2
          ) {
            Storage.withdraw(state, storeId, 'seeds', 2);
            building.plantedYear = year;
            building.harvested = false;
            this.log('A garden is planted with 2 kg of seed.', 'farming');
          }
          if (m === 8 && building.plantedYear === year && !building.harvested) {
            const kg =
              160 *
              (0.65 +
                (hashSeed(state.config.seed + ':crop:' + year + building.id) / 4294967296) * 0.5);
            this.addFood('plants', kg, storeId);
            Storage.addAt(state, storeId, 'seeds', 2.5);
            building.harvested = true;
            this.notify('Garden harvest: ' + Math.floor(kg) + ' kg of vegetables.', 'farming');
          }
        }
      }
    }

    resolveCampaignStatus() {
      const state = this.state;
      if (state.herdHealth <= 0 && this.hayDemand) {
        state.livestock = {
          cattle: 0,
          sheep: 0,
          goats: 0,
        };
        if (state.arrival) state.arrival.animals = [];
        this.notify('The herd was lost after prolonged fodder or shelter failure.', 'loss');
      }
      const leader = state.people.find((p) => p.id === state.leader.id);
      if (!leader?.alive) {
        const successor = state.people
          .filter((person) => person.alive && person.age >= 18)
          .sort((a, b) => b.trust - a.trust)[0];
        if (state.config.legacy && successor) {
          state.leader.id = successor.id;
          this.notify(successor.name + ' assumes leadership.', 'legacy');
        } else {
          state.gameOver = true;
          this.notify(
            'The leader’s campaign has ended. The chronicle records the society that remains.',
            'ending',
          );
        }
      }
      if (!state.population) {
        state.gameOver = true;
        this.notify('No members of the expedition remain.', 'ending');
      }
      if (this.date.getUTCFullYear() > state.lastYear) {
        for (const person of state.people) {
          if (person.alive) {
            person.age++;
          }
        }
        state.lastYear = this.date.getUTCFullYear();
        this.notify('A new year begins. Stocks, skills, relationships and debts persist.', 'year');
      }
    }

    recordDailyLedger(w) {
      const state = this.state;
      state.ledger.push({
        day: this.day,
        time: state.time,
        weather: state.lastWeather?.name || w.name,
        temp: state.lastWeather?.temp ?? w.temp,
        foods: copyState(state.foods),
        resources: copyState(state.resources),
        production: copyState(state.flow.production),
        consumption: copyState(state.flow.consumption),
        losses: copyState(state.flow.losses),
        labor: state.flow.labor,
        population: state.population,
        health: state.health,
        trust: this.meanTrust,
        warmth: state.lastWarmth,
        ecology: copyState(state.ecology),
      });
      state.ledger = state.ledger.slice(-366);
      state.flow = {
        production: {},
        consumption: {},
        losses: {},
        labor: 0,
        refused: 0,
      };
    }

    appointSteward(id) {
      const p = this.state.people.find(
        (person) => person.id === id && person.alive && !person.away && person.age >= 18,
      );
      if (!p) {
        return false;
      }
      this.state.politics.steward = id;
      this.log(p.name + ' appointed as steward.', 'council');
      this.emit();
      return true;
    }

    propose(rule, value) {
      const state = this.state;
      if (
        !hasOwn(RULES, rule) ||
        !RULES[rule].choices.includes(value) ||
        state.politics.proposal ||
        state.people[state.leader.id]?.away
      ) {
        return false;
      }
      const votes = state.households.map((household) => {
        const people = state.people.filter(
          (person) => household.members.includes(person.id) && person.alive && person.age >= 16,
        );
        let support =
          people.reduce((a, person) => a + person.trust, 0) / Math.max(1, people.length) / 100;
        if (rule === 'workHours') {
          support += value === 6 ? 0.3 : value === 10 ? -0.24 : 0.06;
        }
        if (rule === 'ration') {
          support += value === 'reserve' ? (this.foodDays < 7 ? 0.15 : -0.28) : 0.18;
        }
        if (rule === 'tenure') {
          support +=
            (people.filter((p) => p.preference === value).length / Math.max(1, people.length)) *
            0.2;
        }
        if (rule === 'watch') {
          support += value === 'guarded' && !state.neighbours.agreement ? -0.1 : 0.08;
        }
        return {
          household: household.id,
          yes: support > 0.5,
          weight: people.length,
        };
      });
      state.politics.proposal = {
        rule,
        value,
        votes,
        resolveDay: this.day + 1,
      };
      this.log('Assembly convened to consider ' + RULES[rule].name.toLowerCase() + '.', 'council');
      this.emit();
      return true;
    }

    resolveAssembly() {
      const state = this.state;
      const p = state.politics.proposal;
      if (!p || this.day < p.resolveDay) {
        return;
      }
      const yes = p.votes.filter((v) => v.yes).reduce((a, v) => a + v.weight, 0);
      const total = p.votes.reduce((a, v) => a + v.weight, 0);
      if (yes > total / 2) {
        state.politics[p.rule] = p.value;
        if (p.rule === 'tenure') {
          for (const person of state.people) {
            if (person.alive) {
              person.trust = clamp(person.trust + (person.preference === p.value ? 3 : -2), 0, 100);
              person.memory.push('Assembly changed land and work obligations');
              person.memory = person.memory.slice(-8);
            }
          }
        }
        this.notify(
          'Assembly adopts ' +
            RULES[p.rule].name.toLowerCase() +
            ': ' +
            p.value +
            ' (' +
            yes +
            ' of ' +
            total +
            ' voices).',
          'council',
        );
      } else {
        this.notify(
          'Assembly declines the proposal (' + yes + ' of ' + total + ' voices).',
          'council',
        );
      }
      state.metrics.assemblies++;
      state.politics.proposal = null;
      this.invalidateRoster();
    }

    cull(species, count) {
      const state = this.state;
      if (
        !hasOwn(state.livestock, species) ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > state.livestock[species]
      ) {
        return false;
      }
      const yieldKg = {
        cattle: 140,
        sheep: 22,
        goats: 18,
      }[species];
      if (state.arrival) {
        const landed = state.arrival.animals.filter((a) => a.kind === species && a.shipId === null);
        if (landed.length < count) return false;
        const removed = new Set(landed.slice(0, count).map((a) => a.id));
        state.arrival.animals = state.arrival.animals.filter((a) => !removed.has(a.id));
      }
      state.livestock[species] -= count;
      this.addFood('meat', count * yieldKg);
      state.metrics.animalsCulled += count;
      for (const h of state.households) {
        h.trust = Math.max(0, h.trust - 0.6);
      }
      this.refreshFood();
      this.log(
        count +
          ' ' +
          species +
          ' slaughtered: ' +
          count * yieldKg +
          ' kg of modeled edible meat; future feed demand and dairy output fall.',
        'husbandry',
      );
      this.emit();
      return true;
    }

    scout(regionId, kind = 'survey') {
      const state = this.state;
      const region = state.regions.find((r) => r.id === regionId);
      if (
        !region ||
        region.kind === 'home' ||
        region.kind === 'trade' ||
        state.scouts.some((v) => v.region === regionId) ||
        this.workforce < 4 ||
        this.foodDays < 2
      ) {
        return false;
      }
      if (kind === 'envoy' && !state.neighbours.known) {
        return false;
      }
      const crew = this.availablePeople
        .slice()
        .sort((a, b) => b.navigation - a.navigation)
        .slice(0, 4);
      const days = region.days + (kind === 'envoy' ? 2 : 0);
      const provisions = (crew.length * days * CALORIES_PER_ADULT_RATION) / FOOD.driedFish.kcal;
      if ((state.storage.stores.camp.stock.driedFish || 0) < provisions) {
        return false;
      }
      const id = state.nextId++;
      Storage.withdraw(state, 'camp', 'driedFish', provisions);
      crew.forEach((person) => {
        this.dropGatheringCargo(person);
        WorkerOrders.releasePlaces(person);
        person.away = 'scout:' + id;
      });
      state.scouts.push({
        id,
        region: regionId,
        kind,
        crew: crew.map((p) => p.id),
        start: this.day,
        due: this.day + days,
      });
      this.invalidateRoster();
      this.refreshFood();
      this.log(
        (kind === 'envoy' ? 'Envoys' : 'Survey party') +
          ' depart for ' +
          region.name +
          ' with ' +
          days +
          ' days of dried provisions.',
        'exploration',
      );
      this.emit();
      return true;
    }

    voyageQuote(shipId, regionId, crewCount, timber) {
      const state = this.state;
      const ship = state.ships.find((v) => v.id === shipId);
      const region = state.regions.find((r) => r.id === regionId);
      crewCount = Math.round(crewCount);
      timber = Number(timber);
      let reason = '';
      if (!ship || ship.status !== 'anchored' || !ship.sail) {
        reason = 'Choose an anchored knarr with its sail.';
      } else if (!region || region.kind !== 'trade') {
        reason = 'Choose a trading harbour.';
      } else if (
        !Number.isInteger(crewCount) ||
        crewCount < 6 ||
        crewCount > 16 ||
        crewCount > this.workforce
      ) {
        reason = 'The voyage needs 6–16 available adults.';
      } else if (
        !isFiniteNumber(timber) ||
        timber < 0 ||
        timber > (state.storage.stores.camp.stock.timber || 0)
      ) {
        reason = 'The timber cargo exceeds available stock.';
      }
      const days = (region?.days || 20) * 2 + 5 + (this.season === 'winter' ? 12 : 0);
      const provisions = (crewCount * days * CALORIES_PER_ADULT_RATION) / FOOD.driedFish.kcal;
      const mass = timber * 500 + provisions + crewCount * 100 + 300;
      if (!reason && (state.storage.stores.camp.stock.driedFish || 0) < provisions) {
        reason = 'Not enough dried provisions for the round trip.';
      }
      if (!reason && mass > ship.capacity) {
        reason = 'Crew, cargo and supplies exceed this knarr’s modeled 12-tonne payload.';
      }
      if (!reason && ship.condition < 35) {
        reason = 'Repair the hull before attempting an ocean crossing.';
      }
      return {
        reason,
        days,
        provisions,
        mass,
        capacity: ship?.capacity || 0,
      };
    }

    launch(shipId, regionId, crewCount = 8, timber = 6) {
      if (
        this.state.arrival &&
        (this.state.people.some((p) => p.arrivalShip === shipId) ||
          this.state.arrival.animals.some((a) => a.shipId === shipId) ||
          this.state.arrival.tents.some((t) => t.shipId === shipId) ||
          (this.state.arrival.ferry.sourceShip === shipId &&
            this.state.arrival.ferry.phase !== 'idle') ||
          Storage.storeVolume(this.state, this.state.storage.stores['ship:' + shipId]) > 0)
      )
        return null;
      const quote = this.voyageQuote(shipId, regionId, crewCount, timber);
      if (quote.reason) {
        return null;
      }
      const state = this.state;
      const ship = state.ships.find((v) => v.id === shipId);
      const crew = this.availablePeople
        .slice()
        .sort((a, b) => b.navigation - a.navigation)
        .slice(0, crewCount);
      const id = state.nextId++;
      const region = state.regions.find((r) => r.id === regionId);
      Storage.withdraw(state, 'camp', 'driedFish', quote.provisions);
      Storage.withdraw(state, 'camp', 'timber', timber);
      crew.forEach((person) => {
        this.dropGatheringCargo(person);
        WorkerOrders.releasePlaces(person);
        person.away = 'voyage:' + id;
      });
      ship.status = 'at sea';
      ship.voyage = id;
      const v = {
        id,
        shipId,
        region: regionId,
        crew: crew.map((p) => p.id),
        captain: crew[0].id,
        start: this.day,
        due: this.day + quote.days,
        plannedDays: quote.days,
        provisions: quote.provisions,
        cargoTimber: timber,
        phase: 'outbound',
        delay: 0,
        condition: ship.condition,
        losses: 0,
      };
      state.voyages.push(v);
      this.invalidateRoster();
      this.refreshFood();
      this.notify(
        ship.name + ' sails for ' + region.name + '. Cargo and provisions leave the home stores.',
        'voyage',
      );
      this.emit();
      return v;
    }

    updateTravel() {
      const state = this.state;
      for (const mission of state.scouts.slice()) {
        if (this.day < mission.due) {
          continue;
        }
        mission.crew.forEach((id) => {
          const person = state.people.find((p) => p.id === id);
          if (person) {
            person.away = null;
          }
        });
        const region = state.regions.find((r) => r.id === mission.region);
        if (mission.kind === 'survey') {
          region.known = true;
          region.confidence = 0.85;
          region.reportDay = this.day;
          state.metrics.scoutReturns++;
          if (region.id === 'woodland') {
            state.ecology.wood += 400;
            state.ecology.initialWood += 400;
          }
          if (region.id === 'estuary' && state.neighbours.present) {
            state.neighbours.known = true;
            this.notify(
              'The party reports a coastal community near the estuary. Its seasonal territory ' +
                'is not unclaimed land.',
              'exploration',
            );
          } else {
            this.notify(
              region.name + ' surveyed. Reports identify resources and access conditions.',
              'exploration',
            );
          }
        } else if (mission.kind === 'exchange') {
          const neighbours = state.neighbours;
          neighbours.food += mission.tradeFood || 0;
          neighbours.received += mission.tradeFood || 0;
          neighbours.sent += 100;
          Storage.addAt(
            state,
            'camp',
            'hay',
            Math.min(100, Math.max(0, this.hayCapacity - state.resources.hay)),
          );
          neighbours.trust = Math.min(100, neighbours.trust + 1);
          this.notify(
            'The exchange party returns with 100 kg of fodder after delivering 20 kg of ' +
              'dried fish.',
            'diplomacy',
          );
        } else {
          const neighbours = state.neighbours;
          const acceptance = neighbours.food < 500 || neighbours.trust >= 35 || this.random() > 0.6;
          if (acceptance) {
            neighbours.agreement = true;
            neighbours.access = 'seasonal shared access';
            neighbours.trust += 12;
            neighbours.lastReport = this.day;
            this.notify(
              'Envoys return with an agreement for seasonal access and reciprocal visits.',
              'diplomacy',
            );
          } else {
            neighbours.trust += 3;
            neighbours.lastReport = this.day;
            this.notify(
              'Envoys return: the community declines shared access for now.',
              'diplomacy',
            );
          }
        }
        state.scouts = state.scouts.filter((v) => v.id !== mission.id);
      }
      for (const v of state.voyages.slice()) {
        const ship = state.ships.find((b) => b.id === v.shipId);
        const need = (v.crew.length * CALORIES_PER_ADULT_RATION) / FOOD.driedFish.kcal;
        const used = Math.min(v.provisions, need);
        v.provisions -= used;
        if (used < need) {
          v.crew.forEach(
            (id) => (state.people[id].health = Math.max(0, state.people[id].health - 2)),
          );
        }
        const weather = this.weather;
        if (weather.gale && this.day % 3 === 0) {
          v.due++;
          v.delay++;
          const captain = state.people[v.captain];
          v.condition = Math.max(0, v.condition - (1 - captain.navigation) * 8);
        }
        const elapsed = this.day - v.start;
        if (elapsed > v.plannedDays * 0.55 && v.phase === 'outbound') {
          v.phase = 'returning';
          const demand =
            0.7 +
            (hashSeed(state.config.seed + ':market:' + v.region + ':' + Math.floor(this.day / 30)) %
              60) /
              100;
          v.returnCargo = {
            iron: v.cargoTimber * 2 * demand,
            cloth: v.cargoTimber * 1.3,
            grain: v.cargoTimber * 24 * demand,
          };
        }
        if (this.day < v.due) {
          continue;
        }
        v.crew.forEach((id) => {
          const person = state.people[id];
          person.away = null;
          person.navigation = Math.min(1, person.navigation + 0.015);
        });
        Storage.addAt(state, 'camp', 'driedFish', v.provisions);
        ship.status = 'anchored';
        ship.voyage = null;
        ship.condition = Math.max(15, v.condition - 4);
        for (const [key, amount] of Object.entries(v.returnCargo || {})) {
          if (key === 'grain') {
            this.addFood(key, amount);
          } else {
            Storage.addAt(state, 'camp', key, amount);
          }
        }
        state.metrics.tradeReturns++;
        this.notify(
          ship.name + ' returns after ' + elapsed + ' days with iron, cloth and grain.',
          'voyage',
        );
        state.voyages = state.voyages.filter((p) => p.id !== v.id);
      }
    }

    exchange() {
      const state = this.state;
      const neighbours = state.neighbours;
      if (
        !neighbours.known ||
        !neighbours.agreement ||
        neighbours.food > 2200 ||
        neighbours.access === 'closed' ||
        (state.storage.stores.camp.stock.driedFish || 0) < 20 ||
        state.scouts.some((v) => v.kind === 'exchange')
      ) {
        return false;
      }
      const region = state.regions.find((r) => r.id === 'estuary');
      if (!this.scout(region.id, 'envoy')) {
        return false;
      }
      const mission = state.scouts.at(-1);
      mission.kind = 'exchange';
      mission.tradeFood = 20;
      Storage.withdraw(
        state,
        'camp',
        'driedFish',
        20,
      ); /* Reciprocal goods arrive when the party returns. */
      this.refreshFood();
      this.emit();
      return true;
    }

    visit(id) {
      const person = this.state.people.find(
        (person) => person.id === id && person.alive && !person.away,
      );
      if (
        !person ||
        Math.hypot(this.state.leader.x - (person.x || 0), this.state.leader.z - (person.z || 0)) > 5
      ) {
        return false;
      }
      if (person.lastVisit === this.day) {
        return false;
      }
      person.lastVisit = this.day;
      person.trust = Math.min(100, person.trust + 0.8);
      person.memory.push('Karlsefni heard my report');
      person.memory = person.memory.slice(-8);
      this.emit();
      return true;
    }

    endCampaign() {
      this.state.ended = true;
      this.log('The player closes this chapter of the expedition.', 'ending');
      this.emit();
    }

    chronicle() {
      const state = this.state;
      const identity =
        this.state.ended || state.gameOver
          ? 'Recorded expedition'
          : state.metrics.tradeReturns > 2
            ? 'A trading outpost'
            : state.neighbours.agreement
              ? 'A coastal compact'
              : state.health > 70 && this.foodDays > 20
                ? 'A provisioned harbour'
                : 'An uncertain foothold';
      return {
        identity,
        days: this.day,
        people: state.population,
        health: Math.round(state.health),
        trust: Math.round(this.meanTrust),
        tradeReturns: state.metrics.tradeReturns,
        ecology: Math.round((state.ecology.wood / state.ecology.initialWood) * 100),
        records: state.chronicle.slice().reverse(),
      };
    }

    serialize() {
      this.refreshFood();
      return JSON.stringify(this.state);
    }
    static load(json) {
      try {
        const s = JSON.parse(json);
        if (s.version === 1) {
          return Simulation.migrate(s);
        }
        if (
          s.version !== 3 ||
          !s.config ||
          !isFiniteNumber(s.startDate) ||
          !isFiniteNumber(s.time) ||
          s.time < 0 ||
          !Array.isArray(s.people) ||
          s.people.length > 300 ||
          !Array.isArray(s.households) ||
          !Array.isArray(s.buildings) ||
          !Array.isArray(s.queue) ||
          !Array.isArray(s.ships) ||
          !Array.isArray(s.voyages) ||
          !Array.isArray(s.scouts) ||
          !Array.isArray(s.regions) ||
          !Array.isArray(s.journal) ||
          !Array.isArray(s.ledger) ||
          !s.resources ||
          !s.foods ||
          !s.politics ||
          !s.ecology ||
          !s.leader ||
          !s.livestock ||
          !s.neighbours ||
          !s.flow ||
          !s.metrics ||
          !Array.isArray(s.notifications) ||
          !Array.isArray(s.chronicle)
        ) {
          return null;
        }
        for (const key of [
          'food',
          'timber',
          'turf',
          'stone',
          'iron',
          'sails',
          'tents',
          'hay',
          'charcoal',
          'firewood',
          'water',
          'seeds',
          'cloth',
        ]) {
          if (!isFiniteNumber(s.resources[key]) || s.resources[key] < 0) {
            return null;
          }
        }
        for (const key of Object.keys(FOOD)) {
          if (!isFiniteNumber(s.foods[key]) || s.foods[key] < 0) {
            return null;
          }
        }
        if (!Gathering.validState(s)) return null;
        if (
          s.hallHearths !== undefined &&
          (!s.hallHearths ||
            typeof s.hallHearths !== 'object' ||
            Array.isArray(s.hallHearths) ||
            Object.entries(s.hallHearths).some(
              ([room, lit]) => !['I', 'II', 'III', 'IV'].includes(room) || typeof lit !== 'boolean',
            ))
        )
          return null;
        if (
          s.buildings.some(
            (building) =>
              building.hearthLit !== undefined && typeof building.hearthLit !== 'boolean',
          )
        )
          return null;
        const ids = new Set();
        for (const [index, person] of s.people.entries()) {
          if (
            !WorkerOrders.validOrder(person.order, s) ||
            person.id !== index ||
            !Number.isInteger(person.id) ||
            ids.has(person.id) ||
            !isFiniteNumber(person.health) ||
            person.health < 0 ||
            person.health > 100 ||
            !isFiniteNumber(person.trust) ||
            !isFiniteNumber(person.fatigue) ||
            !isFiniteNumber(person.age) ||
            !person.skills ||
            !Object.keys(TASKS).every(
              (key) =>
                isFiniteNumber(person.skills[key]) &&
                person.skills[key] >= 0 &&
                person.skills[key] <= 1,
            ) ||
            typeof person.name !== 'string' ||
            !Array.isArray(person.memory) ||
            !isFiniteNumber(person.navigation) ||
            person.navigation < 0 ||
            person.navigation > 1
          ) {
            return null;
          }
          ids.add(person.id);
        }
        if (
          !s.people.some((p) => p.id === s.leader.id) ||
          !isFiniteNumber(s.leader.x) ||
          !isFiniteNumber(s.leader.z) ||
          !isFiniteNumber(s.leader.heading)
        ) {
          return null;
        }
        const jobs = new Set();
        for (const building of [...s.buildings, ...s.queue]) {
          if (
            !hasOwn(TYPES, building.type) ||
            !isFiniteNumber(building.id) ||
            jobs.has(building.id) ||
            !isFiniteNumber(building.progress) ||
            building.progress < 0 ||
            !isFiniteNumber(building.hours) ||
            building.hours <= 0 ||
            building.progress > building.hours + 0.001 ||
            !isFiniteNumber(building.x) ||
            !isFiniteNumber(building.z) ||
            !isFiniteNumber(building.rotation) ||
            !building.cost
          ) {
            return null;
          }
          jobs.add(building.id);
        }
        const reserved = new Set();
        for (const v of [...s.voyages, ...s.scouts]) {
          for (const id of v.crew || []) {
            if (reserved.has(id)) {
              return null;
            }
            reserved.add(id);
          }
        }
        for (const [index, ship] of s.ships.entries()) {
          if (
            ship.id !== index ||
            !['anchored', 'at sea', 'lost'].includes(ship.status) ||
            typeof ship.sail !== 'boolean' ||
            !isFiniteNumber(ship.condition) ||
            ship.condition < 0 ||
            ship.condition > 100 ||
            !isFiniteNumber(ship.capacity) ||
            ship.capacity <= 0
          ) {
            return null;
          }
        }
        if (
          !Number.isInteger(s.resources.sails) ||
          s.resources.sails !== s.ships.filter((v) => v.sail).length ||
          !Number.isInteger(s.resources.tents) ||
          s.resources.tents > s.config.tents
        ) {
          return null;
        }
        for (const v of [...s.voyages, ...s.scouts]) {
          if (
            !Array.isArray(v.crew) ||
            !v.crew.every((id) => ids.has(id)) ||
            !isFiniteNumber(v.due) ||
            !isFiniteNumber(v.start)
          ) {
            return null;
          }
        }
        for (const key of ['cattle', 'sheep', 'goats']) {
          if (!Number.isInteger(s.livestock[key]) || s.livestock[key] < 0) {
            return null;
          }
        }
        if (s.population !== s.people.filter((person) => person.alive).length) {
          return null;
        }
        for (const [key, r] of Object.entries(RULES)) {
          if (!r.choices.includes(s.politics[key])) {
            return null;
          }
        }
        for (const value of Object.values(s.ecology)) {
          if (!isFiniteNumber(value) || value < 0) {
            return null;
          }
        }
        if (
          s.timberDropoff &&
          (!isFiniteNumber(s.timberDropoff.x) ||
            !isFiniteNumber(s.timberDropoff.z) ||
            !Meadows.containsPoint(s.timberDropoff.x, s.timberDropoff.z) ||
            typeof s.timberDropoff.label !== 'string')
        ) {
          return null;
        }
        if (
          !Arrival.validate(s) ||
          !Storage.validate(s) ||
          !Hearths.validate(s) ||
          !Cheats.validate(s) ||
          !Processes.validate(s) ||
          !Doors.validate(s)
        )
          return null;
        return new Simulation(s);
      } catch {
        return null;
      }
    }
    static migrate(old) {
      if (
        !old.resources ||
        !old.tasks ||
        !Array.isArray(old.buildings) ||
        !Array.isArray(old.queue) ||
        !isFiniteNumber(old.time) ||
        old.time < 0
      ) {
        return null;
      }
      for (const v of Object.values(old.resources)) {
        if (!isFiniteNumber(v) || v < 0) {
          return null;
        }
      }
      const simulation = new Simulation();
      const state = simulation.state;
      state.time = old.time;
      state.hallReady = Boolean(old.hallReady);
      state.surveyed = Boolean(old.surveyed);
      state.resources = {
        ...state.resources,
        ...old.resources,
      };
      state.foods = createStartingFoodStocks(old.resources.food);
      for (const list of ['buildings', 'queue']) {
        for (const b of old[list]) {
          if (
            !hasOwn(TYPES, b.type) ||
            !isFiniteNumber(b.x) ||
            !isFiniteNumber(b.z) ||
            !isFiniteNumber(b.progress) ||
            b.progress < 0 ||
            b.progress > TYPES[b.type].hours
          ) {
            return null;
          }
          state[list].push({
            ...b,
            hours: TYPES[b.type].hours,
            cost: copyState(TYPES[b.type].cost),
            condition: 100,
            quality: 1,
            site: simulation.siteInfo(b.x, b.z),
            sailShip: null,
          });
        }
      }
      if (
        !Number.isInteger(state.resources.sails) ||
        state.resources.sails < 0 ||
        state.resources.sails > 4 ||
        !Number.isInteger(state.resources.tents) ||
        state.resources.tents > 10
      ) {
        return null;
      }
      const fabric = [...state.buildings, ...state.queue].filter((order) => order.cost.sails);
      const used = state.ships.length - state.resources.sails;
      if (fabric.length !== used) {
        return null;
      }
      for (let i = 0; i < used; i++) {
        state.ships[i].sail = false;
        fabric[i].sailShip = i;
      }
      state.nextId = Math.max(
        old.nextId || 1,
        ...[...state.buildings, ...state.queue].map((b) => b.id + 1),
      );
      state.journal = Array.isArray(old.journal) ? old.journal : state.journal;
      delete state.workerOrdersVersion;
      WorkerOrders.initialize(state);
      delete state.storage;
      Storage.initialize(state);
      Hearths.initialize(state);
      simulation.refreshFood();
      simulation.log(
        'Previous expedition save upgraded to the household and physical-stores simulation.',
        'migration',
      );
      return simulation;
    }
  }
  root.VinlandModel = {
    Simulation,
    TYPES,
    TASKS,
    FOOD,
    PRESETS,
    REGIONS,
    RULES,
    config: normalizeScenarioConfig,
    hash: hashSeed,
    seeded: createSeededRandom,
    coast,
    elevation,
    landDistance,
  };
  if (typeof module !== 'undefined') {
    module.exports = root.VinlandModel;
  }
})(typeof window !== 'undefined' ? window : globalThis);
