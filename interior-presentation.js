/** Walk-view camera and light entering enclosed rooms. No external assets. */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  const Spaces = root.VinlandBuildingSpaces;
  const Hearths = root.VinlandHearths;
  const MAX_ROOMS = 6; // Hall F's six enclosed rooms share one shell.
  const CAMERA_RADIUS = 0.18;

  class InteriorPresentation {
    constructor(world) {
      this.world = world;
      this.cameraBlend = 0;
      this.materials = new Map();
      this.ownedMaterials = new Set();
      this.ray = new THREE.Raycaster();
      this.uniforms = {
        indoorRoomCount: { value: 0 },
        indoorFrames: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Vector4()) },
        indoorSizes: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Vector4()) },
        indoorRoofSlopes: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Vector2()) },
      };
      this.doorLight = new THREE.SpotLight('#c7dcdf', 0, 10, 0.85, 0.85, 2);
      this.smokeLight = new THREE.SpotLight('#ccdbe3', 0, 10, 0.5, 0.8, 2);
      this.fireLight = new THREE.PointLight('#ff9b46', 0, 9, 2);
      for (const light of [this.doorLight, this.smokeLight, this.fireLight]) {
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = 12;
        light.shadow.bias = -0.0004;
        light.shadow.normalBias = 0.025;
        light.shadow.autoUpdate = false;
        world.scene.add(light);
        if (light.target) world.scene.add(light.target);
      }
    }

    activeSpace() {
      return this.world.view === 'walk' ? this.cameraSpaceAt(this.world.displayedWalkPose()) : null;
    }

    hallPassages() {
      const rooms = this.world.usableSpaces().filter((space) => space.type === 'hall');
      if (this.passageRooms === rooms[0]) return this.passages || [];
      this.passageRooms = rooms[0];
      const connections = [
        ['I', 'II', 'z'],
        ['II', 'III', 'z'],
        ['IV', 'I', 'x'],
        ['V', 'II', 'x'],
        ['VII', 'III', 'x'],
      ];
      this.passages = [];
      for (const [from, to, axis] of connections) {
        const first = rooms.find((space) => space.room.n === from);
        const second = rooms.find((space) => space.room.n === to);
        if (!first || !second) continue;
        const dimension = axis === 'x' ? 'w' : 'd';
        const start = first.room[axis] + first.plan[dimension] / 2;
        const end = second.room[axis] - second.plan[dimension] / 2;
        const local =
          axis === 'x'
            ? { x: (start + end) / 2, z: second.room.z }
            : { x: second.room.x, z: (start + end) / 2 };
        const center = Spaces.toWorld({ x: 0, z: 0, rotation: first.rotation }, local);
        this.passages.push({
          ...center,
          rotation: first.rotation,
          rooms: [first, second],
          // Match the Hall door width. Slight overlap with each room avoids
          // a numerical boundary gap; exterior entrances are not included.
          plan: {
            w: axis === 'x' ? end - start + 0.24 : 1.1,
            d: axis === 'z' ? end - start + 0.24 : 1.1,
          },
        });
      }
      return this.passages;
    }

    hallPassageAt(point) {
      return this.hallPassages().find((passage) => Spaces.contains(passage, point));
    }

    cameraSpaceAt(point) {
      const room = this.world.spaceAt(point);
      if (room) return room;
      // Navigation and work still use exact room footprints. The camera also
      // recognises the thick-walled connecting passages as part of the Hall.
      return this.hallPassageAt(point)?.rooms.reduce((nearest, candidate) =>
        Math.hypot(candidate.x - point.x, candidate.z - point.z) <
        Math.hypot(nearest.x - point.x, nearest.z - point.z)
          ? candidate
          : nearest,
      );
    }

    shell(space) {
      if (!space) return null;
      if (space.type === 'hall') return this.world.hall;
      if (space.type === 'tent') return this.world.tents[Number(space.spaceId.split(':')[1])];
      return this.world.objects.get(space.id);
    }

    roofProfile(space) {
      let profile;
      this.shell(space)?.traverse((object) => {
        if (!object.userData.rainRoof) return;
        if (
          space.type === 'hall' &&
          (Math.abs(object.position.z - space.room.z) > 0.1 ||
            Math.abs(object.position.x - space.room.x) > 0.1)
        )
          return;
        profile = object.userData.rainRoof;
      });
      return profile;
    }

    ceiling(space, point) {
      const local = Spaces.toLocal(space, point);
      const floor = this.world.actorElevation(space.x, space.z);
      if (space.type === 'tent') return floor + 2.8 * (1 - Math.abs(local.x) / 1.75);
      const roof = this.roofProfile(space);
      if (!roof) return floor + 3 * (1 - Math.abs(local.x) / (space.plan.w / 2));
      return floor + roof.eave - 0.4 + roof.rise * (1 - Math.abs(local.x) / (roof.width / 2));
    }

    adjustCameraRig(pose, focus, desired, seconds) {
      const space = this.cameraSpaceAt(pose);
      const blend = 1 - Math.exp(-seconds * 9);
      this.cameraBlend += ((space ? 1 : 0) - this.cameraBlend) * blend;
      if (this.cameraBlend < 0.001) return;
      const yaw = this.world.walkYaw;
      const pitch = THREE.MathUtils.clamp(this.world.walkPitch, -0.2, 0.45);
      const indoor = new THREE.Vector3(
        pose.x - Math.sin(yaw) * 1.85 + Math.cos(yaw) * 0.22,
        focus.y + Math.sin(pitch) * 1.85 + 0.16,
        pose.z - Math.cos(yaw) * 1.85 - Math.sin(yaw) * 0.22,
      );
      desired.lerp(indoor, this.cameraBlend);
      if (space) this.constrainCamera(desired, focus, pose);
    }

    constrainCamera(position, focus, pose) {
      const space = this.cameraSpaceAt(pose);
      if (!space) return;
      // Constrain both the desired rig and its eased result. This prevents the
      // transition itself from travelling through a roof or wall at the door.
      const region = space.type === 'hall' ? this.hallPassageAt(pose) || space : space;
      const cameraRoom = this.cameraSpaceAt(position);
      const sharedHall = space.type === 'hall' && cameraRoom?.type === 'hall';
      const local = Spaces.toLocal(region, position);
      const inset = (space.type === 'hall' ? 0 : space.plan.thickness / 2) + CAMERA_RADIUS;
      if (!sharedHall) {
        local.x = THREE.MathUtils.clamp(
          local.x,
          -region.plan.w / 2 + inset,
          region.plan.w / 2 - inset,
        );
        local.z = THREE.MathUtils.clamp(
          local.z,
          -region.plan.d / 2 + inset,
          region.plan.d / 2 - inset,
        );
        const point = Spaces.toWorld(region, local);
        position.x = point.x;
        position.z = point.z;
      }
      const floor = this.world.actorElevation(pose.x, pose.z);
      const focusInHall = space.type === 'hall' && this.cameraSpaceAt(focus)?.type === 'hall';
      if (!focusInHall && !Spaces.contains(space, focus)) {
        focus.x = pose.x;
        focus.z = pose.z;
      }
      position.y = THREE.MathUtils.clamp(
        position.y,
        floor + 0.85,
        this.ceiling(sharedHall ? cameraRoom : space, position) - CAMERA_RADIUS,
      );
      focus.y = Math.min(focus.y, this.ceiling(space, pose) - 0.25);

      // Sweep a small camera volume against the actual room meshes, including
      // benches and roof slopes. Low furniture need not block a high camera.
      const direction = position.clone().sub(focus);
      const distance = direction.length();
      if (distance < 0.01) return;
      direction.normalize();
      const shell = this.shell(space);
      shell.updateWorldMatrix(true, true);
      const cameraObstacles = [shell];
      for (const { pivot } of this.world.doorControls.entries.values()) cameraObstacles.push(pivot);
      let allowed = distance;
      for (const offset of [
        [0, 0],
        [CAMERA_RADIUS, 0],
        [-CAMERA_RADIUS, 0],
        [0, CAMERA_RADIUS],
        [0, -CAMERA_RADIUS],
      ]) {
        const origin = focus.clone();
        origin.x += Math.cos(this.world.walkYaw) * offset[0];
        origin.z -= Math.sin(this.world.walkYaw) * offset[0];
        origin.y += offset[1];
        this.ray.set(origin, direction);
        this.ray.near = 0.08;
        this.ray.far = distance + CAMERA_RADIUS;
        const hit = this.ray
          .intersectObjects(cameraObstacles, true)
          .find(
            ({ object }) =>
              object.isMesh &&
              object.visible &&
              object.material.opacity > 0.5 &&
              !object.parent?.userData.hearth,
          );
        if (hit) allowed = Math.min(allowed, Math.max(0.08, hit.distance - CAMERA_RADIUS));
      }
      position.copy(focus).addScaledVector(direction, allowed);
      // A close camera can show the shoulder without clipping its near plane.
      if (this.world.camera.near !== 0.06) {
        this.world.camera.near = 0.06;
        this.world.camera.updateProjectionMatrix();
      }
    }

    installMaterials() {
      this.world.scene.traverse((object) => {
        if (!object.isMesh) return;
        const install = (original) => {
          if (
            !original.isMeshStandardMaterial ||
            this.ownedMaterials.has(original) ||
            original.userData.vinlandIndoorLighting
          )
            return original;
          if (this.materials.has(original)) return this.materials.get(original);
          const material = original.clone();
          material.userData.vinlandIndoorLighting = true;
          const previous = original.onBeforeCompile;
          const previousKey = original.customProgramCacheKey.call(original);
          const uniforms = this.uniforms;
          material.onBeforeCompile = function (shader, renderer) {
            previous.call(this, shader, renderer);
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = 'varying vec3 indoorWorldPosition;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
              '#include <project_vertex>',
              `
              #include <project_vertex>
              vec4 indoorVertex = vec4(transformed, 1.0);
              #ifdef USE_INSTANCING
                indoorVertex = instanceMatrix * indoorVertex;
              #endif
              indoorWorldPosition = (modelMatrix * indoorVertex).xyz;
            `,
            );
            shader.fragmentShader =
              `
              varying vec3 indoorWorldPosition;
              uniform int indoorRoomCount;
              uniform vec4 indoorFrames[${MAX_ROOMS}];
              uniform vec4 indoorSizes[${MAX_ROOMS}];
              uniform vec2 indoorRoofSlopes[${MAX_ROOMS}];
              float enclosedRoom() {
                for (int i = 0; i < ${MAX_ROOMS}; i++) {
                  if (i >= indoorRoomCount) break;
                  vec2 delta = indoorWorldPosition.xz - indoorFrames[i].xy;
                  vec2 local = vec2(dot(delta, vec2(indoorFrames[i].z, -indoorFrames[i].w)),
                                    dot(delta, indoorFrames[i].wz));
                  float ceiling = indoorSizes[i].w + indoorRoofSlopes[i].x *
                    (1.0 - abs(local.x) / indoorRoofSlopes[i].y);
                  if (abs(local.x) < indoorSizes[i].x + 0.03 && abs(local.y) < indoorSizes[i].y + 0.03 &&
                      indoorWorldPosition.y > indoorSizes[i].z - 0.2 &&
                      indoorWorldPosition.y < ceiling - 0.015) return 1.0;
                }
                return 0.0;
              }
            ` + shader.fragmentShader;
            // Keep outdoor sunlight intact. Inside, the roof blocks sun/sky;
            // local portal and hearth lights supply the room's illumination.
            const lights = THREE.ShaderChunk.lights_fragment_begin.replace(
              'getDirectionalLightInfo( directionalLight, directLight );',
              'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= 1.0 - enclosedRoom();',
            );
            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <lights_fragment_begin>',
              lights +
                '\n#if defined(RE_IndirectDiffuse)\nirradiance *= mix(1.0, 0.025, enclosedRoom());\n#endif\n',
            );
          };
          material.customProgramCacheKey = () => previousKey + ':enclosed-rooms-v1';
          this.materials.set(original, material);
          this.ownedMaterials.add(material);
          return material;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(install)
          : install(object.material);
      });
    }

    hearth(space = this.activeSpace()) {
      if (!space) return null;
      let hearth;
      const shell = this.shell(space);
      shell?.updateWorldMatrix(true, true);
      shell?.traverse((object) => {
        if (!object.userData.hearth) return;
        const point = object.getWorldPosition(new THREE.Vector3());
        if (Spaces.contains(space, point)) hearth = object;
      });
      return hearth;
    }

    hearthState(space) {
      return Hearths.view(this.world.sim, space.spaceId);
    }

    hearthEnabled(space) {
      return !!space && this.hearthState(space).powerKW > 0.02;
    }

    updatePot(hearth, fire) {
      if (!fire.pot && !hearth.userData.pot) return;
      if (!hearth.userData.pot) {
        const group = new THREE.Group();
        const iron = new THREE.MeshStandardMaterial({ color: '#282b2b', roughness: 0.9 });
        const bowl = new THREE.Mesh(
          new THREE.SphereGeometry(0.31, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
          iron,
        );
        bowl.scale.y = 0.85;
        group.add(bowl);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.025, 6, 20), iron);
        rim.rotation.x = Math.PI / 2;
        group.add(rim);
        const broth = new THREE.Mesh(
          new THREE.CircleGeometry(0.285, 20),
          new THREE.MeshStandardMaterial({
            color: '#8a6335',
            roughness: 0.45,
            side: THREE.DoubleSide,
          }),
        );
        broth.rotation.x = -Math.PI / 2;
        broth.position.y = -0.06;
        group.add(broth);
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.85, 5), iron);
        chain.position.y = 0.425;
        group.add(chain);
        group.userData.chain = chain;
        group.position.y = 0.85;
        hearth.add(group);
        hearth.userData.pot = group;
        // A portable cooking stand anchors the hook above the fire; its feet
        // stay within the existing hearth hazard, clear of the side aisles.
        const stand = new THREE.Group();
        const top = new THREE.Vector3(0, 1.7, 0);
        for (const [x, z] of [
          [-0.45, 0.4],
          [0.45, 0.4],
          [0, -0.52],
        ]) {
          const foot = new THREE.Vector3(x, 0.08, z);
          const direction = top.clone().sub(foot);
          const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.018, 0.024, direction.length(), 6),
            iron,
          );
          leg.position.copy(foot).add(top).multiplyScalar(0.5);
          leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
          stand.add(leg);
        }
        hearth.add(stand);
        hearth.userData.cookingStand = stand;
      }
      const pot = hearth.userData.pot;
      pot.visible = !!fire.pot;
      hearth.userData.cookingStand.visible = !!fire.pot;
      if (fire.pot) {
        pot.position.set(0, fire.pot.onFire ? 0.85 : 0.35, fire.pot.onFire ? 0 : 0.65);
        pot.userData.chain.visible = fire.pot.onFire;
      }
    }

    updateFuel(hearth, fire) {
      if (!hearth.userData.logs) {
        const logs = new THREE.Group();
        const geometry = new THREE.CylinderGeometry(0.065, 0.08, 0.72, 7);
        const material = new THREE.MeshStandardMaterial({ color: '#4e3625', roughness: 1 });
        for (let index = 0; index < 8; index++) {
          const log = new THREE.Mesh(geometry, material);
          log.rotation.set(Math.PI / 2, 0, (index % 2 ? 1 : -1) * 0.55);
          log.position.set(((index % 3) - 1) * 0.12, 0.15 + Math.floor(index / 3) * 0.1, 0);
          logs.add(log);
        }
        hearth.add(logs);
        hearth.userData.logs = logs;
      }
      const count = Math.ceil(Math.min(8, fire.fuelKg));
      hearth.userData.logs.children.forEach((log, index) => {
        log.visible = index < count;
      });
    }

    updateLighting(daylight, elapsed) {
      const world = this.world;
      // Apply roof occlusion while approaching a doorway as well, avoiding a
      // sudden change in the room's brightness when crossing the threshold.
      let active = this.activeSpace();
      if (!active && world.view === 'walk') {
        const pose = world.displayedWalkPose();
        active = world
          .usableSpaces()
          .filter((space) => !['tent', 'sailbudir', 'tentbudir'].includes(space.type))
          .map((space) => ({ space, door: Spaces.toWorld(space, space.plan.outside) }))
          .filter(({ door }) => Math.hypot(door.x - pose.x, door.z - pose.z) < 5)
          .sort(
            (a, b) =>
              Math.hypot(a.door.x - pose.x, a.door.z - pose.z) -
              Math.hypot(b.door.x - pose.x, b.door.z - pose.z),
          )[0]?.space;
      }
      const enclosed = active && !['tent', 'sailbudir', 'tentbudir'].includes(active.type);
      const rooms = enclosed
        ? active.type === 'hall'
          ? world.usableSpaces().filter((space) => space.type === 'hall')
          : [active]
        : [];
      this.uniforms.indoorRoomCount.value = rooms.length;
      rooms.forEach((space, index) => {
        const floor = world.actorElevation(space.x, space.z);
        const roof = this.roofProfile(space);
        this.uniforms.indoorFrames.value[index].set(
          space.x,
          space.z,
          Math.cos(space.rotation || 0),
          Math.sin(space.rotation || 0),
        );
        this.uniforms.indoorSizes.value[index].set(
          space.plan.w / 2,
          space.plan.d / 2,
          floor,
          roof ? floor + roof.eave - 0.22 - (space.type === 'hall' ? 0.14 : 0.09) : floor + 2.4,
        );
        this.uniforms.indoorRoofSlopes.value[index].set(
          roof?.rise || 1,
          roof ? roof.width / 2 : space.plan.w / 2,
        );
      });
      const sky = daylight * (world.sim.weather.rain ? 0.55 : 1);
      this.doorLight.intensity = 0;
      this.smokeLight.intensity = 0;
      this.fireLight.intensity = 0;
      for (const light of [this.doorLight, this.smokeLight, this.fireLight]) {
        light.shadow.autoUpdate = false;
        light.shadow.needsUpdate = false;
      }
      // Replace the old large, unoccluded glow above Hall F.
      world.campFire.intensity = 0;
      for (const space of world.usableSpaces()) {
        const hearth = this.hearth(space);
        if (!hearth) continue;
        const fire = this.hearthState(space);
        const flame = hearth.userData.flame;
        flame.visible = fire.flameKW > 0.03;
        const strength = Math.min(1.8, Math.sqrt(fire.flameKW / 6));
        flame.scale.set(strength, strength * (1 + Math.sin(elapsed * 8) * 0.12), strength);
        for (const child of hearth.children)
          if (child !== flame && child.material?.isMeshBasicMaterial) {
            child.visible = fire.embersKg > 0.0005;
            child.material.color.setRGB(Math.min(1, fire.powerKW / 5), 0.05, 0.008);
          }
        this.updatePot(hearth, fire);
        this.updateFuel(hearth, fire);
      }
      for (const smoke of world.smokes) {
        const room = world
          .usableSpaces()
          .find(
            (space) =>
              space.type === 'hall' && space.room.x === smoke.x && space.room.z === smoke.z,
          );
        if (!room) continue;
        const fire = this.hearthState(room);
        smoke.o.visible = fire.flameKW > 0.05;
        smoke.o.material.opacity =
          Math.min(0.4, 0.08 + fire.moisture * 0.35) * Math.min(1, fire.flameKW / 4);
        smoke.o.position.set(room.x - smoke.x, 0, room.z - smoke.z);
      }
      if (!enclosed) return;
      const floor = world.actorElevation(active.x, active.z);
      const door = Spaces.toWorld(active, active.plan.inside);
      const direction = active.type === 'hall' ? { x: -1.8, z: 0 } : { x: 0, z: -1.8 };
      const target = Spaces.toWorld(active, {
        x: active.plan.inside.x + direction.x,
        z: active.plan.inside.z + direction.z,
      });
      this.doorLight.position.set(door.x, floor + 1.65, door.z);
      this.doorLight.target.position.set(target.x, floor + 0.3, target.z);
      const adjoiningRoom = world.spaceAt(Spaces.toWorld(active, active.plan.outside));
      const borrowedDaylight = adjoiningRoom && adjoiningRoom.spaceId !== active.spaceId ? 0.18 : 1;
      const entranceDoor = [...world.doorControls.entries.values()]
        .map(({ door }) => door)
        .filter((door) => door.spaceIds.includes(active.spaceId))
        .sort(
          (a, b) => Math.hypot(a.x - door.x, a.z - door.z) - Math.hypot(b.x - door.x, b.z - door.z),
        )[0];
      const entranceOpen =
        active.type === 'tent' ||
        (entranceDoor && root.VinlandDoors.isOpen(world.sim.state, entranceDoor.id));
      this.doorLight.intensity = entranceOpen ? sky * 17 * borrowedDaylight : 0;
      const roof = this.roofProfile(active);
      const hearth = this.hearth(active);
      if (hearth && roof) {
        this.smokeLight.position.set(active.x, floor + roof.eave + roof.rise - 0.3, active.z);
        this.smokeLight.target.position.set(active.x, floor + 0.1, active.z);
        this.smokeLight.intensity = sky * 10;
      }
      if (hearth && this.hearthEnabled(active)) {
        hearth.getWorldPosition(this.fireLight.position);
        this.fireLight.position.y += 0.65;
        this.fireLight.intensity =
          Math.min(28, this.hearthState(active).powerKW * 0.8) *
          (1 + Math.sin(elapsed * 6.7) * 0.045 + Math.sin(elapsed * 11.3) * 0.025);
      }
      // Keep shader light counts stable, but do not render eight extra shadow
      // views in district mode or when the corresponding light is off.
      for (const light of [this.doorLight, this.smokeLight, this.fireLight])
        light.shadow.autoUpdate = light.intensity > 0;
    }

    destroy() {
      for (const material of this.ownedMaterials) material.dispose();
      for (const light of [this.doorLight, this.smokeLight, this.fireLight]) light.dispose();
    }
  }
  root.VinlandInteriorPresentation = InteriorPresentation;
})(window);
