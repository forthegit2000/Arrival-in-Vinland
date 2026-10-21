/**
 * SettlementWorld extends BaseWorld with detailed people, vegetation, weather,
 * local collision, and walking. Animation time is in real elapsed seconds.
 * The update() method lists presentation steps in their execution order.
 * Economic work, stocks, travel outcomes, and health belong to Simulation.
 */
(function (root) {
  'use strict';

  const THREE = root.THREE;
  const Model = root.VinlandModel;
  const Collision = root.VinlandCollision;
  const PERSON_RADIUS = 0.34;
  let detailRandom = Model.seeded(1005);
  const TAU = Math.PI * 2;
  const WALK_SPEED = 1.4; // Metres per simulation second; the shared clock applies speed controls.
  const SPRINT_MULTIPLIER = 3;
  const SWIM_DEPTH = 1.15;
  const SWIM_SPEED = 0.7; // Deliberate game calibration for swimming in clothing.
  const WALK_LOOK_SPEED = Math.PI / 3; // 60 degrees per real second.
  const WALK_CAMERA_DISTANCE = Math.hypot(7.5, 3);
  function enclosurePosts(width, depth) {
    const posts = [];
    // Two missing posts form the gateway, shared by rendering and collision.
    for (let post = 2; post < 28; post++) {
      const angle = (post / 28) * TAU;
      posts.push({ x: (Math.sin(angle) * width) / 2, z: (Math.cos(angle) * depth) / 2 });
    }
    return posts;
  }

  const Models = root.VinlandWorldModels;
  const material = Models.detailMaterial;
  class SettlementWorld extends root.VinlandWorld.BaseWorld {
    buildPerson(index) {
      const group = root.VinlandCharacters.createHuman(this.sim.state.people[index], index);
      for (const resource of root.VinlandStorage.KEYS) {
        group.add(this.buildGatheringLoad(resource));
      }
      group.add(root.VinlandCharacters.createAxe());
      return group;
    }

    buildGatheringLoad(resource) {
      const Storage = root.VinlandStorage;
      const amount = root.VinlandWorkTiming.RULES[resource]?.load || Storage.loadSize(resource);
      return Models.createGatheringLoad(resource, Storage.volume(resource, amount));
    }

    resourcePileOptions(pile) {
      const Storage = root.VinlandStorage;
      return {
        isWood: Storage.WOOD_KEYS.includes(pile.resource),
        woodSolidFraction: Storage.WOOD_SOLID_FRACTION,
        groundOffsetAt: (position) => {
          const point = root.VinlandBuildingSpaces.toWorld(pile, position);
          return (
            Model.elevation(point.x, point.z, this.sim.state.config) -
            Model.elevation(pile.x, pile.z, this.sim.state.config)
          );
        },
      };
    }

    buildResourcePile(pile) {
      return Models.createResourcePile(pile, this.resourcePileOptions(pile));
    }

    buildWoodPile(pile) {
      return Models.createWoodPile(pile, this.resourcePileOptions(pile));
    }

    buildScene() {
      detailRandom = Model.seeded(this.sim.state.config.seed + ':details');
      super.buildScene();
      // Arrival cargo is drawn from its real inventory below. The old fixed
      // barrels and crates otherwise remain visible even after stocks run out.
      this.landingSupplies?.traverse((mesh) => mesh.geometry?.dispose());
      this.landingSupplies?.clear();
      this.view = 'district';
      this.keys = new Set();
      this.routes = new Map();
      this.routeSignature = '';
      this.agentPositions = new Map();
      this.orbitSaved = null;
      this.walkYaw = 0;
      this.walkPitch = Math.atan2(3, 7.5);
      this.envTime = 0;
      const state = this.sim.state;
      while (this.people.length > state.people.length) {
        this.scene.remove(this.people.pop());
      }
      while (this.people.length < state.people.length) {
        const i = this.people.length;
        const p = this.buildPerson(i);
        p.userData = {
          select: 'person',
          index: i,
          phase: i * 2,
          angle: i * 0.6,
          r: 24,
        };
        this.people.push(p);
        this.scene.add(p);
      }
      while (this.ships.length > state.ships.length) {
        this.scene.remove(this.ships.pop());
        this.shipPositions.pop();
        this.shipsSails.pop();
      }
      while (this.ships.length < state.ships.length) {
        const i = this.ships.length;
        const p = this.buildKnarr(i);
        this.shipPositions.push(
          this.measuredTerrain ? root.VinlandMeadows.anchorage(i) : [-108, -45 + i * 24],
        );
        this.ships.push(p);
        this.scene.add(p);
      }
      const tentCount = state.config.tents;
      while (this.tents.length > tentCount) {
        this.scene.remove(this.tents.pop());
      }
      while (this.tents.length < tentCount) {
        const t = this.buildTent(this.tents.length);
        this.tents.push(t);
        this.scene.add(t);
      }
      this.tentPositions = [];
      this.tents.forEach((elapsedSeconds, i) => {
        const a = (i / Math.max(10, tentCount)) * TAU;
        const r = 26 + (i % 2) * 7;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        elapsedSeconds.position.set(x, Model.elevation(x, z, state.config), z);
        elapsedSeconds.rotation.y = a;
        this.tentPositions.push([x, z]);
      });
      this.hall.visible = state.config.inheritedHall;
      this.hall.position.y = Model.elevation(0, 0, state.config);
      this.scene.children.find((object) => object.isHemisphereLight).intensity = 1.7;
      const grass = this.scene.children.find((object) => object.name === 'Ground grass');
      if (grass) {
        const vertices = [];
        for (const a of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
          const dx = Math.cos(a) * 0.075;
          const dz = Math.sin(a) * 0.075;
          vertices.push(-dx, 0, -dz, dx, 0, dz, 0, 0.46, 0.04);
        }
        const blades = new THREE.BufferGeometry();
        blades.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        blades.computeVertexNormals();
        grass.geometry = blades;
        grass.material.side = THREE.DoubleSide;
      }
      this.buildDetails();
      this.captureTrees();
      this.buildWeather();
      this.prepareObstacles();
      this.renderer.domElement.addEventListener('pointermove', (event) => {
        if (this.view === 'walk' && this.pointer.down) {
          this.rotateWalkView(event.movementX * 0.004, event.movementY * 0.003);
        }
      });
      document.addEventListener(
        'keydown',
        (this.keyDown = (event) => {
          if (
            this.sim.conversationPersonId == null &&
            !event.target.matches('input,textarea,select') &&
            document.body.dataset.screen !== 'atlantic' &&
            !document.querySelector('dialog[open], #title-screen:not([hidden])')
          ) {
            this.keys.add(event.code);
          }
        }),
      );
      document.addEventListener('keyup', (this.keyUp = (event) => this.keys.delete(event.code)));
      window.addEventListener('blur', (this.blurHandler = () => this.clearInput()));
    }

    buildDetails() {
      const group = new THREE.Group();
      this.scene.add(group);
      this.detailGroup = group;
      const bark = material('#8e8872');
      const leaf = material('#788356');
      const trunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.12, 0.24, 1, 7),
        bark,
        this.measuredTerrain ? this.landscapeCount(600) : 95,
      );
      const crowns = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 1),
        leaf,
        trunks.count * 5,
      );
      const d = new THREE.Object3D();
      this.birchPlacements = [];
      this.birchTrunks = trunks;
      this.birchLeaves = crowns;
      for (let i = 0; i < trunks.count; i++) {
        // Share woodland habitat with the conifers, across the whole tile.
        const site = this.measuredTerrain
          ? this.treePlacements[Math.floor(detailRandom() * this.treePlacements.length)]
          : { x: 45 + detailRandom() * 110, z: detailRandom() * 230 - 115 };
        let { x, z } = site;
        if (this.measuredTerrain) {
          // Offset birches from the sampled conifer rather than stacking trunks.
          x += 3 * Math.cos(i * 2.4);
          z += 3 * Math.sin(i * 2.4);
        }
        const h = 5 + detailRandom() * 4;
        const visible = !this.measuredTerrain || this.woodlandSuitable(x, z);
        const y = Model.elevation(x, z, this.sim.state.config);
        if (visible) this.birchPlacements.push({ x, z, h, s: 1, index: i });
        d.position.set(x, y + h * 0.45, z);
        d.scale.set(1, h * 0.9, 1);
        if (!visible) {
          d.scale.setScalar(0);
        }
        d.rotation.set(0, 0, 0);
        d.updateMatrix();
        trunks.setMatrixAt(i, d.matrix);
        for (let j = 0; j < 5; j++) {
          d.position.set(
            x + Math.sin(j * 2) * 1.2,
            y + h * 0.65 + j * 0.4,
            z + Math.cos(j * 2) * 1.2,
          );
          d.scale.set(1.4 + detailRandom(), 1.3, 1.4 + detailRandom());
          if (!visible) {
            d.scale.setScalar(0);
          }
          d.rotation.set(i * 0.1, i, j * 0.1);
          d.updateMatrix();
          crowns.setMatrixAt(i * 5 + j, d.matrix);
          crowns.setColorAt(
            i * 5 + j,
            new THREE.Color().setHSL(
              0.18 + detailRandom() * 0.07,
              0.2,
              0.28 + detailRandom() * 0.1,
            ),
          );
        }
      }
      trunks.userData.clearsForBuildings = true;
      crowns.userData.clearsForBuildings = true;
      trunks.castShadow = true;
      crowns.castShadow = true;
      crowns.receiveShadow = true;
      group.add(trunks, crowns);
      this.birchCrowns = crowns;
      const waterMarker = new THREE.Group();
      waterMarker.position.set(46, Model.elevation(46, 28, this.sim.state.config), 28);
      waterMarker.visible = !this.measuredTerrain;
      group.add(waterMarker);
      for (let i = 0; i < 20; i++) {
        const stone = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.35 + detailRandom() * 0.3, 1),
          bark,
        );
        stone.position.set(Math.sin(i) * 3, 0.2, Math.cos(i) * 3);
        stone.scale.y = 0.5;
        waterMarker.add(stone);
      }
      const stream = new THREE.Mesh(
        new THREE.CircleGeometry(2.7, 28),
        new THREE.MeshStandardMaterial({
          color: '#607e76',
          roughness: 0.25,
          metalness: 0.1,
        }),
      );
      stream.rotation.x = -Math.PI / 2;
      stream.position.y = 0.04;
      waterMarker.add(stream);
      this.campFire = new THREE.PointLight('#ffa453', 0, 24, 2);
      this.campFire.position.set(0, Model.elevation(0, 0, this.sim.state.config) + 3, 0);
      this.scene.add(this.campFire);
      /* A real double slate-box oven replaces the original schematic block. */
      const kitchen = root.VinlandWorld.rooms.find((r) => r.n === 'IV');
      const oven = Models.createSlateOven(kitchen, detailRandom);
      this.hall.children[2].children
        .filter(
          (object) =>
            object.isMesh &&
            object.geometry.type === 'BoxGeometry' &&
            Math.abs(object.position.x - (kitchen.x - 1)) < 0.01 &&
            Math.abs(object.scale.x - 1.25) < 0.01,
        )
        .forEach((object) => this.hall.children[2].remove(object));
      this.hall.children[2].add(oven);
    }

    captureTrees() {
      this.vegetation = [];
      this.scene.traverse((object) => {
        if (object.isInstancedMesh && object.userData.clearsForBuildings) {
          const matrices = [];
          for (let i = 0; i < object.count; i++) {
            const m = new THREE.Matrix4();
            object.getMatrixAt(i, m);
            matrices.push(m);
          }
          this.vegetation.push({
            o: object,
            matrices,
          });
        }
      });
    }

    buildWeather() {
      this.snowUniform = {
        value: 0,
      };
      const snow = this.snowUniform;
      this.terrain.material.onBeforeCompile = (shader) => {
        shader.uniforms.uSnow = snow;
        shader.fragmentShader = 'uniform float uSnow;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.84,.88,.86),uSnow);',
        );
      };
      this.weatherEffects = new root.VinlandWeather.WeatherEffects(this);
    }

    prepareObstacles() {
      this.staticCollisions = new Collision.SpatialIndex();
      this.actorCollisions ||= new Collision.SpatialIndex();
      this.relocateActors = true;
      let nextId = 0;
      const add = (shape) => this.staticCollisions.set(nextId++, shape);
      const state = this.sim.state;
      this.buildingBounds = [...state.buildings, ...state.queue]
        .filter((building) => building.type !== 'restore' && !building.kind)
        .map((building) => ({
          ...building,
          w: Model.TYPES[building.type].w,
          d: Model.TYPES[building.type].d,
        }));
      this.addBuildingObstacles(add);
      this.addHallObstacles(add);
      this.addLandingObstacles(add);
      this.addLandscapeObstacles(add);
    }

    addBuildingObstacles(add) {
      for (const building of this.buildingBounds) {
        if (building.type === 'garden') continue;
        if (building.type === 'palisade') {
          // Match the visible posts and leave the actual gateway open.
          const posts = enclosurePosts(building.w, building.d);
          for (const [index, { x, z }] of posts.entries()) {
            add({
              x: building.x + Math.cos(building.rotation) * x + Math.sin(building.rotation) * z,
              z: building.z - Math.sin(building.rotation) * x + Math.cos(building.rotation) * z,
              radius: 0.22,
            });
            const next = posts[index + 1];
            if (next) {
              const { x: nextX, z: nextZ } = next;
              const middleX = (x + nextX) / 2;
              const middleZ = (z + nextZ) / 2;
              add({
                x:
                  building.x +
                  Math.cos(building.rotation) * middleX +
                  Math.sin(building.rotation) * middleZ,
                z:
                  building.z -
                  Math.sin(building.rotation) * middleX +
                  Math.cos(building.rotation) * middleZ,
                w: Math.hypot(nextX - x, nextZ - z),
                d: 0.18,
                rotation: building.rotation - Math.atan2(nextZ - z, nextX - x),
              });
            }
          }
        } else {
          const completed = this.sim.state.buildings.some((item) => item.id === building.id);
          const layout = root.VinlandBuildingSpaces.plan(building.type);
          if (completed && layout) {
            for (const shape of [...layout.walls, ...layout.furniture])
              add(root.VinlandBuildingSpaces.obstacle(building, shape));
          } else if (completed && building.type === 'well')
            add({ x: building.x, z: building.z, radius: 1.25 });
          else add(building); // Construction sites remain closed to through traffic.
        }
      }
      this.tents.forEach((tent, index) => {
        if (tent.visible && index < this.sim.state.resources.tents)
          for (const wall of [
            { x: -1.65, z: 0, w: 0.15, d: 5 },
            { x: 1.65, z: 0, w: 0.15, d: 5 },
            { x: 0, z: -2.5, w: 3.5, d: 0.15 },
            { x: -1.225, z: 2.5, w: 1.05, d: 0.15 },
            { x: 1.225, z: 2.5, w: 1.05, d: 0.15 },
          ]) {
            add(
              root.VinlandBuildingSpaces.obstacle(
                { x: tent.position.x, z: tent.position.z, rotation: tent.rotation.y },
                wall,
              ),
            );
          }
      });
    }

    addMeshObstacle(mesh, add) {
      mesh.updateWorldMatrix(true, false);
      const bounds = new THREE.Box3().setFromObject(mesh);
      const ground = Model.elevation(
        bounds.getCenter(new THREE.Vector3()).x,
        bounds.getCenter(new THREE.Vector3()).z,
        this.sim.state.config,
      );
      if (bounds.max.y < ground + 0.3 || bounds.min.y > ground + 1.6) return;
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      mesh.matrixWorld.decompose(position, quaternion, scale);
      const dimensions = mesh.geometry.parameters;
      add({
        x: position.x,
        z: position.z,
        w: dimensions.width * Math.abs(scale.x),
        d: dimensions.depth * Math.abs(scale.z),
        rotation: new THREE.Euler().setFromQuaternion(quaternion, 'YXZ').y,
      });
    }

    addHallObstacles(add) {
      // Cutaway is a display setting; it must never shrink the physical walls.
      const wallScale = this.hallWalls.scale.y;
      this.hallWalls.scale.y = 1;
      this.hallWalls.updateWorldMatrix(true, true);
      if (this.sim.state.config.inheritedHall)
        this.hallWalls.traverse((mesh) => {
          if (mesh.isMesh && mesh.geometry.type === 'BoxGeometry') this.addMeshObstacle(mesh, add);
        });
      this.hallWalls.scale.y = wallScale;
      this.hallWalls.updateWorldMatrix(true, true);
    }

    addLandingObstacles(add) {
      this.landingSupplies?.traverse((mesh) => {
        if (mesh.isMesh && mesh.geometry.type === 'BoxGeometry') this.addMeshObstacle(mesh, add);
        else if (mesh.isMesh && mesh.geometry.type === 'CylinderGeometry') {
          const point = mesh.getWorldPosition(new THREE.Vector3());
          add({ x: point.x, z: point.z, radius: mesh.geometry.parameters.radiusTop });
        }
      });
    }

    addLandscapeObstacles(add) {
      // Index trunks and substantial rocks, not foliage or grass. Cleared
      // construction ground uses the same footprint as the visible vegetation.
      for (const { o: object, matrices } of this.vegetation || []) {
        if (!['CylinderGeometry', 'IcosahedronGeometry'].includes(object.geometry.type)) continue;
        object.updateWorldMatrix(true, false);
        for (const matrix of matrices) {
          const worldMatrix = object.matrixWorld.clone().multiply(matrix);
          const point = new THREE.Vector3();
          const scale = new THREE.Vector3();
          worldMatrix.decompose(point, new THREE.Quaternion(), scale);
          if (
            scale.lengthSq() < 0.001 ||
            this.clearedForConstruction(point.x, point.z) ||
            this.sim.state.harvest?.nodes[root.VinlandGathering.sourceId('tree', point.x, point.z)]
              ?.felled
          )
            continue;
          const ground = Model.elevation(point.x, point.z, this.sim.state.config);
          const trunk = object.geometry.type === 'CylinderGeometry';
          if (!trunk && point.y > ground + 2) continue;
          const radius = trunk
            ? object.geometry.parameters.radiusBottom * Math.max(scale.x, scale.z)
            : Math.max(scale.x, scale.z) * 0.75;
          if (radius >= 0.18) add({ x: point.x, z: point.z, radius });
        }
      }
    }

    clearedForConstruction(x, z) {
      return this.buildingBounds.some((building) => Collision.circleIntersects(x, z, 2, building));
    }

    clearAt(x, z, radius = PERSON_RADIUS) {
      if (
        !this.withinMap(x, z, radius) ||
        Model.landDistance(x, z, this.sim.state.config) < Math.max(0.8, radius)
      )
        return false;
      return !this.staticCollisions?.blocked(x, z, radius);
    }

    segmentClear(start, end, radius = PERSON_RADIUS, actorId) {
      const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / 0.18));
      for (let step = 1; step <= steps; step++) {
        const fraction = step / steps;
        if (
          !this.clearAt(
            start.x + (end.x - start.x) * fraction,
            start.z + (end.z - start.z) * fraction,
            radius,
          )
        )
          return false;
        if (
          actorId !== undefined &&
          this.actorCollisions.blocked(
            start.x + (end.x - start.x) * fraction,
            start.z + (end.z - start.z) * fraction,
            radius,
            actorId,
          )
        )
          return false;
      }
      return true;
    }

    actorClearAt(x, z, radius, id) {
      const leader = this.sim.state.leader;
      const clear =
        id === 'person:' + leader.id
          ? this.playerClearAt(x, z, radius)
          : this.clearAt(x, z, radius);
      return clear && !this.actorCollisions.blocked(x, z, radius, id);
    }

    withinMap(x, z, radius) {
      return this.measuredTerrain
        ? x >= this.mapExtent.minX + radius &&
            x <= this.mapExtent.minX + this.mapExtent.width - radius &&
            z >= this.mapExtent.minZ + radius &&
            z <= this.mapExtent.minZ + this.mapExtent.depth - radius
        : Math.hypot(x, z) <= 170 - radius;
    }

    boatFrame(index) {
      const ship = this.ships[index];
      if (!ship || this.sim.state.ships[index]?.status !== 'anchored') return null;
      return {
        x: this.shipPositions[index][0],
        z: this.shipPositions[index][1],
        rotation: ship.rotation.y,
        index,
        ship,
        geometry: ship.userData.boatGeometry,
      };
    }

    deckHalfWidth(boat, z) {
      return (
        Math.pow(Math.max(0, Math.cos((z / boat.geometry.length) * Math.PI)), 0.6) *
        boat.geometry.width *
        0.46 *
        0.95
      );
    }

    deckContains(boat, point, radius = 0) {
      const local = root.VinlandBuildingSpaces.toLocal(boat, point);
      return (
        Math.abs(local.z) <= boat.geometry.deckEnd - radius &&
        Math.abs(local.x) <= this.deckHalfWidth(boat, local.z) - radius
      );
    }

    deckBoatAt(point) {
      for (let index = 0; index < this.ships.length; index++) {
        const boat = this.boatFrame(index);
        if (boat && this.deckContains(boat, point)) return boat;
      }
      return null;
    }

    boatBlocksWater(boat, point, radius) {
      const p = root.VinlandBuildingSpaces.toLocal(boat, point),
        half = boat.geometry.length / 2;
      if (Math.abs(p.z) > half + radius) return false;
      const fraction = THREE.MathUtils.clamp(p.z / boat.geometry.length + 0.5, 0, 1);
      const halfWidth = (Math.pow(Math.sin(fraction * Math.PI), 0.58) * boat.geometry.width) / 2;
      return Math.abs(p.x) < halfWidth + radius;
    }

    openWaterClearAt(x, z, radius) {
      if (
        !this.withinMap(x, z, radius) ||
        this.staticCollisions?.blocked(x, z, radius) ||
        this.doorControls?.blocked(x, z, radius)
      )
        return false;
      for (let index = 0; index < this.ships.length; index++) {
        const boat = this.boatFrame(index);
        if (boat && this.boatBlocksWater(boat, { x, z }, radius)) return false;
      }
      return true;
    }

    playerClearAt(x, z, radius) {
      const boat = this.deckBoatAt(this.sim.state.leader);
      if (!boat) return this.openWaterClearAt(x, z, radius);
      if (!this.deckContains(boat, { x, z }, radius)) return false;
      const local = root.VinlandBuildingSpaces.toLocal(boat, { x, z });
      return !boat.geometry.obstacles.some((shape) =>
        Collision.circleIntersects(local.x, local.z, radius, shape),
      );
    }

    leaderSurfaceAt(point) {
      const boat = this.deckBoatAt(point);
      if (boat) {
        const local = root.VinlandBuildingSpaces.toLocal(boat, point);
        const height =
          boat.ship.position.y +
          boat.geometry.deckHeight * Math.cos(boat.ship.rotation.z) +
          local.x * Math.sin(boat.ship.rotation.z);
        return { mode: 'deck', height, depth: 0, surface: height, boat };
      }
      const ground = Model.elevation(point.x, point.z, this.sim.state.config);
      if (this.spaceAt?.(point)) return { mode: 'land', height: ground, depth: 0, surface: ground };
      const seaDistance = this.measuredTerrain
        ? root.VinlandMeadows.shoreDistance(point.x, point.z)
        : Model.landDistance(point.x, point.z, this.sim.state.config);
      let surface = 0.02,
        depth = seaDistance < 0 ? Math.max(0, surface - ground) : 0;
      if (seaDistance >= 0 && this.measuredTerrain) {
        const water = root.VinlandMeadows.freshwaterAt(point.x, point.z);
        if (water && water.distance < 0) {
          surface = water.surface + 0.012;
          depth = Math.max(0, surface - this.terrainSurfaceHeight(point.x, point.z));
        }
      }
      if (depth < 0.035) return { mode: 'land', height: ground, depth: 0, surface: ground };
      return {
        mode: depth >= SWIM_DEPTH ? 'swim' : 'wade',
        depth,
        surface,
        height: surface - Math.min(depth, SWIM_DEPTH),
      };
    }

    leaderMoveSpeed(sprinting) {
      const water = this.leaderSurfaceAt(this.sim.state.leader);
      if (water.mode === 'swim') return SWIM_SPEED * (sprinting ? 1.3 : 1);
      if (water.mode === 'wade') {
        const depth = THREE.MathUtils.clamp(water.depth / SWIM_DEPTH, 0, 1);
        return THREE.MathUtils.lerp(WALK_SPEED, 0.65, depth) * (sprinting ? 1.2 : 1);
      }
      return WALK_SPEED * (sprinting ? SPRINT_MULTIPLIER : 1);
    }

    nearbyBoatAction() {
      const leader = this.sim.state.leader,
        Spaces = root.VinlandBuildingSpaces;
      const aboard = this.deckBoatAt(leader);
      let nearest = null;
      for (let index = 0; index < this.ships.length; index++) {
        const boat = this.boatFrame(index);
        if (!boat || (aboard && aboard.index !== index)) continue;
        const local = Spaces.toLocal(boat, leader);
        for (const side of [-1, 1]) {
          for (let z = -5.5; z <= 5.5; z += 0.5) {
            const deck = Spaces.toWorld(boat, {
              x: side * (this.deckHalfWidth(boat, z) - PERSON_RADIUS - 0.08),
              z,
            });
            const outside = Spaces.toWorld(boat, {
              x: side * (boat.geometry.width / 2 + PERSON_RADIUS + 0.35),
              z,
            });
            const approach = aboard ? deck : outside;
            const distance = Math.hypot(leader.x - approach.x, leader.z - approach.z);
            if (distance > 1.5 || (nearest && distance >= nearest.distance)) continue;
            const deckLocal = Spaces.toLocal(boat, deck);
            if (
              boat.geometry.obstacles.some((shape) =>
                Collision.circleIntersects(deckLocal.x, deckLocal.z, PERSON_RADIUS, shape),
              )
            )
              continue;
            if (!this.openWaterClearAt(outside.x, outside.z, PERSON_RADIUS)) continue;
            if (
              this.actorCollisions.blocked(deck.x, deck.z, PERSON_RADIUS, 'person:' + leader.id) ||
              this.actorCollisions.blocked(
                outside.x,
                outside.z,
                PERSON_RADIUS,
                'person:' + leader.id,
              )
            )
              continue;
            // Stay beside the same gunwale; do not board across the opposite side.
            if (local.x * side < 0) continue;
            nearest = {
              type: aboard ? 'leave-boat' : 'board-boat',
              id: index,
              distance,
              target: aboard ? outside : deck,
            };
          }
        }
      }
      return nearest;
    }

    useNearbyBoat() {
      const action = this.nearbyBoatAction();
      if (!action) return false;
      const leader = this.sim.state.leader;
      Object.assign(leader, action.target);
      Object.assign(this.sim.state.people[leader.id], action.target);
      this.agentPositions.set(leader.id, { ...action.target });
      this.actorCollisions.set('person:' + leader.id, { ...action.target, radius: PERSON_RADIUS });
      this.previousWalkPose = this.currentWalkPose = null;
      return true;
    }

    findActorPosition(point, radius, id) {
      for (let distance = 0; distance <= 30; distance += 0.65) {
        const samples = Math.max(1, Math.ceil((distance * TAU) / 0.65));
        for (let sample = 0; sample < samples; sample++) {
          const angle = (sample / samples) * TAU;
          const x = point.x + Math.sin(angle) * distance;
          const z = point.z + Math.cos(angle) * distance;
          if (this.actorClearAt(x, z, radius, id)) return { x, z };
        }
      }
      return null;
    }

    moveActor(point, dx, dz, radius, id, steer = false) {
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.18));
      const stepX = dx / steps;
      const stepZ = dz / steps;
      let moved = false;
      for (let step = 0; step < steps; step++) {
        const candidates = [[stepX, stepZ]];
        if (steer) {
          // Pass on the same relative side, so oncoming walkers separate.
          for (const angle of [Math.PI / 6, Math.PI / 3, Math.PI / 2, -Math.PI / 3, -Math.PI / 2]) {
            candidates.push([
              Math.cos(angle) * stepX - Math.sin(angle) * stepZ,
              Math.sin(angle) * stepX + Math.cos(angle) * stepZ,
            ]);
          }
        }
        candidates.push([stepX, 0], [0, stepZ]);
        let advanced = false;
        for (const [x, z] of candidates) {
          if (
            Math.hypot(x, z) < 0.00001 ||
            !this.actorClearAt(point.x + x, point.z + z, radius, id)
          )
            continue;
          if (steer) {
            const length = Math.hypot(x, z);
            // Begin passing before bodies touch. Looking ahead prevents two
            // walkers from repeatedly stepping into the same narrow gap.
            const lookAhead = Math.max(length, 0.75);
            if (
              this.actorCollisions.blocked(
                point.x + (x / length) * lookAhead,
                point.z + (z / length) * lookAhead,
                radius,
                id,
              )
            )
              continue;
          }
          point.x += x;
          point.z += z;
          moved = advanced = true;
          this.actorCollisions.set(id, { ...point, radius });
          break;
        }
        if (!advanced) break;
      }
      return moved;
    }

    path(start, target, actorId, gridSize = 1.5) {
      const clearance = gridSize < 1 ? 0.35 : 0.45;
      if (this.segmentClear(start, target, clearance, actorId))
        return [{ x: target.x, z: target.z }];
      const minimumCoordinate = this.measuredTerrain ? this.mapExtent.minX + 3 : -117;
      const maximumCoordinate = this.measuredTerrain
        ? this.mapExtent.minX + this.mapExtent.width - 3
        : 120;
      const encodeCell = (x, z) => x + ':' + z;
      const toCell = (point) => [Math.round(point.x / gridSize), Math.round(point.z / gridSize)];
      const [startX, startZ] = toCell(start);
      let [targetX, targetZ] = toCell(target);
      const isPassable = (x, z) =>
        x * gridSize >= minimumCoordinate &&
        x * gridSize <= maximumCoordinate &&
        z * gridSize >= minimumCoordinate &&
        z * gridSize <= maximumCoordinate &&
        this.clearAt(x * gridSize, z * gridSize, clearance) &&
        (actorId === undefined ||
          !this.actorCollisions.blocked(x * gridSize, z * gridSize, clearance, actorId));
      // Find a nearby open cell when the destination lies inside an obstacle.
      if (!isPassable(targetX, targetZ)) {
        let found = false;
        for (let radius = 1; radius < 6 && !found; radius++) {
          for (let dx = -radius; dx <= radius && !found; dx++) {
            for (let dz = -radius; dz <= radius && !found; dz++) {
              if (isPassable(targetX + dx, targetZ + dz)) {
                targetX += dx;
                targetZ += dz;
                found = true;
              }
            }
          }
        }
      }
      const targetKey = encodeCell(targetX, targetZ);
      const openNodes = [
        {
          x: startX,
          z: startZ,
          g: 0,
          f: Math.hypot(targetX - startX, targetZ - startZ),
        },
      ];
      const bestCost = new Map([[encodeCell(startX, startZ), 0]]);
      const cameFrom = new Map();
      let iterations = 0;
      // Bound search time so one worker's route cannot stall a rendered frame.
      while (openNodes.length && iterations++ < 6000) {
        openNodes.sort((left, right) => left.f - right.f);
        const current = openNodes.shift();
        const currentKey = encodeCell(current.x, current.z);
        if (currentKey === targetKey) {
          const waypoints = [];
          let previousKey = currentKey;
          while (cameFrom.has(previousKey)) {
            const [x, z] = previousKey.split(':').map(Number);
            waypoints.unshift({
              x: x * gridSize,
              z: z * gridSize,
            });
            previousKey = cameFrom.get(previousKey);
          }
          const last = waypoints.at(-1) || start;
          if (
            !this.clearAt(target.x, target.z, clearance) ||
            !this.segmentClear(last, target, clearance, actorId)
          )
            return [];
          waypoints.push({ x: target.x, z: target.z });
          return waypoints;
        }
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = current.x + dx;
          const z = current.z + dz;
          const neighborKey = encodeCell(x, z);
          if (!isPassable(x, z)) {
            continue;
          }
          const from =
            currentKey === encodeCell(startX, startZ)
              ? start
              : { x: current.x * gridSize, z: current.z * gridSize };
          if (!this.segmentClear(from, { x: x * gridSize, z: z * gridSize }, clearance, actorId)) {
            continue;
          }
          const nextCost = current.g + 1;
          if (nextCost >= (bestCost.get(neighborKey) ?? Infinity)) {
            continue;
          }
          bestCost.set(neighborKey, nextCost);
          cameFrom.set(neighborKey, currentKey);
          openNodes.push({
            x,
            z,
            g: nextCost,
            f: nextCost + Math.abs(targetX - x) + Math.abs(targetZ - z),
          });
        }
      }
      return [];
    }

    buildGeneric(type) {
      const group = super.buildGeneric(type);
      const definition = Model.TYPES[type];
      const posts = type === 'palisade' ? enclosurePosts(definition.w, definition.d) : [];
      return Models.addBuildingDetails(group, type, definition, posts);
    }

    sync() {
      super.sync();
      const state = this.sim.state;
      this.hall.visible = state.config.inheritedHall;
      this.ships.forEach((ship, i) => {
        ship.visible = state.ships[i]?.status === 'anchored';
        if (this.shipsSails[i]) {
          this.shipsSails[i].visible = !!state.ships[i]?.sail;
        }
      });
      for (const order of state.queue.filter((order) => order.kind)) {
        const object = this.objects.get(order.id);
        if (object) {
          this.scene.remove(object);
          if (object.userData.path) {
            this.scene.remove(object.userData.path);
          }
          this.objects.delete(order.id);
        }
      }
      const sig = [state.resources.tents, ...state.buildings, ...state.queue]
        .map((b) => (typeof b === 'number' ? b : [b.id, b.type, b.x, b.z, b.rotation].join(':')))
        .join(',');
      if (sig !== this.geometrySignature) {
        this.geometrySignature = sig;
        this.prepareObstacles();
        this.routes.clear();
        this.clearBuildingTrees();
      }
    }

    clearBuildingTrees() {
      for (const { o: object, matrices } of this.vegetation) {
        matrices.forEach((m, i) => {
          const point = new THREE.Vector3().setFromMatrixPosition(m);
          const occupied = this.clearedForConstruction(point.x, point.z);
          const result = m.clone();
          if (occupied) {
            result.scale(new THREE.Vector3(0, 0, 0));
          }
          object.setMatrixAt(i, result);
        });
        object.instanceMatrix.needsUpdate = true;
      }
    }

    canPlace(type, x, z, rotation = 0) {
      return this.sim.canPlace(type, x, z, rotation);
    }

    setView(view) {
      if (!['district', 'walk'].includes(view) || view === this.view) {
        return;
      }
      this.previousWalkPose = null;
      this.currentWalkPose = null;
      if (view === 'walk') {
        this.sim.commandWorkers([this.sim.state.leader.id], { type: 'stop' });
        this.orbitSaved = {
          azimuth: this.azimuth,
          polar: this.polar,
          distance: this.desiredDistance,
          target: this.target.clone(),
        };
        this.walkYaw = this.sim.state.leader.heading;
        this.camera.fov = 54;
        this.view = 'walk';
        this.sim.state.leader.walking = true;
      } else {
        this.view = 'district';
        this.sim.state.leader.walking = false;
        this.camera.fov = 39;
        if (this.orbitSaved) {
          this.azimuth = this.orbitSaved.azimuth;
          this.polar = this.orbitSaved.polar;
          this.desiredDistance = this.orbitSaved.distance;
          this.target.copy(this.orbitSaved.target);
        }
      }
      this.clearInput();
      this.camera.updateProjectionMatrix();
      this.sim.invalidateRoster();
    }

    nearby() {
      const l = this.sim.state.leader;
      let closest = null;
      for (const [id, point] of this.agentPositions) {
        if (id === l.id || this.sim.state.people[id].away || !this.sim.state.people[id].alive) {
          continue;
        }
        const d = Math.hypot(l.x - point.x, l.z - point.z);
        if (d < 5 && (!closest || d < closest.distance) && this.segmentClear(l, point, 0.05)) {
          closest = {
            type: 'person',
            id,
            distance: d,
          };
        }
      }
      const boat = this.view === 'walk' && this.nearbyBoatAction();
      if (boat) return boat;
      if (closest) {
        return closest;
      }
      if (this.sim.state.config.inheritedHall && Math.hypot(l.x, l.z) < 20) {
        return {
          type: 'hall',
        };
      }
      const buildingDefinition = this.sim.state.buildings.find(
        (b) =>
          Math.hypot(l.x - b.x, l.z - b.z) <
          Math.max(Model.TYPES[b.type].w, Model.TYPES[b.type].d) / 2 + 3,
      );
      return buildingDefinition
        ? {
            type: 'building',
            id: buildingDefinition.id,
          }
        : null;
    }

    update(deltaSeconds) {
      this.elapsed += deltaSeconds;
      this.envTime += deltaSeconds;
      const elapsedSeconds = this.elapsed;
      const weather = this.sim.weather;
      this.updateCamera(deltaSeconds);
      // Sea and freshwater share this clock; camera updates continue during pause.
      if (!this.paused) this.water.material.uniforms.time.value += deltaSeconds;
      this.animateShips(elapsedSeconds);
      this.animatePeople(deltaSeconds, elapsedSeconds);
      this.animateLivestock(elapsedSeconds);
      this.animateHearthsAndWildlife(elapsedSeconds, weather);
      this.updateLightingAndWeather(deltaSeconds, elapsedSeconds, weather);
      this.renderer.render(this.scene, this.camera);
    }

    clearInput() {
      this.keys.clear();
      this.heldRotationButtons?.clear();
      this.workerControls?.cancelDrag();
    }

    isForestAt(x, z) {
      return this.measuredTerrain
        ? this.treePlacements.some((tree) => Math.hypot(tree.x - x, tree.z - z) < 18)
        : x > 40;
    }

    findWorkerPosition(point, index = 0) {
      for (let radius = 0; radius < 24; radius += 2) {
        for (let step = 0; step < 12; step++) {
          const angle = index * 2.4 + (step * Math.PI) / 6;
          const x = point.x + Math.sin(angle) * radius;
          const z = point.z + Math.cos(angle) * radius;
          if (this.clearAt(x, z, 0.6)) {
            return { x, z };
          }
        }
      }
      return null;
    }

    isGatheringSite(resource, x, z) {
      if (!this.clearAt(x, z, 0.6)) {
        return false;
      }
      if (resource === 'timber' || resource === 'firewood') {
        return this.isForestAt(x, z);
      }
      // These are terrain-based habitat estimates, not surveyed resource beds.
      // Keep cutting outside the camp and away from standing water/buildings.
      if (Math.hypot(x, z) < 35 || this.isForestAt(x, z)) {
        return false;
      }
      const site = this.sim.siteInfo(x, z);
      return resource === 'turf'
        ? site.wet >= 0.28 && site.height < 7
        : resource === 'hay' && site.wet < 0.45 && site.height < 12;
    }

    gatheringCandidates(resource, origin) {
      const sites = [];
      if (resource === 'timber' || resource === 'firewood') {
        const trees = this.treePlacements
          .slice()
          .sort(
            (a, b) =>
              Math.hypot(a.x - origin.x, a.z - origin.z) -
              Math.hypot(b.x - origin.x, b.z - origin.z),
          );
        const cells = new Set();
        for (const tree of trees) {
          const cell = Math.floor(tree.x / 20) + ':' + Math.floor(tree.z / 20);
          if (!cells.has(cell)) {
            cells.add(cell);
            sites.push({ x: tree.x, z: tree.z });
          }
          if (sites.length >= 64) {
            break;
          }
        }
      } else {
        for (let radius = 12; radius <= 360 && sites.length < 64; radius += 12) {
          const samples = Math.max(8, Math.ceil((2 * Math.PI * radius) / 12));
          for (let step = 0; step < samples && sites.length < 64; step++) {
            const angle = (step / samples) * Math.PI * 2;
            const x = origin.x + Math.sin(angle) * radius;
            const z = origin.z + Math.cos(angle) * radius;
            if (this.isGatheringSite(resource, x, z)) {
              sites.push({ x, z });
            }
          }
        }
      }
      return sites;
    }

    supportWorkLocation(task) {
      if (task === 'fishing') {
        const landing = this.measuredTerrain ? root.VinlandMeadows.landing : [-60, -28];
        return { x: landing[0], z: landing[1] };
      }
      if (task === 'craft') {
        const workshop =
          this.sim.state.buildings.find((building) => building.type === 'smithy') ||
          this.sim.state.buildings.find((building) => building.type === 'charcoal');
        return workshop ? { x: workshop.x, z: workshop.z } : { x: 18, z: -23 };
      }
      return task === 'herding' ? { x: -38, z: 32 } : { x: 48, z: -37 };
    }

    workerDestination(person, data, deltaSeconds) {
      if (person.id === this.sim.conversationPersonId) return null;
      const order = person.order;
      if (!order) {
        return null;
      }
      if (order.type === 'move') {
        return order;
      }
      const working =
        order.type === 'work'
          ? this.sim.hour >= 8 && this.sim.hour < 8 + this.sim.state.politics.workHours
          : root.VinlandWorkerOrders.isWorkingHour(this.sim.hour);
      if (!working) {
        return null;
      }
      if (order.type === 'work') return order;
      if (order.type === 'build') {
        const construction = this.sim.state.queue.find(
          (building) => building.id === order.buildingId,
        );
        return construction && !construction.paused ? order : null;
      }
      return order;
    }

    moveWorker(person, data, target, deltaSeconds, speedMultiplier = 1) {
      if (!target) {
        this.routes.delete(person.id);
        return false;
      }
      const signature = [
        person.order?.type || person.job,
        person.order?.phase,
        target.x,
        target.z,
      ].join(':');
      let route = this.routes.get(person.id);
      if (!route || route.sig !== signature) {
        route = { sig: signature, points: this.path(data, target) };
        this.routes.set(person.id, route);
      }
      let remaining = deltaSeconds * WALK_SPEED * speedMultiplier;
      let moved = false;
      const initialDistance = Math.hypot(data.x - target.x, data.z - target.z);
      while (remaining > 0 && route.points.length) {
        // Grid corners are navigation hints, not places every walker must
        // occupy. Skip visible corners so crowds can pass a person standing
        // on a shared waypoint without squeezing through that person.
        while (
          route.points.length > 1 &&
          Math.hypot(route.points[1].x - data.x, route.points[1].z - data.z) < 5 &&
          this.segmentClear(
            data,
            route.points[1],
            0.45,
            route.avoidActors ? 'person:' + person.id : undefined,
          )
        ) {
          route.points.shift();
        }
        const next = route.points[0];
        const dx = next.x - data.x;
        const dz = next.z - data.z;
        const distance = Math.hypot(dx, dz);
        const step = Math.min(distance, remaining);
        if (distance > 0.001) {
          const x = data.x + (dx / distance) * step;
          const z = data.z + (dz / distance) * step;
          if (!this.segmentClear(data, { x, z }, PERSON_RADIUS)) {
            this.routes.delete(person.id);
            break;
          }
          const advanced = this.moveActor(
            data,
            x - data.x,
            z - data.z,
            PERSON_RADIUS,
            'person:' + person.id,
            true,
          );
          this.people[person.id].rotation.y = Math.atan2(dx, dz);
          moved ||= advanced;
        }
        remaining -= step;
        if (Math.hypot(data.x - next.x, data.z - next.z) < 0.05) {
          route.points.shift();
        }
      }
      const progress = initialDistance - Math.hypot(data.x - target.x, data.z - target.z);
      route.blockedSeconds =
        progress < deltaSeconds * 0.1 ? (route.blockedSeconds || 0) + deltaSeconds : 0;
      if (route.blockedSeconds >= 1.5) {
        const detour = this.path(data, target, 'person:' + person.id);
        if (detour.length) {
          route.points = detour;
          route.avoidActors = true;
        }
        route.blockedSeconds = 0;
      }
      return moved;
    }

    readMovementInput() {
      const arrowMovement = this.view !== 'walk';
      const forward =
        Number(this.keys.has('KeyW') || (arrowMovement && this.keys.has('ArrowUp'))) -
        Number(this.keys.has('KeyS') || (arrowMovement && this.keys.has('ArrowDown')));
      const right =
        Number(this.keys.has('KeyD') || (arrowMovement && this.keys.has('ArrowRight'))) -
        Number(this.keys.has('KeyA') || (arrowMovement && this.keys.has('ArrowLeft')));
      return { forward, right };
    }

    rotateWalkView(horizontal, vertical) {
      this.walkYaw -= horizontal;
      // The summer sun reaches about 62° here. Allow a view almost to the
      // zenith; the camera rig still keeps the camera above terrain/inside rooms.
      this.walkPitch = Math.max(
        -Math.PI * 0.44,
        Math.min(Math.PI * 0.4, this.walkPitch + vertical),
      );
    }

    updateWalkLook(deltaSeconds) {
      if (
        document.body.dataset.screen === 'atlantic' ||
        document.querySelector('dialog[open]') ||
        document.activeElement?.matches('input,textarea,select')
      )
        return;
      const horizontal = Number(this.keys.has('ArrowRight')) - Number(this.keys.has('ArrowLeft'));
      const vertical = Number(this.keys.has('ArrowDown')) - Number(this.keys.has('ArrowUp'));
      this.rotateWalkView(
        horizontal * WALK_LOOK_SPEED * deltaSeconds,
        vertical * WALK_LOOK_SPEED * deltaSeconds,
      );
    }

    actorElevation(x, z, actorId) {
      return actorId === this.sim.state.leader.id
        ? this.leaderSurfaceAt({ x, z }).height
        : Model.elevation(x, z, this.sim.state.config);
    }

    stepLeader(deltaSeconds) {
      if (this.view !== 'walk') return;
      const leader = this.sim.state.leader;
      if (this.sim.state.people[leader.id].arrivalFerry) return;
      this.previousWalkPose = { x: leader.x, z: leader.z, heading: leader.heading };
      if (this.sim.conversationPersonId == null && !document.querySelector('dialog[open]')) {
        const { forward, right } = this.readMovementInput();
        const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
        const speed =
          (this.leaderMoveSpeed(sprinting) * deltaSeconds) /
          Math.max(1, Math.hypot(forward, right));
        // The walk camera faces +Z at yaw zero, so screen-right points toward -X.
        const dx = (Math.sin(this.walkYaw) * forward - Math.cos(this.walkYaw) * right) * speed;
        const dz = (Math.cos(this.walkYaw) * forward + Math.sin(this.walkYaw) * right) * speed;
        this.moveActor(leader, dx, dz, PERSON_RADIUS, 'person:' + leader.id);
        Object.assign(this.sim.state.people[leader.id], { x: leader.x, z: leader.z });
        this.agentPositions.set(leader.id, { x: leader.x, z: leader.z });
        if (forward || right) {
          leader.heading = Math.atan2(dx, dz);
        }
      }
      this.currentWalkPose = { x: leader.x, z: leader.z, heading: leader.heading };
    }

    displayedWalkPose() {
      const leader = this.sim.state.leader;
      const previous = this.previousWalkPose;
      const current = this.currentWalkPose;
      // Loading, relocating or entering walk mode can change the position
      // outside a physics step. Start at that position instead of blending
      // from a stale pose elsewhere on the map.
      if (
        !previous ||
        !current ||
        current.x !== leader.x ||
        current.z !== leader.z ||
        current.heading !== leader.heading
      ) {
        return leader;
      }
      const alpha = Math.min(
        1,
        this.sim.state.realtimeRemainderSeconds / root.VinlandGathering.STEP_SECONDS,
      );
      const turn = Math.atan2(
        Math.sin(current.heading - previous.heading),
        Math.cos(current.heading - previous.heading),
      );
      return {
        x: previous.x + (current.x - previous.x) * alpha,
        z: previous.z + (current.z - previous.z) * alpha,
        heading: previous.heading + turn * alpha,
      };
    }

    updateCamera(deltaSeconds) {
      const state = this.sim.state;
      if (this.view === 'walk') {
        this.updateWalkLook(deltaSeconds);
        const pose = this.displayedWalkPose();
        const y = this.actorElevation(pose.x, pose.z, state.leader.id);
        const focus = new THREE.Vector3(pose.x, y + 1.3, pose.z);
        const horizontalDistance = Math.cos(this.walkPitch) * WALK_CAMERA_DISTANCE;
        const desired = new THREE.Vector3(
          pose.x - Math.sin(this.walkYaw) * horizontalDistance,
          focus.y + Math.sin(this.walkPitch) * WALK_CAMERA_DISTANCE,
          pose.z - Math.cos(this.walkYaw) * horizontalDistance,
        );
        // Keep the camera above nearby ground while preserving an upward look.
        const cameraWater = this.leaderSurfaceAt(desired);
        const minimumHeight = Math.max(
          Model.elevation(desired.x, desired.z, state.config) + 0.75,
          cameraWater.depth > 0 || cameraWater.mode === 'deck'
            ? cameraWater.surface + 0.4
            : -Infinity,
        );
        if (desired.y < minimumHeight) {
          focus.y += minimumHeight - desired.y;
          desired.y = minimumHeight;
        }
        this.indoorPresentation?.adjustCameraRig(pose, focus, desired, deltaSeconds);
        // Ease the complete camera rig together. Easing only its position
        // while snapping its aim causes a pitch pulse on every physics tick.
        const follow = 1 - Math.exp(-deltaSeconds * 8);
        this.camera.position.lerp(desired, follow);
        this.camera.position.y = Math.max(this.camera.position.y, minimumHeight);
        this.target.lerp(focus, follow);
        this.indoorPresentation?.constrainCamera(this.camera.position, this.target, pose);
        this.camera.lookAt(this.target);
      } else {
        this.distance += (this.desiredDistance - this.distance) * Math.min(1, deltaSeconds * 7);
        const sin = Math.sin(this.polar);
        this.camera.position.set(
          this.target.x + Math.sin(this.azimuth) * sin * this.distance,
          this.target.y + Math.cos(this.polar) * this.distance,
          this.target.z + Math.cos(this.azimuth) * sin * this.distance,
        );
        this.camera.lookAt(this.target);
      }
    }

    animateShips(elapsedSeconds) {
      this.ships.forEach((ship, i) => {
        // A saved deck position must remain on its anchored boat when loading,
        // rather than replaying the opening arrival beneath the passenger.
        const aboard = this.deckBoatAt(this.sim.state.leader)?.index === i;
        // Campaigns begin at 08:00. Faster simulation clocks must also finish
        // the arrival before the player reaches the anchored hull.
        const arrivalSeconds = Math.max(elapsedSeconds, (this.sim.state.time - 8) * 3600);
        const arrival = this.sim.day === 0 && !aboard ? Math.max(0, 1 - arrivalSeconds / 12) : 0;
        ship.position.set(
          this.shipPositions[i][0] - arrival * 18,
          0.06 + Math.sin(elapsedSeconds * 0.55 + i) * 0.1,
          this.shipPositions[i][1],
        );
        ship.rotation.z = Math.sin(elapsedSeconds * 0.4 + i) * 0.012;
      });
    }

    findIdleRestSpot(desired, personId) {
      const landing = this.sim.state.arrival?.landing;
      const normal = landing && root.VinlandArrival.shoreNormal(landing.x, landing.z);
      const reserved = [...(this.idlePeople?.entries() || [])]
        .filter(([id, rest]) => id !== personId && rest.target)
        .map(([, rest]) => rest.target);
      for (let attempt = 0; attempt < 32; attempt++) {
        const angle = attempt * 2.399 + personId;
        const radius = attempt ? 1.1 * Math.sqrt(attempt) : 0;
        const point = {
          x: desired.x + Math.sin(angle) * radius,
          z: desired.z + Math.cos(angle) * radius,
          heading: desired.heading,
        };
        if (!this.actorClearAt(point.x, point.z, 0.8, 'person:' + personId)) continue;
        if (this.spaceAt?.(point)) continue;
        if (this.measuredTerrain && root.VinlandMeadows.freshwaterDistance(point.x, point.z) < 3)
          continue;
        if (landing) {
          const dx = point.x - landing.x,
            dz = point.z - landing.z;
          const inland = dx * normal.x + dz * normal.z;
          const sideways = -dx * normal.z + dz * normal.x;
          if (inland < 30 && Math.abs(sideways) < 3.5) continue;
        }
        if (reserved.some((target) => Math.hypot(target.x - point.x, target.z - point.z) < 1.7))
          continue;
        const height = this.terrainSurfaceHeight(point.x, point.z);
        if (
          [-0.6, 0.6].some((dx) =>
            [-0.6, 0.6].some(
              (dz) =>
                Math.abs(this.terrainSurfaceHeight(point.x + dx, point.z + dz) - height) > 0.16,
            ),
          )
        )
          continue;
        return point;
      }
      return null;
    }

    idleRestDestination(person) {
      const tents = this.tents.filter(
        (tent, index) =>
          tent.visible &&
          (!this.sim.state.arrival || this.sim.state.arrival.tents[index]?.status === 'pitched'),
      );
      let desired;
      if (tents.length) {
        let tent = tents[person.household % tents.length];
        if (Math.hypot(tent.position.x - person.x, tent.position.z - person.z) > 30)
          tent = tents.reduce((nearest, candidate) =>
            candidate.position.distanceToSquared(this.people[person.id].position) <
            nearest.position.distanceToSquared(this.people[person.id].position)
              ? candidate
              : nearest,
          );
        const angle = person.id * 2.399;
        const radius = 4.5 + (person.id % 3);
        desired = {
          x: tent.position.x + Math.sin(angle) * radius,
          z: tent.position.z + Math.cos(angle) * radius,
          heading: angle + Math.PI,
        };
      } else if (this.sim.state.arrival?.landing) {
        desired = this.arrivalAssemblyTarget(person.id);
      } else desired = { x: person.x, z: person.z, heading: this.people[person.id].rotation.y };
      const point = this.findIdleRestSpot(desired, person.id);
      if (!point) return null;
      const route = this.path(person, point);
      if (!route.length && Math.hypot(person.x - point.x, person.z - point.z) > 0.2) return null;
      // Resting never requires crossing a stream or pond. Work orders retain
      // their existing navigation; an idle person can wait on this bank.
      if (this.measuredTerrain) {
        let previous = person;
        for (const next of route) {
          const steps = Math.max(
            1,
            Math.ceil(Math.hypot(next.x - previous.x, next.z - previous.z)),
          );
          for (let step = 1; step <= steps; step++) {
            const x = previous.x + ((next.x - previous.x) * step) / steps;
            const z = previous.z + ((next.z - previous.z) * step) / steps;
            if (root.VinlandMeadows.freshwaterDistance(x, z) < 0.5) return null;
          }
          previous = next;
        }
      }
      return point;
    }

    animatePeople(deltaSeconds, elapsedSeconds) {
      const state = this.sim.state;
      const leader = state.leader;
      this.sim.roster();
      this.people.forEach((object, i) => {
        const person = state.people[i];
        object.visible = !!person?.alive && !person.away;
        if (!object.visible) {
          this.actorCollisions.remove('person:' + i);
          return;
        }
        let data = this.agentPositions.get(i);
        if (!data) {
          const home = this.tentPositions[
            person.household % Math.max(1, this.tentPositions.length)
          ] || [16, 15];
          const sr = Model.seeded(state.config.seed + ':person:' + i);
          data = {
            x: Number.isFinite(person.x)
              ? person.x
              : i === leader.id
                ? leader.x
                : home[0] + (sr() - 0.5) * 12,
            z: Number.isFinite(person.z)
              ? person.z
              : i === leader.id
                ? leader.z
                : home[1] + (sr() - 0.5) * 12,
          };
          Object.assign(data, this.findActorPosition(data, PERSON_RADIUS, 'person:' + i) || data);
          this.agentPositions.set(i, data);
        }
        if (
          this.relocateActors &&
          !this.actorClearAt(data.x, data.z, PERSON_RADIUS, 'person:' + i)
        ) {
          Object.assign(data, this.findActorPosition(data, PERSON_RADIUS, 'person:' + i) || data);
        }
        if (this.relocateActors) Object.assign(person, { x: data.x, z: data.z });
        this.actorCollisions.set('person:' + i, { ...data, radius: PERSON_RADIUS });
        if (i === leader.id && (this.relocateActors || !Number.isFinite(person.x))) {
          leader.x = data.x;
          leader.z = data.z;
        }
        let moving = false;
        if (i === leader.id && this.view === 'walk') {
          data.x = leader.x;
          data.z = leader.z;
          object.rotation.y = this.displayedWalkPose().heading;
          const input = this.readMovementInput();
          moving = !this.paused && !!(input.forward || input.right);
        } else {
          data.x = Number.isFinite(person.x) ? person.x : data.x;
          data.z = Number.isFinite(person.z) ? person.z : data.z;
          moving = !this.paused && !!person.moving;
        }
        // Interpolation is presentation only. Collision positions, saves and
        // worker navigation continue using the authoritative simulation pose.
        const displayed = i === leader.id && this.view === 'walk' ? this.displayedWalkPose() : data;
        object.position.set(
          displayed.x,
          this.actorElevation(displayed.x, displayed.z, i),
          displayed.z,
        );
        if (i === this.sim.conversationPersonId) {
          object.rotation.y = Math.atan2(leader.x - data.x, leader.z - data.z);
        }
        this.actorCollisions.set('person:' + i, { x: data.x, z: data.z, radius: PERSON_RADIUS });
        person.x = data.x;
        person.z = data.z;
        const carriedResource =
          person.arrivalCarry?.resource ||
          person.cargo?.resource ||
          (person.carriedFirewood > 0 ? 'firewood' : null);
        const carrying = !!carriedResource;
        const working =
          !this.paused && root.VinlandWorkTiming.isWorking(this.sim, person) && !carrying;
        const cuttingWood =
          working && root.VinlandWorkTiming.AXE_ACTIVITIES.has(person.order?.activity);
        const tool = object.children.find((child) => child.name === 'harvest-tool');
        const source = state.harvest?.nodes[person.order?.nodeId];
        if (working && source) object.rotation.y = Math.atan2(source.x - data.x, source.z - data.z);
        for (const load of object.children.filter((child) => child.name.startsWith('carried-'))) {
          load.visible = carrying && load.userData.resource === carriedResource;
          load.position.set(0, 0, 0);
        }
        if (carrying) this.animateResourceUnloading(object, person);
        const rig = object.characterRig;
        const distance = rig.lastPosition
          ? Math.hypot(displayed.x - rig.lastPosition.x, displayed.z - rig.lastPosition.z)
          : 0;
        rig.lastPosition ||= { x: displayed.x, z: displayed.z };
        rig.lastPosition.x = displayed.x;
        rig.lastPosition.z = displayed.z;
        const talking = i === this.sim.conversationPersonId;
        const idle = root.VinlandIdlePeople.available(this.sim, person);
        const rest = this.idlePeople?.get(i);
        const aboard = root.VinlandIdlePeople.aboard(person);
        const resting = idle && !person.moving;
        const wetGround = !aboard && (this.sim.weather.rain || this.sim.weather.snow);
        const seated = (aboard || rest?.settled) && i % 3 !== 0 && !wetGround;
        if (resting && rest?.settled) object.rotation.y = rest.target.heading;
        root.VinlandCharacters.poseHuman(object, {
          distance,
          seconds: deltaSeconds,
          moving: moving && distance > 0.00001 && !talking,
          sprinting:
            i === leader.id &&
            this.view === 'walk' &&
            (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')),
          carrying,
          swimming: i === leader.id && this.leaderSurfaceAt(displayed).mode === 'swim',
          wading: i === leader.id && this.leaderSurfaceAt(displayed).mode === 'wade',
          chopping: cuttingWood && !talking,
          resting: resting ? (seated ? 'seated' : 'standing') : null,
          paused: this.paused,
          cameraDistance: object.position.distanceTo(this.camera.position),
          tool,
        });
      });
      this.relocateActors = false;
    }

    animateResourceUnloading(object, person) {
      if (!person.cargo) return;
      const order = person.order;
      const gathering = order?.phase === 'unloading';
      const hauling = order?.type === 'haul' && order.loadSeconds > 0;
      if (!gathering && !hauling) return;
      const storeId = gathering ? order.storeId : order.destinationStoreId;
      const store = this.sim.state.storage.stores[storeId];
      const elapsed = gathering ? order.unloadSeconds : order.loadSeconds;
      const duration = gathering
        ? root.VinlandGathering.UNLOAD_SECONDS
        : root.VinlandLogistics.UNLOAD_SECONDS;
      // The first part of unloading is sorting the bundle. In the final
      // second, move it from the arms onto the stack before inventory transfers.
      const progress = Math.max(0, Math.min(1, elapsed - duration + 1));
      if (!store || !progress || !this.resourceTransferPile) return;
      const amount = Math.min(
        person.cargo.amount,
        root.VinlandStorage.roomFor(this.sim.state, store, person.cargo.resource),
      );
      if (amount <= 1e-7) return;
      const pile = this.resourceTransferPile(store, person.cargo.resource, amount);
      if (!pile) return;
      const marker = this.resourcePileMarkers?.get(pile.id);
      const top = marker?.userData.stackTop || new THREE.Vector3(0, 0.1, 0);
      const point = root.VinlandBuildingSpaces.toWorld(pile, top);
      const floor = pile.indoor
        ? Model.elevation(store.x, store.z, this.sim.state.config) + 0.16
        : Model.elevation(pile.x, pile.z, this.sim.state.config) + 0.02;
      object.updateWorldMatrix(true, false);
      const destination = object.worldToLocal(new THREE.Vector3(point.x, floor + top.y, point.z));
      destination.sub(new THREE.Vector3(0, 1.15, 0.2));
      const load = object.getObjectByName('carried-' + person.cargo.resource);
      load.position.copy(destination.multiplyScalar(progress * progress * (3 - 2 * progress)));
    }

    animateLivestock(elapsedSeconds) {
      const state = this.sim.state;
      const deltaSeconds = Math.min(
        0.1,
        Math.max(0, elapsedSeconds - (this.lastLivestockTime ?? elapsedSeconds)),
      );
      this.lastLivestockTime = elapsedSeconds;
      const seconds = this.paused ? 0 : deltaSeconds;
      this.livestockTime = (this.livestockTime || 0) + seconds;
      const herd = [];
      let addedModels = false;
      for (const key of ['cattle', 'sheep', 'goats']) {
        for (let index = 0; index < state.livestock[key]; index++)
          herd.push(key === 'goats' ? 'goat' : key === 'cattle' ? 'cattle' : 'sheep');
      }
      while (this.animals.length < herd.length) {
        const index = this.animals.length;
        const animal = this.buildAnimal(herd[index], index);
        animal.userData = {
          phase: index * 1.7,
          index,
          ox: Math.sin(index * 2) * 13,
          oz: Math.cos(index * 2) * 8,
        };
        this.animals.push(animal);
        this.scene.add(animal);
        addedModels = true;
      }
      const byre =
        this.sim.season === 'winter' &&
        state.buildings.find((building) => building.type === 'byre');
      this.animals.forEach((existing, index) => {
        existing.visible = index < herd.length;
        const id = 'animal:' + index;
        if (!existing.visible) {
          this.actorCollisions.remove(id);
          return;
        }
        let animal = existing;
        // Aggregate herd counts can shift the species at an array index.
        // Replace the visual, preserving its location and registration data.
        if (animal.livestockRig.kind !== herd[index]) {
          animal = this.buildAnimal(herd[index], index);
          animal.position.copy(existing.position);
          animal.rotation.copy(existing.rotation);
          animal.userData = existing.userData;
          this.scene.remove(existing);
          this.scene.add(animal);
          this.animals[index] = animal;
          addedModels = true;
        }
        const data = animal.userData;
        const time = this.livestockTime;
        let x = -45 + data.ox + Math.sin(time * 0.06 + data.phase) * 1.2;
        let z = 29 + data.oz + Math.cos(time * 0.05 + data.phase);
        if (byre) {
          x = byre.x + ((index % 8) - 3.5) * 0.7;
          z = byre.z + (Math.floor(index / 8) - 1.5) * 2;
        }
        let moved = 0;
        const onDeck = false; // ArrivalWorld owns persistent livestock locations; established herds stay ashore.
        if (onDeck) {
          this.actorCollisions.remove(id);
          data.onLand = false;
          const ship = this.ships.at(-1);
          animal.position.set(
            ship.position.x + ((index % 4) - 1.5) * 0.8,
            1.4,
            ship.position.z + (Math.floor(index / 4) - 3.5) * 1.3,
          );
          animal.rotation.y = ship.rotation.y;
        } else {
          const radius = herd[index] === 'cattle' ? 0.8 : 0.45;
          let point = { x: animal.position.x, z: animal.position.z };
          if (!data.onLand || !this.actorClearAt(point.x, point.z, radius, id))
            point = this.findActorPosition(data.onLand ? point : { x, z }, radius, id) || point;
          data.onLand = true;
          const before = { ...point };
          const distance = Math.hypot(x - point.x, z - point.z);
          // Alternate gentle wandering with standing/grazing. This is ambient
          // presentation, not an additional source of feed or animal production.
          const wander = (time + index * 2.7) % 18 < 6;
          const step = wander || byre ? Math.min(distance, seconds * 0.45) : 0;
          if (distance > 0.01 && step > 0)
            this.moveActor(
              point,
              ((x - point.x) / distance) * step,
              ((z - point.z) / distance) * step,
              radius,
              id,
            );
          moved = Math.hypot(point.x - before.x, point.z - before.z);
          if (moved > 0.00001) {
            const heading = Math.atan2(point.x - before.x, point.z - before.z);
            const turn = Math.atan2(
              Math.sin(heading - animal.rotation.y),
              Math.cos(heading - animal.rotation.y),
            );
            animal.rotation.y += turn * Math.min(1, seconds * 8);
          }
          animal.position.set(point.x, this.actorElevation(point.x, point.z), point.z);
          this.actorCollisions.set(id, { ...point, radius });
        }
        const cosine = Math.cos(animal.rotation.y);
        const sine = Math.sin(animal.rotation.y);
        // The pose samples the existing walkable surface under each hoof and
        // the muzzle. Heights are relative to the animal's unchanged root.
        const groundAt = (localX, localZ) =>
          this.actorElevation(
            animal.position.x + cosine * localX + sine * localZ,
            animal.position.z - sine * localX + cosine * localZ,
          ) - animal.position.y;
        root.VinlandCharacters.poseLivestock(animal, {
          distance: moved,
          seconds,
          moving: moved > 0.00001,
          grazing: !onDeck && !byre && moved < 0.00001,
          paused: this.paused,
          cameraDistance: animal.position.distanceTo(this.camera.position),
          groundAt: onDeck ? null : groundAt,
        });
      });
      if (addedModels) this.indoorPresentation?.installMaterials();
    }

    animateHearthsAndWildlife(elapsedSeconds, w) {
      const state = this.sim.state;
      this.smokes.forEach(({ o: object, x, z, y, seed }) => {
        object.visible = state.hallReady && state.config.inheritedHall;
        const positions = object.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const h = (elapsedSeconds * 0.8 + i * 0.47 + seed) % 10;
          positions.setXYZ(
            i,
            x + h * w.wind * 0.017,
            Model.elevation(x, z, state.config) + y + h,
            z + h * 0.18,
          );
        }
        positions.needsUpdate = true;
      });
      // Hearth visuals and light follow physical combustion in InteriorPresentation.
      this.campFire.intensity = 0;
      this.birds.forEach((building, i) => {
        const a = elapsedSeconds * 0.055 + i * 0.8;
        building.visible = this.sim.season !== 'winter';
        building.position.set(
          -95 + Math.cos(a) * (20 + i),
          15 + i * 0.8 + Math.sin(elapsedSeconds * 0.4 + i),
          -25 + Math.sin(a) * (25 + i),
        );
        building.rotation.y = -a;
      });
    }

    updateLightingAndWeather(deltaSeconds, elapsedSeconds, weather) {
      this.sky ||= new root.VinlandSky(this);
      const solar = this.sky.update(elapsedSeconds, weather);
      const light = Math.max(0, this.sky.sunDirection.y);
      // Anchor the shadow volume near the viewed settlement or walking leader.
      // Moving this anchor never changes the astronomical direction.
      if (this.view === 'walk') {
        const leader = this.sim.state.leader;
        this.sun.target.position.set(
          leader.x,
          Model.elevation(leader.x, leader.z, this.sim.state.config),
          leader.z,
        );
      } else this.sun.target.position.copy(this.target);
      this.sun.position
        .copy(this.sky.sunDirection)
        .multiplyScalar(160)
        .add(this.sun.target.position);
      this.sun.intensity =
        solar.apparentElevationDegrees > 0
          ? light * 3.1 * (weather.rain || weather.snow ? 0.18 : 1)
          : 0;
      this.sun.color.set(light < 0.35 ? '#ffd0a0' : '#ffe7bd');
      this.scene.children.find((object) => object.isHemisphereLight).intensity =
        (0.18 + this.sky.daylight * 0.1 + light * 1.75) * (weather.rain ? 0.82 : 1);
      if (this.measuredTerrain) {
        this.scene.fog.color.copy(this.sky.horizonColor);
      } else {
        this.scene.background.copy(this.sky.horizonColor);
        this.scene.fog.color.copy(this.sky.horizonColor);
      }
      this.water.material.uniforms.sun.value.copy(this.sky.sunDirection);
      this.scene.fog.density = this.view === 'walk' ? 0.0065 : weather.rain ? 0.0035 : 0.0023;
      if (this.measuredTerrain && this.view === 'district') {
        this.scene.fog.density *= Math.min(1, 210 / this.distance);
      }
      this.water.material.uniforms.fogDensity.value = this.scene.fog.density;
      this.water.material.uniforms.fogColor.value.copy(this.scene.fog.color);
      const snow =
        this.sim.season === 'winter' && weather.temp < 1
          ? Math.min(0.68, (2 - weather.temp) * 0.075)
          : 0;
      this.snowUniform.value += (snow - this.snowUniform.value) * Math.min(1, deltaSeconds * 2);
      this.terrain.material.color.lerp(
        new THREE.Color().setRGB(1 - snow * 0.03, 1 - snow * 0.01, 1 + snow * 0.32),
        Math.min(1, deltaSeconds),
      );
      if (this.birchCrowns) {
        this.birchCrowns.material.color.set(
          this.sim.season === 'autumn'
            ? '#a99159'
            : this.sim.season === 'winter'
              ? '#747e68'
              : '#788356',
        );
      }
      this.weatherEffects.update(
        this.paused ? 0 : deltaSeconds,
        this.water.material.uniforms.time.value,
        weather,
        light,
      );
      this.indoorPresentation?.updateLighting(light, elapsedSeconds);
      this.clouds.visible = !this.measuredTerrain;
      this.clouds.position.x = Math.sin(elapsedSeconds * 0.002) * 25;
    }

    destroy() {
      window.removeEventListener('resize', this.resizeHandler);
      document.removeEventListener('keydown', this.keyDown);
      document.removeEventListener('keyup', this.keyUp);
      window.removeEventListener('blur', this.blurHandler);
      this.weatherEffects.dispose();
      this.sky?.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.container.replaceChildren();
    }
  }
  root.VinlandWorld.SettlementWorld = SettlementWorld;
})(window);
