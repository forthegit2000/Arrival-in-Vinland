/** Navigation adapter and visible harvest marks. Economic state stays in Gathering. */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  const Model = root.VinlandModel;
  const Gathering = root.VinlandGathering;

  class HarvestWorld extends root.VinlandWorld.SettlementWorld {
    buildScene() {
      super.buildScene();
      this.harvestSources = new Map();
      this.forestCells = new Map();
      this.harvestMeshes = new Map();
      this.harvestEffects = new THREE.Group();
      this.scene.add(this.harvestEffects);
      const addTree = (tree, index, trunks, crowns, crownsPerTree, radius, species = 'conifer') => {
        const id = Gathering.sourceId('tree', tree.x, tree.z);
        const source = {
          id,
          kind: 'tree',
          x: tree.x,
          z: tree.z,
          species,
          height: tree.h,
          radius,
          volume: Math.max(0.08, Math.min(0.5, Math.PI * radius * radius * tree.h * 0.3)),
        };
        this.harvestSources.set(id, { source, index, trunks, crowns, crownsPerTree });
        const cell = Math.floor(source.x / 20) + ':' + Math.floor(source.z / 20);
        if (!this.forestCells.has(cell)) this.forestCells.set(cell, []);
        this.forestCells.get(cell).push(source);
      };
      this.treePlacements.forEach((tree, index) =>
        addTree(tree, index, this.coniferTrunks, this.coniferCrowns, 4, 0.26 * tree.s),
      );
      this.birchPlacements.forEach((tree) =>
        addTree(tree, tree.index, this.birchTrunks, this.birchLeaves, 5, 0.24, 'birch'),
      );
      this.updateHarvestVisuals();
    }

    movePerson(person, target, seconds) {
      let point = this.agentPositions.get(person.id);
      if (!point) {
        point = this.findActorPosition(
          { x: person.x || 10, z: person.z || 20 },
          0.34,
          'person:' + person.id,
        );
        if (!point) return false;
        this.agentPositions.set(person.id, point);
      }
      const distance = Math.max(1, Math.hypot(target.x - point.x, target.z - point.z));
      const uphill = Math.max(
        0,
        (this.actorElevation(target.x, target.z) - this.actorElevation(point.x, point.z)) /
          distance,
      );
      const wet = this.spaceAt?.(point) ? 0 : this.sim.siteInfo(point.x, point.z).wet;
      const speed = ((person.cargo ? 0.75 : 1) * (1 - wet * 0.2)) / (1 + uphill * 5);
      person.moving = this.moveWorker(person, point, target, seconds, speed);
      person.x = point.x;
      person.z = point.z;
      if (person.id === this.sim.state.leader.id) {
        this.sim.state.leader.x = point.x;
        this.sim.state.leader.z = point.z;
      }
      return person.moving;
    }

    workDestination(person) {
      return person.order;
    }

    nearbyTrees(x, z) {
      // Habitat searches test many ground patches. Look in nine nearby cells
      // rather than scanning every tree on the enlarged map for each patch.
      const column = Math.floor(x / 20),
        row = Math.floor(z / 20);
      const trees = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const source of this.forestCells.get(column + dx + ':' + (row + dz)) || []) {
            if (Math.hypot(source.x - x, source.z - z) < 18) trees.push(source);
          }
        }
      }
      return trees;
    }

    isForestAt(x, z) {
      if (!this.forestCells) return super.isForestAt(x, z);
      return this.nearbyTrees(x, z).some(
        (source) => !this.sim.state.harvest.nodes[source.id]?.felled,
      );
    }

    isGatheringSite(resource, x, z) {
      if (!this.clearAt(x, z, 0.6)) return false;
      if (resource === 'timber' || resource === 'firewood') {
        return this.nearbyTrees(x, z).some((source) =>
          Gathering.sourceAvailable(this.sim, source, resource),
        );
      }
      return super.isGatheringSite(resource, x, z);
    }

    gatheringCandidates(resource, origin) {
      const candidates = this.sim.state.harvest.piles
        .filter((pile) => pile.resource === resource && pile.amount > 0)
        .map((pile) => ({ ...pile, kind: 'pile' }));
      if (resource === 'timber' || resource === 'firewood') {
        for (const { source } of this.harvestSources.values()) {
          if (
            source.kind === 'tree' &&
            !this.clearedForConstruction(source.x, source.z) &&
            Gathering.sourceAvailable(this.sim, source, resource)
          )
            candidates.push(source);
        }
      } else {
        const habitat = resource === 'plants' ? 'hay' : resource;
        if (resource === 'hay') {
          for (const node of Object.values(this.sim.state.harvest.nodes)) {
            if (node.kind === 'hay' && node.dryHay > 0.00001) candidates.push(node);
          }
        }
        let points;
        if (resource === 'freshFish') {
          const shore = this.supportWorkLocation('fishing');
          points = [shore];
          for (let radius = 12; radius <= 120; radius += 12) {
            for (let step = 0; step < 12; step++) {
              const x = shore.x + Math.sin((step * Math.PI) / 6) * radius;
              const z = shore.z + Math.cos((step * Math.PI) / 6) * radius;
              const distance = Model.landDistance(x, z, this.sim.state.config);
              if (distance >= 1 && distance < 8) points.push({ x, z });
            }
          }
        } else points = super.gatheringCandidates(habitat, origin);
        for (const point of points) {
          const x = Math.round(point.x / 6) * 6,
            z = Math.round(point.z / 6) * 6;
          const kind = resource === 'freshFish' ? 'fish' : resource;
          const source = { id: Gathering.sourceId(kind, x, z), kind, x, z };
          if (Gathering.sourceAvailable(this.sim, source, resource)) candidates.push(source);
        }
      }
      const unique = [...new Map(candidates.map((source) => [source.id, source])).values()];
      unique.sort((a, b) => {
        // Pick up already-dried hay and abandoned bundles before cutting more.
        const priority = (source) => (source.kind === 'pile' || source.dryHay > 0 ? -1000 : 0);
        return (
          Math.hypot(a.x - origin.x, a.z - origin.z) +
          priority(a) -
          Math.hypot(b.x - origin.x, b.z - origin.z) -
          priority(b)
        );
      });
      return unique.slice(0, 64);
    }

    findHarvestTarget(resource, person) {
      for (const source of this.gatheringCandidates(resource, person)) {
        if (Model.landDistance(source.x, source.z, this.sim.state.config) < 0.8) continue;
        const occupants = this.sim.state.people.filter(
          (other) => other.id !== person.id && other.order?.nodeId === source.id && !other.cargo,
        ).length;
        const limit =
          source.kind === 'tree' && !this.sim.state.harvest.nodes[source.id]?.felled ? 1 : 2;
        if (occupants >= limit) continue;
        const target = this.findActorPosition(source, 0.45, 'person:' + person.id);
        if (
          !target ||
          (Math.hypot(person.x - target.x, person.z - target.z) > 0.8 &&
            !this.path(person, target).length)
        )
          continue;
        const store = this.deliveryPoint(resource, {
          ...person,
          x: target.x,
          z: target.z,
          order: {},
        });
        if (store) return { source, ...target };
      }
      return null;
    }

    deliveryPoint(resource, person, campOnly = false) {
      const accepts =
        resource === 'hay'
          ? ['haybarn', 'storehouse']
          : ['timber', 'firewood'].includes(resource)
            ? ['woodshed', 'storehouse']
            : ['storehouse'];
      const buildings = this.sim.state.buildings.filter(
        (building) => !campOnly && accepts.includes(building.type) && building.condition > 15,
      );
      const camp = this.sim.state.timberDropoff || { x: 0, z: 20 };
      const stores = [
        { id: 'camp', x: camp.x, z: camp.z },
        ...buildings.map((building) => ({
          id: 'building:' + building.id,
          x: building.x,
          z: building.z,
          radius: Math.hypot(Model.TYPES[building.type].w, Model.TYPES[building.type].d) / 2 + 1,
        })),
      ];
      const cached = person.order?.storePoint;
      if (
        cached &&
        stores.some((store) => store.id === cached.id) &&
        this.actorClearAt(cached.x, cached.z, 0.34, 'person:' + person.id)
      )
        return cached;
      stores.sort(
        (a, b) =>
          Math.hypot(a.x - person.x, a.z - person.z) - Math.hypot(b.x - person.x, b.z - person.z),
      );
      for (const store of stores) {
        // Goods can be stacked along the store's perimeter. Choose the clear
        // approach nearest the carrier rather than funneling everyone through
        // one point in the middle of the idle camp crowd.
        const approaches = [];
        for (let step = 0; step < 16; step++) {
          const angle = (step * Math.PI * 2) / 16;
          const radius = store.radius || 8;
          const x = store.x + Math.sin(angle) * radius;
          const z = store.z + Math.cos(angle) * radius;
          if (this.actorClearAt(x, z, 0.45, 'person:' + person.id)) approaches.push({ x, z });
        }
        approaches.sort(
          (a, b) =>
            Math.hypot(a.x - person.x, a.z - person.z) - Math.hypot(b.x - person.x, b.z - person.z),
        );
        for (const target of approaches) {
          if (
            Math.hypot(person.x - target.x, person.z - target.z) > 0.8 &&
            !this.path(person, target).length
          )
            continue;
          const result = { ...target, id: store.id };
          if (person.order) person.order.storePoint = result;
          return result;
        }
      }
      return null;
    }

    sync() {
      super.sync();
      if (this.harvestEffects && this.harvestRevision !== this.sim.state.harvest.revision) {
        this.harvestRevision = this.sim.state.harvest.revision;
        this.clearBuildingTrees();
        this.updateHarvestVisuals();
        this.prepareObstacles();
        this.routes.clear();
      }
    }

    clearedPatchAt(x, z) {
      for (const node of Object.values(this.sim.state.harvest.nodes)) {
        if (!['turf', 'hay', 'plants'].includes(node.kind)) continue;
        const fraction = 1 - node.remaining / node.volume;
        if (x >= node.x - 3 && x <= node.x - 3 + fraction * 6 && Math.abs(z - node.z) <= 3)
          return true;
      }
      return false;
    }

    clearBuildingTrees() {
      super.clearBuildingTrees();
      if (!this.harvestSources) return;
      for (const { o: object, matrices } of this.vegetation) {
        if (!['Ground grass', 'Ground shrubs'].includes(object.name)) continue;
        matrices.forEach((matrix, index) => {
          const point = new THREE.Vector3().setFromMatrixPosition(matrix);
          if (this.clearedPatchAt(point.x, point.z)) {
            const cleared = matrix.clone().scale(new THREE.Vector3(0, 0, 0));
            object.setMatrixAt(index, cleared);
          }
        });
        object.instanceMatrix.needsUpdate = true;
      }
      this.updateHarvestVisuals();
    }

    updateHarvestVisuals() {
      if (!this.harvestSources) return;
      const dummy = new THREE.Object3D();
      for (const node of Object.values(this.sim.state.harvest.nodes)) {
        const y = Model.elevation(node.x, node.z, this.sim.state.config);
        if (node.kind === 'tree' && node.felled) {
          const tree = this.harvestSources.get(node.id);
          if (!tree) continue;
          if (this.clearedForConstruction(node.x, node.z)) {
            const log = this.harvestMeshes.get(node.id);
            if (log) log.visible = false;
            continue;
          }
          dummy.position.set(node.x, y + 0.16, node.z);
          dummy.scale.set(
            tree.source.radius / (tree.trunks.geometry.parameters.radiusBottom || 0.26),
            0.32,
            tree.source.radius / (tree.trunks.geometry.parameters.radiusBottom || 0.26),
          );
          dummy.updateMatrix();
          tree.trunks.setMatrixAt(tree.index, dummy.matrix);
          const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
          for (let crown = 0; crown < tree.crownsPerTree; crown++)
            tree.crowns.setMatrixAt(tree.index * tree.crownsPerTree + crown, hidden);
          tree.trunks.instanceMatrix.needsUpdate = tree.crowns.instanceMatrix.needsUpdate = true;
          let log = this.harvestMeshes.get(node.id);
          if (!log) {
            log = new THREE.Mesh(
              new THREE.CylinderGeometry(node.radius * 0.65, node.radius * 0.8, 2.5, 8),
              new THREE.MeshStandardMaterial({ color: '#8c7254', roughness: 1 }),
            );
            log.rotation.z = Math.PI / 2;
            log.position.set(node.x, y + node.radius * 0.65, node.z + 0.5);
            log.name = 'Felled timber';
            this.harvestEffects.add(log);
            this.harvestMeshes.set(node.id, log);
          }
          log.visible = node.remaining > 0.00001;
          log.scale.y = Math.max(0.05, node.remaining / node.volume);
        } else if (['turf', 'hay'].includes(node.kind)) {
          let patch = this.harvestMeshes.get(node.id);
          if (!patch) {
            patch = new THREE.Group();
            const ground = new THREE.Mesh(
              new THREE.PlaneGeometry(1, 6, 6, 6),
              new THREE.MeshStandardMaterial({
                color: node.kind === 'turf' ? '#594b39' : '#9c9862',
                roughness: 1,
                side: THREE.DoubleSide,
              }),
            );
            ground.rotation.x = -Math.PI / 2;
            patch.add(ground);
            const swath = new THREE.Mesh(
              new THREE.BoxGeometry(4, 0.25, 0.45),
              new THREE.MeshStandardMaterial({ color: '#79904f', roughness: 1 }),
            );
            swath.position.set(0, 0.15, 0);
            patch.add(swath);
            patch.name =
              node.kind === 'turf'
                ? 'Cut turf'
                : node.kind === 'plants'
                  ? 'Foraged ground'
                  : 'Mown meadow';
            this.harvestEffects.add(patch);
            this.harvestMeshes.set(node.id, patch);
          }
          const width = (1 - node.remaining / node.volume) * 6;
          patch.position.set(node.x - 3 + width / 2, y + 0.035, node.z);
          const ground = patch.children[0];
          ground.scale.x = Math.max(0.001, width);
          const vertices = ground.geometry.attributes.position;
          for (let index = 0; index < vertices.count; index++) {
            const x = patch.position.x + vertices.getX(index) * ground.scale.x;
            const z = patch.position.z - vertices.getY(index);
            // Drape the cut surface over the measured terrain instead of
            // floating a flat rectangle above sloping ground.
            vertices.setZ(index, Model.elevation(x, z, this.sim.state.config) - y);
          }
          vertices.needsUpdate = true;
          ground.geometry.computeVertexNormals();
          patch.children[1].scale.x = Math.min(1, width / 4);
          patch.children[1].visible = node.kind === 'hay' && node.freshHay + node.dryHay > 0;
          patch.children[1].material.color.set(node.dryHay > 0 ? '#c5b16e' : '#79904f');
          patch.visible = width > 0.001;
        }
      }
      const livePiles = new Set();
      for (const pile of this.sim.state.harvest.piles) {
        if (pile.amount <= 0.00001) continue;
        livePiles.add(pile.id);
        let mesh = this.harvestMeshes.get(pile.id);
        if (mesh && mesh.userData.amount !== pile.amount) {
          mesh.removeFromParent();
          mesh.traverse((piece) => {
            piece.geometry?.dispose();
            for (const material of Array.isArray(piece.material)
              ? piece.material
              : [piece.material])
              material?.dispose();
            if (piece.isInstancedMesh) piece.dispose();
          });
          mesh = null;
        }
        if (!mesh) {
          mesh = this.buildResourcePile({
            id: pile.id,
            storeId: pile.id,
            resource: pile.resource,
            occupied: root.VinlandStorage.volume(pile.resource, pile.amount),
            x: pile.x,
            z: pile.z,
            w: 1.2,
            d: 0.6,
            h: 0.7,
          });
          mesh.name = 'Recoverable ' + pile.resource;
          mesh.userData.amount = pile.amount;
          this.harvestEffects.add(mesh);
          this.harvestMeshes.set(pile.id, mesh);
        }
        mesh.position.set(
          pile.x,
          Model.elevation(pile.x, pile.z, this.sim.state.config) + 0.02,
          pile.z,
        );
        mesh.visible = true;
      }
      for (const [id, mesh] of this.harvestMeshes)
        if (id.startsWith('pile:') && !livePiles.has(id)) mesh.visible = false;
    }
  }
  root.VinlandWorld.HarvestWorld = HarvestWorld;
})(window);
