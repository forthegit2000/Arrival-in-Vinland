/** Saved door targets and doorway geometry shared by interaction, collision and light. */
(function (root) {
  'use strict';
  const Spaces =
    typeof module !== 'undefined' ? require('./building-spaces.js') : root.VinlandBuildingSpaces;
  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  function initialize(state) {
    state.doors ||= {};
  }
  function isOpen(state, id) {
    return state.doors?.[id] === true;
  }
  function validate(state) {
    return (
      state.doors === undefined ||
      (!!state.doors &&
        !Array.isArray(state.doors) &&
        Object.entries(state.doors).every(
          ([id, open]) =>
            /^(building:\d+|hall:[IV]+:(east|west|north|south))$/.test(id) &&
            typeof open === 'boolean',
        ))
    );
  }
  function definitions(state) {
    const doors = [];
    for (const building of state.buildings) {
      const plan = Spaces.plan(building.type);
      if (!plan) continue;
      doors.push({
        id: 'building:' + building.id,
        spaceIds: ['building:' + building.id],
        ...Spaces.toWorld(building, plan.entrance),
        rotation: building.rotation || 0,
        width: plan.doorWidth,
        height: ['sailbudir', 'tentbudir'].includes(building.type) ? 1.5 : 1.85,
        cloth: ['sailbudir', 'tentbudir'].includes(building.type),
        floorX: building.x,
        floorZ: building.z,
      });
    }
    if (!state.config.inheritedHall) return doors;
    const hall = {
      x: 0,
      z: 0,
      rotation: state.config.site === 'meadows' ? Meadows.hallRotation : 0,
    };
    const hallDoors = [];
    for (const room of Spaces.HALL_ROOMS.filter((room) => room.kind !== 'shed')) {
      const openings = [
        {
          side: 'east',
          x: room.x + room.w / 2 + 0.425,
          z: room.z + (room.n === 'V' ? -0.4 : 0),
          angle: Math.PI / 2,
        },
      ];
      if (room.kind === 'living') {
        openings.push({
          side: 'west',
          x: room.x - room.w / 2 - 0.425,
          z: room.z,
          angle: Math.PI / 2,
        });
        if (room.n !== 'I')
          openings.push({ side: 'north', x: room.x, z: room.z - room.d / 2 - 0.425, angle: 0 });
        if (room.n !== 'III')
          openings.push({ side: 'south', x: room.x, z: room.z + room.d / 2 + 0.425, angle: 0 });
      }
      for (const opening of openings) {
        // Two wall openings can describe one connecting passage. Fit one leaf between them.
        const shared = hallDoors.find(
          (door) =>
            door.angle === opening.angle &&
            Math.hypot(door.localX - opening.x, door.localZ - opening.z) < 0.9,
        );
        if (shared) {
          shared.localX = (shared.localX + opening.x) / 2;
          shared.localZ = (shared.localZ + opening.z) / 2;
          shared.spaceIds.push('hall:' + room.n);
        } else
          hallDoors.push({
            id: 'hall:' + room.n + ':' + opening.side,
            spaceIds: ['hall:' + room.n],
            localX: opening.x,
            localZ: opening.z,
            angle: opening.angle,
          });
      }
    }
    for (const door of hallDoors)
      doors.push({
        ...door,
        ...Spaces.toWorld(hall, { x: door.localX, z: door.localZ }),
        rotation: hall.rotation + door.angle,
        width: 1.1,
        height: 1.8,
        floorX: 0,
        floorZ: 0,
      });
    return doors;
  }
  function leaf(door, open) {
    const hinge = Spaces.toWorld(door, { x: -door.width / 2, z: 0 });
    const rotation = door.rotation + (open ? -Math.PI / 2 : 0);
    return {
      ...Spaces.toWorld({ ...hinge, rotation }, { x: door.width / 2, z: 0 }),
      rotation,
      w: door.width,
      d: 0.1,
    };
  }
  const api = { initialize, isOpen, validate, definitions, leaf };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandDoors = api;
})(typeof window === 'undefined' ? globalThis : window);
