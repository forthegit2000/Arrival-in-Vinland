const { test } = require('node:test');
const assert = require('node:assert/strict');
const Doors = require('../doors.js');
const Spaces = require('../building-spaces.js');
const Collision = require('../collision.js');
const { Simulation } = require('../simulation.js');
test('doors default closed, retain explicit state and reject malformed saves', () => {
  const sim = new Simulation();
  assert.equal(Doors.isOpen(sim.state, 'hall:I:east'), false);
  sim.state.doors['hall:I:east'] = true;
  assert.equal(Simulation.load(sim.serialize()).state.doors['hall:I:east'], true);
  const old = JSON.parse(sim.serialize());
  delete old.doors;
  assert.deepEqual(Simulation.load(JSON.stringify(old)).state.doors, {});
  old.doors = { 'hall:I:east': 'open' };
  assert.equal(Simulation.load(JSON.stringify(old)), null);
});
test('Hall F has one leaf per shared passage and the open boat shed has none', () => {
  const doors = Doors.definitions(new Simulation().state);
  assert.equal(new Set(doors.map((d) => d.id)).size, doors.length);
  assert.equal(doors.length, 8);
  assert.ok(doors.some((d) => d.spaceIds.includes('hall:I') && d.spaceIds.includes('hall:IV')));
  assert.ok(!doors.some((d) => d.spaceIds.includes('hall:VI')));
});
test('rotated building doors block the opening when closed and clear its centre when open', () => {
  const sim = new Simulation();
  for (const rotation of [0, 0.37, Math.PI / 2, 2.7]) {
    sim.state.buildings = [{ id: 1, type: 'turfhouse', x: 70, z: 60, rotation, condition: 100 }];
    const door = Doors.definitions(sim.state).find((d) => d.id === 'building:1');
    assert.equal(Collision.circleIntersects(door.x, door.z, 0.34, Doors.leaf(door, false)), true);
    assert.equal(Collision.circleIntersects(door.x, door.z, 0.34, Doors.leaf(door, true)), false);
    const entrance = Spaces.toWorld(sim.state.buildings[0], Spaces.plan('turfhouse').entrance);
    assert.deepEqual({ x: door.x, z: door.z }, entrance);
  }
});
