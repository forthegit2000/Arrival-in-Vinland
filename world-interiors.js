/** Entrances, indoor routes, occupied shelter places and interior presentation. */
(function (root) {
  'use strict';
  const Model = root.VinlandModel;
  const Spaces = root.VinlandBuildingSpaces;
  const ROOM_CAPACITY = { I: 8, II: 16, III: 8 };

  class InteriorWorld extends root.VinlandWorld.HarvestWorld {
    buildScene() {
      super.buildScene();
      this.sim.navigation = this;
      this.sim.state.interiorSimulation = true;
      this.indoorPresentation = new root.VinlandInteriorPresentation(this);
      this.doorControls = new root.VinlandDoorControls(this);
    }

    usableSpaces() {
      const state = this.sim.state;
      if (
        this.cachedSpaces &&
        this.cachedBuildings === state.buildings &&
        this.cachedBuildingCount === state.buildings.length &&
        this.cachedTents === state.resources.tents &&
        this.cachedGeometry === this.geometrySignature
      )
        return this.cachedSpaces;
      this.cachedBuildings = state.buildings;
      this.cachedBuildingCount = state.buildings.length;
      this.cachedTents = state.resources.tents;
      this.cachedGeometry = this.geometrySignature;
      const spaces = this.sim.state.buildings
        .filter((building) => Spaces.plan(building.type))
        .map((building) => ({
          ...building,
          spaceId: 'building:' + building.id,
          plan: Spaces.plan(building.type),
        }));
      if (this.sim.state.config.inheritedHall) {
        for (const room of root.VinlandWorld.rooms) {
          if (room.kind === 'shed') continue;
          const center = Spaces.toWorld({ x: 0, z: 0, rotation: this.hall.rotation.y }, room);
          spaces.push({
            ...center,
            type: 'hall',
            spaceId: 'hall:' + room.n,
            rotation: this.hall.rotation.y,
            room,
            plan: {
              w: room.w,
              d: room.d,
              thickness: 0.85,
              navigation:
                room.kind === 'living'
                  ? [-1, 1].flatMap((side) => [
                      { x: side * 0.92, z: 0 },
                      { x: side * 1.05, z: 0 },
                      { x: side * 0.92, z: room.n === 'I' ? -1.1 : -1.6 },
                      { x: side * 0.92, z: room.n === 'I' ? 1.1 : 1.6 },
                      { x: 0, z: room.n === 'I' ? side * 1.1 : side * 1.6 },
                    ])
                  : [],
              inside: { x: room.w / 2 - 0.5, z: room.n === 'V' ? -0.4 : 0 },
              outside: { x: room.w / 2 + 1.4, z: room.n === 'V' ? -0.4 : 0 },
              stations: [
                { x: 0.9, z: -0.9 },
                { x: -0.9, z: 0.9 },
              ],
            },
          });
        }
      }
      this.tents.forEach((tent, index) => {
        if (
          !tent.visible ||
          index >= this.sim.state.resources.tents ||
          (this.sim.state.arrival && this.sim.state.arrival.tents[index]?.status !== 'pitched')
        )
          return;
        spaces.push({
          x: tent.position.x,
          z: tent.position.z,
          rotation: tent.rotation.y,
          type: 'tent',
          spaceId: 'tent:' + index,
          plan: {
            w: 3.5,
            d: 5,
            thickness: 0.12,
            inside: { x: 0, z: 1.6 },
            outside: { x: 0, z: 3.2 },
            stations: [],
          },
        });
      });
      this.cachedSpaces = spaces;
      return spaces;
    }

    operational(space) {
      if (space.type === 'hall') return this.sim.state.hallReady;
      if (space.type === 'tent') return true;
      return this.sim.state.buildings.some(
        (building) => building.id === space.id && building.condition > 15,
      );
    }

    // Routes may include operable doors. Physical actor movement still collides
    // with each current leaf; workers open it before trying to pass.
    actorClearAt(x, z, radius, id) {
      return (
        super.actorClearAt(x, z, radius, id) &&
        (!this.movingThroughDoors || !this.doorControls?.blocked(x, z, radius))
      );
    }

    clearAt(x, z, radius = 0.34) {
      return super.clearAt(x, z, radius) && !this.doorControls?.blocked(x, z, radius, true);
    }

    moveActor(...args) {
      this.movingThroughDoors = true;
      try {
        return super.moveActor(...args);
      } finally {
        this.movingThroughDoors = false;
      }
    }

    moveWorker(person, point, target, seconds, speedMultiplier = 1) {
      // Approach the next route waypoint, which can differ from the final
      // destination when a route crosses several Hall rooms.
      const next = this.routes.get(person.id)?.points[0] || target;
      this.doorControls?.beforeWorkerMove(person, next);
      return super.moveWorker(person, point, target, seconds, speedMultiplier);
    }

    nearby() {
      const door = this.view === 'walk' && this.doorControls?.nearby();
      return door ? { type: 'door', id: door.id } : super.nearby();
    }

    spaceAt(point) {
      return this.usableSpaces().find((space) => Spaces.contains(space, point));
    }

    prepareObstacles() {
      super.prepareObstacles();
      this.syncResourcePlotObstacles();
      if (!this.sim.state.config.inheritedHall) return;
      this.hallInside.updateWorldMatrix(true, true);
      this.hallInside.traverse((object) => {
        const shape = object.userData.walkObstacle;
        if (!shape) return;
        const add = (obstacle) =>
          this.staticCollisions.set('hall-furniture:' + object.id, obstacle);
        if (shape === true) this.addMeshObstacle(object, add);
        else {
          const point = object.getWorldPosition(new root.THREE.Vector3());
          const scale = object.getWorldScale(new root.THREE.Vector3());
          add({
            x: point.x,
            z: point.z,
            ...shape,
            radius: shape.radius ? shape.radius * scale.x : undefined,
            rotation: this.hall.rotation.y,
          });
        }
      });
      // The hearths remain hazards even with the roof hidden.
      for (const room of root.VinlandWorld.rooms.filter((room) => room.kind === 'living')) {
        const point = Spaces.toWorld({ x: 0, z: 0, rotation: this.hall.rotation.y }, room);
        this.staticCollisions.set('hearth:' + room.n, {
          ...point,
          w: room.n === 'I' ? 1.1 : 0.9,
          d: room.n === 'I' ? 1.1 : 2,
          rotation: this.hall.rotation.y,
        });
      }
    }

    path(start, target, actorId, depth = 0) {
      if (depth > 8) return []; // Guard malformed or cyclic room connections.
      const origin = this.spaceAt(start),
        destination = this.spaceAt(target);
      if (origin?.spaceId === destination?.spaceId) {
        return origin
          ? this.interiorPath(origin, start, target, actorId)
          : super.path(start, target, actorId);
      }
      if (origin?.type === 'hall' && destination?.type === 'hall') {
        const connectedRooms = super.path(start, target, actorId, 0.25);
        if (connectedRooms.length) return connectedRooms;
      }
      const points = [];
      let cursor = start;
      if (origin) {
        const inside = Spaces.toWorld(origin, origin.plan.inside);
        const outside = Spaces.toWorld(origin, origin.plan.outside);
        const exit = this.interiorPath(origin, cursor, inside, actorId);
        if (!exit.length && Math.hypot(cursor.x - inside.x, cursor.z - inside.z) > 0.3) return [];
        if (!this.segmentClear(inside, outside, 0.35, actorId)) return [];
        points.push(...exit, outside);
        cursor = outside;
      }
      if (destination) {
        const outside = Spaces.toWorld(destination, destination.plan.outside);
        const inside = Spaces.toWorld(destination, destination.plan.inside);
        const throughRoom = this.spaceAt(outside);
        const approach =
          throughRoom && throughRoom.spaceId !== destination.spaceId
            ? this.path(cursor, outside, actorId, depth + 1)
            : this.outdoorPath(cursor, outside, actorId);
        if (!approach.length && Math.hypot(cursor.x - outside.x, cursor.z - outside.z) > 0.3)
          return [];
        if (!this.segmentClear(outside, inside, 0.35, actorId)) return [];
        const interior = this.interiorPath(destination, inside, target, actorId);
        if (!interior.length && Math.hypot(inside.x - target.x, inside.z - target.z) > 0.3)
          return [];
        return [...points, ...approach, inside, ...interior];
      }
      const exterior = this.spaceAt(cursor)
        ? this.path(cursor, target, actorId, depth + 1)
        : this.outdoorPath(cursor, target, actorId);
      return exterior.length ? [...points, ...exterior] : [];
    }

    interiorPath(space, start, target, actorId) {
      if (this.segmentClear(start, target, 0.35, actorId)) return [{ x: target.x, z: target.z }];
      const aislePoints = (space.plan.navigation || [])
        .map((point) => Spaces.toWorld(space, point))
        .filter((point) => this.actorClearAt(point.x, point.z, 0.35, actorId));
      if (aislePoints.length) {
        // Visibility routing resolves narrow aisles in the building's own
        // coordinates. A world-aligned grid can miss these gaps after rotation.
        const points = [start, target, ...aislePoints];
        const distances = points.map(() => Infinity),
          parents = points.map(() => -1);
        const visited = new Set();
        distances[0] = 0;
        while (visited.size < points.length) {
          let nearest = -1;
          for (let index = 0; index < points.length; index++) {
            if (!visited.has(index) && (nearest < 0 || distances[index] < distances[nearest]))
              nearest = index;
          }
          if (nearest < 0 || !Number.isFinite(distances[nearest])) break;
          if (nearest === 1) {
            const route = [];
            for (let index = 1; index !== 0; index = parents[index])
              route.unshift({ x: points[index].x, z: points[index].z });
            return route;
          }
          visited.add(nearest);
          for (let index = 0; index < points.length; index++) {
            if (visited.has(index)) continue;
            const distance =
              distances[nearest] +
              Math.hypot(points[index].x - points[nearest].x, points[index].z - points[nearest].z);
            if (
              distance >= distances[index] ||
              !this.segmentClear(points[nearest], points[index], 0.35, actorId)
            )
              continue;
            distances[index] = distance;
            parents[index] = nearest;
          }
        }
      }
      return super.path(start, target, actorId, 0.25);
    }

    outdoorPath(start, outside, actorId) {
      // A coarse outdoor cell can land in a thick turf wall beside a narrow
      // Hall doorway. Refine approach and departure when the coarse path fails.
      for (const grid of [1.5, 0.5, 0.25]) {
        const route = super.path(start, outside, actorId, grid);
        if (route.length) return route;
      }
      // Keep a long approach on the outdoor grid, then resolve only the
      // entrance neighbourhood finely. Otherwise a narrow passage beside
      // Hall F's boat shed can exhaust the fine-grid search from far away.
      for (const radius of [3, 6]) {
        for (let direction = 0; direction < 8; direction++) {
          const angle = (direction * Math.PI) / 4;
          const approach = {
            x: outside.x + Math.cos(angle) * radius,
            z: outside.z + Math.sin(angle) * radius,
          };
          if (!this.clearAt(approach.x, approach.z, 0.45)) continue;
          const entrance = super.path(approach, outside, actorId, 0.25);
          if (!entrance.length) continue;
          const route = super.path(start, approach, actorId);
          if (route.length) return [...route, ...entrance];
        }
      }
      return [];
    }

    interiorPoints(space) {
      const points = [...space.plan.stations];
      for (let z = -space.plan.d / 2 + 1.4; z <= space.plan.d / 2 - 1.4; z += 0.9) {
        for (const x of [-0.65, 0.65]) points.push({ x, z });
      }
      return points
        .map((point) => Spaces.toWorld(space, point))
        .filter((point) => this.clearAt(point.x, point.z, 0.35))
        .slice(0, 8);
    }

    indoorTarget(space, person, reserved = []) {
      for (const point of this.interiorPoints(space)) {
        if (reserved.some((other) => Math.hypot(other.x - point.x, other.z - point.z) < 0.75))
          continue;
        if (!this.actorClearAt(point.x, point.z, 0.35, 'person:' + person.id)) continue;
        if (
          Math.hypot(person.x - point.x, person.z - point.z) > 0.3 &&
          !this.path(person, point).length
        )
          continue;
        return point;
      }
      return null;
    }

    workplacePoint(building, person) {
      const space = this.usableSpaces().find(
        (space) => space.spaceId === 'building:' + building.id,
      );
      const point = space
        ? this.indoorTarget(space, person)
        : this.findWorkerPosition(building, person.id);
      return point ? { ...point, workplaceId: 'building:' + building.id } : null;
    }

    workAssignment(task, person) {
      // A charcoal pit is an outdoor workplace, not an enclosed room.
      if (task === 'craft' && !this.sim.has('smithy')) {
        for (const building of this.sim.state.buildings.filter(
          (building) => building.type === 'charcoal' && building.condition > 15,
        )) {
          const point = this.workplacePoint(building, person);
          if (point) return point;
        }
      }
      if (!['craft', 'herding'].includes(task)) return null;
      const types = task === 'craft' ? ['smithy', 'workshop'] : ['carehut', 'byre'];
      const spaces = this.usableSpaces()
        .filter((space) => this.operational(space))
        .filter(
          (space) =>
            types.includes(space.type) ||
            (task === 'herding' && space.spaceId === 'hall:IV' && this.sim.state.hallReady),
        )
        .sort(
          (a, b) =>
            (types.indexOf(a.type) < 0 ? types.length : types.indexOf(a.type)) -
            (types.indexOf(b.type) < 0 ? types.length : types.indexOf(b.type)),
        );
      for (const space of spaces) {
        const reserved = this.sim.state.people
          .filter(
            (other) =>
              other.id !== person.id &&
              other.alive &&
              !other.away &&
              other.order?.workplaceId === space.spaceId,
          )
          .map((other) => other.order);
        const target = this.indoorTarget(space, person, reserved);
        if (target) return { ...target, workplaceId: space.spaceId };
      }
      return null;
    }

    workDestination(person) {
      const order = person.order;
      if (order?.type !== 'work' || !['craft', 'herding'].includes(order.task))
        return super.workDestination(person);
      const outdoor = this.sim.state.buildings.find(
        (building) =>
          'building:' + building.id === order.workplaceId &&
          building.type === 'charcoal' &&
          building.condition > 15,
      );
      if (outdoor) return order;
      const space = this.usableSpaces().find((space) => space.spaceId === order.workplaceId);
      if (
        space &&
        this.operational(space) &&
        Spaces.contains(space, order) &&
        this.clearAt(order.x, order.z, 0.35)
      )
        return order;
      if (order.indoorRetryAt > this.sim.state.time) return null;
      const indoor = this.workAssignment(order.task, person);
      if (indoor) {
        Object.assign(order, indoor);
        delete order.status;
        delete order.indoorRetryAt;
      } else if (
        this.usableSpaces()
          .filter((space) => this.operational(space))
          .some(
            (space) =>
              (order.task === 'craft' ? ['smithy', 'workshop'] : ['carehut', 'byre']).includes(
                space.type,
              ) ||
              (order.task === 'herding' && space.spaceId === 'hall:IV' && this.sim.state.hallReady),
          )
      ) {
        order.status = 'Waiting for an indoor work station.';
        order.indoorRetryAt = this.sim.state.time + 30 / 3600;
        return null;
      } else if (order.workplaceId) {
        delete order.workplaceId;
        Object.assign(
          order,
          this.findWorkerPosition(this.supportWorkLocation(order.task), person.id),
        );
      }
      return order;
    }

    deliveryPoint(resource, person) {
      const Storage = root.VinlandStorage;
      Storage.syncStores(this.sim.state);
      const stores = Object.values(this.sim.state.storage.stores).filter(
        (store) =>
          ['woodshed', 'storehouse', 'haybarn'].includes(store.type) &&
          Storage.roomFor(this.sim.state, store, resource) > 1e-7,
      );
      stores.sort(
        (a, b) =>
          Math.hypot(a.x - person.x, a.z - person.z) - Math.hypot(b.x - person.x, b.z - person.z),
      );
      stores.push(this.sim.state.storage.stores.camp);
      for (const store of stores) {
        if (Storage.roomFor(this.sim.state, store, resource) <= 1e-7) continue;
        const point = this.resourceStoragePoint(store, resource, person, true);
        if (!point) continue;
        if (person.order) person.order.storePoint = point;
        return point;
      }
      return null;
    }

    storagePoint(id, person, resource = person.cargo?.resource || person.order?.resource) {
      const store = this.sim.state.storage.stores[id];
      if (!root.VinlandStorage.operational(this.sim.state, store)) return null;
      if (!root.VinlandStorage.KEYS.includes(resource)) return null;
      const point = this.resourceStoragePoint(store, resource, person, !!person.cargo);
      if (point && person.order) person.order.logisticsPoint = point;
      return point;
    }

    reserveResourcePlot(store, index, plot) {
      if (!this.staticCollisions) return;
      this.staticCollisions.set('storage-plot:' + store.id + ':' + index, {
        x: plot.x,
        z: plot.z,
        ...root.VinlandStorage.OUTDOOR_STORAGE_BAY,
        rotation: 0,
      });
    }

    syncResourcePlotObstacles() {
      for (const id of this.resourceObstacleIds || []) this.staticCollisions?.remove(id);
      this.resourceObstacleIds = new Set();
      for (const store of Object.values(this.sim.state.storage.stores)) {
        for (const pile of root.VinlandStorage.resourcePiles(this.sim.state, store)) {
          if (pile.indoor) continue;
          const index = Number(pile.id.split(':yard:')[1]);
          this.reserveResourcePlot(store, index, pile);
          this.resourceObstacleIds.add('storage-plot:' + store.id + ':' + index);
        }
      }
    }

    ensureResourcePlots(store, incomingResource = null, incomingAmount = 0) {
      if (['ship', 'ferry'].includes(store.type)) return true;
      const Storage = root.VinlandStorage;
      const bay = Storage.OUTDOOR_STORAGE_BAY;
      store.resourcePlots ||= [];
      const requirements = Storage.KEYS.map((resource) => {
        const volume = Storage.outdoorResourceVolume(
          this.sim.state,
          store,
          resource,
          incomingResource === resource ? incomingAmount : 0,
        );
        return { resource, required: Math.ceil(volume / (bay.w * bay.d * bay.h) - 1e-9) };
      });
      const signature =
        requirements.map((entry) => entry.required).join(':') +
        ':' +
        this.geometrySignature +
        ':' +
        this.sim.state.harvest.revision;
      this.resourcePlotSearchFailures ||= new Map();
      if (this.resourcePlotSearchFailures.get(store.id) === signature) return false;
      let searchCursor = 0;
      for (const { resource, required } of requirements) {
        let count = store.resourcePlots.filter((plot) => plot.resource === resource).length;
        while (count < required) {
          if (store.resourcePlots.length >= 1000) return false;
          let location = null;
          // Allocate stable, saved ground plots. Reserve the whole bay so
          // growth never pushes a stack into a neighbouring pile or route.
          while (searchCursor < 32 * 24 && !location) {
            const radius = 3 * (1 + Math.floor(searchCursor / 24));
            const step = searchCursor++ % 24;
            const angle = (step * Math.PI * 2) / 24;
            const x = store.x + Math.sin(angle) * radius;
            const z = store.z + Math.cos(angle) * radius;
            const clearance = Math.hypot(bay.w, bay.d) / 2 + 0.55;
            if (!this.actorClearAt(x, z, clearance)) continue;
            // Empty saved plots have no solid collision body, but their
            // storage spaces must still be kept separate from new plots.
            const overlapsPlot = Object.values(this.sim.state.storage.stores).some((other) =>
              (other.resourcePlots || []).some(
                (plot) => Math.abs(plot.x - x) < bay.w + 0.8 && Math.abs(plot.z - z) < bay.d + 0.8,
              ),
            );
            if (overlapsPlot) continue;
            if (this.spaceAt({ x, z })) continue;
            const ground = Model.elevation(x, z, this.sim.state.config);
            const corners = [-1, 1].flatMap((dx) =>
              [-1, 1].map((dz) => ({ x: x + (dx * bay.w) / 2, z: z + (dz * bay.d) / 2 })),
            );
            if (
              corners.some(
                (point) =>
                  !this.clearAt(point.x, point.z, 0.4) ||
                  Math.abs(Model.elevation(point.x, point.z, this.sim.state.config) - ground) >
                    0.35,
              )
            )
              continue;
            location = { resource, x, z };
          }
          if (!location) {
            this.resourcePlotSearchFailures.set(store.id, signature);
            return false;
          }
          store.resourcePlots.push(location);
          this.routes?.clear();
          count++;
        }
      }
      this.resourcePlotSearchFailures.delete(store.id);
      return true;
    }

    // Hand transfers must respect walls and the current door leaf, even when
    // worker route planning would allow opening that door later.
    canReachSupply(person, pile) {
      const point = root.VinlandSupplies.edgePoint(person, pile);
      const distance = Math.hypot(point.x - person.x, point.z - person.z);
      if (distance > root.VinlandSupplies.REACH) return false;
      const steps = Math.max(1, Math.ceil(distance / 0.08));
      for (let step = 1; step <= steps; step++) {
        const fraction =
          ((Math.max(0, distance - 0.12) / Math.max(distance, 0.001)) * step) / steps;
        const x = person.x + (point.x - person.x) * fraction;
        const z = person.z + (point.z - person.z) * fraction;
        if (!this.clearAt(x, z, 0.03) || this.doorControls?.blocked(x, z, 0.03)) return false;
      }
      return true;
    }

    canPlaceSupply(person, point) {
      const bay = root.VinlandStorage.OUTDOOR_STORAGE_BAY;
      if (!this.canReachSupply(person, { ...point, ...bay })) return false;
      const ground = Model.elevation(point.x, point.z, this.sim.state.config);
      for (let ix = -3; ix <= 3; ix++) {
        for (let iz = -2; iz <= 2; iz++) {
          const x = point.x + (ix * bay.w) / 6,
            z = point.z + (iz * bay.d) / 4;
          if (
            !this.actorClearAt(x, z, 0.12, 'person:' + person.id) ||
            Math.hypot(x - person.x, z - person.z) < 0.48 ||
            this.spaceAt({ x, z }) ||
            Math.abs(Model.elevation(x, z, this.sim.state.config) - ground) > 0.35
          )
            return false;
        }
      }
      return true;
    }

    supplyPlacement(person, load) {
      const Storage = root.VinlandStorage,
        Supplies = root.VinlandSupplies;
      const candidates = Object.values(this.sim.state.storage.stores).flatMap((store) =>
        Storage.supplyBays(this.sim.state, store, load.resource),
      );
      const reachable = candidates.filter((pile) => Supplies.reachable(this.sim, person, pile));
      reachable.sort(
        (a, b) =>
          Math.hypot(a.x - person.x, a.z - person.z) - Math.hypot(b.x - person.x, b.z - person.z),
      );
      if (reachable.length) return { storeId: reachable[0].storeId, pileId: reachable[0].id };
      const point = {
        x: person.x + Math.sin(this.walkYaw) * 2,
        z: person.z + Math.cos(this.walkYaw) * 2,
      };
      return this.canPlaceSupply(person, point)
        ? { point }
        : {
            error:
              'There is no clear, reachable ground for this load. Move beside a storage bay or clear ground.',
          };
    }

    resourceTransferPile(store, resource, incomingAmount = 0) {
      const Storage = root.VinlandStorage;
      const current = Storage.resourcePiles(this.sim.state, store);
      // Aggregate stock fills bays in order. Withdraw from the last occupied
      // bay, so the pile beside the carrier is the one that actually shrinks.
      if (!incomingAmount) return current.filter((pile) => pile.resource === resource).pop();
      const preview = Storage.resourcePiles(this.sim.state, store, resource, incomingAmount);
      return preview.find(
        (pile) =>
          pile.resource === resource &&
          pile.occupied > (current.find((old) => old.id === pile.id)?.occupied || 0) + 1e-7,
      );
    }

    resourceStoragePoint(store, resource, person, delivering) {
      const Storage = root.VinlandStorage;
      const amount = delivering
        ? Math.min(
            person.cargo?.amount || Storage.loadSize(resource),
            Storage.roomFor(this.sim.state, store, resource),
          )
        : 0;
      if (delivering && amount <= 1e-7) return null;
      if (!this.ensureResourcePlots(store, resource, amount)) return null;
      const pile = this.resourceTransferPile(store, resource, amount);
      if (!pile) return null;
      const localPoints = pile.indoor
        ? [{ x: -pile.side * (pile.w / 2 + 0.55), z: 0 }]
        : [
            { x: pile.w / 2 + 0.55, z: 0 },
            { x: -pile.w / 2 - 0.55, z: 0 },
            { x: 0, z: pile.d / 2 + 0.55 },
            { x: 0, z: -pile.d / 2 - 0.55 },
          ];
      const points = localPoints.map((point) => Spaces.toWorld(pile, point));
      points.sort(
        (a, b) =>
          Math.hypot(a.x - person.x, a.z - person.z) - Math.hypot(b.x - person.x, b.z - person.z),
      );
      for (const point of points) {
        if (!this.actorClearAt(point.x, point.z, 0.35, 'person:' + person.id)) continue;
        const cached = [person.order?.storePoint, person.order?.logisticsPoint].some(
          (entry) =>
            entry?.id === store.id && Math.hypot(entry.x - point.x, entry.z - point.z) < 0.1,
        );
        if (cached) return { ...point, id: store.id };
        if (
          Math.hypot(point.x - person.x, point.z - person.z) > 0.35 &&
          !this.path(person, point, 'person:' + person.id).length
        )
          continue;
        return { ...point, id: store.id };
      }
      return null;
    }

    shelterPlaces() {
      const places = [];
      for (const space of this.usableSpaces()) {
        if (!this.operational(space)) continue;
        const capacity =
          space.type === 'hall'
            ? this.sim.state.hallReady
              ? ROOM_CAPACITY[space.room.n] || 0
              : 0
            : space.type === 'tent'
              ? 8
              : Model.TYPES[space.type].shelter || 0;
        if (!capacity) continue;
        const localPoints = space.plan.berths || [];
        if (!localPoints.length) {
          const x = space.type === 'tent' ? 0.45 : 0.92;
          for (let z = -space.plan.d / 2 + 0.65; z < space.plan.d / 2 - 0.65; z += 0.72)
            localPoints.push({ x: -x, z }, { x, z });
        }
        let count = 0;
        for (const local of localPoints) {
          const point = Spaces.toWorld(space, local);
          if (!this.clearAt(point.x, point.z, 0.35)) continue;
          places.push({
            ...point,
            spaceId: space.spaceId,
            slot: count++,
            warmth: space.type === 'hall' || Model.TYPES[space.type]?.winter ? 1 : 0.2,
          });
          if (count >= capacity) break;
        }
      }
      return places;
    }

    shelterDestination(person) {
      if (person.restRetryAt > this.sim.state.time) return null;
      const places = this.cachedShelterPlaces || this.shelterPlaces();
      const saved = person.restPlace;
      const current =
        saved &&
        places.find((place) => place.spaceId === saved.spaceId && place.slot === saved.slot);
      const reserved = new Set(
        this.sim.state.people
          .filter(
            (other) => other.id !== person.id && other.alive && !other.away && other.restPlace,
          )
          .map((other) => other.restPlace.spaceId + ':' + other.restPlace.slot),
      );
      if (current && !reserved.has(current.spaceId + ':' + current.slot)) {
        Object.assign(saved, current);
        return saved;
      }
      const candidates = places
        .filter((place) => !reserved.has(place.spaceId + ':' + place.slot))
        .sort(
          (a, b) =>
            b.warmth - a.warmth ||
            Math.hypot(a.x - person.x, a.z - person.z) - Math.hypot(b.x - person.x, b.z - person.z),
        );
      for (const place of candidates) {
        if (!this.actorClearAt(place.x, place.z, 0.35, 'person:' + person.id)) continue;
        if (
          !this.path(person, place).length &&
          Math.hypot(person.x - place.x, person.z - place.z) > 0.3
        )
          continue;
        person.restPlace = { ...place };
        return person.restPlace;
      }
      delete person.restPlace;
      person.restRetryAt = this.sim.state.time + 30 / 3600;
      return null;
    }

    restDestination(person) {
      const order = person.order;
      if (!order || ['move', 'shelter'].includes(order.type)) return null;
      const end = 8 + (order.type === 'work' ? this.sim.state.politics.workHours : 10);
      return this.sim.hour < 8 || this.sim.hour >= end ? this.shelterDestination(person) : null;
    }

    preparePeople() {
      this.doorControls?.update();
      const signature =
        this.geometrySignature +
        ':' +
        this.sim.state.hallReady +
        ':' +
        this.sim.state.buildings.map((building) => building.condition > 15).join(',');
      if (signature !== this.shelterSignature) {
        this.shelterSignature = signature;
        this.cachedShelterPlaces = this.shelterPlaces();
        for (const person of this.sim.state.people) delete person.restRetryAt;
      }
      const spaces = this.usableSpaces();
      for (const person of this.sim.presentPeople) {
        if (
          this.sim.state.arrival &&
          (Number.isInteger(person.arrivalShip) || person.arrivalFerry)
        ) {
          person.shelterWarmth = 0.2;
          person.insideSpace = null;
          continue;
        }
        const space = spaces.find((space) => Spaces.contains(space, person, 0.15));
        const residential =
          space &&
          this.operational(space) &&
          (space.type === 'tent' ||
            (space.type === 'hall'
              ? this.sim.state.hallReady && ROOM_CAPACITY[space.room.n]
              : Model.TYPES[space.type].shelter));
        person.shelterWarmth = residential
          ? space.type === 'hall' || Model.TYPES[space.type]?.winter
            ? 1
            : 0.2
          : 0;
        person.insideSpace = space?.spaceId || null;
      }
    }

    actorElevation(x, z, actorId) {
      const ground = super.actorElevation(x, z, actorId);
      const floorHeight = (space) =>
        Model.elevation(
          space.type === 'hall' ? 0 : space.x,
          space.type === 'hall' ? 0 : space.z,
          this.sim.state.config,
        ) + (space.type === 'hall' ? 0.14 : 0.09);
      const space =
        this.spaceAt({ x, z }) || this.indoorPresentation?.hallPassageAt({ x, z })?.rooms[0];
      if (space) return space.type === 'tent' ? ground : floorHeight(space);
      // A short earth threshold joins the level floor to sloping terrain.
      // This also keeps the follow camera smooth while passing the doorway.
      for (const candidate of this.usableSpaces()) {
        if (candidate.type === 'tent') continue;
        const point = Spaces.toLocal(candidate, { x, z });
        const sideDoor = candidate.type === 'hall';
        const beyond = sideDoor ? point.x - candidate.plan.w / 2 : point.z - candidate.plan.d / 2;
        const across = sideDoor ? point.z : point.x;
        if (beyond >= 0 && beyond < 1.5 && Math.abs(across) < (candidate.plan.doorWidth || 1.1) / 2)
          return ground + (floorHeight(candidate) - ground) * (1 - beyond / 1.5);
      }
      return ground;
    }

    updateInteriorVisibility() {
      const cutaway = this.view !== 'walk' && this.cutaway;
      for (const building of this.sim.state.buildings) {
        const object = this.objects.get(building.id);
        if (!object) continue;
        object.userData.roof.visible = !cutaway;
        object.userData.base.traverse((mesh) => {
          if (!mesh.userData.structuralWall) return;
          mesh.material.transparent = false;
          mesh.material.opacity = 1;
          mesh.material.depthWrite = true;
        });
      }
      this.tents.forEach((tent, index) => {
        const open = cutaway;
        tent.traverse((mesh) => {
          if (mesh.isMesh && mesh.geometry.type === 'BufferGeometry') mesh.visible = !open;
        });
      });
      this.hallRoofs.visible = !cutaway;
      this.hallWalls.scale.y = cutaway ? 0.4 : 1;
    }

    sync() {
      this.cachedSpaces = null;
      root.VinlandStorage.syncStores(this.sim.state);
      super.sync();
      this.syncStorageMarkers();
      this.doorControls?.sync();
      this.indoorPresentation.installMaterials();
      this.updateInteriorVisibility();
    }
    syncStorageMarkers() {
      this.resourcePileMarkers ||= new Map();
      const state = this.sim.state;
      const livePiles = new Set();
      for (const store of Object.values(state.storage.stores)) {
        if (['ship', 'ferry'].includes(store.type)) continue;
        this.ensureResourcePlots(store);
        for (const pile of root.VinlandStorage.resourcePiles(state, store)) {
          livePiles.add(pile.id);
          let marker = this.resourcePileMarkers.get(pile.id);
          const previous = marker?.userData.pile;
          if (
            marker &&
            (Math.abs(previous.occupied - pile.occupied) > 1e-9 ||
              previous.x !== pile.x ||
              previous.z !== pile.z ||
              previous.rotation !== pile.rotation ||
              previous.resource !== pile.resource)
          ) {
            this.disposeStorageMarker(marker);
            marker = null;
          }
          if (!marker) {
            marker = this.buildResourcePile(pile);
            const building = state.buildings.find((entry) => 'building:' + entry.id === store.id);
            marker.position.set(
              pile.x,
              Model.elevation(
                pile.indoor ? building.x : pile.x,
                pile.indoor ? building.z : pile.z,
                state.config,
              ) + (pile.indoor ? 0.16 : 0.02),
              pile.z,
            );
            marker.rotation.y = pile.rotation || 0;
            this.scene.add(marker);
            this.resourcePileMarkers.set(pile.id, marker);
          }
        }
      }
      for (const [id, marker] of this.resourcePileMarkers) {
        if (livePiles.has(id)) continue;
        this.disposeStorageMarker(marker);
        this.resourcePileMarkers.delete(id);
      }
      this.syncResourcePlotObstacles();
    }
    disposeStorageMarker(marker) {
      marker.removeFromParent();
      marker.traverse((mesh) => {
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) material?.dispose();
        if (mesh.isInstancedMesh) mesh.dispose();
      });
    }
    update(seconds) {
      this.doorControls?.update();
      // Simulation transfers run before the render update. Sync here so the
      // destination pile appears in the same frame the carried bundle empties.
      this.syncStorageMarkers();
      this.updateInteriorVisibility();
      super.update(seconds);
    }
    destroy() {
      for (const marker of this.resourcePileMarkers?.values() || [])
        this.disposeStorageMarker(marker);
      this.doorControls.destroy();
      this.indoorPresentation.destroy();
      super.destroy();
    }
  }
  root.VinlandWorld.InteriorWorld = InteriorWorld;
})(window);
