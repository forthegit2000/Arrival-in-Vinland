/** Shared, metre-based building plans. Rendering and collision use the same walls. */
(function (root) {
  'use strict';
  const Content = typeof module !== 'undefined' ? require('./content.js') : root.VinlandContent;
  const HALL_ROOMS = [
    {
      n: 'I',
      name: 'Private chamber',
      x: 0,
      z: -9,
      w: 4.5,
      d: 4.2,
      kind: 'living',
    },
    {
      n: 'II',
      name: 'Main skáli',
      x: 0,
      z: -1.5,
      w: 4.8,
      d: 8,
      kind: 'living',
    },
    {
      n: 'III',
      name: 'South skáli',
      x: 0,
      z: 7,
      w: 4.7,
      d: 5.8,
      kind: 'living',
    },
    {
      n: 'IV',
      name: 'Kitchen',
      x: -5.1,
      z: -9,
      w: 3.7,
      d: 4.1,
      kind: 'kitchen',
    },
    {
      n: 'V',
      name: 'Large storeroom',
      x: -5.1,
      z: -1.1,
      w: 3.5,
      d: 8.4,
      kind: 'storage',
    },
    {
      n: 'VII',
      name: 'South storeroom',
      x: -4.7,
      z: 7,
      w: 2.4,
      d: 5.8,
      kind: 'storage',
    },
    {
      n: 'VI',
      name: 'Boat-repair shed',
      x: 5.4,
      z: 1,
      w: 3.8,
      d: 9,
      kind: 'shed',
    },
  ];
  const OPEN_TYPES = new Set(['restore', 'garden', 'palisade', 'well', 'charcoal']);

  function toWorld(building, point) {
    const cosine = Math.cos(building.rotation || 0),
      sine = Math.sin(building.rotation || 0);
    return {
      x: building.x + cosine * point.x + sine * point.z,
      z: building.z - sine * point.x + cosine * point.z,
    };
  }
  function toLocal(building, point) {
    const cosine = Math.cos(building.rotation || 0),
      sine = Math.sin(building.rotation || 0);
    const x = point.x - building.x,
      z = point.z - building.z;
    return { x: cosine * x - sine * z, z: sine * x + cosine * z };
  }
  function plan(type) {
    if (OPEN_TYPES.has(type) || !Content.TYPES[type]) return null;
    const { w, d } = Content.TYPES[type];
    const temporary = ['sailbudir', 'tentbudir'].includes(type);
    const thickness = temporary ? 0.65 : 0.9;
    const height = temporary ? 0.96 : 2.3;
    const doorWidth = 1.8;
    const frontWidth = (w - doorWidth) / 2;
    const walls = [
      { x: -w / 2, z: 0, w: thickness, d: d + thickness, h: height },
      { x: w / 2, z: 0, w: thickness, d: d + thickness, h: height },
      { x: 0, z: -d / 2, w, d: thickness, h: height },
      { x: -(w + doorWidth) / 4, z: d / 2, w: frontWidth, d: thickness, h: height },
      { x: (w + doorWidth) / 4, z: d / 2, w: frontWidth, d: thickness, h: height },
    ];
    const furniture = [];
    if (['longhouse', 'turfhouse', 'carehut'].includes(type)) {
      for (const side of [-1, 1])
        furniture.push({
          x: side * (w / 2 - 0.95),
          z: 0,
          w: 1.2,
          d: d - 2,
          h: 0.65,
          kind: 'platform',
        });
    } else if (type === 'byre') {
      for (const side of [-1, 1])
        furniture.push({
          x: side * (w / 2 - 1.3),
          z: -0.5,
          w: 1.7,
          d: d - 3,
          h: 0.8,
          kind: 'stall',
        });
    } else if (['woodshed', 'storehouse', 'haybarn'].includes(type)) {
      for (const side of [-1, 1])
        furniture.push({
          x: side * (w / 2 - 1.1),
          z: -d / 4,
          w: 1.2,
          d: d / 2,
          h: 1.1,
          kind: type === 'haybarn' ? 'hay' : 'stores',
        });
    } else if (type === 'boatyard') {
      furniture.push({ x: 0, z: -d / 5, w: 2, d: 6.5, h: 1.1, kind: 'boat' });
    } else if (!temporary) {
      furniture.push({
        x: -w / 2 + 1.1,
        z: -d / 5,
        w: 1.2,
        d: d / 2,
        h: 0.9,
        kind: type === 'smithy' ? 'forge' : 'bench',
      });
    }
    const stations = [
      { x: 0.65, z: d / 2 - thickness - 1 },
      { x: -0.65, z: d / 2 - thickness - 1 },
      { x: 0.65, z: 0 },
      { x: -0.65, z: -d / 4 },
    ];
    if (['longhouse', 'turfhouse', 'carehut'].includes(type))
      furniture.push({ x: 0, z: 0, w: 0.9, d: 1.4, h: 0.18, kind: 'hearth' });
    const berths = [];
    const capacity = Content.TYPES[type].shelter || 0;
    for (
      let z = -d / 2 + thickness + 0.45;
      z <= d / 2 - thickness - 0.45 && berths.length < capacity;
      z += 0.72
    ) {
      for (const x of [-0.95, 0.95]) {
        if (berths.length < capacity) berths.push({ x, z });
      }
    }
    return {
      w,
      d,
      thickness,
      height,
      doorWidth,
      walls,
      furniture,
      navigation: furniture.some((item) => item.kind === 'hearth')
        ? [-1, 1].flatMap((side) => [
            { x: side * 0.95, z: 1.2 },
            { x: side * 0.95, z: -1.2 },
            { x: 0, z: side * 1.2 },
          ])
        : [],
      stations,
      berths,
      entrance: { x: 0, z: d / 2 },
      inside: { x: 0, z: d / 2 - thickness - 0.6 },
      outside: { x: 0, z: d / 2 + thickness / 2 + 0.5 },
    };
  }
  function contains(building, point, margin = 0) {
    const layout = building.plan || plan(building.type);
    if (!layout) return false;
    const local = toLocal(building, point);
    return Math.abs(local.x) < layout.w / 2 - margin && Math.abs(local.z) < layout.d / 2 - margin;
  }
  function obstacle(building, local) {
    return { ...local, ...toWorld(building, local), rotation: building.rotation || 0 };
  }
  const api = { HALL_ROOMS, plan, toWorld, toLocal, contains, obstacle };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandBuildingSpaces = api;
})(typeof window !== 'undefined' ? window : globalThis);
