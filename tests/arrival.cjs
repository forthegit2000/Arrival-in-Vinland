const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Simulation } = require('../simulation.js');
const Arrival = require('../arrival.js');
const Storage = require('../storage.js');
function campaign() {
  const sim = new Simulation();
  assert.equal(Arrival.start(sim), true);
  return sim;
}
function advance(sim, seconds) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) Arrival.step(sim, 0.1);
}
function scout(sim) {
  assert.equal(Arrival.leaderAshore(sim), true);
  for (let step = 0; step < 3000 && sim.state.people[0].arrivalShip !== null; step++)
    Arrival.step(sim, 0.1);
  assert.equal(sim.state.people[0].arrivalShip, null);
  advance(sim, 10);
}
function quantities(sim) {
  const totals = Object.fromEntries(
    Storage.KEYS.map((key) => [key, Storage.total(sim.state, key)]),
  );
  for (const p of sim.state.people)
    if (p.arrivalCarry) totals[p.arrivalCarry.resource] += p.arrivalCarry.amount;
  return totals;
}
test('new landfall has four ship inventories, no camp, packed tents and a dedicated livestock manifest', () => {
  const sim = new Simulation(),
    before = quantities(sim);
  Arrival.start(sim);
  assert.deepEqual(quantities(sim), before);
  assert.equal(sim.state.arrival.livestockShip, 3);
  assert.equal(sim.state.people.filter((p) => p.arrivalShip !== null).length, 160);
  assert.deepEqual(
    Object.fromEntries(
      ['cattle', 'sheep', 'goats'].map((kind) => [
        kind,
        sim.state.arrival.animals.filter((a) => a.kind === kind && a.shipId === 3).length,
      ]),
    ),
    { cattle: 8, sheep: 12, goats: 12 },
  );
  assert.equal(sim.state.ships[3].role, 'livestock');
  assert.equal(sim.shelter, 0);
  assert.equal(sim.state.arrival.tents.filter((t) => t.status === 'packed').length, 10);
  assert.equal(
    Object.values(sim.state.storage.stores.camp.stock).reduce((s, v) => s + v, 0),
    0,
  );
  const beforePeople = sim.state.people.map((p) => [p.x, p.z]);
  advance(sim, 600);
  assert.deepEqual(
    sim.state.people.map((p) => [p.x, p.z]),
    beforePeople,
  );
  assert.equal(
    sim.state.arrival.animals.every((a) => a.shipId === 3),
    true,
  );
  assert.ok(Simulation.load(sim.serialize()));
});
test('scouting uses a crewed finite-capacity ferry and leaves the rest aboard until ordered', () => {
  const sim = campaign();
  scout(sim);
  const a = sim.state.arrival;
  assert.equal(sim.state.people.filter((p) => !Arrival.aboard(p)).length, 2);
  assert.equal(sim.state.arrival.hallDiscovered, false);
  assert.ok(Simulation.load(sim.serialize()));
  const rower = sim.state.people[a.ferry.workerId];
  assert.equal(rower.order.action, 'row');
  const ids = sim.state.people
    .filter((p) => p.arrivalShip !== null && !p.arrivalFerry)
    .slice(0, 18)
    .map((p) => p.id);
  Arrival.order(sim, ids, 'land');
  let max = 0;
  for (
    let step = 0;
    step < 10000 && ids.some((id) => sim.state.people[id].arrivalShip !== null);
    step++
  ) {
    Arrival.step(sim, 0.1);
    max = Math.max(max, a.ferry.passengers.length + 1);
  }
  assert.ok(max <= Arrival.TENDER.people);
  assert.equal(
    ids.every((id) => sim.state.people[id].arrivalShip === null),
    true,
  );
  assert.equal(
    sim.state.arrival.animals.every((a) => a.shipId === 3),
    true,
  );
});
test('ferry cargo and hand loads conserve stock, obey limits and survive mid-transfer saves', () => {
  let sim = campaign();
  scout(sim);
  const worker = sim.state.people.find((p) => p.id !== 0 && !Arrival.aboard(p));
  Arrival.order(sim, [worker.id], 'unload');
  let cargoSeen = false,
    carrySeen = false,
    restored = false;
  const before = quantities(sim);
  const consumedBefore = { ...sim.state.flow.consumption };
  for (let step = 0; step < 12000; step++) {
    Arrival.step(sim, 0.1);
    const f = sim.state.arrival.ferry;
    const cargo =
      Object.entries(sim.state.storage.stores.ferry.stock).reduce(
        (sum, [key, n]) => sum + Arrival.mass(key, n),
        0,
      ) +
      f.tents.length * 15;
    assert.ok(cargo <= Arrival.TENDER.cargoKg + 0.001);
    cargoSeen ||= cargo > 0;
    for (const p of sim.state.people)
      if (p.arrivalCarry) {
        carrySeen = true;
        assert.ok(Arrival.mass(p.arrivalCarry.resource, p.arrivalCarry.amount) <= 15 + 0.001);
      }
    if (carrySeen && !restored) {
      const saved = Simulation.load(sim.serialize());
      assert.ok(saved, 'in-transit save');
      sim = saved;
      restored = true;
    }
    if ((sim.state.storage.stores.camp.stock.hay || 0) > 0) break;
  }
  assert.ok(cargoSeen && carrySeen && restored);
  assert.ok(Object.values(sim.state.storage.stores.camp.stock).some((n) => n > 0));
  const after = quantities(sim);
  for (const key of Storage.KEYS) {
    // Boarding provisions are eaten, recorded in consumption; unloading creates none.
    const eaten = (sim.state.flow.consumption?.[key] || 0) - (consumedBefore[key] || 0);
    assert.ok(Math.abs(after[key] + eaten - before[key]) < 0.001, key + ' must be conserved');
  }
  assert.ok(sim.state.arrival.tents.some((t) => t.status === 'landed'));
});
test('pitched shelter requires unloaded canvas and real person-hours, with multiple builders adding labour', () => {
  const sim = campaign();
  scout(sim);
  const tent = sim.state.arrival.tents[0];
  Object.assign(tent, { shipId: null, status: 'landed', x: -62, z: -8 });
  const workers = sim.state.people.filter((p) => p.id !== 0).slice(0, 2);
  for (const p of workers) {
    p.arrivalShip = null;
    p.arrivalFerry = false;
    p.x = -57.4;
    p.z = -4.4;
  }
  Arrival.order(
    sim,
    workers.map((p) => p.id),
    'pitch',
    { x: -60, z: -7 },
  );
  advance(sim, 1800);
  assert.equal(sim.shelter, 0);
  assert.ok(Math.abs(tent.progress - 1) < 0.01);
  advance(sim, 1810);
  assert.equal(tent.status, 'pitched');
  assert.equal(sim.shelter, 8);
  assert.ok(Simulation.load(sim.serialize()));
});
test('livestock remain on their own ship until two landed handlers bring them over the gangway', () => {
  const sim = campaign();
  scout(sim);
  const handlers = sim.state.people
    .filter((p) => p.id !== 0 && p.id !== sim.state.arrival.ferry.workerId)
    .slice(0, 2);
  for (const p of handlers) {
    p.arrivalShip = null;
    p.arrivalFerry = false;
  }
  Arrival.order(sim, [handlers[0].id], 'livestock');
  advance(sim, 200);
  assert.equal(sim.state.arrival.deployment, null);
  Arrival.order(sim, [handlers[1].id], 'livestock');
  advance(sim, 350);
  assert.equal(sim.state.arrival.deployment.phase, 'unloading');
  assert.ok(Simulation.load(sim.serialize()));
  advance(sim, 2400);
  assert.equal(sim.state.arrival.animals.filter((a) => a.shipId === null).length, 32);
  assert.deepEqual(sim.state.livestock, { cattle: 8, sheep: 12, goats: 12 });
  assert.ok(Simulation.load(sim.serialize()));
});
test('old saves keep established camps; malformed manifests and overloaded ferries are rejected', () => {
  const old = new Simulation();
  assert.equal(Simulation.load(old.serialize()).state.arrival, undefined);
  const sim = campaign(),
    state = JSON.parse(sim.serialize());
  state.arrival.animals[0].shipId = 0;
  assert.equal(Simulation.load(JSON.stringify(state)), null);
  const overloaded = JSON.parse(sim.serialize());
  overloaded.storage.stores.ferry.stock.firewood = 201;
  overloaded.storage.stores['ship:0'].stock.firewood = 0;
  overloaded.resources.firewood = 201;
  assert.equal(Simulation.load(JSON.stringify(overloaded)), null);
});
test('one shared real-time clock gives the same arrival result at 1x, 3x and 8x', () => {
  const results = [];
  for (const speed of [1, 3, 8]) {
    const sim = campaign();
    Arrival.leaderAshore(sim);
    for (let seconds = 0; seconds < 240; seconds += speed)
      sim.advanceRealtime(Math.min(speed, 240 - seconds));
    results.push(sim.serialize());
  }
  assert.equal(results[0], results[1]);
  assert.equal(results[0], results[2]);
});

test('tent transport survives saving and interruption without moving or duplicating the roll', () => {
  let sim = campaign();
  scout(sim);
  const worker = sim.state.people.find((p) => p.id !== 0 && !Arrival.aboard(p));
  const tent = sim.state.arrival.tents[0];
  Object.assign(tent, { shipId: null, status: 'landed', x: worker.x, z: worker.z });
  Arrival.order(sim, [worker.id], 'pitch', { x: worker.x + 25, z: worker.z + 5 });
  advance(sim, 1);
  assert.equal(tent.status, 'carried');
  assert.equal(tent.progress, 0);
  assert.equal(sim.shelter, 0);
  sim = Simulation.load(sim.serialize());
  assert.ok(sim);
  const carrier = sim.state.people[worker.id];
  assert.equal(carrier.arrivalTent, tent.id);
  assert.equal(Arrival.interrupt(sim, carrier), true);
  const dropped = sim.state.arrival.tents.find((t) => t.id === tent.id);
  assert.equal(dropped.status, 'landed');
  assert.equal(dropped.x, carrier.x);
  assert.equal(dropped.z, carrier.z);
  assert.equal(sim.state.arrival.tents.length, 10);
  assert.ok(Simulation.load(sim.serialize()));
});

test('stopping a hand carrier leaves the exact load in a physical cache', () => {
  const sim = campaign();
  scout(sim);
  const worker = sim.state.people.find((p) => p.id !== 0 && !Arrival.aboard(p));
  Arrival.order(sim, [worker.id], 'unload');
  for (let i = 0; i < 6000 && !worker.arrivalCarry; i++) Arrival.step(sim, 0.1);
  assert.ok(worker.arrivalCarry);
  const before = quantities(sim),
    load = { ...worker.arrivalCarry };
  assert.equal(Arrival.interrupt(sim, worker), true);
  assert.equal(worker.arrivalCarry, undefined);
  assert.deepEqual(quantities(sim), before);
  const cache = Object.values(sim.state.storage.stores).find((s) =>
    s.id.startsWith('arrival-interrupted:'),
  );
  assert.equal(cache.stock[load.resource], load.amount);
  assert.equal(cache.x, worker.x);
  assert.ok(Simulation.load(sim.serialize()));
});

test('drinking credits avoid consuming water twice and each ship supplies its own people', () => {
  const sim = campaign(),
    state = sim.state;
  const credits = new Map(sim.presentPeople.map((p) => [p.id, 3 / 24]));
  const before = Storage.total(state, 'water');
  Arrival.drink(sim, credits);
  const animalNeed = (8 * 40 + 24 * 4) / 24;
  assert.ok(Math.abs(before - Storage.total(state, 'water') - animalNeed) < 1e-6);
  state.storage.stores['ship:0'].stock.water = 0;
  const result = Arrival.drink(sim);
  assert.equal(result.ratios.get(state.people.find((p) => p.arrivalShip === 0).id), 0);
  assert.equal(result.ratios.get(state.people.find((p) => p.arrivalShip === 1).id), 1);
});

test('animals on the livestock knarr cannot eat shoreline grass', () => {
  const sim = campaign(),
    state = sim.state;
  const pasture = state.ecology.pasture,
    hay = Storage.total(state, 'hay');
  sim.consumeHourlySupplies({ feels: 15, temp: 15 }, sim.roster(), true);
  assert.equal(state.ecology.pasture, pasture);
  assert.ok(Math.abs(hay - Storage.total(state, 'hay') - sim.hayDemand / 24) < 1e-6);
});

test('arrival building budgets require landed materials and usable canvas', () => {
  const sim = campaign();
  assert.match(sim.blockedReason('tentbudir'), /Unload a tent/);
  assert.match(sim.blockedReason('restore'), /inspect Hall F/);
  assert.equal(Storage.available(sim.state, 'iron', true), 0);
  assert.ok(Storage.available(sim.state, 'iron') > 0);
});

test('converting, cancelling and dismantling a búð preserves its actual tent canvas', () => {
  const sim = campaign(),
    state = sim.state;
  Object.assign(state.arrival.tents[0], { status: 'landed', shipId: null, x: -60, z: 0 });
  Storage.deposit(state, 'camp', 'timber', 2);
  Storage.deposit(state, 'camp', 'turf', 10);
  const order = sim.order('tentbudir', 45, 45);
  assert.ok(order);
  assert.equal(state.arrival.tents.length, 9);
  assert.equal(state.resources.tents, 9);
  assert.ok(Simulation.load(sim.serialize()));
  assert.equal(sim.cancel(order.id), true);
  assert.equal(state.arrival.tents.length, 10);
  assert.equal(state.resources.tents, 10);
  assert.equal(state.arrival.tents.find((t) => t.id === 0).status, 'landed');
  assert.ok(Simulation.load(sim.serialize()));
  const second = sim.order('tentbudir', 45, 45);
  assert.ok(second);
  second.progress = second.hours;
  for (const material of Object.values(second.materials)) material.delivered = material.required;
  sim.advanceConstruction(0);
  assert.equal(sim.dismantle(second.id), true);
  assert.equal(state.arrival.tents.length, 10);
  assert.equal(state.resources.tents, 10);
  assert.ok(Simulation.load(sim.serialize()));
});

test('Hall F is discovered by Karlsefni reaching it after disembarking', () => {
  const sim = campaign();
  scout(sim);
  assert.equal(sim.state.arrival.hallDiscovered, false);
  Object.assign(sim.state.leader, { x: 12, z: 0 });
  Object.assign(sim.state.people[0], { x: 12, z: 0 });
  Arrival.step(sim, 0.1);
  assert.equal(sim.state.arrival.hallDiscovered, true);
  assert.ok(
    sim.state.journal.some((entry) => entry.kind === 'discovery' && entry.text.includes('Hall F')),
  );
});

test('walk landing requests bring every idle passenger ashore, including children and the watch', () => {
  const sim = new Simulation({ population: 24, children: 0.25 });
  Arrival.start(sim);
  scout(sim);
  const speaker = sim.state.people.find((person) => person.id !== 0 && !Arrival.aboard(person));
  sim.commandWorkers([speaker.id], { type: 'gather', resource: 'firewood', x: 80, z: 60 });
  const previous = { ...speaker.order };
  const result = Arrival.requestLanding(sim, speaker.id, 'land');
  assert.ok(result.count > 0);
  assert.deepEqual(speaker.order, previous, 'the coordinator keeps their existing job');
  assert.ok(sim.state.people.some((person) => person.age < 16 && person.order?.action === 'land'));
  let restored = false;
  for (
    let i = 0;
    i < 24000 && sim.state.people.some((person) => Number.isInteger(person.arrivalShip));
    i++
  ) {
    Arrival.step(sim, 0.1);
    if (!restored && sim.state.arrival.ferry.phase === 'outbound') {
      assert.ok(Simulation.load(sim.serialize()));
      restored = true;
    }
  }
  assert.ok(restored);
  assert.equal(sim.state.people.filter((person) => Number.isInteger(person.arrivalShip)).length, 0);
  assert.equal(
    sim.state.people.filter(Arrival.aboard).length,
    1,
    'the rower remains with the tender',
  );
  assert.ok(Simulation.load(sim.serialize()));
});

test('walk landing requests assign only idle helpers and explain missing handlers and tent cargo', () => {
  const sim = campaign();
  scout(sim);
  const speaker = sim.state.people.find((person) => person.id !== 0 && !Arrival.aboard(person));
  assert.match(
    Arrival.requestLanding(sim, speaker.id, 'livestock').reason,
    /Two available handlers/,
  );
  assert.match(
    Arrival.requestLanding(sim, speaker.id, 'pitch', { x: 40, z: 40 }).reason,
    /Unload a packed tent/,
  );
  assert.equal(Arrival.requestLanding(sim, speaker.id, 'unload').count, 1);
  const oldOrder = { ...speaker.order };
  assert.equal(Arrival.requestLanding(sim, speaker.id, 'livestock').count, 0);
  assert.deepEqual(speaker.order, oldOrder);
  assert.ok(Simulation.load(sim.serialize()));
});

test('talking to a landing carrier pauses that person and preserves their physical load', () => {
  const sim = campaign();
  scout(sim);
  const speaker = sim.state.people.find((person) => person.id !== 0 && !Arrival.aboard(person));
  Arrival.requestLanding(sim, speaker.id, 'unload');
  for (let i = 0; i < 6000 && !speaker.arrivalCarry; i++) Arrival.step(sim, 0.1);
  assert.ok(speaker.arrivalCarry);
  const before = {
    x: speaker.x,
    z: speaker.z,
    load: { ...speaker.arrivalCarry },
    order: { ...speaker.order },
  };
  sim.conversationPersonId = speaker.id;
  advance(sim, 10);
  assert.deepEqual(
    { x: speaker.x, z: speaker.z, load: speaker.arrivalCarry, order: speaker.order },
    before,
  );
  assert.ok(Simulation.load(sim.serialize()));
  sim.conversationPersonId = null;
  advance(sim, 30);
  assert.ok(Object.values(sim.state.storage.stores.camp.stock).some((amount) => amount > 0));
});

test('walk tent confirmation validates helpers and ground before assigning anyone', () => {
  const sim = campaign();
  scout(sim);
  const speaker = sim.state.people.find((person) => person.id !== 0 && !Arrival.aboard(person));
  Object.assign(sim.state.arrival.tents[0], {
    status: 'landed',
    shipId: null,
    x: speaker.x,
    z: speaker.z,
  });
  const rejected = Arrival.requestLanding(
    sim,
    speaker.id,
    'pitch',
    { x: 45, z: 45 },
    { canPitchArrivalTent: () => false },
  );
  assert.equal(rejected.count, 0);
  assert.equal(speaker.order, null);
  const blocked = Arrival.requestLanding(
    sim,
    speaker.id,
    'pitch',
    { x: 45, z: 45 },
    { canPitchArrivalTent: () => true, path: () => [] },
  );
  assert.match(blocked.reason, /reach/);
  assert.equal(speaker.order, null);
  assert.equal(Arrival.requestLanding(sim, speaker.id, 'pitch', { x: 45, z: 45 }).count, 1);
  sim.conversationPersonId = speaker.id;
  advance(sim, 10);
  assert.equal(speaker.order.tentId, undefined, 'a speaker does not move tent equipment');
  sim.conversationPersonId = null;
  advance(sim, 10);
  assert.equal(speaker.arrivalTent, 0);
  assert.ok(Simulation.load(sim.serialize()));
});

test('a walk-mode request lands the complete 160-person manifest without releasing cargo or animals', () => {
  const sim = campaign();
  scout(sim);
  const speaker = sim.state.people.find((person) => person.id !== 0 && !Arrival.aboard(person));
  assert.equal(Arrival.requestLanding(sim, speaker.id, 'land').count, 157);
  for (
    let i = 0;
    i < 100000 && sim.state.people.some((person) => Number.isInteger(person.arrivalShip));
    i++
  )
    Arrival.step(sim, 0.1);
  assert.equal(sim.state.people.filter((person) => Number.isInteger(person.arrivalShip)).length, 0);
  assert.equal(sim.state.people.filter(Arrival.aboard).length, 1);
  assert.equal(
    sim.state.arrival.animals.every((animal) => animal.shipId === 3),
    true,
  );
  assert.equal(
    sim.state.arrival.tents.every((tent) => tent.status === 'packed'),
    true,
  );
  assert.equal(sim.shelter, 0);
  assert.ok(Simulation.load(sim.serialize()));
});
