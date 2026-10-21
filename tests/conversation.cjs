const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../simulation.js');
const { onsiteHours, stockBuildingMaterials } = require('./work-fixtures.cjs');
const { ConversationSession, activityLine } = require('../conversation.js');

function placeNearby(simulation, id = 1) {
  Object.assign(simulation.state.people[id], { x: 11, z: 17 });
}

test('a conversation preserves the existing order and stays out of saves', () => {
  const simulation = new Simulation();
  placeNearby(simulation);
  simulation.commandWorkers([1], { type: 'move', x: 30, z: 30 });
  const original = simulation.state.people[1].order;
  const session = new ConversationSession(simulation);
  assert.equal(session.start(1), true);
  assert.equal(simulation.conversationPersonId, 1);
  assert.equal(simulation.state.people[1].order, original);
  const loaded = Simulation.load(simulation.serialize());
  assert.ok(loaded);
  assert.equal(loaded.conversationPersonId, undefined);
  assert.deepEqual(loaded.state.people[1].order, original);
  session.close();
  assert.equal(simulation.conversationPersonId, null);
  assert.equal(simulation.state.people[1].order, original);
});

test('only the speaking builder pauses; the crew resumes without losing work hours', () => {
  const simulation = new Simulation();
  stockBuildingMaterials(simulation);
  placeNearby(simulation);
  const building = simulation.order('restore', 0, 0);
  simulation.commandWorkers([1, 2], { type: 'build', buildingId: building.id, x: 10, z: 20 });
  const session = new ConversationSession(simulation);
  session.start(1);
  onsiteHours(simulation, 1);
  assert.equal(building.progress, 1);
  assert.equal(simulation.state.people[1].order.workedHours, 0);
  assert.equal(simulation.state.people[2].order.workedHours, 1);
  session.close();
  onsiteHours(simulation, 1);
  assert.equal(building.progress, 3);
  assert.equal(simulation.state.people[1].order.workedHours, 1);
});

test('gathering and support work pause locally, and new orders survive the conversation', () => {
  for (const order of [
    { type: 'gather', resource: 'timber' },
    { type: 'work', task: 'fishing' },
  ]) {
    const simulation = new Simulation();
    placeNearby(simulation);
    simulation.commandWorkers([1, 2], { ...order, x: 45, z: 45 });
    const session = new ConversationSession(simulation);
    session.start(1);
    onsiteHours(simulation, 1);
    assert.equal(simulation.state.people[1].order.workedHours, 0);
    assert.equal(simulation.state.people[2].order.workedHours, 1);
    simulation.commandWorkers([1], { type: 'gather', resource: 'hay', x: 45, z: 45 });
    session.close();
    assert.equal(simulation.state.people[1].order.resource, 'hay');
    session.start(1);
    simulation.commandWorkers([1], { type: 'stop' });
    session.close();
    assert.equal(simulation.state.people[1].order, null);
    onsiteHours(simulation, 1);
    assert.equal(simulation.state.people[1].job, null);
    assert.ok(simulation.state.people[2].order);
  }
});

test('only nearby living companions can speak, and activity reports stay brief', () => {
  const simulation = new Simulation();
  const session = new ConversationSession(simulation);
  assert.equal(session.start(0), false);
  assert.equal(session.start(999), false);
  placeNearby(simulation);
  const person = simulation.state.people[1];
  person.away = 'voyage';
  assert.equal(session.start(1), false);
  person.away = null;
  person.x = 100;
  assert.equal(session.start(1), false);
  placeNearby(simulation);
  assert.equal(activityLine(person, simulation), "I'm idle, waiting for orders.");
  simulation.commandWorkers([1], { type: 'gather', resource: 'timber', x: 45, z: 45 });
  person.order.phase = 'store';
  assert.equal(activityLine(person, simulation), "I'm bringing logs to the store.");
  simulation.state.time = 23;
  assert.equal(activityLine(person, simulation), "I'm resting until work starts.");
});

test('gathering conversations name the actual travel, work and handling stage', () => {
  const simulation = new Simulation();
  simulation.state.time = 9;
  const person = simulation.state.people[1];
  simulation.commandWorkers([1], { type: 'gather', resource: 'timber', x: 45, z: 45 });
  assert.equal(activityLine(person, simulation), "I'm looking for a reachable gathering site.");
  for (const [phase, activity, expected] of [
    ['site', 'felling', "I'm walking to the woodcutting site."],
    ['working', 'clearing', 'Clearing a safe felling area.'],
    ['working', 'felling', 'Felling the tree.'],
    ['working', 'limbing', 'Removing branches.'],
    ['working', 'bucking', 'Cross-cutting the fallen trunk.'],
    ['working', 'loading', "I'm loading logs."],
    ['store', 'felling', "I'm bringing logs to the store."],
    ['unloading', 'loading', "I'm unloading logs at the store."],
  ]) {
    Object.assign(person.order, { phase, activity });
    assert.equal(activityLine(person, simulation), expected);
  }
  person.order.resource = 'firewood';
  Object.assign(person.order, { phase: 'working', activity: 'splitting' });
  assert.equal(activityLine(person, simulation), 'Splitting firewood.');
  person.order.activity = 'sharpening';
  assert.equal(activityLine(person, simulation), 'Whetting the tool and resting.');
  delete person.order.activity;
  assert.equal(activityLine(person, simulation), "I'm processing firewood.");
});

test('waiting reasons take priority over old activities, and remain visible while speaking', () => {
  const simulation = new Simulation();
  simulation.state.time = 9;
  placeNearby(simulation);
  const person = simulation.state.people[1];
  simulation.commandWorkers([1], { type: 'gather', resource: 'firewood', x: 45, z: 45 });
  Object.assign(person.order, { phase: 'working', activity: 'felling' });
  const session = new ConversationSession(simulation);
  assert.equal(session.start(1), true);
  for (const reason of [
    'Too windy to fell a tree safely.',
    'Waiting for space at this source.',
    'No reachable storage.',
    'Storage is full.',
    'Waiting for a clear route to the gathering site.',
  ]) {
    person.order.status = reason;
    assert.equal(activityLine(person, simulation), reason);
  }
  delete person.order.status;
  assert.equal(activityLine(person, simulation), 'Felling the tree.');
  simulation.state.time = 18;
  assert.equal(activityLine(person, simulation), "I'm resting until work starts.");
  session.close();
});

test('field and support jobs report actual work stages and blockers', () => {
  const simulation = new Simulation();
  simulation.state.time = 9;
  const person = simulation.state.people[1];
  for (const [resource, activity, expected] of [
    ['turf', 'cutting', 'Cutting and stacking turf.'],
    ['hay', 'mowing', 'Mowing grass.'],
    ['hay', 'drying', 'Waiting for the hay to dry.'],
  ]) {
    simulation.commandWorkers([1], { type: 'gather', resource, x: 45, z: 45 });
    Object.assign(person.order, { phase: 'working', activity });
    assert.equal(activityLine(person, simulation), expected);
  }
  simulation.commandWorkers([1], { type: 'work', task: 'fishing', x: 45, z: 45 });
  Object.assign(person.order, { phase: 'working', activity: 'fishing' });
  assert.equal(activityLine(person, simulation), 'Fishing.');
  person.order.status = 'No reachable storage.';
  assert.equal(activityLine(person, simulation), 'No reachable storage.');
  simulation.commandWorkers([1], { type: 'work', task: 'craft', x: 45, z: 45 });
  person.order.activity = 'preparingBatch';
  assert.equal(activityLine(person, simulation), 'Preparing the batch.');
  person.order.status = 'Supply at least 100 kg wood to this pit.';
  assert.equal(activityLine(person, simulation), person.order.status);
});

test('arrival conversations report the actual landing work even outside normal working hours', () => {
  const Arrival = require('../arrival.js');
  const simulation = new Simulation();
  Arrival.start(simulation);
  simulation.state.time = 22;
  const person = simulation.state.people[1];
  person.order = { type: 'arrival', action: 'land', x: 0, z: 0, workedHours: 0 };
  assert.equal(activityLine(person, simulation), "I'm waiting for passage ashore.");
  person.order.action = 'row';
  person.order.status = 'Rowing the landing boat.';
  assert.equal(activityLine(person, simulation), 'Rowing the landing boat.');
  person.order.action = 'pitch';
  assert.equal(activityLine(person, simulation), "I'm resting until work starts.");
});
