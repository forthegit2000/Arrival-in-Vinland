/** District selection, contextual orders and construction crews. */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  const WorkerOrders = root.VinlandWorkerOrders;

  class WorkerControls {
    constructor(app, callbacks) {
      this.app = app;
      this.world = app.world;
      this.callbacks = callbacks;
      this.selected = new Set();
      this.rings = new Map();
      this.mode = null;
      this.drag = null;
      this.buildOpen = false;
      this.workOpen = false;
      this.ringGeometry = new THREE.RingGeometry(0.55, 0.7, 24);
      this.ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xa7e5ff,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      this.world.workerControls = this;
      if (!app.sim.state.timberDropoff) {
        app.sim.state.timberDropoff = {
          ...this.standPoint({ x: 0, z: 20 }),
          label: app.sim.state.config.inheritedHall ? 'Hall F' : 'Camp store',
        };
      }
      this.onAction = (event) => {
        const button = event.target.closest('[data-worker-action]');
        if (button) {
          this.action(button.dataset.workerAction, button.dataset.resource);
        }
      };
      document.getElementById('selection-panel').addEventListener('click', this.onAction);
      root.VinlandArrivalControls.install(this);
      this.render();
    }

    available() {
      return new Set(this.app.sim.availablePeople.map((person) => person.id));
    }

    select(ids, additive = false) {
      if (!additive) {
        this.clear();
      }
      const available = this.available();
      for (const id of ids) {
        if (!available.has(id) || this.selected.has(id)) {
          continue;
        }
        this.selected.add(id);
        const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.08;
        ring.renderOrder = 15;
        this.world.people[id].add(ring);
        this.rings.set(id, ring);
      }
      this.callbacks.closeInspector();
      this.world.clearSelection();
      this.render();
    }

    clear() {
      for (const ring of this.rings.values()) {
        ring.removeFromParent();
      }
      this.rings.clear();
      this.selected.clear();
      this.mode = null;
      this.buildOpen = false;
      this.workOpen = false;
    }

    action(action, resource = 'timber') {
      if (root.VinlandArrivalControls.handle(this, action)) return;
      if (action === 'idle') {
        this.app.sim.roster();
        this.select(
          this.app.sim.availablePeople
            .filter((person) => !person.job && !person.order)
            .map((person) => person.id),
        );
        return;
      }
      if (action === 'back') {
        this.callbacks.cancelPlacement();
        this.buildOpen = false;
        this.render();
        return;
      }
      if (action === 'work-back') {
        this.workOpen = false;
        this.render();
        return;
      }
      if (
        !this.selected.size &&
        !(action === 'build' && root.VinlandCheats.instant(this.app.sim.state))
      ) {
        return;
      }
      if (action === 'work-menu') {
        this.workOpen = true;
        this.mode = null;
        this.render();
        return;
      }
      if (action === 'work') {
        this.assignWork(resource);
        return;
      }
      if (action === 'supply-camp') {
        this.assignHauling('camp');
        return;
      }
      if (action === 'haul') {
        this.mode = 'haul';
        this.workOpen = false;
        this.render();
        return;
      }
      if (action === 'gather') {
        this.gatherAutomatically(resource);
        return;
      }
      if (action === 'shelter') {
        let count = 0;
        for (const id of this.selected) {
          const person = this.app.sim.state.people[id];
          this.app.sim.commandWorkers([id], { type: 'shelter', x: person.x, z: person.z });
          const place = this.world.shelterDestination(person);
          if (place) {
            Object.assign(person.order, { x: place.x, z: place.z });
            count++;
          } else {
            this.app.sim.commandWorkers([id], { type: 'stop' });
          }
        }
        this.callbacks.notify(count + ' people going to shelter.');
        this.mode = null;
      } else if (action === 'stop') {
        this.app.sim.commandWorkers([...this.selected], { type: 'stop' });
        this.mode = null;
      } else if (action === 'build') {
        this.buildOpen = true;
        this.mode = null;
      } else {
        this.mode = action;
        this.buildOpen = false;
      }
      this.render();
    }

    assignWork(task) {
      if (!Object.hasOwn(WorkerOrders.WORK, task)) return;
      if (task === 'craft' && !this.app.sim.has('charcoal')) {
        this.callbacks.notify('Build a charcoal clamp before assigning crafting work.');
        return;
      }
      let count = 0;
      for (const [index, id] of [...this.selected].entries()) {
        const person = this.app.sim.state.people[id];
        const indoor = this.world.workAssignment(task, person);
        const destination = this.world.supportWorkLocation(task);
        destination.x += Math.sin(index * 2.4) * Math.sqrt(index) * 0.8;
        destination.z += Math.cos(index * 2.4) * Math.sqrt(index) * 0.8;
        const target = indoor || this.standPoint(destination, index);
        const origin = this.world.agentPositions.get(id) || this.app.sim.state.people[id];
        if (
          !target ||
          (Math.hypot(origin.x - target.x, origin.z - target.z) > 3.5 &&
            !this.world.path(origin, target).length)
        )
          continue;
        count += this.app.sim.commandWorkers([id], { type: 'work', task, ...target });
      }
      this.workOpen = false;
      this.callbacks.notify(
        count + ' workers assigned to ' + WorkerOrders.WORK[task].label.toLowerCase() + '.',
      );
      this.render();
    }

    assignAtBuilding(id) {
      const building = this.app.sim.state.buildings.find((building) => building.id === id);
      if (!building || !this.selected.size) {
        this.callbacks.notify('Select people first, then choose Work here at the building.');
        return;
      }
      const task = ['charcoal', 'smithy', 'workshop'].includes(building.type) ? 'craft' : 'herding';
      let count = 0;
      for (const personId of this.selected) {
        const person = this.app.sim.state.people[personId];
        const point = this.world.workplacePoint(building, person);
        if (point)
          count += this.app.sim.commandWorkers([personId], { type: 'work', task, ...point });
      }
      this.callbacks.notify(count + ' workers assigned here. Supply this building with inputs.');
      this.render();
    }

    assignHauling(storeId) {
      root.VinlandStorage.syncStores(this.app.sim.state);
      const store = this.app.sim.state.storage.stores[storeId];
      if (!root.VinlandStorage.operational(this.app.sim.state, store)) return;
      const count = this.app.sim.commandWorkers([...this.selected], {
        type: 'haul',
        destinationStoreId: storeId,
        x: store.x,
        z: store.z,
      });
      this.mode = null;
      this.workOpen = false;
      this.callbacks.notify(
        count + ' workers hauling supplies to ' + (storeId === 'camp' ? 'camp.' : 'this building.'),
      );
      this.render();
    }

    gatherAutomatically(resource) {
      const result = this.assignGathering([...this.selected], resource);
      this.mode = null;
      this.buildOpen = false;
      this.callbacks.notify(
        result.count
          ? result.count + ' workers gathering ' + WorkerOrders.GATHERING[resource].label + '.'
          : result.reason,
      );
      this.render();
    }

    assignGathering(ids, resource) {
      const reason = WorkerOrders.gatheringBlockedReason(this.app.sim, resource);
      if (reason) return { count: 0, reason };
      const available = this.available();
      const people = [...new Set(ids)]
        .filter((id) => available.has(id))
        .map((id) => this.app.sim.state.people[id]);
      if (!people.length) return { count: 0, reason: "I'm unable to work just now." };
      let count = 0;
      for (const person of people) {
        const target = this.world.findHarvestTarget(resource, person);
        if (!target) continue;
        if (target.source.kind !== 'pile') this.app.sim.registerHarvestSource(target.source);
        count += this.app.sim.commandWorkers([person.id], {
          type: 'gather',
          resource,
          nodeId: target.source.id,
          x: target.x,
          z: target.z,
          phase: 'site',
        });
      }
      return {
        count,
        reason: count
          ? ''
          : 'No reachable ' + WorkerOrders.GATHERING[resource].label + ' gathering area found.',
      };
    }

    hits(event) {
      this.world.pointFromMouse(event);
      return this.world.raycaster.intersectObjects(this.world.scene.children, true);
    }

    hitSelectable(event) {
      for (const hit of this.hits(event)) {
        let object = hit.object;
        while (object) {
          if (object.userData.hall || object.userData.select) {
            const type = object.userData.hall ? 'hall' : object.userData.select;
            const id =
              type === 'person'
                ? object.userData.index
                : type === 'ship' || type === 'livestock-ship'
                  ? this.world.ships.indexOf(object)
                  : type === 'tent'
                    ? this.world.tents.indexOf(object)
                    : object.userData.buildingId;
            return { object, type, id };
          }
          object = object.parent;
        }
      }
      return null;
    }

    hitPerson(event) {
      const hit = this.hitSelectable(event);
      return hit?.type === 'person' ? hit.id : null;
    }

    beginPointer(event) {
      if (
        event.button !== 0 ||
        event.pointerType === 'touch' ||
        this.world.view !== 'district' ||
        this.world.placing
      ) {
        return false;
      }
      this.drag = {
        x: event.clientX,
        y: event.clientY,
        additive: event.shiftKey,
        pointerId: event.pointerId,
      };
      this.world.renderer.domElement.setPointerCapture(event.pointerId);
      return true;
    }

    movePointer(event) {
      if (!this.drag) {
        return false;
      }
      const box = document.getElementById('worker-selection-box');
      box.hidden =
        Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) < 5 || !!this.mode;
      Object.assign(box.style, {
        left: Math.min(this.drag.x, event.clientX) + 'px',
        top: Math.min(this.drag.y, event.clientY) + 'px',
        width: Math.abs(event.clientX - this.drag.x) + 'px',
        height: Math.abs(event.clientY - this.drag.y) + 'px',
      });
      return true;
    }

    endPointer(event) {
      if (!this.drag) {
        return false;
      }
      const start = this.drag;
      this.cancelDrag();
      if (this.mode) {
        this.groundCommand(event);
        return true;
      }
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) {
        const hit = this.hitSelectable(event);
        if (hit && hit.type !== 'person') {
          this.clear();
          this.world.selectObject(hit.object);
          this.world.onSelect(hit.type, hit.id);
          this.render();
        } else {
          this.select(hit ? [hit.id] : [], start.additive);
        }
        return true;
      }
      const rectangle = this.world.container.getBoundingClientRect();
      const ids = [];
      for (const id of this.available()) {
        const object = this.world.people[id];
        const point = this.world.project(
          object.position.x,
          object.position.y + 1,
          object.position.z,
        );
        const x = point.x + rectangle.left;
        const y = point.y + rectangle.top;
        if (
          object.visible &&
          point.visible &&
          x >= Math.min(start.x, event.clientX) &&
          x <= Math.max(start.x, event.clientX) &&
          y >= Math.min(start.y, event.clientY) &&
          y <= Math.max(start.y, event.clientY)
        ) {
          ids.push(id);
        }
      }
      this.select(ids, start.additive);
      return true;
    }

    cancelDrag() {
      this.drag = null;
      document.getElementById('worker-selection-box').hidden = true;
    }

    standPoint(point, index = 0) {
      return this.world.findWorkerPosition(point, index);
    }

    assignConstruction(building) {
      let count = 0;
      for (const [index, id] of [...this.selected].entries()) {
        if (count >= root.VinlandContent.TYPES[building.type].crew) {
          break;
        }
        const definition = root.VinlandContent.TYPES[building.type];
        const angle =
          building.type === 'restore' ? this.world.hall.rotation.y : building.rotation || 0;
        const edge = building.shipRepair
          ? this.world.supportWorkLocation('fishing')
          : {
              x: building.x + Math.cos(angle) * (definition.w / 2 + 2),
              z: building.z - Math.sin(angle) * (definition.w / 2 + 2),
            };
        edge.x += Math.sin(index * 2.4) * 2;
        edge.z += Math.cos(index * 2.4) * 2;
        const target = this.standPoint(edge, index);
        if (target) {
          const origin = this.world.agentPositions.get(id) || this.app.sim.state.people[id];
          if (
            !this.world.path(origin, target).length &&
            Math.hypot(origin.x - target.x, origin.z - target.z) > 4
          ) {
            continue;
          }
          count += this.app.sim.commandWorkers([id], {
            type: 'build',
            buildingId: building.id,
            ...target,
          });
        }
      }
      this.callbacks.notify(
        count + ' workers assigned. Each contributes up to 10 person-hours per day.',
      );
      this.render();
      return count;
    }

    groundCommand(event) {
      if (root.VinlandArrivalControls.ground(this, event)) return true;
      if (!this.selected.size) {
        return false;
      }
      if (this.mode === 'haul') {
        const hit = this.hitSelectable(event);
        if (
          hit?.type === 'building' &&
          this.app.sim.state.buildings.some((building) => building.id === hit.id)
        )
          this.assignHauling('building:' + hit.id);
        else if (hit?.type === 'hall') {
          const point = this.world.pointFromMouse(event);
          const hearth = root.VinlandHearths.definitions(this.app.sim.state)
            .filter((item) => item.hall)
            .sort(
              (a, b) =>
                Math.hypot(a.x - (point?.x || 0), a.z - (point?.z || 0)) -
                Math.hypot(b.x - (point?.x || 0), b.z - (point?.z || 0)),
            )[0];
          if (hearth) this.assignHauling(hearth.storeId);
        } else
          this.callbacks.notify('Choose a store, workplace or hearth room in Hall F to supply.');
        return true;
      }
      if (!this.mode || this.mode === 'build') {
        for (const hit of this.hits(event)) {
          let object = hit.object;
          while (object) {
            const building = this.app.sim.state.queue.find((order) =>
              object.userData.hall
                ? order.type === 'restore'
                : order.id === object.userData.buildingId ||
                  (order.kind === 'repair' &&
                    (order.shipRepair
                      ? order.targetId === this.world.ships.indexOf(object)
                      : order.targetId === object.userData.buildingId)),
            );
            if (building) {
              this.assignConstruction(building);
              return true;
            }
            object = object.parent;
          }
        }
      }
      const point = this.world.pointFromMouse(event);
      if (!point || !this.world.clearAt(point.x, point.z, 0.5)) {
        this.callbacks.notify('Choose reachable ground beside the trees or building.');
        return true;
      }
      let count = 0;
      const interior = this.world.spaceAt(point);
      const destinations = [];
      for (const [index, id] of [...this.selected].entries()) {
        const person = this.app.sim.state.people[id];
        const target = interior
          ? this.world.indoorTarget(interior, person, destinations)
          : this.standPoint(
              { x: point.x + ((index % 5) - 2) * 1.3, z: point.z + Math.floor(index / 5) * 1.3 },
              index,
            );
        if (!target) {
          continue;
        }
        destinations.push(target);
        const origin = this.world.agentPositions.get(id) || person;
        const route = this.world.path(origin, target);
        if (!route.length && Math.hypot(origin.x - target.x, origin.z - target.z) > 4) {
          continue;
        }
        count += this.app.sim.commandWorkers([id], {
          type: 'move',
          ...target,
        });
      }
      this.mode = null;
      this.callbacks.notify(
        count ? count + ' workers ordered to move.' : 'No route to that location.',
      );
      this.render();
      return true;
    }

    render() {
      const available = this.available();
      for (const id of [...this.selected]) {
        if (!available.has(id)) {
          this.selected.delete(id);
          this.rings.get(id)?.removeFromParent();
          this.rings.delete(id);
        }
      }
      if (!this.selected.size) {
        if (!root.VinlandCheats.instant(this.app.sim.state)) this.buildOpen = false;
        this.workOpen = false;
        this.mode = null;
      }
      document.getElementById('construction-palette').hidden = !this.buildOpen;
      document.getElementById('worker-orders').hidden = this.buildOpen;
      document.querySelector(
        '.worker-actions > .worker-gathering-actions:not(#arrival-orders)',
      ).hidden = !this.selected.size || this.workOpen;
      document.getElementById('worker-work-options').hidden = !this.selected.size || !this.workOpen;
      document.getElementById('worker-orders').classList.toggle('order-targeting', !!this.mode);
      document.getElementById('worker-selection-title').textContent = this.selected.size
        ? this.selected.size + (this.selected.size === 1 ? ' worker selected' : ' workers selected')
        : '';
      const people = [...this.selected].map((id) => this.app.sim.state.people[id]);
      const sites = this.app.sim.state.queue.filter((building) =>
        people.some((person) => person.order?.buildingId === building.id),
      );
      const workSummary = sites.length
        ? ' · ' +
          (sites.length === 1
            ? root.VinlandContent.TYPES[sites[0].type].name
            : sites.length + ' sites') +
          ' · ' +
          Math.ceil(sites.reduce((sum, site) => sum + site.hours - site.progress, 0)) +
          ' person-hours left'
        : people.some((person) => person.order?.type === 'gather')
          ? ' · ' +
            people.reduce((sum, person) => sum + (person.order?.workedHours || 0), 0).toFixed(0) +
            ' person-hours on duty'
          : '';
      document.getElementById('worker-selection-summary').textContent = people.length
        ? people
            .slice(0, 2)
            .map((person) => person.name)
            .join(', ') +
          (people.length > 2 ? ' +' + (people.length - 2) : '') +
          workSummary
        : '';
      const counts = {
        move: 0,
        gather: 0,
        build: 0,
        idle: 0,
        work: 0,
        shelter: 0,
        haul: 0,
        arrival: 0,
      };
      for (const person of people) {
        counts[person.order?.type || 'idle']++;
      }
      const blocked = people.find((person) => person.order?.status)?.order.status;
      const carrying = people.filter((person) => person.cargo).length;
      this.targetHint = this.mode
        ? this.mode === 'haul'
          ? 'Click a completed store or workplace to supply'
          : 'Click ground to move'
        : '';
      const status = document.getElementById('worker-order-status');
      status.textContent = blocked
        ? blocked
        : people.length === 1 &&
            root.VinlandWorkTiming.ACTIVITIES[people[0].order?.activity] &&
            root.VinlandWorkTiming.isWorking(this.app.sim, people[0])
          ? root.VinlandWorkTiming.ACTIVITIES[people[0].order.activity]
          : people.length
            ? `${carrying ? carrying + ' carrying · ' : ''}${counts.move} moving · ${counts.gather} gathering · ${counts.build} building · ${counts.haul} hauling · ${counts.work} working · ${counts.shelter} sheltering · ${counts.idle} idle.`
            : '';
      status.hidden = !status.textContent;
      for (const button of document.querySelectorAll('[data-worker-action]')) {
        const action = button.dataset.workerAction;
        button.hidden = false;
        if (action === 'build' && root.VinlandCheats.instant(this.app.sim.state)) {
          button.disabled = false;
          button.hidden = false;
        } else if (!['idle', 'back'].includes(action)) {
          button.disabled = !this.selected.size;
          button.hidden = !this.selected.size;
        }
        if (this.workOpen && !['work', 'work-back', 'supply-camp', 'haul'].includes(action))
          button.hidden = true;
        const gathering =
          action === 'gather' &&
          people.length > 0 &&
          people.every(
            (person) =>
              person.order?.type === 'gather' &&
              WorkerOrders.resourceForOrder(person.order) === button.dataset.resource,
          );
        const working =
          action === 'work' &&
          people.length > 0 &&
          people.every(
            (person) =>
              person.order?.type === 'work' && person.order.task === button.dataset.resource,
          );
        button.classList.toggle('active', action === this.mode || gathering || working);
      }
      root.VinlandArrivalControls.render(this);
      this.callbacks.selectionChanged?.();
    }

    dispose() {
      document.getElementById('arrival-orders')?.remove();
      this.clear();
      this.cancelDrag();
      this.ringGeometry.dispose();
      this.ringMaterial.dispose();
      document.getElementById('selection-panel').removeEventListener('click', this.onAction);
      this.world.workerControls = null;
    }
  }

  root.VinlandWorkerControls = { WorkerControls };
})(window);
