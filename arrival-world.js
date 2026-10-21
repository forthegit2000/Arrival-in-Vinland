/** Local landfall presentation and navigation. Outcomes remain in arrival.js. */
(function (root) {
  'use strict';
  const THREE = root.THREE,
    Arrival = root.VinlandArrival,
    Storage = root.VinlandStorage;
  const Spaces = root.VinlandBuildingSpaces,
    Model = root.VinlandModel;
  class ArrivalWorld extends root.VinlandWorld.InteriorWorld {
    buildScene() {
      super.buildScene();
      if (!this.sim.state.arrival) return;
      this.arrivalTender = this.buildHull(5.5, 1.9, true);
      this.arrivalTender.scale.y = 0.42;
      this.arrivalTender.name = 'Crewed landing boat';
      this.scene.add(this.arrivalTender);
      this.arrivalOars = [-1, 1].map((side) => {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.8, 0.65, -1.15);
        const wood = new THREE.MeshStandardMaterial({ color: 0x967149, roughness: 0.85 });
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 6), wood);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.x = side * 0.65;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.07, 0.18), wood);
        blade.position.x = side * 1.9;
        pivot.add(shaft, blade);
        this.scene.add(pivot);
        return pivot;
      });
      this.arrivalCargo = new Map();
      this.arrivalTentBundles = new Map();
      this.prepareArrivalSeats();
      this.updateArrivalTents();
    }
    boatFrame(index) {
      const frame = super.boatFrame(index),
        saved = this.sim.state.arrival?.shipPoses[index];
      return frame && saved ? { ...frame, ...saved } : frame;
    }
    prepareArrivalSeats() {
      const state = this.sim.state,
        a = state.arrival;
      if (!a || a.seatsPrepared) return;
      for (let index = 0; index < this.ships.length; index++) {
        const boat = this.boatFrame(index),
          berths = [];
        for (let z = -6.8; z <= 6.8; z += 0.75)
          for (let x = -1.5; x <= 1.5; x += 0.75) {
            if (index === a.livestockShip && Math.abs(z) < 5.8) continue;
            const p = Spaces.toWorld(boat, { x, z });
            if (
              this.deckContains(boat, p, 0.34) &&
              !boat.geometry.obstacles.some((shape) =>
                root.VinlandCollision.circleIntersects(x, z, 0.34, shape),
              )
            )
              berths.push({ x, z });
          }
        let next = 0;
        for (const person of state.people.filter(
          (p) => p.arrivalShip === index && !p.arrivalFerry,
        )) {
          const local = berths[next++];
          if (!local) throw Error('The passenger manifest exceeds the available deck places.');
          person.arrivalSeat = local;
          Object.assign(person, Spaces.toWorld(boat, local));
          this.agentPositions.set(person.id, { x: person.x, z: person.z });
          if (person.id === state.leader.id)
            Object.assign(state.leader, { x: person.x, z: person.z });
        }
      }
      a.seatsPrepared = true;
    }
    arrivalLandingClear(p) {
      return Arrival.canLand(this.sim.state, p) && this.clearAt(p.x, p.z, 2.2) && !this.spaceAt(p);
    }
    suggestArrivalLanding() {
      const base = Arrival.defaultLanding(this.sim.state);
      for (let radius = 0; radius < 50; radius += 3)
        for (let step = 0; step < 16; step++) {
          const p = {
            x: base.x + Math.sin((step * Math.PI) / 8) * radius,
            z: base.z + Math.cos((step * Math.PI) / 8) * radius,
          };
          if (this.arrivalLandingClear(p)) return p;
        }
      return base;
    }
    arrivalPersonTarget(index, personId) {
      const state = this.sim.state,
        a = state.arrival,
        person = state.people[personId];
      const desired = {
        x: a.landing.x + ((index % 5) - 2) * 1.1,
        z: a.landing.z + Math.floor(index / 5) * 1.1,
      };
      if (index === 0 && person?.order?.type === 'arrival' && person.order.action === 'unload') {
        const helpers = state.people.filter(
          (helper) =>
            helper.order?.type === 'arrival' &&
            helper.order.action === 'unload' &&
            !Arrival.aboard(helper),
        );
        const rank = helpers.indexOf(person),
          normal = Arrival.shoreNormal(a.landing.x, a.landing.z),
          spacing = 2.4,
          alongShore = (rank - (helpers.length - 1) / 2) * spacing;
        // Returning carriers need separate access points. Otherwise helpers
        // waiting at one shared point can block the last carrier's return.
        desired.x = a.landing.x - normal.z * alongShore;
        desired.z = a.landing.z + normal.x * alongShore;
      }
      return (
        this.findActorPosition(
          desired,
          0.34,
          personId === undefined ? undefined : 'person:' + personId,
        ) || desired
      );
    }
    arrivalAnimalTarget(index) {
      const a = this.sim.state.arrival;
      const normal = Arrival.shoreNormal(a.landing.x, a.landing.z);
      const desired = {
        x: a.landing.x + normal.x * 15 + ((index % 6) - 2.5) * 2.2,
        z: a.landing.z + normal.z * 15 + Math.floor(index / 6) * 2.2,
      };
      return this.findActorPosition(desired, 0.8, 'animal:' + index) || desired;
    }
    arrivalAssemblyTarget(personId) {
      const landing = this.sim.state.arrival.landing;
      const normal = Arrival.shoreNormal(landing.x, landing.z);
      const desired = root.VinlandIdlePeople.assemblyPoint(landing, normal, personId);
      return (
        this.findIdleRestSpot(desired, personId) || {
          ...(this.findActorPosition(desired, 0.5, 'person:' + personId) || desired),
          heading: desired.heading,
        }
      );
    }
    syncArrivalPerson(person) {
      this.agentPositions.set(person.id, { x: person.x, z: person.z });
      this.actorCollisions?.set('person:' + person.id, { x: person.x, z: person.z, radius: 0.34 });
      if (person.id === this.sim.state.leader.id && person.arrivalFerry) {
        this.previousWalkPose = this.currentWalkPose || { ...this.sim.state.leader };
        this.currentWalkPose = { ...this.sim.state.leader };
      }
    }
    arrivalDropPoint(resource, person) {
      const state = this.sim.state,
        order = person.order;
      this.arrivalDropDestinations ||= new WeakMap();
      const previous = this.arrivalDropDestinations.get(person);
      // Remember route validation only for this order and load. After loading
      // a save, or changing the world, the first delivery must find a route again.
      const reusable =
        previous &&
        previous.order === order &&
        previous.load === person.arrivalCarry &&
        previous.resource === resource &&
        previous.geometry === this.geometrySignature &&
        previous.harvest === state.harvest.revision &&
        !(person.arrivalBlocked && !previous.blocked);
      if (order && !reusable) delete order.storePoint;

      // This still checks capacity, the current pile and actor clearance on
      // every call. Only an unchanged, previously reachable point skips A*.
      const point = this.resourceStoragePoint(state.storage.stores.camp, resource, person, true);
      if (order) order.storePoint = point;
      this.arrivalDropDestinations.set(person, {
        order,
        load: person.arrivalCarry,
        resource,
        geometry: this.geometrySignature,
        harvest: state.harvest.revision,
        blocked: !!person.arrivalBlocked,
      });
      return point;
    }
    moveArrivalPerson(person, target, seconds) {
      const current = this.agentPositions.get(person.id);
      if (current && Math.hypot(current.x - person.x, current.z - person.z) > 2)
        Object.assign(current, { x: person.x, z: person.z });
      const d = Math.hypot(target.x - person.x, target.z - person.z);
      if (d <= 0.8) {
        delete person.arrivalBlocked;
        return true;
      }
      this.arrivalRouteRetries ||= new Map();
      const key = target.x + ':' + target.z;
      const retry = this.arrivalRouteRetries.get(person.id);
      if (retry?.key === key && retry.seconds > 0) {
        retry.seconds -= seconds;
        return false;
      }
      const moved = this.movePerson(person, target, seconds);
      const arrived = Math.hypot(target.x - person.x, target.z - person.z) <= 0.8;
      person.arrivalBlocked = !moved && !arrived;
      if (person.arrivalBlocked) this.arrivalRouteRetries.set(person.id, { key, seconds: 1 });
      else this.arrivalRouteRetries.delete(person.id);
      return arrived;
    }
    actorClearAt(x, z, radius, id) {
      const index = typeof id === 'string' && id.startsWith('person:') ? Number(id.slice(7)) : -1;
      const person = this.sim.state.people[index];
      if (this.sim.state.arrival && person && Arrival.aboard(person)) {
        if (person.arrivalFerry) return true;
        const boat = this.boatFrame(person.arrivalShip);
        return (
          !!boat &&
          this.deckContains(boat, { x, z }, radius) &&
          !this.actorCollisions?.blocked(x, z, radius, id)
        );
      }
      return super.actorClearAt(x, z, radius, id);
    }
    actorElevation(x, z, id) {
      const person = this.sim.state.people[id];
      if (this.sim.state.arrival && person && Arrival.aboard(person)) {
        if (person.arrivalFerry) return 0.42;
        return (this.ships[person.arrivalShip]?.position.y || 0.06) + 1.16;
      }
      return super.actorElevation(x, z, id);
    }
    leaderSurfaceAt(p) {
      const state = this.sim.state,
        person = state.people[state.leader.id];
      if (state.arrival && person?.arrivalFerry)
        return { mode: 'boat', depth: 0, height: 0.42, surface: 0.02 };
      return super.leaderSurfaceAt(p);
    }
    nearby() {
      const a = this.sim.state.arrival,
        p = this.sim.state.people[this.sim.state.leader.id];
      if (a && p.arrivalFerry) return null;
      if (a && Number.isInteger(p.arrivalShip)) return { type: 'go-ashore', id: p.arrivalShip };
      return super.nearby();
    }
    setWalkTentPlacement(active) {
      if (!active) {
        if (this.walkTentPreview) this.disposeStorageMarker(this.walkTentPreview);
        this.walkTentPreview = null;
        this.walkTentPlacement = null;
        return;
      }
      this.setWalkTentPlacement(false);
      this.walkTentPreview = this.buildTent(0);
      this.walkTentPreview.traverse((object) => {
        delete object.userData.select;
        if (!object.isMesh) return;
        object.material = object.material.clone();
        object.material.transparent = true;
        object.material.opacity = 0.35;
        object.material.depthWrite = false;
        object.castShadow = false;
      });
      this.scene.add(this.walkTentPreview);
      this.updateWalkTentPlacement();
    }
    updateWalkTentPlacement() {
      if (!this.walkTentPreview) return;
      const leader = this.sim.state.leader;
      const point = {
        x: leader.x + Math.sin(this.walkYaw) * 8,
        z: leader.z + Math.cos(this.walkYaw) * 8,
      };
      const valid =
        this.view === 'walk' &&
        this.withinMap(point.x, point.z, 4) &&
        this.canPitchArrivalTent(point);
      this.walkTentPlacement = { ...point, valid };
      this.walkTentPreview.position.set(
        point.x,
        Model.elevation(point.x, point.z, this.sim.state.config) + 0.04,
        point.z,
      );
      this.walkTentPreview.traverse((object) => {
        if (object.isMesh) object.material.color.set(valid ? 0x86d6ad : 0xf18d7c);
      });
    }
    useNearbyBoat() {
      const result = super.useNearbyBoat(),
        state = this.sim.state;
      if (result && state.arrival)
        state.people[state.leader.id].arrivalShip = this.deckBoatAt(state.leader)?.index ?? null;
      return result;
    }
    updateArrivalTents() {
      const a = this.sim.state.arrival;
      if (!a) return;
      const signature = a.tents.map((t) => t.status + ':' + t.x + ':' + t.z).join('|');
      if (signature !== this.arrivalTentSignature) {
        this.arrivalTentSignature = signature;
        this.cachedSpaces = null;
        this.shelterSignature = null;
        this.geometrySignature = null;
      }
      this.tents.forEach((object, index) => {
        const tent = a.tents[index];
        object.visible = !!tent && ['pitching', 'pitched'].includes(tent.status);
        if (!object.visible) return;
        object.position.set(tent.x, Model.elevation(tent.x, tent.z, this.sim.state.config), tent.z);
        object.rotation.y = tent.rotation;
        object.scale.y =
          tent.status === 'pitched' ? 1 : 0.15 + (0.85 * tent.progress) / Arrival.TENT_HOURS;
      });
    }
    canPitchArrivalTent(p) {
      if (
        !Arrival.canLand(this.sim.state, p) &&
        Model.landDistance(p.x, p.z, this.sim.state.config) < 4
      )
        return false;
      const floor = Model.elevation(p.x, p.z, this.sim.state.config);
      for (const x of [-2, 0, 2])
        for (const z of [-2.7, 0, 2.7]) {
          if (
            !this.clearAt(p.x + x, p.z + z, 0.4) ||
            this.spaceAt({ x: p.x + x, z: p.z + z }) ||
            Math.abs(Model.elevation(p.x + x, p.z + z, this.sim.state.config) - floor) > 0.5
          )
            return false;
        }
      // Reserve a usable strip beside the canvas for people pitching it.
      // A clear footprint alone can leave every working position inside a rock.
      for (const z of [-2.1, -1.05, 0, 1.05, 2.1])
        if (!this.clearAt(p.x + 2.8, p.z + z, 0.4)) return false;
      return !this.sim.state.arrival.tents.some(
        (t) =>
          ['pitching', 'pitched'].includes(t.status) &&
          Math.abs(t.x - p.x) < 5 &&
          Math.abs(t.z - p.z) < 6.5,
      );
    }
    prepareObstacles() {
      this.updateArrivalTents();
      super.prepareObstacles();
    }
    sync() {
      this.prepareArrivalSeats();
      this.updateArrivalTents();
      super.sync();
      this.updateArrivalTents();
    }
    animateShips(elapsed) {
      const a = this.sim.state.arrival;
      if (!a) return super.animateShips(elapsed);
      a.shipPoses.forEach((pose, index) => {
        this.shipPositions[index] = [pose.x, pose.z];
        Object.assign(this.ships[index].position, { x: pose.x, z: pose.z });
        this.ships[index].position.y = 0.06 + Math.sin(elapsed * 0.55 + index) * 0.07;
        this.ships[index].rotation.set(0, pose.rotation, Math.sin(elapsed * 0.4 + index) * 0.008);
      });
    }
    animatePeople(seconds, elapsed) {
      const state = this.sim.state;
      if (state.arrival)
        for (const person of state.people) {
          const transport = person.arrivalFerry ? 'ferry' : (person.arrivalShip ?? 'land');
          const object = this.people[person.id];
          if (object?.characterRig && object.userData.arrivalTransport !== transport) {
            object.characterRig.posed = false;
            object.userData.arrivalTransport = transport;
          }
          if (person.arrivalFerry || person.order?.type === 'arrival')
            this.agentPositions.set(person.id, { x: person.x, z: person.z });
          if (
            object &&
            Number.isInteger(person.arrivalShip) &&
            root.VinlandIdlePeople.available(this.sim, person)
          ) {
            const boat = this.boatFrame(person.arrivalShip);
            if (boat) object.rotation.y = boat.rotation + (person.arrivalSeat?.z > 0 ? Math.PI : 0);
          }
        }
      super.animatePeople(seconds, elapsed);
      if (!state.arrival) return;
      for (const person of state.people.filter((p) => p.arrivalFerry)) {
        const object = this.people[person.id],
          rig = object?.characterRig;
        if (!rig) continue;
        const displayed = person.id === state.leader.id ? this.displayedWalkPose() : person;
        object.position.set(displayed.x, 0.42, displayed.z);
        const f = state.arrival.ferry;
        object.rotation.y = Math.atan2(f.to.x - f.from.x, f.to.z - f.from.z);
        rig.torso.position.y = rig.skirt.position.y = 0.43;
        rig.legs.forEach((leg) => {
          leg.hip.position.y = 0.43;
          leg.hip.rotation.x = -1.1;
          leg.knee.rotation.x = 1.8;
          leg.ankle.rotation.x = -0.7;
        });
        if (person.id === f.workerId)
          rig.arms.forEach((arm, i) => {
            arm.shoulder.rotation.x = -0.7 + Math.sin(elapsed * 2.5) * 0.35;
            arm.elbow.rotation.x = -0.6;
          });
      }
    }
    animateLivestock(elapsed) {
      const a = this.sim.state.arrival;
      if (!a) return super.animateLivestock(elapsed);
      const normalise = (kind) => (kind === 'goats' ? 'goat' : kind);
      while (this.animals.length < a.animals.length) {
        const saved = a.animals[this.animals.length],
          model = this.buildAnimal(normalise(saved.kind), saved.id);
        model.userData = { phase: saved.id, onLand: false };
        this.animals.push(model);
        this.scene.add(model);
      }
      while (this.animals.length > a.animals.length) {
        this.scene.remove(this.animals.pop());
        this.actorCollisions.remove('animal:' + this.animals.length);
      }
      a.animals.forEach((animal, index) => {
        const model = this.animals[index],
          kind = normalise(animal.kind);
        if (model.livestockRig.kind !== kind) {
          const replacement = this.buildAnimal(kind, animal.id);
          replacement.userData = model.userData;
          this.scene.remove(model);
          this.scene.add(replacement);
          this.animals[index] = replacement;
        }
        const object = this.animals[index];
        let x,
          z,
          y,
          heading = 0;
        const atSea = animal.shipId !== null && animal.progress === 0;
        if (atSea) {
          const pose = a.shipPoses[animal.shipId];
          const rank = a.animals
            .filter((p) => p.kind === animal.kind)
            .findIndex((p) => p.id === animal.id);
          const local =
            animal.kind === 'cattle'
              ? { x: rank % 2 ? 1 : -1, z: -5.4 + Math.floor(rank / 2) * 1.7 }
              : {
                  x: ((rank % 4) - 1.5) * 0.85,
                  z: (animal.kind === 'sheep' ? 1.2 : 3.8) + Math.floor(rank / 4) * 0.85,
                };
          const world = Spaces.toWorld(pose, local);
          x = world.x;
          z = world.z;
          y = this.ships[animal.shipId].position.y + 1.16;
          heading = pose.rotation;
        } else {
          x = animal.x;
          z = animal.z;
          const ground = Model.elevation(x, z, this.sim.state.config);
          y =
            animal.shipId === null
              ? ground
              : THREE.MathUtils.lerp(1.22, ground, Math.min(1, animal.progress * 2));
          if (animal.target) heading = Math.atan2(animal.target.x - x, animal.target.z - z);
        }
        const previous = object.position.clone();
        object.position.set(x, y, z);
        object.rotation.y = heading;
        const radius = animal.kind === 'cattle' ? 0.8 : 0.43;
        this.actorCollisions.set('animal:' + index, { x, z, radius });
        root.VinlandCharacters.poseLivestock(object, {
          seconds: this.paused ? 0 : 0.03,
          distance: previous.distanceTo(object.position),
          moving: animal.progress > 0 && animal.progress < 1,
          grazing: animal.shipId === null,
          paused: this.paused,
          cameraDistance: object.position.distanceTo(this.camera.position),
          groundAt: null,
        });
      });
    }
    updateArrivalPresentation() {
      const a = this.sim.state.arrival;
      if (!a || !this.arrivalTender) return;
      const f = a.ferry;
      this.arrivalTender.position.set(f.x, 0.02, f.z);
      this.arrivalTender.rotation.y = Math.atan2(f.to.x - f.from.x, f.to.z - f.from.z);
      const rowing = !this.paused && ['positioning', 'outbound'].includes(f.phase);
      this.arrivalOars.forEach((oar, index) => {
        const side = index ? 1 : -1;
        const p = Spaces.toWorld(
          { x: f.x, z: f.z, rotation: this.arrivalTender.rotation.y },
          { x: side * 0.8, z: -1.15 },
        );
        oar.position.set(p.x, 0.65, p.z);
        oar.rotation.set(
          0,
          this.arrivalTender.rotation.y +
            (rowing ? Math.sin(this.elapsed * 2.5) * 0.25 : 0.1) * side,
          side * 0.15,
        );
      });
      this.updateArrivalTents();
      this.arrivalGangway ||= new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.12, 1),
        new THREE.MeshStandardMaterial({ color: 0x826044, roughness: 0.92 }),
      );
      if (!this.arrivalGangway.parent) this.scene.add(this.arrivalGangway);
      this.arrivalGangway.visible = a.deployment?.phase === 'unloading';
      if (this.arrivalGangway.visible) {
        const from = Spaces.toWorld(a.shipPoses[a.livestockShip], { x: 2.35, z: 0 });
        const to = a.landing,
          length = Math.hypot(to.x - from.x, to.z - from.z);
        const shoreHeight = Model.elevation(to.x, to.z, this.sim.state.config);
        this.arrivalGangway.position.set(
          (from.x + to.x) / 2,
          (1.22 + shoreHeight) / 2,
          (from.z + to.z) / 2,
        );
        this.arrivalGangway.rotation.set(
          Math.atan2(1.22 - shoreHeight, length),
          Math.atan2(to.x - from.x, to.z - from.z),
          0,
        );
        this.arrivalGangway.scale.z = Math.hypot(length, shoreHeight - 1.22);
      }
      const activeStores = new Set();
      for (const store of Object.values(this.sim.state.storage.stores).filter((entry) =>
        ['ship', 'ferry'].includes(entry.type),
      )) {
        activeStores.add(store.id);
        const cargo = Storage.KEYS.filter((key) => (store.stock[key] || 0) > 1e-7).map((key) => ({
          resource: key,
          amount: store.stock[key],
          occupied: Storage.volume(key, store.stock[key]),
          isWood: Storage.WOOD_KEYS.includes(key),
          woodSolidFraction: Storage.WOOD_SOLID_FRACTION,
        }));
        const signature = cargo.map((entry) => entry.resource + ':' + entry.amount).join('|');
        let mesh = this.arrivalCargo.get(store.id);
        if (mesh?.userData.signature !== signature) {
          if (mesh) this.disposeStorageMarker(mesh);
          // Knarr bulk stores sit inside the broad midship hull, below the
          // walking floor. The tender has a shallower, separate load space.
          const bay =
            store.type === 'ferry'
              ? { x: 0, y: 0.1, z: 0, w: 1.25, d: 2.6, h: 0.9, cellWidth: 0.3, cellDepth: 0.4 }
              : { x: 0, y: -0.02, z: 0, w: 2.4, d: 8, h: 1.1 };
          mesh = root.VinlandWorldModels.createCargoStowage(cargo, [bay]);
          mesh.userData.signature = signature;
          mesh.userData.storeId = store.id;
          mesh.userData.bay = bay;
          this.scene.add(mesh);
          this.arrivalCargo.set(store.id, mesh);
        }
        const frame =
          store.type === 'ferry'
            ? { x: f.x, z: f.z, rotation: this.arrivalTender.rotation.y }
            : a.shipPoses[Number(store.id.slice(5))];
        const boat =
          store.type === 'ferry' ? this.arrivalTender : this.ships[Number(store.id.slice(5))];
        mesh.position.set(frame.x, boat.position.y, frame.z);
        mesh.rotation.y = frame.rotation;
      }
      for (const [id, mesh] of this.arrivalCargo) {
        if (activeStores.has(id)) continue;
        this.disposeStorageMarker(mesh);
        this.arrivalCargo.delete(id);
      }
      for (const [id, mesh] of this.arrivalTentBundles) {
        if (a.tents.some((t) => t.id === id)) continue;
        this.disposeStorageMarker(mesh);
        this.arrivalTentBundles.delete(id);
      }
      for (const tent of a.tents) {
        let mesh = this.arrivalTentBundles.get(tent.id);
        if (!mesh) {
          mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.16, 1.2, 8),
            new THREE.MeshStandardMaterial({ color: 0xb2a689, roughness: 1 }),
          );
          mesh.rotation.z = Math.PI / 2;
          this.scene.add(mesh);
          this.arrivalTentBundles.set(tent.id, mesh);
        }
        mesh.visible = ['packed', 'landed', 'transit', 'carried'].includes(tent.status);
        if (!mesh.visible) continue;
        const frame =
          tent.status === 'packed'
            ? a.shipPoses[tent.shipId]
            : tent.status === 'transit'
              ? { x: f.x, z: f.z, rotation: this.arrivalTender.rotation.y }
              : null;
        const carrier =
          tent.status === 'carried' && !tent.pickup
            ? this.sim.state.people.find((p) => p.arrivalTent === tent.id)
            : null;
        const p = frame
          ? Spaces.toWorld(
              frame,
              tent.status === 'transit'
                ? { x: 0.4, z: (a.ferry.tents.indexOf(tent.id) - 0.5) * 1.3 }
                : { x: 1.4, z: -3 + (tent.id % 5) * 1.1 },
            )
          : tent.pickup || carrier || tent;
        mesh.position.set(
          p.x,
          frame
            ? tent.status === 'transit'
              ? 0.65
              : 1.4
            : Model.elevation(p.x, p.z, this.sim.state.config) + (carrier ? 1 : 0.2),
          p.z,
        );
      }
    }
    update(seconds) {
      this.updateArrivalPresentation();
      super.update(seconds);
      this.updateWalkTentPlacement();
    }
    destroy() {
      this.setWalkTentPlacement(false);
      for (const oar of this.arrivalOars || []) this.disposeStorageMarker(oar);
      for (const mesh of this.arrivalCargo?.values() || []) this.disposeStorageMarker(mesh);
      for (const mesh of this.arrivalTentBundles?.values() || []) this.disposeStorageMarker(mesh);
      this.arrivalGangway?.geometry.dispose();
      this.arrivalGangway?.material.dispose();
      super.destroy();
    }
  }
  root.VinlandWorld.ArrivalWorld = ArrivalWorld;
})(window);
