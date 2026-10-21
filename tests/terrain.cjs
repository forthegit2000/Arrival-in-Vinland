const { stockBuildingMaterials } = require('./work-fixtures.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Meadows = require('../meadows-geography.js');
const { Simulation, elevation, landDistance } = require('../simulation.js');

test('generated terrain identifies the checked-in geometry and original elevation samples', () => {
  const reference = fs.readFileSync(
    path.join(__dirname, '../assets/terrain/meadows-reference.geojson'),
  );
  const dem = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../assets/terrain/meadows-elevation-window.json'),
      'utf8',
    ),
  );
  const hash = (input) => crypto.createHash('sha256').update(input).digest('hex');
  assert.equal(Meadows.data.source.geometryInputSha256, hash(reference));
  assert.equal(Meadows.data.source.elevationSampleSha256, hash(JSON.stringify(dem.values)));
  assert.equal(dem.epsg, 3979);
  assert.deepEqual(dem.resolution.slice(0, 2), [30, -30]);
});

test('the terrain origin is the original mapped Hall F, with geographic metre coordinates', () => {
  const [longitude, latitude] = Meadows.toGeographic(0, 0);
  assert.ok(longitude > -55.533 && longitude < -55.5326);
  assert.ok(latitude > 51.5955 && latitude < 51.5959);
  for (const [x, z] of [
    [0, 0],
    [100, -75],
    [-350, 220],
  ]) {
    const recovered = Meadows.toLocal(Meadows.toGeographic(x, z));
    assert.ok(Math.hypot(recovered[0] - x, recovered[1] - z) < 0.00001);
  }
  assert.ok(Meadows.toGeographic(100, 0)[0] > longitude);
  assert.ok(Meadows.toGeographic(0, 100)[1] < latitude);
  assert.ok(Meadows.hallRotation < -0.35 && Meadows.hallRotation > -0.5);
});

test('terrain heights preserve the measured 30 m source without vertical exaggeration', () => {
  assert.equal(Meadows.data.source.elevationResolutionMetres, 30);
  assert.ok(Math.abs(Meadows.elevation(0, 0) - 4.47) < 0.02);
  for (const row of Meadows.data.heights.rows) {
    assert.ok(row.every((value) => Number.isFinite(value) && value > -100 && value < 200));
  }
  const simulation = new Simulation();
  assert.equal(elevation(0, 0, simulation.state.config), Meadows.elevation(0, 0));
});

test('the sampled shoreline follows mapped geometry to within its 4 m grid spacing', () => {
  let checked = 0;
  for (const line of Meadows.data.coast) {
    for (const [x, z] of line) {
      if (Math.abs(x) > 1076 || Math.abs(z) > 1076) continue;
      assert.ok(Math.abs(Meadows.shoreDistance(x, z)) <= Meadows.data.shore.step + 0.1);
      checked++;
    }
  }
  assert.ok(checked > 50);
  assert.ok(Meadows.shoreDistance(0, 0) > 60);
  assert.ok(Meadows.shoreDistance(-100, 0) < -15);
});

test('the landing is on land, and every arrival knarr anchors offshore', () => {
  assert.ok(Meadows.waterDistance(...Meadows.landing) > 3);
  for (let index = 0; index < 4; index++) {
    assert.ok(Meadows.shoreDistance(...Meadows.anchorage(index)) <= -8);
  }
});

test('land and sea meet only at the mapped coastline, without triangular mask seams', () => {
  const { rows, step } = Meadows.data.shore;
  // A signed distance cannot jump farther than the spacing between samples.
  // Nearest-segment side tests broke this at coastal bends and split OSM ways.
  const maximumChange = step + 0.2;
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < rows[row].length; column++) {
      const value = rows[row][column];
      if (column > 0) {
        assert.ok(Math.abs(value - rows[row][column - 1]) <= maximumChange);
      }
      if (row > 0) {
        assert.ok(Math.abs(value - rows[row - 1][column]) <= maximumChange);
      }
    }
  }
});

test('construction uses the same real sea and freshwater geometry as the renderer', () => {
  const simulation = new Simulation();
  assert.equal(simulation.canPlace('sailbudir', -100, 0), false);
  assert.equal(simulation.canPlace('sailbudir', 45, 45), true);
  const brook = Meadows.data.streams.find((stream) => stream.name === 'Black Duck Brook');
  assert.ok(brook);
  const banks = Meadows.data.streams
    .flatMap((stream) => stream.points)
    .filter(([x, z]) => Math.hypot(x, z) < 104 && Meadows.shoreDistance(x, z) > 5);
  assert.ok(banks.length > 0);
  for (const [x, z] of banks) {
    assert.ok(landDistance(x, z, simulation.state.config) < 0);
    assert.equal(simulation.canPlace('turfhouse', x, z), false);
  }
});

test('the expanded tile has measured height coverage through every edge and corner', () => {
  assert.deepEqual(Meadows.bounds, { minX: -1080, minZ: -1080, width: 2160, depth: 2160 });
  assert.equal(Meadows.data.heights.rows.length, 109);
  assert.equal(Meadows.data.shore.rows.length, 541);
  for (let x = -1080; x <= 1080; x += 120) {
    for (let z = -1080; z <= 1080; z += 120) {
      const height = Meadows.sample(Meadows.data.heights, x, z);
      assert.ok(Number.isFinite(height) && height > -100 && height < 200);
      assert.ok(Number.isFinite(Meadows.shoreDistance(x, z)));
    }
  }
});

test('worker orders and drop-off points in the added terrain survive saving and loading', () => {
  const simulation = new Simulation();
  assert.equal(simulation.commandWorkers([1], { type: 'move', x: 960, z: 960 }), 1);
  simulation.state.timberDropoff = { x: 960, z: 960, label: 'Outer woodland' };
  const loaded = Simulation.load(simulation.serialize());
  assert.ok(loaded);
  assert.equal(loaded.state.people[1].order.x, 960);
  assert.equal(loaded.state.timberDropoff.z, 960);
  assert.equal(simulation.commandWorkers([1], { type: 'move', x: 1081, z: 960 }), 0);
  const outside = JSON.parse(simulation.serialize());
  outside.timberDropoff.x = 1081;
  assert.equal(Simulation.load(JSON.stringify(outside)), null);
});

test('construction and saved orders preserve a freely chosen building angle', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  const angle = 0.37;
  assert.equal(simulation.canPlace('sailbudir', 45, 45, angle), true);
  const order = simulation.order('sailbudir', 45, 45, angle);
  assert.ok(order);
  assert.equal(order.rotation, angle);
  const loaded = Simulation.load(simulation.serialize());
  assert.equal(loaded.state.queue.find((entry) => entry.id === order.id).rotation, angle);
});

// Deliberately scan every original edge: this independent reference has no
// spatial index, bounding-box pruning or precomputed segment coefficients.
function referenceFreshwaterDistance(x, z) {
  for (const ring of Meadows.data.ponds) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const [ax, az] = ring[index],
        [bx, bz] = ring[previous];
      if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    }
    if (inside) return -1;
  }
  let nearest = 64;
  for (const line of [
    ...Meadows.data.streams.map((stream) => stream.points),
    ...Meadows.data.ponds,
  ]) {
    for (let index = 1; index < line.length; index++) {
      const [ax, az] = line[index - 1],
        [bx, bz] = line[index];
      const dx = bx - ax,
        dz = bz - az;
      const fraction = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
      );
      nearest = Math.min(nearest, Math.hypot(x - (ax + fraction * dx), z - (az + fraction * dz)));
    }
  }
  return nearest - 1.2;
}

function checkFreshwaterPoint(x, z) {
  const expected = referenceFreshwaterDistance(x, z);
  const actual = Meadows.freshwaterDistance(x, z);
  assert.ok(
    Math.abs(actual - expected) <= 1e-10,
    `freshwater distance at ${x}, ${z}: ${actual} vs ${expected}`,
  );
  assert.ok(
    Math.abs(Meadows.waterDistance(x, z) - Math.min(Meadows.shoreDistance(x, z), expected)) <=
      1e-10,
  );
  return actual;
}

test('exact freshwater distances match a full geometry scan across the tile and spatial-index seams', () => {
  const { minX, minZ, width, depth } = Meadows.bounds;
  let seed = 72961;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < 12000; index++)
    checkFreshwaterPoint(minX + random() * width, minZ + random() * depth);
  // Include both sides of positive and negative index-cell boundaries.
  for (let x = -1056; x <= 1056; x += 32) {
    for (const epsilon of [-1e-8, 0, 1e-8]) {
      checkFreshwaterPoint(x + epsilon, 17.25);
      checkFreshwaterPoint(-61.5, x + epsilon);
    }
  }
  for (const [x, z] of [
    [minX, minZ],
    [minX + width, minZ + depth],
    [minX - 128, minZ - 128],
    [minX + width + 128, minZ + depth + 128],
  ])
    checkFreshwaterPoint(x, z);
});

test('pond interiors, vertices and shore-adjacent freshwater preserve their exact boundaries', () => {
  let interiors = 0,
    capped = 0;
  for (const ring of Meadows.data.ponds) {
    const centre = ring.reduce(
      (point, [x, z]) => [point[0] + x / ring.length, point[1] + z / ring.length],
      [0, 0],
    );
    if (checkFreshwaterPoint(...centre) === -1) interiors++;
    for (const [x, z] of ring)
      for (const delta of [-1e-8, 0, 1e-8]) checkFreshwaterPoint(x + delta, z + delta);
  }
  for (let x = -1000; x <= 1000; x += 100) if (checkFreshwaterPoint(x, -1000) === 62.8) capped++;
  assert.ok(interiors > 0, 'interior queries retain the -1 metre result');
  assert.ok(capped > 0, 'distant queries retain the existing 64 metre search cap');
});

test('stream offsets preserve clearance decisions for walking and placement', () => {
  for (const stream of Meadows.data.streams) {
    for (let index = 1; index < stream.points.length; index++) {
      const [ax, az] = stream.points[index - 1],
        [bx, bz] = stream.points[index];
      const length = Math.hypot(bx - ax, bz - az);
      if (!length) continue;
      const x = (ax + bx) / 2,
        z = (az + bz) / 2;
      for (const offset of [0, 0.8, 1.2, 1.55, 2, 2.2, 5, 64]) {
        for (const side of [-1, 1]) {
          const px = x - ((bz - az) / length) * offset * side,
            pz = z + ((bx - ax) / length) * offset * side;
          const actual = checkFreshwaterPoint(px, pz),
            expected = referenceFreshwaterDistance(px, pz);
          for (const threshold of [0, 0.35, 0.8, 3]) {
            // Exact threshold ties can round by a few ULPs; test the land/water
            // classification everywhere else and distance precision at ties.
            if (Math.abs(expected - threshold) > 1e-10)
              assert.equal(actual < threshold, expected < threshold);
          }
        }
      }
    }
  }
});

test('freshwater levels, beds and bank transitions share one modeled profile', () => {
  let channels = 0;
  for (const stream of Meadows.streamProfiles) {
    for (let index = 1; index < stream.points.length; index++) {
      const a = stream.points[index - 1],
        b = stream.points[index];
      const x = (a[0] + b[0]) / 2,
        z = (a[1] + b[1]) / 2;
      if (!Meadows.containsPoint(x, z) || Meadows.shoreDistance(x, z) < 2) continue;
      const sample = Meadows.freshwaterAt(x, z);
      assert.ok(sample && sample.distance < 0);
      assert.ok(sample.surface > sample.bed);
      assert.ok(Math.abs(Meadows.elevation(x, z) - sample.bed) < 1e-8);
      assert.ok(sample.depth > 0 && sample.depth <= 1.4);
      channels++;
    }
  }
  assert.ok(channels > 200);
  for (const pond of Meadows.pondProfiles) {
    for (let i = 1; i < pond.ring.length; i++) {
      const a = pond.ring[i - 1],
        b = pond.ring[i];
      const edge = Meadows.freshwaterAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      assert.ok(edge);
      assert.ok(Number.isFinite(edge.bed) && Number.isFinite(pond.level));
    }
  }
  for (const point of [
    [0, 0],
    [45, 45],
    [100, -75],
  ]) {
    assert.equal(Meadows.freshwaterAt(...point), null);
    assert.equal(Meadows.elevation(...point), Meadows.referenceElevation(...point));
  }
});

test('modeled stream mouths meet the sampled sea without altering source coordinates', () => {
  let mouths = 0;
  for (let i = 0; i < Meadows.data.streams.length; i++) {
    const original = Meadows.data.streams[i].points;
    const modeled = Meadows.streamProfiles[i].points;
    assert.deepEqual(modeled.slice(0, original.length), original);
    const last = modeled.at(-1);
    if (modeled.length > original.length) {
      assert.ok(Meadows.shoreDistance(...last) < 0);
      assert.ok(Math.hypot(last[0] - original.at(-1)[0], last[1] - original.at(-1)[1]) <= 12.001);
      assert.ok(Math.abs(Meadows.freshwaterAt(...last).surface - 0.02) < 1e-8);
      mouths++;
    }
  }
  assert.ok(mouths > 0);
});
