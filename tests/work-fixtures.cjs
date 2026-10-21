/** Explicit flat, obstacle-free test field; browser tests cover real navigation. */
const Gathering = require('../gathering.js');
function navigation(simulation, distance = 10) {
  return {
    movePerson(person, target, seconds) {
      const length = Math.hypot(target.x - person.x, target.z - person.z);
      const step = Math.min(length, seconds * 1.4 * (person.cargo ? 0.75 : 1));
      if (!length) return;
      person.x += ((target.x - person.x) / length) * step;
      person.z += ((target.z - person.z) / length) * step;
      person.moving = true;
    },
    workDestination: (person) => person.order,
    deliveryPoint: () => ({ id: 'camp', x: 0, z: 20 }),
    findHarvestTarget(resource) {
      const pile = simulation.state.harvest.piles.find(
        (p) => p.resource === resource && p.amount > 0.00001,
      );
      if (pile) return { x: pile.x, z: pile.z, source: { ...pile, kind: 'pile' } };
      const kind = ['timber', 'firewood'].includes(resource)
        ? 'tree'
        : resource === 'freshFish'
          ? 'fish'
          : resource;
      const source = {
        id: Gathering.sourceId(kind, distance, 20),
        kind,
        x: distance,
        z: 20,
        volume: 0.08,
        height: 5,
        radius: 0.12,
      };
      if (!Gathering.sourceAvailable(simulation, source, resource)) return null;
      return { x: distance, z: 20, source };
    },
  };
}
function placeWorkers(simulation) {
  for (const person of simulation.state.people) {
    if (person.order) Object.assign(person, { x: person.order.x, z: person.order.z });
  }
}
/** Hourly unit-test fixture for already-arrived builders and support workers.
 * It deliberately skips physical harvesting; that is covered in gathering.cjs. */
function onsiteHours(simulation, hours) {
  // This fixture starts after transport; real hauling has separate coverage.
  for (const site of simulation.state.queue)
    for (const material of Object.values(site.materials || {})) {
      material.delivered = material.required;
      material.reservations = [];
    }
  placeWorkers(simulation);
  for (let left = hours; left > 1e-8 && !simulation.state.gameOver; ) {
    const chunk = Math.min(left, 1 - (simulation.state.time % 1));
    const seconds = chunk * 3600;
    for (const person of simulation.availablePeople) {
      if (!person.order || person.id === simulation.conversationPersonId) continue;
      const order = person.order;
      const end = 8 + (order.type === 'work' ? simulation.state.politics.workHours : 10);
      if (simulation.hour >= 8 && simulation.hour < end && order.type !== 'build') {
        order.workedHours += chunk;
        if (order.type === 'work' && !Gathering.resourceFor(order))
          simulation.state.workSeconds[person.id] = seconds;
      }
    }
    simulation.advanceConstruction(seconds);
    simulation.advance(chunk);
    left -= chunk;
  }
}
function provision(simulation) {
  Object.assign(simulation.state.resources, { water: 1e7, firewood: 1e7, hay: 1e7 });
  simulation.state.foods.driedFish = 1e7;
  simulation.refreshFood();
}
/** Construction and cargo tests start after materials have been gathered. */
function stockBuildingMaterials(simulation) {
  Object.assign(simulation.state.resources, { timber: 18, turf: 18, stone: 2.5 });
}
module.exports = { navigation, placeWorkers, onsiteHours, provision, stockBuildingMaterials };
