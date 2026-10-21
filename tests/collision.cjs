const { test } = require('node:test');
const assert = require('node:assert/strict');
const { circleIntersects, SpatialIndex } = require('../collision.js');

test('circle collisions follow the actual rotated footprint, including rounded corner clearance', () => {
  const building = { x: 12, z: -8, w: 4, d: 12, rotation: Math.PI / 4 };
  const worldPoint = (x, z) => ({
    x: building.x + Math.cos(building.rotation) * x + Math.sin(building.rotation) * z,
    z: building.z - Math.sin(building.rotation) * x + Math.cos(building.rotation) * z,
  });
  for (const [x, z, expected] of [
    [0, 0, true],
    [2.2, 0, true],
    [2.5, 0, false],
    [2.25, 6.25, false],
    [0, 6.2, true],
  ]) {
    const point = worldPoint(x, z);
    assert.equal(circleIntersects(point.x, point.z, 0.34, building), expected);
  }
});

test('spatial lookup crosses cell boundaries and removes old positions when actors move', () => {
  const index = new SpatialIndex(4);
  index.set('walker', { x: 3.9, z: 0, radius: 0.34 });
  assert.equal(index.blocked(4.3, 0, 0.34), true);
  assert.equal(index.blocked(3.9, 0, 0.34, 'walker'), false);
  index.set('walker', { x: -20, z: -20, radius: 0.34 });
  assert.equal(index.blocked(4.3, 0, 0.34), false);
  assert.equal(index.blocked(-20, -20, 0.34), true);
  index.remove('walker');
  assert.equal(index.cells.size, 0);
});

test('indexed rotated buildings agree with direct geometry at every nearby sample', () => {
  const index = new SpatialIndex();
  const building = { x: -5, z: 7, w: 4, d: 14, rotation: 0.63 };
  index.set('building', building);
  for (let x = -16; x <= 6; x += 0.5) {
    for (let z = -4; z <= 18; z += 0.5) {
      assert.equal(index.blocked(x, z, 0.34), circleIntersects(x, z, 0.34, building));
    }
  }
});
