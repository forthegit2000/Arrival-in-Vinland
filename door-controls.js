/** Door presentation and passage handling. Closed leaves are solid; routes can plan to open them. */
(function (root) {
  'use strict';
  const THREE = root.THREE,
    Doors = root.VinlandDoors,
    Spaces = root.VinlandBuildingSpaces;
  class DoorControls {
    constructor(world) {
      this.world = world;
      this.entries = new Map();
      this.autoClose = new Map();
      this.obstacles = new root.VinlandCollision.SpatialIndex();
      this.openObstacles = new root.VinlandCollision.SpatialIndex();
      this.material = new THREE.MeshStandardMaterial({ color: '#735137', roughness: 0.95 });
      this.braceMaterial = new THREE.MeshStandardMaterial({ color: '#493322', roughness: 1 });
      this.clothMaterial = new THREE.MeshStandardMaterial({
        color: '#b3a380',
        roughness: 1,
        side: THREE.DoubleSide,
      });
    }
    sync() {
      const definitions = Doors.definitions(this.world.sim.state),
        active = new Set();
      for (const door of definitions) {
        active.add(door.id);
        let entry = this.entries.get(door.id);
        if (!entry) {
          const pivot = new THREE.Group();
          const leaf = new THREE.Mesh(
            new THREE.BoxGeometry(door.width - 0.035, door.height, 0.08),
            door.cloth ? this.clothMaterial : this.material,
          );
          leaf.position.set(door.width / 2, door.height / 2, 0);
          leaf.castShadow = leaf.receiveShadow = true;
          pivot.add(leaf);
          if (!door.cloth)
            for (const height of [0.35, door.height - 0.35]) {
              const brace = new THREE.Mesh(
                new THREE.BoxGeometry(door.width - 0.1, 0.12, 0.12),
                this.braceMaterial,
              );
              brace.position.set(door.width / 2, height, 0);
              pivot.add(brace);
            }
          pivot.name = 'door:' + door.id;
          pivot.userData.select = door.id.startsWith('hall:') ? 'hall' : 'building';
          if (door.id.startsWith('building:'))
            pivot.userData.buildingId = Number(door.id.split(':')[1]);
          this.world.scene.add(pivot);
          entry = { pivot, door };
          this.entries.set(door.id, entry);
        }
        entry.door = door;
        const hinge = Spaces.toWorld(door, { x: -door.width / 2, z: 0 });
        entry.pivot.position.set(
          hinge.x,
          root.VinlandModel.elevation(door.floorX, door.floorZ, this.world.sim.state.config) + 0.12,
          hinge.z,
        );
        entry.pivot.rotation.y =
          door.rotation + (Doors.isOpen(this.world.sim.state, door.id) ? -Math.PI / 2 : 0);
        this.updateObstacle(door);
      }
      for (const [id, entry] of this.entries)
        if (!active.has(id)) {
          this.remove(entry);
          this.entries.delete(id);
          this.autoClose.delete(id);
          this.obstacles.remove(id);
          this.openObstacles.remove(id);
        }
    }
    remove(entry) {
      entry.pivot.removeFromParent();
      entry.pivot.traverse((mesh) => mesh.geometry?.dispose());
    }
    setOpen(id, open, automatic = false) {
      const entry = this.entries.get(id);
      if (!entry) return false;
      const shape = Doors.leaf(entry.door, false);
      // Never close a leaf onto a person standing in the doorway.
      if (
        !open &&
        this.world.sim.presentPeople.some((person) =>
          root.VinlandCollision.circleIntersects(person.x, person.z, 0.4, shape),
        )
      )
        return false;
      this.world.sim.state.doors[id] = open;
      entry.pivot.rotation.y = entry.door.rotation + (open ? -Math.PI / 2 : 0);
      entry.pivot.updateMatrixWorld(true);
      this.updateObstacle(entry.door);
      if (automatic) this.autoClose.set(id, this.world.sim.state.time + 2 / 3600);
      else this.autoClose.delete(id);
      this.world.sim.emit();
      return true;
    }
    nearby() {
      const leader = this.world.sim.state.leader;
      let nearest = null,
        range = 2.1;
      for (const { door } of this.entries.values()) {
        const distance = Math.hypot(leader.x - door.x, leader.z - door.z);
        if (distance < range && this.world.segmentClear(leader, door, 0.05)) {
          nearest = door;
          range = distance;
        }
      }
      return nearest;
    }
    blocked(x, z, radius, openOnly = false) {
      return (openOnly ? this.openObstacles : this.obstacles).blocked(x, z, radius);
    }
    updateObstacle(door) {
      const open = Doors.isOpen(this.world.sim.state, door.id);
      const shape = Doors.leaf(door, open);
      this.obstacles.set(door.id, shape);
      if (open) this.openObstacles.set(door.id, shape);
      else this.openObstacles.remove(door.id);
    }
    beforeWorkerMove(person, target) {
      for (const { door } of this.entries.values()) {
        if (Math.hypot(person.x - door.x, person.z - door.z) > 1.8) continue;
        const local = Spaces.toLocal(door, person),
          goal = Spaces.toLocal(door, target);
        if (Math.abs(local.x) > door.width / 2 + 0.4 || local.z * goal.z > 0.02) continue;
        if (!Doors.isOpen(this.world.sim.state, door.id)) this.setOpen(door.id, true, true);
        if (this.autoClose.has(door.id))
          this.autoClose.set(door.id, this.world.sim.state.time + 2 / 3600);
      }
    }
    update() {
      for (const [id, at] of this.autoClose)
        if (this.world.sim.state.time >= at && this.setOpen(id, false, true))
          this.autoClose.delete(id);
    }
    destroy() {
      for (const entry of this.entries.values()) this.remove(entry);
      for (const material of [this.material, this.braceMaterial, this.clothMaterial])
        material.dispose();
    }
  }
  root.VinlandDoorControls = DoorControls;
})(window);
