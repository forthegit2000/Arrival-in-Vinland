/**
 * Scenario definitions and balancing data shared by the model and the interface.
 * Building work is measured in nominal person-hours. Material units are defined
 * per resource; change the data here rather than duplicating values in the HUD.
 */
(function (root) {
  'use strict';

  const TYPES = {
    restore: {
      name: 'Reopen Hall F',
      subtitle: 'Recover the expedition’s hearth',
      category: 'shelter',
      hours: 640,
      crew: 16,
      cost: {
        timber: 3,
        turf: 12,
        stone: 0.3,
      },
      shelter: 32,
      winter: 32,
      w: 15,
      d: 28,
      description:
        'Repair the inherited roof, doors, hearths and sleeping platforms. Opens 32 ' +
        'estimated berths in the three living rooms. This is a repair of the scenario\u2019s ' +
        'standing hall, not its original construction.',
      stages: [
        ['Inspect, clear & drain', 80],
        ['Frame & roof repairs', 280],
        ['Turf, doors & platforms', 200],
        ['Hearths & provisioning', 80],
      ],
    },
    sailbudir: {
      name: 'Sail-roofed búð',
      subtitle: '16 temporary berths · uses a knarr sail',
      category: 'shelter',
      hours: 160,
      crew: 8,
      cost: {
        timber: 0.8,
        turf: 6,
        sails: 1,
      },
      shelter: 16,
      winter: 0,
      w: 6,
      d: 8,
      description:
        'A low turf-walled shelter beneath a wool sail. Quick summer accommodation for ' +
        '16; its fabric roof does not count as winter housing. One sail is removed from ' +
        'a moored knarr until the shelter is dismantled.',
      stages: [
        ['Level & lay turf', 80],
        ['Raise poles & rig sail', 56],
        ['Drain & furnish', 24],
      ],
    },
    tentbudir: {
      name: 'Tent-walled búð',
      subtitle: '12 temporary berths · reuses one tent',
      category: 'shelter',
      hours: 96,
      crew: 6,
      cost: {
        timber: 0.4,
        turf: 3,
        tents: 1,
      },
      shelter: 12,
      winter: 0,
      w: 5,
      d: 6,
      description:
        'Reuse one of the ten pitched tents over low turf walls. Its original 8 tent ' +
        'berths are removed when work starts; the completed shelter accommodates 12. ' +
        'Temporary housing only.',
      stages: [
        ['Level & lay turf', 48],
        ['Raise & tension canvas', 32],
        ['Drain & furnish', 16],
      ],
    },
    longhouse: {
      name: 'Turf longhouse',
      subtitle: '32 warm berths · timber & turf',
      category: 'shelter',
      hours: 6400,
      crew: 24,
      cost: {
        timber: 24,
        turf: 280,
        stone: 2,
        iron: 3,
      },
      shelter: 32,
      winter: 32,
      w: 8.5,
      d: 22,
      description:
        'An Icelandic-style timber frame inside thick double-skinned turf walls, with a ' +
        'central longfire and sleeping platforms. Comparable to the smaller halls at ' +
        'the site; a new build, not an instant upgrade.',
      stages: [
        ['Drain, foundations & hauling', 1440],
        ['Hew & join timber frame', 1840],
        ['Lay turf walls & roof', 2000],
        ['Doors, hearth & platforms', 1120],
      ],
    },
    turfhouse: {
      name: 'Turf dwelling',
      subtitle: '8 warm berths · a smaller household',
      category: 'shelter',
      hours: 1600,
      crew: 12,
      cost: {
        timber: 7,
        turf: 68,
        stone: 0.8,
        iron: 1,
      },
      shelter: 8,
      winter: 8,
      w: 6,
      d: 9,
      description:
        'A compact timber-framed dwelling with insulating turf walls, an earthen floor, ' +
        'side platforms and a stone hearth. Accommodates an estimated eight people.',
      stages: [
        ['Prepare & drain', 320],
        ['Timber frame', 480],
        ['Turf envelope', 560],
        ['Hearth & platforms', 240],
      ],
    },
    workshop: {
      name: 'Carpenter’s hut',
      subtitle: 'Improve timber preparation by 25%',
      category: 'craft',
      hours: 1100,
      crew: 10,
      cost: {
        timber: 5,
        turf: 44,
        stone: 0.4,
        iron: 1,
      },
      w: 5,
      d: 8,
      description:
        'A sheltered working floor for axes, adzes and timber shaving. The first ' +
        'workshop improves branch removal, cross-cutting and splitting by 25%; further workshops add ' +
        'no production bonus.',
      stages: [
        ['Floor & drainage', 200],
        ['Frame & turf roof', 680],
        ['Benches & tools', 220],
      ],
    },
    charcoal: {
      name: 'Charcoal pit',
      subtitle: 'Prepare fuel for bog-iron smelting',
      category: 'craft',
      hours: 160,
      crew: 6,
      cost: {
        timber: 0.8,
        stone: 0.2,
      },
      w: 4,
      d: 4,
      description:
        'A covered earth pit for slow charcoal burning. Deliver 100–200 kg of firewood here ' +
        'and assign selected workers. Preparation and unloading require labor; burning and ' +
        'cooling take several days. Yield depends on the wood’s moisture.',
      stages: [
        ['Dig & line pit', 64],
        ['Air channels & cover', 64],
        ['First firing', 32],
      ],
    },
    smithy: {
      name: 'Bloomery & smithy',
      subtitle: 'Bog iron → repair nails and fittings',
      category: 'craft',
      hours: 1000,
      crew: 8,
      cost: {
        timber: 3,
        turf: 30,
        stone: 1.2,
        iron: 2,
      },
      w: 5,
      d: 7,
      description:
        'A small sheltered clay bloomery and forging hearth, inspired by furnace hut J. ' +
        'Craft workers gather local bog ore and produce small quantities of usable ' +
        'iron. Requires a charcoal pit and consumes charcoal.',
      stages: [
        ['Prepare clay & stone hearth', 240],
        ['Frame & turf shelter', 440],
        ['Furnace, bellows & anvil', 320],
      ],
    },
    fishing: {
      name: 'Fishing shelter',
      subtitle: 'Improve the catch by 25%',
      category: 'food',
      hours: 320,
      crew: 8,
      cost: {
        timber: 3,
        turf: 8,
        stone: 0.2,
      },
      w: 5,
      d: 7,
      description:
        'A shore shelter for lines, nets, drying poles and catch sorting. The first ' +
        'shelter improves the food gathered by the fishing crew by 25%. It is an ' +
        'inferred Norse facility, not an excavated building at this site.',
      stages: [
        ['Frame & cover', 200],
        ['Nets, poles & racks', 120],
      ],
    },
    smokehouse: {
      name: 'Fish-drying house',
      subtitle: 'Air-dry fish over several cold weeks',
      category: 'food',
      hours: 560,
      crew: 8,
      cost: {
        timber: 4,
        turf: 20,
        stone: 0.5,
      },
      w: 5,
      d: 6,
      description:
        'A ventilated rack house for stockfish. Deliver fresh fish here and assign selected ' +
        'workers to prepare and hang it. Cold, moving air dries it over several weeks; rain ' +
        'delays drying and prolonged warmth can spoil the batch. Workers must take it down.',
      stages: [
        ['Posts & roof', 240],
        ['Turf & drying racks', 240],
        ['Small smoking hearth', 80],
      ],
    },
    byre: {
      name: 'Byre & fold',
      subtitle: 'Winter shelter for all 32 animals',
      category: 'food',
      hours: 2400,
      crew: 16,
      cost: {
        timber: 10,
        turf: 100,
        stone: 1.5,
        iron: 1,
      },
      w: 9,
      d: 13,
      description:
        'A drained cattle byre and small-stock fold. Holds 8 cattle, 12 sheep and 12 ' +
        'goats. A reasonable Norse farm addition for this scenario; livestock buildings ' +
        'have not been identified at L\u2019Anse aux Meadows.',
      stages: [
        ['Drain & lay floor', 480],
        ['Frame & stalls', 720],
        ['Turf envelope', 960],
        ['Mangers & fold', 240],
      ],
    },
    haybarn: {
      name: 'Hay store',
      subtitle: 'Keep winter fodder dry',
      category: 'food',
      hours: 800,
      crew: 10,
      cost: {
        timber: 6,
        turf: 30,
        stone: 0.3,
      },
      w: 6,
      d: 8,
      description:
        'A ventilated timber and turf store. The first store raises dry-hay capacity ' +
        'from 2 to 16 tonnes. At the modeled ration of 100 kg/day for the herd, 12 ' +
        'tonnes cover 120 winter days.',
      stages: [
        ['Raised dry floor', 160],
        ['Posts & roof', 400],
        ['Turf & ventilation', 240],
      ],
    },
  };
  const TASKS = {
    builders: {
      name: 'Construction',
      description: 'Work at the assigned construction site; per-site crew limits apply.',
    },
    fishing: {
      name: 'Fishing',
      description: 'Catch fish, then carry the load back before it enters stores.',
    },
    foraging: {
      name: 'Foraging',
      description: 'Gather edible plants, then carry the load back to stores.',
    },
    timber: {
      name: 'Woodcutting',
      description: 'Fell finite trees, process timber or fuel, then carry loads to storage.',
    },
    turf: {
      name: 'Cut & haul turf',
      description: 'Cut finite turf patches and carry loads to storage.',
    },
    hay: {
      name: 'Haymaking',
      description: 'Mow meadow, leave the grass to dry, then carry dry hay to storage.',
    },
    herding: {
      name: 'Herding & household',
      description: '8 hands needed for livestock, water, cooking and shared camp duties.',
    },
    craft: {
      name: 'Charcoal & iron',
      description: 'Use finished pits and bloomery; fuel and wood limit production.',
    },
  };
  const extra = {
    storehouse: {
      name: 'Dry storehouse',
      category: 'craft',
      hours: 960,
      crew: 10,
      cost: {
        timber: 6,
        turf: 42,
        stone: 0.5,
      },
      w: 7,
      d: 9,
      description:
        'Raised floors, weather-tight doors and a turf roof protect grain, cloth and ' +
        'preserved food. Storage remains at the camp; goods do not teleport between ' +
        'regions.',
      stages: [
        ['Dry foundations', 240],
        ['Frame and envelope', 560],
        ['Shelves and doors', 160],
      ],
    },
    woodshed: {
      name: 'Firewood shelter',
      category: 'craft',
      hours: 240,
      crew: 6,
      cost: {
        timber: 2,
        turf: 5,
      },
      w: 5,
      d: 6,
      description:
        'A ventilated shelter for split firewood. Dry fuel needs less mass to provide ' +
        'the modeled heat demand.',
      stages: [
        ['Posts and drainage', 80],
        ['Roof and stacks', 160],
      ],
    },
    well: {
      name: 'Water collection point',
      category: 'food',
      hours: 200,
      crew: 6,
      cost: {
        timber: 1,
        stone: 0.8,
      },
      w: 4,
      d: 4,
      description:
        'A protected spring collection point with a stone-lined basin. Household crews ' +
        'still collect and carry the water; it is not a piped water system.',
      stages: [
        ['Drain and protect spring', 120],
        ['Basin and buckets', 80],
      ],
    },
    carehut: {
      name: 'Care hut',
      category: 'shelter',
      hours: 1200,
      crew: 10,
      cost: {
        timber: 5,
        turf: 54,
        stone: 0.5,
      },
      shelter: 6,
      winter: 6,
      w: 6,
      d: 8,
      description:
        'Warm, uncrowded accommodation for sick or injured people. Food, water, clean ' +
        'bedding and caregivers determine recovery; the hut alone does not cure ' +
        'illness.',
      stages: [
        ['Floor and drainage', 240],
        ['Frame and roof', 600],
        ['Turf and bedding', 360],
      ],
    },
    garden: {
      name: 'Garden plot',
      category: 'food',
      hours: 160,
      crew: 8,
      cost: {
        timber: 1,
        stone: 0.1,
      },
      w: 12,
      d: 16,
      description:
        'An experimental kitchen garden, not an excavated L\u2019Anse aux Meadows feature. ' +
        'Spring planting uses 2 kg of seed. A cool season limits the autumn vegetable ' +
        'harvest.',
      stages: [
        ['Clear and fence', 96],
        ['Prepare beds', 64],
      ],
    },
    palisade: {
      name: 'Timber enclosure',
      category: 'craft',
      hours: 800,
      crew: 12,
      cost: {
        timber: 9,
        stone: 0.2,
      },
      w: 14,
      d: 14,
      description:
        'A fenced storage enclosure with a gate. Reduces wind damage to local ' +
        'equipment; takes timber and ongoing maintenance. It does not provoke an ' +
        'automatic invasion.',
      stages: [
        ['Post holes', 240],
        ['Hew and set posts', 400],
        ['Gate and bracing', 160],
      ],
    },
    boatyard: {
      name: 'Boat-repair shelter',
      category: 'craft',
      hours: 1600,
      crew: 12,
      cost: {
        timber: 10,
        turf: 24,
        stone: 0.5,
        iron: 2,
      },
      w: 8,
      d: 15,
      description:
        'A sheltered slip and workshop for maintaining the fleet. Individual repairs ' +
        'still require timber, iron and a work crew.',
      stages: [
        ['Prepare slip', 320],
        ['Frame and cover', 960],
        ['Cradles and tools', 320],
      ],
    },
    meeting: {
      name: 'Assembly shelter',
      category: 'shelter',
      hours: 480,
      crew: 8,
      cost: {
        timber: 3,
        turf: 12,
      },
      w: 8,
      d: 8,
      description:
        'A sheltered meeting place. Households decide which proposals they support; the ' +
        'building does not confer a constitution or guaranteed obedience.',
      stages: [
        ['Prepare ground', 120],
        ['Posts and shelter', 240],
        ['Benches', 120],
      ],
    },
  };
  Object.assign(TYPES, extra);
  const FOOD = {
    freshFish: {
      name: 'Fresh fish',
      kcal: 800,
      spoilage: 0.075,
    },
    driedFish: {
      name: 'Dried fish',
      kcal: 3270,
      spoilage: 0.0005,
    },
    meat: {
      name: 'Meat',
      kcal: 1800,
      spoilage: 0.045,
    },
    plants: {
      name: 'Plants',
      kcal: 400,
      spoilage: 0.025,
    },
    grain: {
      name: 'Grain',
      kcal: 3400,
      spoilage: 0.0007,
    },
    dairy: {
      name: 'Dairy',
      kcal: 650,
      spoilage: 0.1,
    },
    fat: {
      name: 'Fat',
      kcal: 8000,
      spoilage: 0.001,
    },
  };
  const PRESETS = {
    karlsefni: {
      name: 'Karlsefni · 1005',
      population: 160,
      ships: 4,
      tents: 10,
      cattle: 8,
      sheep: 12,
      goats: 12,
      month: 8,
      day: 1,
      year: 1005,
      seed: 1601005,
      site: 'meadows',
      supplies: 1,
      children: 0,
      inheritedHall: true,
    },
    traders: {
      name: 'Trading expedition',
      population: 48,
      ships: 2,
      tents: 6,
      cattle: 0,
      sheep: 4,
      goats: 4,
      month: 6,
      day: 1,
      year: 1005,
      seed: 48302,
      site: 'estuary',
      supplies: 1.3,
      children: 0,
      inheritedHall: false,
    },
    households: {
      name: 'Household expedition',
      population: 120,
      ships: 3,
      tents: 12,
      cattle: 6,
      sheep: 10,
      goats: 10,
      month: 5,
      day: 15,
      year: 1005,
      seed: 120550,
      site: 'bay',
      supplies: 1.1,
      children: 0.16,
      inheritedHall: false,
    },
    difficult: {
      name: 'Late landfall',
      population: 80,
      ships: 2,
      tents: 8,
      cattle: 4,
      sheep: 8,
      goats: 8,
      month: 9,
      day: 10,
      year: 1005,
      seed: 80109,
      site: 'meadows',
      supplies: 0.75,
      children: 0,
      inheritedHall: true,
    },
  };
  const REGIONS = [
    {
      id: 'home',
      name: 'Home harbour',
      days: 0,
      kind: 'home',
    },
    {
      id: 'woodland',
      name: 'Inland woodland',
      days: 3,
      kind: 'survey',
    },
    {
      id: 'estuary',
      name: 'Southern estuary',
      days: 6,
      kind: 'survey',
    },
    {
      id: 'labrador',
      name: 'Labrador coast',
      days: 10,
      kind: 'survey',
    },
    {
      id: 'greenland',
      name: 'Greenland',
      days: 17,
      kind: 'trade',
    },
    {
      id: 'iceland',
      name: 'Iceland',
      days: 28,
      kind: 'trade',
    },
  ];
  const RULES = {
    workHours: {
      name: 'Working day',
      choices: [6, 8, 10],
      labels: ['6 hours', '8 hours', '10 hours'],
    },
    ration: {
      name: 'Food distribution',
      choices: ['standard', 'reserve'],
      labels: ['Full ration', 'Reserve ration · 85%'],
    },
    tenure: {
      name: 'Land and work',
      choices: ['compact', 'commons', 'households'],
      labels: ['Expedition compact', 'Negotiated commons', 'Household allotments'],
    },
    watch: {
      name: 'Shore watch',
      choices: ['none', 'light', 'guarded'],
      labels: ['No standing watch', '2-person watch', '6-person watch'],
    },
  };
  const NAMES = [
    'Karlsefni',
    'Guðríðr',
    'Snorri',
    'Þórhallr',
    'Freydís',
    'Bjarni',
    'Helgi',
    'Þóra',
    'Sigríðr',
    'Eiríkr',
    'Ástríðr',
    'Þórsteinn',
    'Ragnhildr',
    'Gunnarr',
    'Ingibjörg',
    'Óláfr',
    'Þórdís',
    'Ketill',
    'Halla',
    'Leifr',
    'Þorgerðr',
    'Skúli',
    'Auðr',
    'Ári',
  ];
  const SOURCES = [
    [
      'Settlement geometry · OpenStreetMap contributors (ODbL)',
      'https://www.openstreetmap.org/copyright',
    ],
    [
      'Measured terrain · NRCan MRDEM-30',
      'https://datacube.services.geo.ca/stac/api/collections/mrdem-30',
    ],
    ['Hall F plan', 'https://canadianmysteries.ca/sites/vinland/archives/map/indexen.html'],
    [
      'Construction estimates · Wallace 2003',
      'https://journals.lib.unb.ca/index.php/NFLDS/article/download/140/237',
    ],
    ['Norse activity in AD 1021', 'https://www.nature.com/articles/s41586-021-03972-8'],
    [
      'Indigenous occupation · Parks Canada',
      'https://parks.canada.ca/lhn-nhs/nl/meadows/culture/sites',
    ],
    [
      'Ocean-going cargo ships · Viking Ship Museum',
      'https://www.vikingeskibsmuseet.dk/en/visit-the-museum/exhibitions/the-five-viking-ships/skuldelev-1/',
    ],
    [
      'Stockfish energy · Norwegian Food Composition Table',
      'https://www.matvaretabellen.no/en/stockfish-dried-fish/',
    ],
  ];
  root.VinlandContent = {
    TYPES,
    TASKS,
    FOOD,
    PRESETS,
    REGIONS,
    RULES,
    NAMES,
    SOURCES,
  };
  if (typeof module !== 'undefined') {
    module.exports = root.VinlandContent;
  }
})(typeof window !== 'undefined' ? window : globalThis);
