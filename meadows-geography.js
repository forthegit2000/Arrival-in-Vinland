/**
 * Offline geographic terrain shared by rendering, walking, and construction.
 * Modern reference: OSM coastline/streams and NRCan's 30 m terrain model.
 * Local metres: +X east, +Z south; (0, 0) is the mapped original Hall F centroid.
 * The 4 m shore-distance grid samples mapped geometry, not a 4 m elevation survey.
 */
(function (root) {
  'use strict';

  const data =
    typeof module !== 'undefined'
      ? require('./assets/terrain/meadows-data.js')
      : root.VinlandMeadowsData;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function sample(grid, x, z) {
    const column = clamp((x - grid.minX) / grid.step, 0, grid.rows[0].length - 1.000001);
    const row = clamp((z - grid.minZ) / grid.step, 0, grid.rows.length - 1.000001);
    const left = Math.floor(column);
    const top = Math.floor(row);
    const fx = column - left;
    const fy = row - top;
    return (
      (grid.rows[top][left] * (1 - fx) + grid.rows[top][left + 1] * fx) * (1 - fy) +
      (grid.rows[top + 1][left] * (1 - fx) + grid.rows[top + 1][left + 1] * fx) * fy
    );
  }

  function closestPoint(x, z, a, b) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const fraction = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return [a[0] + dx * fraction, a[1] + dz * fraction];
  }

  function pointInPolygon(x, z, ring) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const [ax, az] = ring[index];
      const [bx, bz] = ring[previous];
      const crossesRow = az > z !== bz > z;
      if (crossesRow && x < ((bx - ax) * (z - az)) / (bz - az) + ax) {
        inside = !inside;
      }
    }
    return inside;
  }

  function pointBounds(points) {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const [x, z] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return { minX, maxX, minZ, maxZ };
  }

  // Index short segments so agent pathfinding does not scan every stream vertex.
  const FRESHWATER_RANGE = 64;
  const CELL_SIZE = 32;
  const freshwaterPonds = data.ponds.map((ring) => ({ ring, ...pointBounds(ring) }));
  const waterSegments = new Map();
  for (const line of [...data.streams.map((stream) => stream.points), ...data.ponds]) {
    for (let index = 1; index < line.length; index++) {
      const start = line[index - 1],
        end = line[index];
      const deltaX = end[0] - start[0],
        deltaZ = end[1] - start[1];
      const segment = {
        startX: start[0],
        startZ: start[1],
        deltaX,
        deltaZ,
        lengthSquared: deltaX * deltaX + deltaZ * deltaZ || 1,
        ...pointBounds([start, end]),
      };
      const minX = Math.floor((segment.minX - FRESHWATER_RANGE) / CELL_SIZE);
      const maxX = Math.floor((segment.maxX + FRESHWATER_RANGE) / CELL_SIZE);
      const minZ = Math.floor((segment.minZ - FRESHWATER_RANGE) / CELL_SIZE);
      const maxZ = Math.floor((segment.maxZ + FRESHWATER_RANGE) / CELL_SIZE);
      for (let row = minZ; row <= maxZ; row++) {
        for (let column = minX; column <= maxX; column++) {
          const key = `${column},${row}`;
          if (!waterSegments.has(key)) {
            waterSegments.set(key, []);
          }
          waterSegments.get(key).push(segment);
        }
      }
    }
  }

  function freshwaterDistance(x, z) {
    // Most queries are outside every pond. Test their precomputed bounds
    // before walking the polygon, keeping the same exact inside/outside rule.
    for (const pond of freshwaterPonds) {
      if (x < pond.minX || x > pond.maxX || z < pond.minZ || z > pond.maxZ) continue;
      if (pointInPolygon(x, z, pond.ring)) return -1;
    }
    let distanceSquared = FRESHWATER_RANGE * FRESHWATER_RANGE;
    const segments = waterSegments.get(`${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`);
    if (segments) {
      for (const segment of segments) {
        // A segment cannot be closer than its bounding box. Skip it when
        // that lower bound already exceeds the best exact distance found.
        const boxDistanceX = Math.max(segment.minX - x, 0, x - segment.maxX);
        const boxDistanceZ = Math.max(segment.minZ - z, 0, z - segment.maxZ);
        if (boxDistanceX * boxDistanceX + boxDistanceZ * boxDistanceZ >= distanceSquared) continue;
        const fraction = clamp(
          ((x - segment.startX) * segment.deltaX + (z - segment.startZ) * segment.deltaZ) /
            segment.lengthSquared,
          0,
          1,
        );
        const dx = x - (segment.startX + segment.deltaX * fraction);
        const dz = z - (segment.startZ + segment.deltaZ * fraction);
        distanceSquared = Math.min(distanceSquared, dx * dx + dz * dz);
      }
    }
    // Stream width is a modest visual/gameplay estimate; OSM supplies centrelines.
    return Math.sqrt(distanceSquared) - 1.2;
  }

  function shoreDistance(x, z) {
    return sample(data.shore, x, z);
  }

  function waterDistance(x, z) {
    return Math.min(shoreDistance(x, z), freshwaterDistance(x, z));
  }

  function referenceElevation(x, z) {
    const distance = shoreDistance(x, z);
    if (distance < 0) {
      // No measured bathymetry is supplied. This shallow underwater apron is modeled.
      return -0.15 - Math.min(4, -distance * 0.06);
    }
    // Preserve the source relief without exaggeration. Taper mixed coastal DEM
    // pixels to the mapped sea edge rather than letting a 30 m pixel move the shore.
    return Math.max(0.15, sample(data.heights, x, z)) * clamp(distance / 6, 0, 1);
  }

  // OSM supplies outlines/centrelines, not water levels or surveyed bathymetry.
  // Infer conservative levels from the DEM and model shallow beds and banks.
  const BANK_WIDTH = 4;
  const STREAM_HALF_WIDTH = 1.2;
  const smooth = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const pondProfiles = freshwaterPonds.map((pond, index) => ({
    ...pond,
    index,
    level: Math.min(...pond.ring.map(([x, z]) => referenceElevation(x, z))),
  }));
  const streamProfiles = data.streams.map((stream) => {
    const points = stream.points.map((point) => [...point]);
    const last = points.at(-1),
      previous = points.at(-2);
    // Some mapped ways end a few metres above the sampled sea edge. Continue
    // their terminal direction only to meet that edge, never across inland land.
    if (shoreDistance(...last) >= 0 && shoreDistance(...last) < 8) {
      const length = Math.hypot(last[0] - previous[0], last[1] - previous[1]) || 1;
      for (let distance = 1; distance <= 12; distance++) {
        const end = [
          last[0] + ((last[0] - previous[0]) / length) * distance,
          last[1] + ((last[1] - previous[1]) / length) * distance,
        ];
        if (shoreDistance(...end) < -1) {
          points.push(end);
          break;
        }
      }
    }
    return { name: stream.name, points };
  });
  const levels = new Map();
  const nodeKey = ([x, z]) => x.toFixed(6) + ',' + z.toFixed(6);
  for (const stream of streamProfiles)
    for (const point of stream.points) {
      const pond = pondProfiles.find((entry) => pointInPolygon(...point, entry.ring));
      levels.set(
        nodeKey(point),
        pond?.level ?? Math.max(0.02, referenceElevation(...point) - 0.04),
      );
    }
  // Ways run from their higher source towards their outlet. Shared nodes keep
  // junctions watertight; the running minimum removes uphill DEM noise.
  for (let pass = 0; pass < streamProfiles.length + 1; pass++) {
    for (const stream of streamProfiles) {
      let level = Infinity;
      for (const point of stream.points) {
        level = Math.min(level, levels.get(nodeKey(point)));
        levels.set(nodeKey(point), level);
      }
    }
  }
  const profileIndex = new Map();
  function indexProfile(segment) {
    for (
      let row = Math.floor((segment.minZ - 7) / CELL_SIZE);
      row <= Math.floor((segment.maxZ + 7) / CELL_SIZE);
      row++
    )
      for (
        let column = Math.floor((segment.minX - 7) / CELL_SIZE);
        column <= Math.floor((segment.maxX + 7) / CELL_SIZE);
        column++
      ) {
        const key = column + ',' + row;
        if (!profileIndex.has(key)) profileIndex.set(key, []);
        profileIndex.get(key).push(segment);
      }
  }
  const allProfiles = [
    ...streamProfiles.map((stream) => ({ points: stream.points, kind: 'stream' })),
    ...pondProfiles.map((pond) => ({ points: pond.ring, kind: 'pond', pond })),
  ];
  for (const profile of allProfiles)
    for (let index = 1; index < profile.points.length; index++) {
      const a = profile.points[index - 1],
        b = profile.points[index];
      indexProfile({
        ...pointBounds([a, b]),
        a,
        b,
        kind: profile.kind,
        pond: profile.pond,
        levelA: profile.pond?.level ?? levels.get(nodeKey(a)),
        levelB: profile.pond?.level ?? levels.get(nodeKey(b)),
      });
    }

  function freshwaterAt(x, z) {
    let insidePond = null;
    for (const pond of pondProfiles) {
      if (
        x >= pond.minX &&
        x <= pond.maxX &&
        z >= pond.minZ &&
        z <= pond.maxZ &&
        pointInPolygon(x, z, pond.ring)
      ) {
        insidePond = pond;
        break;
      }
    }
    let nearest = null,
      best = insidePond ? Infinity : 7;
    const candidates =
      profileIndex.get(Math.floor(x / CELL_SIZE) + ',' + Math.floor(z / CELL_SIZE)) || [];
    for (const segment of candidates) {
      if (insidePond && segment.pond !== insidePond) continue;
      if (
        x < segment.minX - best ||
        x > segment.maxX + best ||
        z < segment.minZ - best ||
        z > segment.maxZ + best
      )
        continue;
      const point = closestPoint(x, z, segment.a, segment.b);
      const distance = Math.hypot(x - point[0], z - point[1]);
      if (distance >= best) continue;
      best = distance;
      nearest = { segment, point };
    }
    if (!nearest && !insidePond) return null;
    const segment = nearest?.segment;
    const kind = insidePond ? 'pond' : segment.kind;
    const distance = insidePond
      ? -Math.min(best, 64)
      : best - (kind === 'stream' ? STREAM_HALF_WIDTH : 0);
    if (distance > BANK_WIDTH) return null;
    const length = segment
      ? Math.hypot(segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]) || 1
      : 1;
    const fraction = segment
      ? Math.hypot(nearest.point[0] - segment.a[0], nearest.point[1] - segment.a[1]) / length
      : 0;
    const surface =
      insidePond?.level ?? segment.levelA + (segment.levelB - segment.levelA) * fraction;
    const depth =
      distance < 0
        ? kind === 'stream'
          ? 0.48 * smooth(-distance / STREAM_HALF_WIDTH)
          : 1.4 * smooth(-distance / 8)
        : 0;
    const raw = referenceElevation(x, z);
    const bed =
      distance < 0 ? surface - depth : surface + (raw - surface) * smooth(distance / BANK_WIDTH);
    return {
      kind,
      distance,
      surface,
      depth,
      bed,
      flowX: kind === 'stream' ? (segment.b[0] - segment.a[0]) / length : 0,
      flowZ: kind === 'stream' ? (segment.b[1] - segment.a[1]) / length : 0,
    };
  }

  function elevation(x, z) {
    const raw = referenceElevation(x, z);
    if (shoreDistance(x, z) < 0) return raw;
    return freshwaterAt(x, z)?.bed ?? raw;
  }

  function toGeographic(x, z) {
    return [
      data.frame.origin[0] + x / data.frame.eastScale,
      data.frame.origin[1] - z / data.frame.northScale,
    ];
  }

  function toLocal([longitude, latitude]) {
    return [
      (longitude - data.frame.origin[0]) * data.frame.eastScale,
      (data.frame.origin[1] - latitude) * data.frame.northScale,
    ];
  }

  function coastAtZ(z) {
    // Compatibility for cosmetic shore placements. Physics uses signed distance,
    // since a real bay cannot be represented by one x coordinate for each row.
    const crossings = [];
    for (const line of data.coast) {
      for (let index = 1; index < line.length; index++) {
        const a = line[index - 1];
        const b = line[index];
        if (a[1] > z !== b[1] > z)
          crossings.push(a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]));
      }
    }
    return crossings.sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? -600;
  }

  let closestShore = [0, 0];
  let shoreRange = Infinity;
  for (const line of data.coast) {
    for (let index = 1; index < line.length; index++) {
      const point = closestPoint(0, 0, line[index - 1], line[index]);
      const range = Math.hypot(...point);
      if (range < shoreRange) {
        closestShore = point;
        shoreRange = range;
      }
    }
  }
  const inlandNormal = [
    shoreDistance(closestShore[0] + 1, closestShore[1]) -
      shoreDistance(closestShore[0] - 1, closestShore[1]),
    shoreDistance(closestShore[0], closestShore[1] + 1) -
      shoreDistance(closestShore[0], closestShore[1] - 1),
  ];
  const length = Math.hypot(...inlandNormal);
  inlandNormal[0] /= length;
  inlandNormal[1] /= length;
  const landing = closestShore.map((value, axis) => value + inlandNormal[axis] * 14);

  function anchorage(index) {
    const along = (index - 1.5) * 24;
    const point = [
      closestShore[0] - inlandNormal[0] * 35 - inlandNormal[1] * along,
      closestShore[1] - inlandNormal[1] * 35 + inlandNormal[0] * along,
    ];
    for (let step = 0; step < 12 && shoreDistance(...point) > -8; step++) {
      point[0] -= inlandNormal[0] * 8;
      point[1] -= inlandNormal[1] * 8;
    }
    return point;
  }

  // The sampled square is also the rendered map tile and camera navigation range.
  const bounds = {
    minX: data.heights.minX,
    minZ: data.heights.minZ,
    width: (data.heights.rows[0].length - 1) * data.heights.step,
    depth: (data.heights.rows.length - 1) * data.heights.step,
  };

  function containsPoint(x, z) {
    return (
      Number.isFinite(x) &&
      Number.isFinite(z) &&
      x >= bounds.minX &&
      x <= bounds.minX + bounds.width &&
      z >= bounds.minZ &&
      z <= bounds.minZ + bounds.depth
    );
  }

  const geography = {
    bounds,
    containsPoint,
    data,
    sample,
    toLocal,
    toGeographic,
    elevation,
    referenceElevation,
    freshwaterAt,
    streamProfiles,
    pondProfiles,
    shoreDistance,
    waterDistance,
    freshwaterDistance,
    coastAtZ,
    landing,
    anchorage,
    hallRotation: data.hallRotation,
  };
  if (typeof module !== 'undefined') {
    module.exports = geography;
  } else {
    root.VinlandMeadows = geography;
  }
})(typeof window !== 'undefined' ? window : globalThis);
