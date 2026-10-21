/** Non-working rest behavior. Destinations and poses are transient; positions use normal saves. */
(function (root) {
  'use strict';

  function aboard(person) {
    return Number.isInteger(person.arrivalShip) || person.arrivalFerry === true;
  }

  function available(simulation, person) {
    return (
      person.alive &&
      !person.away &&
      person.id !== simulation.state.leader.id &&
      !person.order &&
      !person.cargo &&
      !person.arrivalCarry &&
      !(person.carriedFirewood > 0) &&
      person.id !== simulation.conversationPersonId
    );
  }

  // Four people face a shared centre. Irregular group centres leave routes
  // between them instead of forming a solid rectangular crowd at the landing.
  function assemblyPoint(landing, normal, id) {
    const group = Math.floor(id / 4);
    const spread = Math.sqrt(group + 1) * 4.6;
    const lateral = Math.sin(group * 2.399) * spread;
    const inland = 20 + (1 + Math.cos(group * 2.399)) * spread * 0.65;
    const angle = ((id % 4) * Math.PI) / 2 + group * 0.23;
    const center = {
      x: landing.x + normal.x * inland - normal.z * lateral,
      z: landing.z + normal.z * inland + normal.x * lateral,
    };
    return {
      x: center.x + Math.sin(angle) * 1.4,
      z: center.z + Math.cos(angle) * 1.4,
      heading: angle + Math.PI,
    };
  }

  function advance(simulation, seconds, world) {
    if (!world?.idleRestDestination || !Number.isFinite(seconds) || seconds <= 0) return;
    if (simulation.state.gameOver || simulation.state.ended) return;
    world.idlePeople ||= new Map();
    const camp = (world.arrivalTentSignature || '') + ':' + world.geometrySignature;
    for (const person of simulation.state.people) {
      if (!available(simulation, person) || aboard(person)) {
        world.idlePeople.delete(person.id);
        continue;
      }
      let rest = world.idlePeople.get(person.id);
      if (!rest || rest.camp !== camp) {
        rest = { camp, wait: 2 + (person.id % 7), target: null, blocked: 0, settled: false };
        world.idlePeople.set(person.id, rest);
      }
      const activeSeconds = Math.max(0, seconds - rest.wait);
      rest.wait = Math.max(0, rest.wait - seconds);
      if (!activeSeconds) continue;
      if (rest.settled) {
        rest.wait = 10;
        if (world.clearAt(person.x, person.z, 0.8)) continue;
        rest.settled = false;
        rest.target = null;
      }
      if (!rest.target) rest.target = world.idleRestDestination(person);
      if (!rest.target) {
        rest.wait = 30;
        continue;
      }
      const distance = Math.hypot(person.x - rest.target.x, person.z - rest.target.z);
      if (distance < 0.2) {
        person.moving = false;
        rest.settled = true;
        rest.wait = 10;
        world.routes.delete(person.id);
        continue;
      }
      world.movePerson(person, rest.target, activeSeconds);
      rest.blocked = person.moving ? 0 : rest.blocked + seconds;
      if (rest.blocked >= 3) {
        // Do not repeatedly pathfind against a busy delivery route.
        rest.target = null;
        rest.wait = 30;
        rest.blocked = 0;
      }
    }
  }

  const api = { aboard, available, assemblyPoint, advance };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandIdlePeople = api;
})(typeof window === 'undefined' ? globalThis : window);
