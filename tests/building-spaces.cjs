const { test } = require('node:test');
const assert = require('node:assert/strict');
const Spaces = require('../building-spaces.js');
const { circleIntersects } = require('../collision.js');
const { Simulation, TYPES } = require('../simulation.js');
const { navigation, provision } = require('./work-fixtures.cjs');

test('legacy hearth switches migrate to unfuelled hearths and malformed switches are rejected', () => {
  const simulation = new Simulation();
  simulation.state.hallHearths = { I: false, IV: true };
  const loaded = Simulation.load(simulation.serialize());
  assert.equal(loaded.state.hallHearths, undefined);
  assert.deepEqual(loaded.state.hearths.fires, {});
  assert.equal(loaded.state.resources.firewood, simulation.state.resources.firewood);
  for (const value of [null, [], 'lit', { I: 1 }, { V: true }]) {
    const state = JSON.parse(simulation.serialize());
    state.hallHearths = value;
    assert.equal(Simulation.load(JSON.stringify(state)), null);
  }
  const state = JSON.parse(simulation.serialize());
  state.buildings.push({ hearthLit: 'yes' });
  assert.equal(Simulation.load(JSON.stringify(state)), null);
});

test('shared walls have usable doorways at every tested rotation, while side walls stay solid', () => {
  for (const type of Object.keys(TYPES)) {
    const plan = Spaces.plan(type);
    if (!plan) continue;
    for (let angle = 0; angle < Math.PI * 2; angle += 0.17) {
      const building = { type, x: 40, z: 50, rotation: angle };
      const shapes = plan.walls.map((wall) => Spaces.obstacle(building, wall));
      const door = Spaces.toWorld(building, plan.entrance);
      assert.equal(
        shapes.some((wall) => circleIntersects(door.x, door.z, 0.34, wall)),
        false,
        type,
      );
      const side = Spaces.toWorld(building, { x: plan.w / 2, z: 0 });
      assert.equal(
        shapes.some((wall) => circleIntersects(side.x, side.z, 0.34, wall)),
        true,
        type,
      );
      const local = { x: 0.4, z: -0.8 };
      const roundTrip = Spaces.toLocal(building, Spaces.toWorld(building, local));
      assert.ok(Math.hypot(roundTrip.x - local.x, roundTrip.z - local.z) < 1e-12);
    }
    assert.equal(plan.berths.length, TYPES[type].shelter || 0, type + ' berth count');
    for (const berth of plan.berths) {
      assert.equal(
        [...plan.walls, ...plan.furniture].some((shape) =>
          circleIntersects(berth.x, berth.z, 0.34, shape),
        ),
        false,
        type + ' accessible berth',
      );
    }
  }
});

test('shelter orders persist, and malformed indoor metadata is rejected', () => {
  const simulation = new Simulation();
  simulation.commandWorkers([1], { type: 'shelter', x: 10, z: 20 });
  simulation.state.people[1].restPlace = { spaceId: 'tent:0', slot: 0, x: 10, z: 20, warmth: 0.2 };
  assert.ok(Simulation.load(simulation.serialize()));
  for (const mutate of [
    (state) => {
      state.people[1].restPlace.x = Infinity;
    },
    (state) => {
      state.people[1].restPlace.slot = -1;
    },
    (state) => {
      state.people[1].shelterWarmth = 20;
    },
    (state) => {
      state.interiorSimulation = 'yes';
    },
  ]) {
    const state = JSON.parse(simulation.serialize());
    mutate(state);
    assert.equal(Simulation.load(JSON.stringify(state)), null);
  }
});

test('ordered workers can travel to shelter off duty without earning work or losing their job', () => {
  const simulation = new Simulation();
  simulation.state.time = 18;
  simulation.commandWorkers([1], { type: 'gather', resource: 'turf', x: 10, z: 20 });
  const person = simulation.state.people[1],
    order = person.order;
  Object.assign(person, { x: 30, z: 20 });
  const nav = navigation(simulation);
  nav.restDestination = () => ({ x: 0, z: 20 });
  simulation.advanceRealtime(60, nav);
  assert.ok(person.x < 1);
  assert.equal(person.order, order);
  assert.equal(order.workedHours, 0);
  assert.equal(simulation.state.flow.production.turf || 0, 0);
});

test('with physical occupancy enabled, outdoor people do not borrow indoor warmth', () => {
  const simulation = new Simulation();
  provision(simulation);
  simulation.state.interiorSimulation = true;
  simulation.state.time = 170 * 24 + 8;
  simulation.state.people[1].shelterWarmth = 1;
  simulation.state.people[2].shelterWarmth = 0;
  simulation.advance(1);
  assert.ok(simulation.state.people[1]._warmth > simulation.state.people[2]._warmth);
  assert.ok(simulation.state.people[1].health > simulation.state.people[2].health);
});

test('indoor warmth uses time spent inside, not just the position at the hour boundary', () => {
  const simulation = new Simulation();
  provision(simulation);
  simulation.state.interiorSimulation = true;
  simulation.state.time = 170 * 24 + 8;
  const nav = navigation(simulation);
  nav.preparePeople = () => {
    simulation.state.people[1].shelterWarmth = simulation.hour >= 8.5 ? 1 : 0;
  };
  simulation.advanceRealtime(3600, nav);
  const outside = simulation.state.people[2]._warmth;
  const mixed = simulation.state.people[1]._warmth;
  assert.ok(mixed > outside && mixed < 1);
  const indoors = require('../hearths.js').comfort(simulation, {
    ...simulation.state.people[1],
    shelterWarmth: 1,
  });
  assert.ok(Math.abs(mixed - (outside + indoors) / 2) < 0.0001);
});
