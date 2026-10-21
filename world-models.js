/**
 * Object-model factories: geometry, materials and named visual parts only.
 * Metres, Y up. No simulation/world access, navigation, scene registration or
 * animation updates. Controllers pass layouts, quantities and ground offsets,
 * then register returned roofs, hearths, smoke sources and sails themselves.
 * Character rigs and the baked knarr structure keep their dedicated modules.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  // Shared surfaces and primitives, also used by terrain and scenery rendering.
  const createMaterial = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.96,
      ...extra,
    });
  const materials = {
    wood: createMaterial('#695039'),
    darkwood: createMaterial('#403e2c'),
    planks: createMaterial('#9e7850'),
    turf: createMaterial('#afbc8a'),
    wall: createMaterial('#8d956d'),
    soil: createMaterial('#7e7358'),
    stone: createMaterial('#7c8176'),
    linen: createMaterial('#dad0ac', {
      side: THREE.DoubleSide,
    }),
    rope: createMaterial('#b3a583'),
    iron: createMaterial('#444941', {
      metalness: 0.5,
    }),
    skin: createMaterial('#c6a180'),
    white: createMaterial('#d6cfb2'),
    black: createMaterial('#4b493b'),
  };
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(1, 7, 5),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 7),
    cone: new THREE.ConeGeometry(1, 1, 8),
  };
  function addMesh(g, m, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const addBox = (p, x, y, z, w, h, d, m) => addMesh(geometries.box, m, p, x, y, z, w, h, d);
  function turfWall(parent, x, z, length, alongZ, opening = false, openingOffset = 0) {
    const thickness = 0.85;
    const height = 2.3;
    const segment = (mid, len) => {
      const cx = x + (alongZ ? 0 : mid);
      const cz = z + (alongZ ? mid : 0);
      const wall = addBox(
        parent,
        cx,
        height / 2,
        cz,
        alongZ ? thickness : len,
        height,
        alongZ ? len : thickness,
        materials.wall,
      );
      wall.userData.turfGroundWall = true;
      for (let y = 0.4; y < height; y += 0.4) {
        addBox(
          parent,
          cx,
          y,
          cz,
          alongZ ? thickness + 0.025 : len,
          0.045,
          alongZ ? len : thickness + 0.025,
          materials.turf,
        );
      }
    };
    if (!opening) {
      segment(0, length);
      return;
    }
    const door = 1.1;
    const part = (length - door) / 2;
    segment(-(length + door) / 4 + openingOffset / 2, part + openingOffset);
    segment((length + door) / 4 + openingOffset / 2, part - openingOffset);
    x += alongZ ? 0 : openingOffset;
    z += alongZ ? openingOffset : 0;
    addBox(
      parent,
      x,
      2.13,
      z,
      alongZ ? thickness : door,
      0.34,
      alongZ ? door : thickness,
      materials.wall,
    );
    const a = alongZ ? [x, 1.95, z - door / 2] : [x - door / 2, 1.95, z];
    const b = alongZ ? [x, 1.95, z + door / 2] : [x + door / 2, 1.95, z];
    addBeam(parent, a, b, 0.09);
  }
  function addBeam(p, a, b, r = 0.1, m = materials.wood) {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const v = end.clone().sub(start);
    const object = addMesh(geometries.cylinder, m, p);
    object.scale.set(r, v.length(), r);
    object.position.copy(start.add(end).multiplyScalar(0.5));
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
    return object;
  }
  function addRope(p, points, r = 0.022) {
    const curve = new THREE.CatmullRomCurve3(points.map((a) => new THREE.Vector3(...a)));
    return addMesh(new THREE.TubeGeometry(curve, 16, r, 4, false), materials.rope, p);
  }
  const detailBox = (group, w, h, d, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const detailMaterial = (color) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.94,
    });
  const clothColors = ['#7d6652', '#59726b', '#967c58', '#876258', '#586b4f', '#b5a481', '#50676e'];
  const clothMats = clothColors.map((color) => detailMaterial(color));

  function addBarrel(parent, ...dimensions) {
    const object = createBarrel(...dimensions);
    parent.add(object);
    return object;
  }
  function addRoof(parent, ...dimensions) {
    const roof = createRoof(...dimensions);
    parent.add(roof);
    return roof;
  }
  function addHearth(parent, hearths, x, z, long) {
    const hearth = createHearth(x, z, long);
    parent.add(hearth);
    hearths.push(hearth);
    return hearth;
  }
  // Furniture and structural parts. These do not register scene effects.
  function createSlateOven(kitchen, random) {
    const oven = new THREE.Group();
    oven.position.set(kitchen.x - 1, 0.1, kitchen.z + 1);
    const dark = detailMaterial('#4b614b');
    const slate = detailMaterial('#757c73');
    for (const side of [-1, 1]) {
      const x = side * 0.32;
      detailBox(oven, 0.04, 0.55, 0.9, slate, x - 0.27, 0.27, 0);
      detailBox(oven, 0.04, 0.55, 0.9, slate, x + 0.27, 0.27, 0);
      detailBox(oven, 0.55, 0.55, 0.04, slate, x, 0.27, -0.43);
      detailBox(oven, 0.55, 0.05, 0.9, dark, x, 0.03, 0);
    }
    for (let i = 0; i < 18; i++) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), slate);
      rock.position.set((random() - 0.5) * 1.15, 0.6 + random() * 0.15, (random() - 0.5) * 0.8);
      oven.add(rock);
    }
    return oven;
  }

  function createBarrel(x, y, z, s = 1) {
    const object = new THREE.Group();
    object.position.set(x, y, z);
    object.scale.setScalar(s);
    object.userData.walkObstacle = { radius: 0.38 };
    addMesh(
      new THREE.CylinderGeometry(0.38, 0.33, 0.85, 10),
      materials.planks,
      object,
      0,
      0.425,
      0,
    );
    for (const h of [0.17, 0.67]) {
      addMesh(
        new THREE.TorusGeometry(0.365, 0.025, 4, 12),
        materials.iron,
        object,
        0,
        h,
        0,
      ).rotation.x = Math.PI / 2;
    }
    addBox(object, 0, 0.86, 0, 0.66, 0.035, 0.66, materials.wood);
    return object;
  }
  function createRoof(x, z, w, d, height = 2.5, rise = 1.8, turf = true, smokeOpening = false) {
    const roof = new THREE.Group();
    roof.position.set(x, 0, z);
    roof.userData.rainRoof = { width: w, depth: d, eave: height + 0.22, rise };
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, height);
    shape.lineTo(0, height + rise);
    shape.lineTo(w / 2, height);
    shape.lineTo(w / 2, height + 0.22);
    shape.lineTo(0, height + rise + 0.22);
    shape.lineTo(-w / 2, height + 0.22);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: d,
      bevelEnabled: false,
      steps: 1,
    });
    g.translate(0, 0, -d / 2);
    const roofMaterial = (turf ? materials.turf : materials.planks).clone();
    const liningMaterial = materials.planks.clone();
    liningMaterial.side = THREE.DoubleSide;
    const addRoofPanel = (geometry) => {
      addMesh(geometry, roofMaterial, roof);
      // Timber faces the room; grass belongs on the outside.
      const lining = addMesh(geometry, liningMaterial, roof, 0, -0.06, 0);
      lining.userData.indoorLining = true;
    };
    if (turf) {
      // The roof overhang sits beyond the wall centre. Close the space
      // between its sloping underside and the flat wall top with timber,
      // otherwise the room has a continuous, unintended strip of open sky.
      const wallWidth = w - 1.7,
        wallDepth = d - 1.7;
      for (const side of [-1, 1]) {
        const inner = side * (wallWidth / 2 - 0.15);
        const outer = side * (wallWidth / 2 + 0.15);
        const top = (edge) => height + rise * (1 - Math.abs(edge) / (w / 2));
        const closure = new THREE.Shape();
        closure.moveTo(inner, 2.25);
        closure.lineTo(outer, 2.25);
        closure.lineTo(outer, top(outer));
        closure.lineTo(inner, top(inner));
        closure.closePath();
        const geometry = new THREE.ExtrudeGeometry(closure, {
          depth: wallDepth,
          bevelEnabled: false,
        });
        geometry.translate(0, 0, -wallDepth / 2);
        addMesh(geometry, liningMaterial, roof).userData.indoorLining = true;
        addBox(
          roof,
          0,
          2.33,
          (side * wallDepth) / 2,
          wallWidth,
          0.2,
          0.3,
          liningMaterial,
        ).userData.indoorLining = true;
      }
    }
    // Open gable ends were invisible from inside; close them below the roof.
    for (const end of [-1, 1]) {
      const gable = new THREE.Shape();
      gable.moveTo(-w / 2, height);
      gable.lineTo(0, height + rise);
      gable.lineTo(w / 2, height);
      gable.closePath();
      const mesh = addMesh(
        new THREE.ShapeGeometry(gable),
        liningMaterial,
        roof,
        0,
        0,
        (end * (d - (turf ? 1.7 : 0.6))) / 2,
      );
      mesh.material.side = THREE.DoubleSide;
    }
    if (smokeOpening) {
      // Separate roof sections leave a genuine ridge aperture, not a light
      // shining through an opaque mesh. The short middle section has no ridge.
      const holeWidth = 0.65,
        holeDepth = 0.9;
      for (const end of [-1, 1]) {
        const section = g.clone();
        section.scale(1, 1, (d - holeDepth) / (2 * d));
        section.translate(0, 0, (end * (d + holeDepth)) / 4);
        addRoofPanel(section);
      }
      for (const side of [-1, 1]) {
        const panel = new THREE.Shape();
        const edge = (side * holeWidth) / 2;
        const peak = height + rise * (1 - holeWidth / w);
        panel.moveTo((side * w) / 2, height);
        panel.lineTo(edge, peak);
        panel.lineTo(edge, peak + 0.22);
        panel.lineTo((side * w) / 2, height + 0.22);
        panel.closePath();
        const middle = new THREE.ExtrudeGeometry(panel, {
          depth: holeDepth,
          bevelEnabled: false,
        });
        middle.translate(0, 0, -holeDepth / 2);
        addRoofPanel(middle);
      }
      roof.userData.smokeOpening = { width: holeWidth, depth: holeDepth };
    } else addRoofPanel(g);
    for (const side of [-1, 1]) {
      addBeam(
        roof,
        [(side * w) / 2, height, -d / 2],
        [(side * w) / 2, height, d / 2],
        0.13,
        materials.darkwood,
      );
    }
    if (!smokeOpening)
      addBeam(
        roof,
        [0, height + rise + 0.13, -d / 2],
        [0, height + rise + 0.13, d / 2],
        0.12,
        materials.darkwood,
      );
    for (const zz of [-d / 2, d / 2]) {
      for (const side of [-1, 1]) {
        addBeam(roof, [(side * w) / 2, height, zz], [0, height + rise, zz], 0.11, materials.wood);
      }
    }
    return roof;
  }
  function createHearth(x, z, long = true) {
    const group = new THREE.Group();
    group.position.set(x, 0.05, z);
    addBox(group, 0, 0, 0, long ? 0.9 : 1.1, 0.1, long ? 2 : 1.1, materials.stone);
    for (let i = 0; i < 9; i++) {
      addMesh(
        geometries.sphere,
        materials.stone,
        group,
        Math.sin(i * 2.8) * (long ? 0.48 : 0.5),
        0.11,
        Math.cos(i * 2.8) * (long ? 1 : 0.5),
        0.17,
        0.12,
        0.17,
      );
    }
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.27, 0.5, 6),
      new THREE.MeshBasicMaterial({
        color: '#edaf4a',
        transparent: true,
        opacity: 0.85,
      }),
    );
    fire.position.set(0, 0.31, 0);
    group.userData.hearth = true;
    group.userData.flame = fire;
    group.add(fire);
    addMesh(
      geometries.sphere,
      new THREE.MeshBasicMaterial({
        color: '#b95528',
      }),
      group,
      0,
      0.08,
      0,
      0.24,
      0.05,
      long ? 0.6 : 0.25,
    );
    return group;
  }
  // Hall construction returns the parts needed by selection and interiors.
  function createHall(rooms) {
    const hall = new THREE.Group();
    const walls = new THREE.Group();
    const roofs = new THREE.Group();
    const inside = new THREE.Group();
    hall.add(walls, roofs, inside);
    const roomMeshes = [],
      hearths = [],
      smokeSources = [];
    rooms.forEach((r) => {
      const floor = addBox(inside, r.x, 0.06, r.z, r.w, 0.15, r.d, materials.soil);
      floor.userData.room = r.n;
      roomMeshes.push(floor);
      if (r.kind === 'shed') {
        for (const x of [r.x - r.w / 2, r.x + r.w / 2]) {
          for (const z of [r.z - r.d / 2, r.z, r.z + r.d / 2]) {
            addBeam(walls, [x, 0, z], [x, 2.55, z], 0.11);
          }
        }
        addBox(walls, r.x, 1.2, r.z - r.d / 2, r.w, 2.4, 0.3, materials.darkwood);
        addRoof(roofs, r.x, r.z, r.w + 0.6, r.d + 0.7, 2.5, 0.45, false);
        const cradle = createHull(6.8, 1.6, false);
        cradle.position.set(r.x, 0.65, r.z);
        cradle.userData.walkObstacle = { w: 1.6, d: 6.8 };
        inside.add(cradle);
        for (let j = 0; j < 3; j++) {
          addBox(inside, r.x, 0.25, r.z - 2.5 + j * 2.5, 2.5, 0.4, 0.3, materials.wood);
        }
        return;
      }
      const thick = 0.85;
      for (const side of [-1, 1]) {
        turfWall(
          walls,
          r.x + side * (r.w / 2 + thick / 2),
          r.z,
          r.d + thick * 2,
          true,
          r.kind === 'living' || side === 1,
          r.n === 'V' && side === 1 ? -0.4 : 0,
        );
      }
      for (const side of [-1, 1]) {
        turfWall(
          walls,
          r.x,
          r.z + side * (r.d / 2 + thick / 2),
          r.w,
          false,
          r.kind === 'living' && !(r.n === 'I' && side === -1) && !(r.n === 'III' && side === 1),
        );
      }
      if (r.kind === 'living') {
        for (const side of [-1, 1]) {
          // Keep the side entrance clear instead of running a sleeping
          // platform straight across the doorway.
          const platformLength = (r.d - 0.7 - 1.5) / 2;
          for (const end of [-1, 1]) {
            addBox(
              inside,
              r.x + side * (r.w / 2 - 0.5),
              0.37,
              r.z + end * (0.75 + platformLength / 2),
              0.93,
              0.65,
              platformLength,
              materials.planks,
            ).userData.walkObstacle = true;
          }
          for (let j = 0; j < Math.floor(r.d); j++) {
            if (Math.abs(-r.d / 2 + 0.7 + j) < 0.9) continue;
            const m = createMaterial(j % 2 ? '#a29675' : '#81866a');
            addBox(
              inside,
              r.x + side * (r.w / 2 - 0.5),
              0.74,
              r.z - r.d / 2 + 0.7 + j,
              0.7,
              0.1,
              0.8,
              m,
            );
          }
        }
        addHearth(inside, hearths, r.x, r.z, r.n !== 'I');
        for (const z of [r.z - r.d / 2 + 0.5, r.z + r.d / 2 - 0.5]) {
          for (const x of [r.x - r.w / 2 + 0.2, r.x + r.w / 2 - 0.2]) {
            addBeam(inside, [x, 0, z], [x, 3.7, z], 0.1);
          }
        }
        addRoof(roofs, r.x, r.z, r.w + 2.1, r.d + 2, 2.28, 1.85, true, true);
        smokeSources.push({ x: r.x, z: r.z, y: 4.25 });
      } else {
        addRoof(roofs, r.x, r.z, r.w + 1.8, r.d + 1.8, 2.28, 1.25, true, r.kind === 'kitchen');
        if (r.kind === 'storage') {
          for (let i = 0; i < 3; i++) {
            addBarrel(inside, r.x - r.w / 2 + 0.65, 0.1, r.z - r.d / 2 + 1 + i * 1.05, 0.8);
          }
          addBox(
            inside,
            r.x + 0.65,
            0.6,
            r.z + r.d / 2 - 1,
            1,
            1,
            1.7,
            materials.wood,
          ).userData.walkObstacle = true;
          if (r.n === 'V') {
            addMesh(
              new THREE.CylinderGeometry(0.55, 0.55, 0.65, 10),
              materials.wood,
              inside,
              r.x + 1,
              0.4,
              r.z - 2,
            );
          }
        } else {
          addBox(
            inside,
            r.x - 1,
            0.06,
            r.z + 1,
            1.25,
            0.12,
            1.2,
            materials.stone,
          ).userData.walkObstacle = true;
          addHearth(inside, hearths, r.x - 1, r.z + 1, false);
          smokeSources.push({ x: r.x, z: r.z, y: 3.65 });
          addBarrel(inside, r.x + 1, 0, r.z - 1, 0.65);
        }
      }
    });
    hall.traverse((object) => {
      if (object.isMesh) {
        object.userData.hall = true;
      }
    });
    return { object: hall, walls, roofs, inside, roomMeshes, hearths, smokeSources };
  }
  function createTent(index) {
    const group = new THREE.Group();
    const w = 3.5;
    const d = 5;
    const h = 2.8;
    const verts = [
      -w / 2,
      0,
      -d / 2,
      0,
      h,
      -d / 2,
      0,
      h,
      d / 2,
      -w / 2,
      0,
      -d / 2,
      0,
      h,
      d / 2,
      -w / 2,
      0,
      d / 2,
      w / 2,
      0,
      -d / 2,
      0,
      h,
      d / 2,
      0,
      h,
      -d / 2,
      w / 2,
      0,
      -d / 2,
      w / 2,
      0,
      d / 2,
      0,
      h,
      d / 2,
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(
        [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1],
        2,
      ),
    );
    geometry.computeVertexNormals();
    addMesh(
      geometry,
      index % 3 === 0
        ? createMaterial('#c8b88c', {
            side: THREE.DoubleSide,
          })
        : materials.linen,
      group,
    );
    for (const z of [-d / 2, d / 2]) {
      addBeam(group, [-w / 2 - 0.1, 0, z], [0, h + 0.15, z], 0.08);
      addBeam(group, [w / 2 + 0.1, 0, z], [0, h + 0.15, z], 0.08);
      addRope(group, [
        [0, h, z],
        [-2.7, 0, z + Math.sign(z) * 0.6],
      ]);
    }
    addBeam(group, [0, h, -d / 2 - 0.3], [0, h, d / 2 + 0.3], 0.08);
    addBox(group, 0, 0.02, 0, w, 0.03, d, materials.soil);
    group.userData.rainRoof = { width: w, depth: d, eave: 0, rise: h };
    group.userData.select = 'tent';
    return group;
  }
  // Boats: fixed geometry and movable sail handles; no transport decisions.
  function createHull(length, width, deck = true) {
    const group = new THREE.Group();
    // Shared by traversal and rendering; deck bounds follow these planks.
    group.userData.boatGeometry = {
      length,
      width,
      deckHeight: 1.16,
      deckEnd: (length * 6.4) / 14,
      obstacles: [{ x: 0, z: 0, radius: 0.18 }],
    };
    const rows = 8;
    const segments = 32;
    for (let band = 0; band < rows; band++) {
      const v = [];
      const idx = [];
      for (let j = 0; j <= segments; j++) {
        const z = (j / segments - 0.5) * length;
        const u = (j / segments) * 2 - 1;
        const broad = Math.pow(Math.sin((j / segments) * Math.PI), 0.58);
        for (let key = 0; key < 2; key++) {
          const f = (band + key) / rows;
          const x = broad * width * 0.5 * (0.33 + f * 0.67);
          const y = 0.25 + f * f * 1.6 + Math.pow(Math.abs(u), 5) * 1.25;
          v.push(x, y, z);
        }
      }
      for (let j = 0; j < segments; j++) {
        let a = j * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const geoHull = new THREE.BufferGeometry();
      geoHull.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      geoHull.setIndex(idx);
      geoHull.computeVertexNormals();
      const m = createMaterial(band % 2 ? '#76523a' : '#875e40', {
        side: THREE.DoubleSide,
      });
      addMesh(geoHull, m, group);
      const mirror = addMesh(geoHull, m, group);
      mirror.scale.x = -1;
    }
    addBeam(group, [0, 0.25, -length / 2], [0, 0.25, length / 2], 0.12, materials.darkwood);
    for (const sign of [-1, 1]) {
      addBeam(
        group,
        [0, 0.1, ((sign * length) / 2) * 0.85],
        [0, 3.3, (sign * length) / 2],
        0.18,
        materials.wood,
      );
    }
    for (let j = -6; j <= 6; j++) {
      const z = ((j / 7) * length) / 2;
      const broad = Math.pow(Math.cos((z / length) * Math.PI), 0.6) * width * 0.46;
      addBeam(group, [-broad, 1.65, z], [broad, 1.65, z], 0.09, materials.wood);
      if (deck) {
        addBox(group, 0, 1.13, z, broad * 1.9, 0.06, (length / 14) * 0.85, materials.planks);
      }
    }
    return group;
  }
  function createKnarr({ livestock, arriving, random }) {
    const group = root.VinlandKnarr.create();
    const sail = new THREE.Group();
    const width = 8.7;
    const height = 6.9;
    const cols = 18;
    const rows = 16;
    const geometry = new THREE.PlaneGeometry(width, height, cols, rows);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(i, 0.6 * Math.cos((x / width) * Math.PI) * Math.cos((y / height) * Math.PI));
      pos.setY(i, y - 0.25 * Math.cos((x / width) * Math.PI));
    }
    geometry.computeVertexNormals();
    addMesh(geometry, materials.linen, sail, 0, 6.7, 0);
    for (let i = 0; i < 9; i++) {
      const x = -width / 2 + (i * width) / 8;
      addRope(
        sail,
        [
          [x, 10.15, 0.02],
          [x, 6.7, 0.6 * Math.cos((x / width) * Math.PI)],
          [x, 3.25, 0.02],
        ],
        0.013,
      );
    }
    addRope(sail, [
      [-4.35, 3.25, 0],
      [-1.8, 1.5, 4],
    ]);
    addRope(sail, [
      [4.35, 3.25, 0],
      [1.8, 1.5, 4],
    ]);
    group.add(sail);
    for (const z of [-7.5, 7.5]) {
      for (const side of [-1, 1]) {
        addRope(group, [
          [0, 12.4, 0],
          [side * 1.8, 1.6, z],
        ]);
      }
    }
    addRope(
      group,
      [
        [0, 3.2, -8.5],
        [2, 1, -14],
        [7, 0, -20],
      ],
      0.04,
    );
    if (!livestock && !arriving) {
      for (let i = 0; i < 8; i++) {
        const x = random() * 2.2 - 1.1,
          z = random() * 10 - 5;
        addBarrel(group, x, 1.2, z, 0.7);
        group.userData.boatGeometry.obstacles.push({ x, z, radius: 0.4 });
      }
      addBox(group, 0, 1.65, 1, 2.4, 0.8, 3, materials.linen);
      group.userData.boatGeometry.obstacles.push({ x: 0, z: 1, w: 2.4, d: 3 });
    } else if (livestock) {
      for (const x of [-1.8, 1.8]) {
        for (let z = -5; z <= 5; z += 2) {
          addBeam(group, [x, 1.2, z], [x, 2.6, z], 0.065);
        }
        addBeam(group, [x, 2.25, -6], [x, 2.25, 6], 0.055);
      }
      for (let z = -5; z < 6; z += 2) {
        addBeam(group, [-1.8, 2.1, z], [1.8, 2.1, z], 0.04);
      }
    }
    group.userData.select = livestock ? 'livestock-ship' : 'ship';
    return { object: group, sail };
  }
  // Building layouts are supplied by the controller from building-spaces.js.
  function createBuilding(type, definition, layout) {
    const def = definition;
    const hearths = [];
    const group = new THREE.Group();
    // Every construction type is selectable, including specialized meshes
    // that return before the ordinary longhouse geometry is assembled.
    group.userData.select = 'building';
    const base = new THREE.Group();
    const roof = new THREE.Group();
    group.add(base, roof);
    group.userData.base = base;
    group.userData.roof = roof;
    const w = def.w;
    const d = def.d;
    if (type === 'charcoal') {
      addMesh(new THREE.CylinderGeometry(1.9, 2.15, 0.6, 18), materials.soil, base, 0, 0.15, 0);
      for (let i = 0; i < 7; i++) {
        addBeam(base, [-1 + i * 0.3, 0.5, -1], [1, 0.5, 1 - i * 0.3], 0.07, materials.darkwood);
      }
      return { object: group, hearths };
    }
    if (type === 'sailbudir' || type === 'tentbudir') {
      if (type === 'sailbudir') {
        roof.userData.rainRoof = { width: w, depth: d, eave: 1.25, rise: 1.75 };
      }
      for (const wall of layout.walls) {
        const mesh = addBox(
          base,
          wall.x,
          wall.h / 2,
          wall.z,
          wall.w,
          wall.h,
          wall.d,
          materials.wall.clone(),
        );
        mesh.userData.structuralWall = true;
        mesh.name = 'Exterior wall';
      }
      addBox(base, 0, 0.04, 0, w, 0.08, d, materials.soil);
      if (type === 'sailbudir') {
        const verts = [
          -w / 2,
          1.25,
          -d / 2,
          0,
          3,
          -d / 2,
          0,
          3,
          d / 2,
          -w / 2,
          1.25,
          -d / 2,
          0,
          3,
          d / 2,
          -w / 2,
          1.25,
          d / 2,
          w / 2,
          1.25,
          -d / 2,
          0,
          3,
          d / 2,
          0,
          3,
          -d / 2,
          w / 2,
          1.25,
          -d / 2,
          w / 2,
          1.25,
          d / 2,
          0,
          3,
          d / 2,
        ];
        const geoFabric = new THREE.BufferGeometry();
        geoFabric.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geoFabric.computeVertexNormals();
        addMesh(geoFabric, materials.linen, roof);
        for (const z of [-d / 2, d / 2]) {
          addBeam(base, [0, 0, z], [0, 3.1, z], 0.09);
        }
      } else {
        const tent = createTent(12);
        // This reused mesh belongs to the building; it is not a landing tent.
        delete tent.userData.select;
        tent.scale.set(1.5, 0.9, 1.2);
        tent.position.y = 0.5;
        roof.add(tent);
      }
      return { object: group, hearths };
    }
    if (!layout) return { object: group, hearths };
    for (const wall of layout.walls) {
      const mesh = addBox(
        base,
        wall.x,
        wall.h / 2,
        wall.z,
        wall.w,
        wall.h,
        wall.d,
        materials.wall.clone(),
      );
      mesh.name = 'Exterior wall';
      mesh.userData.structuralWall = true;
      mesh.userData.turfGroundWall = true;
    }
    // The opening is real geometry. A lintel bridges it above head height.
    addBox(base, 0, 2.15, d / 2, layout.doorWidth, 0.3, layout.thickness, materials.wood);
    addRoof(
      roof,
      0,
      0,
      w + 1.7,
      d + 1.7,
      2.4,
      w * 0.29,
      true,
      layout.furniture.some((item) => item.kind === 'hearth'),
    );
    addBox(base, 0, 0.04, 0, w, 0.08, d, materials.soil);
    for (const item of layout.furniture) {
      if (item.kind === 'hearth') {
        addHearth(base, hearths, item.x, item.z, true);
        continue;
      }
      const material =
        item.kind === 'hay'
          ? createMaterial('#b3a46e')
          : item.kind === 'forge'
            ? materials.stone
            : materials.wood;
      const mesh = addBox(
        base,
        item.x,
        item.h / 2 + 0.08,
        item.z,
        item.w,
        item.h,
        item.d,
        material,
      );
      mesh.name = 'Interior ' + item.kind;
    }
    return { object: group, hearths };
  }
  function addBuildingDetails(building, type, definition, posts = []) {
    const base = building.userData.base;
    const roof = building.userData.roof;
    if (['woodshed', 'storehouse', 'haybarn'].includes(type)) {
      // The old solid boxes represented permanently full stores. Keep a
      // low pallet beneath the inventory-driven stacks instead.
      base.traverse((mesh) => {
        if (!['Interior stores', 'Interior hay'].includes(mesh.name)) return;
        mesh.scale.y = 0.07;
        mesh.position.y = 0.12;
      });
    }
    if (type === 'garden') {
      base.clear();
      roof.clear();
      const soil = detailMaterial('#615039');
      const fence = detailMaterial('#746149');
      const plants = detailMaterial('#678351');
      for (let row = 0; row < 6; row++) {
        detailBox(
          base,
          definition.w - 2,
          0.12,
          1.25,
          soil,
          0,
          0.06,
          -definition.d / 2 + 2 + row * 2,
        );
        for (let i = 0; i < 9; i++) {
          const plant = new THREE.Mesh(new THREE.SphereGeometry(0.25, 5, 4), plants);
          plant.position.set(-definition.w / 2 + 2 + i, 0.3, -definition.d / 2 + 2 + row * 2);
          plant.scale.y = 0.7;
          base.add(plant);
        }
      }
      for (const x of [-definition.w / 2, definition.w / 2]) {
        for (let z = -definition.d / 2; z <= definition.d / 2; z += 2) {
          detailBox(base, 0.1, 1.1, 0.1, fence, x, 0.55, z);
        }
      }
      for (const x of [-definition.w / 2, definition.w / 2]) {
        detailBox(base, 0.08, 0.1, definition.d, fence, x, 0.85, 0);
      }
    }
    if (type === 'well') {
      base.clear();
      roof.clear();
      const stone = detailMaterial('#7e887b');
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.65, 16, 1, true), stone);
      ring.position.y = 0.3;
      base.add(ring);
      const water = new THREE.Mesh(new THREE.CircleGeometry(1.02, 20), detailMaterial('#517c78'));
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.05;
      base.add(water);
      for (const x of [-1.45, 1.45]) {
        detailBox(base, 0.18, 2.6, 0.18, detailMaterial('#756143'), x, 1.3, 0);
      }
      detailBox(roof, 3.2, 0.18, 2.8, detailMaterial('#97865d'), 0, 2.6, 0);
    }
    if (type === 'palisade') {
      base.clear();
      roof.clear();
      const wood = detailMaterial('#725841');
      for (const [index, { x, z }] of posts.entries()) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2.8, 7), wood);
        pole.position.set(x, 1.4, z);
        pole.castShadow = true;
        base.add(pole);
        const next = posts[index + 1];
        if (next) {
          for (const height of [0.8, 1.6]) {
            const rail = detailBox(
              base,
              Math.hypot(next.x - x, next.z - z),
              0.16,
              0.18,
              wood,
              (x + next.x) / 2,
              height,
              (z + next.z) / 2,
            );
            rail.name = 'Enclosure rail';
            rail.rotation.y = -Math.atan2(next.z - z, next.x - x);
          }
        }
      }
    }
    if (type === 'meeting') {
      roof.children.forEach((object) => {
        if (object.material) {
          object.material.color.set('#a6a17c');
        }
      });
    }
    if (type === 'boatyard') {
      const boat = createHull(6.5, 2, false);
      boat.position.set(0, 0.5, -definition.d / 5);
      base.add(boat);
    }
    return building;
  }
  // Cargo visuals consume quantities and ground offsets supplied by callers.
  function createGatheringLoad(resource, occupied) {
    const load = new THREE.Group();
    load.name = 'carried-' + resource;
    load.userData.resource = resource;
    load.visible = false;
    if (resource === 'timber' || resource === 'firewood') {
      const pieces = resource === 'firewood' ? 3 : 1;
      for (let index = 0; index < pieces; index++) {
        const log = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, pieces === 1 ? 1.1 : 0.6, 8),
          clothMats[0],
        );
        log.rotation.z = Math.PI / 2;
        log.position.set(0, 1.05 + index * 0.1, 0.2);
        load.add(log);
      }
    } else {
      const contents = createResourcePile({
        resource,
        occupied,
        x: 0,
        z: 0,
        indoor: true,
        w: 0.5,
        d: Math.max(0.35, occupied / 0.2),
        h: 0.4,
      });
      contents.position.set(0, 0.95, 0.2);
      load.add(contents);
    }
    return load;
  }
  /** Pack actual occupied volume into fixed cells, never into an unbounded column.
   * Bays are local to the vessel. The caller supplies quantities and material rules.
   * Overflow is recorded explicitly; oversized/debug stocks never stretch the hull.
   */
  function createCargoStowage(cargo, bays) {
    const group = new THREE.Group();
    group.name = 'Stowed cargo';
    const cells = bays.flatMap((bay) => {
      const columns = Math.max(1, Math.floor(bay.w / (bay.cellWidth || 0.6)));
      const rows = Math.max(1, Math.floor(bay.d / (bay.cellDepth || 0.8)));
      const width = bay.w / columns;
      const depth = bay.d / rows;
      const result = [];
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          result.push({
            x: bay.x - bay.w / 2 + (column + 0.5) * width,
            y: bay.y,
            z: bay.z - bay.d / 2 + (row + 0.5) * depth,
            w: width,
            d: depth,
            h: bay.h,
          });
        }
      }
      return result;
    });
    let cellIndex = 0;
    group.userData.cargo = [];
    for (const entry of cargo) {
      let remaining = entry.occupied;
      const resource = new THREE.Group();
      resource.name = 'Cargo ' + entry.resource;
      while (remaining > 1e-9 && cellIndex < cells.length) {
        const cell = cells[cellIndex++];
        const occupied = Math.min(remaining, cell.w * cell.d * cell.h);
        const pile = {
          resource: entry.resource,
          occupied,
          indoor: true,
          w: cell.w,
          d: cell.d,
          h: occupied / (cell.w * cell.d),
        };
        const contents = createResourcePile(pile, {
          isWood: entry.isWood,
          woodSolidFraction: entry.woodSolidFraction,
        });
        contents.position.set(cell.x, cell.y, cell.z);
        resource.add(contents);
        remaining -= occupied;
      }
      resource.userData = {
        resource: entry.resource,
        amount: entry.amount,
        occupied: entry.occupied,
        representedVolume: entry.occupied - remaining,
        overflowVolume: remaining,
      };
      group.userData.cargo.push(resource.userData);
      group.add(resource);
    }
    group.userData.capacity = cells.reduce((total, cell) => total + cell.w * cell.d * cell.h, 0);
    return group;
  }

  function createResourcePile(pile, options = {}) {
    if (options.isWood) return createWoodPile(pile, options);
    const colors = {
      turf: '#645038',
      stone: '#90918a',
      iron: '#575b60',
      hay: '#b8a363',
      charcoal: '#292b29',
      water: '#735239',
      seeds: '#ac8856',
      cloth: '#978777',
      freshFish: '#8e7450',
      driedFish: '#baa47a',
      meat: '#8e7450',
      plants: '#8e7450',
      grain: '#b79b64',
      dairy: '#a57e52',
      fat: '#a57e52',
    };
    const liquids = ['water', 'dairy', 'fat'].includes(pile.resource);
    const baskets = ['freshFish', 'meat', 'plants'].includes(pile.resource);
    const sacks = ['grain', 'seeds', 'driedFish'].includes(pile.resource);
    const group = new THREE.Group();
    group.name = 'Stored ' + pile.resource;
    group.userData.pile = { ...pile };
    const unitWidth = pile.resource === 'charcoal' ? 0.18 : pile.resource === 'stone' ? 0.3 : 0.5;
    const columns = Math.max(1, Math.floor(pile.w / unitWidth));
    const rows = Math.max(1, Math.floor(pile.d / unitWidth));
    const layerHeight =
      pile.resource === 'hay'
        ? pile.h
        : ['cloth', 'iron'].includes(pile.resource)
          ? 0.12
          : Math.min(unitWidth, 0.4);
    const layers = Math.max(1, Math.floor(pile.h / layerHeight));
    const cell = { w: pile.w / columns, d: pile.d / rows, h: pile.h / layers };
    const units = pile.occupied / (cell.w * cell.d * cell.h);
    const count = Math.ceil(units - 1e-9);
    let geometry;
    if (liquids || baskets) geometry = new THREE.CylinderGeometry(0.46, 0.4, 0.95, 12, 1, true);
    else if (pile.resource === 'hay') geometry = new THREE.ConeGeometry(0.5, 0.95, 10);
    else if (sacks) geometry = new THREE.SphereGeometry(0.48, 10, 7);
    else if (['stone', 'charcoal'].includes(pile.resource))
      geometry = new THREE.IcosahedronGeometry(0.5, 1);
    else geometry = new THREE.BoxGeometry(0.95, 0.9, 0.95);
    const surface = detailMaterial(colors[pile.resource]);
    const surfaces =
      pile.resource === 'turf'
        ? [surface, surface, detailMaterial('#63764e'), surface, surface, surface]
        : surface;
    const contents = new THREE.InstancedMesh(geometry, surfaces, count);
    contents.name = liquids || baskets ? 'Storage containers' : 'Stored units';
    contents.castShadow = contents.receiveShadow = true;
    contents.userData.select = 'stockpile';
    contents.userData.buildingId = pile.storeId;
    group.add(contents);
    let filling = null;
    if (liquids || baskets) {
      const color = {
        water: '#507e98',
        dairy: '#d5c6a0',
        fat: '#d5ba7c',
        freshFish: '#9aaeb1',
        meat: '#884f45',
        plants: '#71874e',
      }[pile.resource];
      filling = new THREE.InstancedMesh(
        baskets
          ? new THREE.SphereGeometry(0.43, 10, 7)
          : new THREE.CylinderGeometry(0.43, 0.38, 0.8, 12),
        detailMaterial(color),
        count,
      );
      filling.name = 'Stored contents';
      filling.castShadow = filling.receiveShadow = true;
      filling.userData.select = 'stockpile';
      filling.userData.buildingId = pile.storeId;
      group.add(filling);
    }
    const piece = new THREE.Object3D();
    for (let index = 0; index < count; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns) % rows;
      const layer = Math.floor(index / (columns * rows));
      const fraction = Math.min(1, units - index);
      const size = liquids || baskets ? 1 : Math.cbrt(fraction);
      piece.position.set(
        -pile.w / 2 + (column + 0.5) * cell.w,
        layer * cell.h + (size * cell.h) / 2,
        -pile.d / 2 + (row + 0.5) * cell.d,
      );
      let ground = 0;
      if (!pile.indoor) {
        ground = options.groundOffsetAt(piece.position);
      }
      piece.position.y += ground;
      piece.scale.set(cell.w * size, cell.h * size, cell.d * size);
      piece.updateMatrix();
      contents.setMatrixAt(index, piece.matrix);
      if (filling) {
        // Basket contents are spherical; their radius is 0.43, rather than the
        // liquid cylinder's 0.4 half-height. Both must sit above the bay floor.
        piece.position.y = layer * cell.h + ground + cell.h * fraction * (baskets ? 0.43 : 0.4);
        piece.scale.y = cell.h * fraction;
        piece.updateMatrix();
        filling.setMatrixAt(index, piece.matrix);
      }
    }
    contents.instanceMatrix.needsUpdate = true;
    if (filling) filling.instanceMatrix.needsUpdate = true;
    group.userData.stackTop = piece.position.clone();
    return group;
  }
  function createWoodPile(pile, options) {
    const group = new THREE.Group();
    group.name = 'Stored ' + pile.resource;
    group.userData.pile = { ...pile };
    group.userData.select = 'stockpile';
    group.userData.buildingId = pile.storeId;
    // The grid fills from the bottom, with a stable ordering. Additional
    // deliveries add pieces instead of rearranging the existing stack.
    const columns = Math.max(1, Math.floor(pile.w / (pile.resource === 'timber' ? 1.1 : 0.55)));
    const rows = Math.max(1, Math.floor(pile.d / 0.14 + 1e-6));
    const layers = Math.max(1, Math.floor(pile.h / 0.14 + 1e-6));
    const length = pile.w / columns - 0.02;
    const solidPerPiece =
      (pile.w * pile.d * pile.h * options.woodSolidFraction) / (columns * rows * layers);
    const radius = Math.min(
      Math.sqrt(solidPerPiece / (Math.PI * length)),
      0.48 * Math.min(pile.d / rows, pile.h / layers),
    );
    const pieces = (pile.occupied * options.woodSolidFraction) / solidPerPiece;
    const count = Math.ceil(pieces - 1e-9);
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 10);
    const bark = detailMaterial('#72513a');
    const endgrain = detailMaterial('#bd9563');
    const logs = new THREE.InstancedMesh(geometry, [bark, endgrain, endgrain], count);
    logs.castShadow = logs.receiveShadow = true;
    logs.userData.select = 'stockpile';
    logs.userData.buildingId = pile.storeId;
    const piece = new THREE.Object3D();
    for (let index = 0; index < count; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns) % rows;
      const layer = Math.floor(index / (columns * rows));
      piece.position.set(
        -pile.w / 2 + ((column + 0.5) * pile.w) / columns,
        ((layer + 0.5) * pile.h) / layers,
        -pile.d / 2 + ((row + 0.5) * pile.d) / rows,
      );
      if (!pile.indoor) {
        piece.position.y += options.groundOffsetAt(piece.position);
      }
      piece.rotation.z = Math.PI / 2;
      piece.scale.set(1, Math.min(1, pieces - index), 1);
      piece.updateMatrix();
      logs.setMatrixAt(index, piece.matrix);
    }
    logs.instanceMatrix.needsUpdate = true;
    group.add(logs);
    group.userData.stackTop = piece.position.clone();
    return group;
  }

  root.VinlandWorldModels = {
    materials,
    geometries,
    createMaterial,
    addMesh,
    addBox,
    addBeam,
    addRope,
    detailMaterial,
    createSlateOven,
    createBarrel,
    createRoof,
    createHearth,
    createHall,
    createTent,
    createHull,
    createKnarr,
    createBuilding,
    addBuildingDetails,
    createGatheringLoad,
    createCargoStowage,
    createResourcePile,
    createWoodPile,
  };
})(window);
