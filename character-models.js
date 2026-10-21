/**
 * Procedural human/livestock models and presentation-only poses. Metres, +Z forward.
 * Shared geometry uses vertex colors: one draw per joint, rather than one per
 * cuff, finger or facial feature. No simulation state or external assets here.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  const TAU = Math.PI * 2;
  const HIP_HEIGHT = 0.82;
  const THIGH_LENGTH = 0.4;
  const SHIN_LENGTH = 0.39;
  const DOWN = new THREE.Vector3(0, -1, 0);
  const RIGHT = new THREE.Vector3(1, 0, 0);
  const clamp = THREE.MathUtils.clamp;
  const wardrobe = ['#7b5745', '#49686b', '#947445', '#805450', '#526047', '#b1a080', '#485c76'];
  const hairColors = ['#483326', '#aa8249', '#6b4931', '#9a603c', '#b2a078', '#302c29'];
  const skinColors = ['#c59b7c', '#bd8f70', '#cfa98b', '#b98b70'];
  const surface = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91 });
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  const lowSphere = new THREE.SphereGeometry(1, 7, 5);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const variants = new Map();

  // Assemble static details into a single colored geometry for each joint.
  class Parts {
    constructor() {
      this.positions = [];
      this.normals = [];
      this.colors = [];
    }
    add(geometry, color, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
      const transform = new THREE.Matrix4().compose(
        new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
        new THREE.Vector3(...scale),
      );
      const normalTransform = new THREE.Matrix3().getNormalMatrix(transform);
      const tint = new THREE.Color(color);
      const point = new THREE.Vector3();
      const normal = new THREE.Vector3();
      const indices = geometry.index;
      const count = indices ? indices.count : geometry.attributes.position.count;
      for (let index = 0; index < count; index++) {
        const vertex = indices ? indices.getX(index) : index;
        point.fromBufferAttribute(geometry.attributes.position, vertex).applyMatrix4(transform);
        normal
          .fromBufferAttribute(geometry.attributes.normal, vertex)
          .applyMatrix3(normalTransform)
          .normalize();
        this.positions.push(point.x, point.y, point.z);
        this.normals.push(normal.x, normal.y, normal.z);
        this.colors.push(tint.r, tint.g, tint.b);
      }
    }
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
      return geometry;
    }
  }

  function shaded(color, multiplier) {
    return new THREE.Color(color).multiplyScalar(multiplier);
  }

  // Elliptical clothing rings give shoulders, waist, folds and flared hems
  // their own silhouette instead of stretching a straight cylinder.
  function garment(rings, folds = 0.018, segments = 16) {
    const positions = [];
    const indices = [];
    for (let row = 0; row < rings.length; row++) {
      const [y, width, depth] = rings[row];
      for (let column = 0; column <= segments; column++) {
        const angle = (column / segments) * TAU;
        const fold = 1 + Math.cos(angle * 8) * folds;
        positions.push(Math.sin(angle) * width * fold, y, Math.cos(angle) * depth * fold);
        if (row < rings.length - 1 && column < segments) {
          const a = row * (segments + 1) + column;
          const b = a + segments + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function createVariant(index, child) {
    const dress = index % 3 === 1;
    const cloth = wardrobe[index % wardrobe.length];
    const lining = '#c5bba1';
    const leather = '#4b3528';
    const hair = hairColors[index % hairColors.length];
    const skin = skinColors[index % skinColors.length];
    const bronze = '#ad8a49';
    const torso = new Parts();
    const tunic = garment([
      [-0.29, 0.225, 0.14],
      [-0.16, 0.22, 0.14],
      [0.0, 0.18, 0.115],
      [0.16, 0.19, 0.125],
      [0.37, 0.235, 0.14],
      [0.47, 0.205, 0.12],
      [0.51, 0.09, 0.08],
    ]);
    torso.add(tunic, cloth);
    tunic.dispose();
    torso.add(cylinder, leather, [0, 0.02, 0], [0.185, 0.043, 0.122]);
    torso.add(cube, bronze, [0.035, 0.02, 0.125], [0.045, 0.036, 0.012]);
    torso.add(sphere, leather, [-0.15, -0.09, 0.12], [0.065, 0.085, 0.035]);
    torso.add(cylinder, lining, [0, 0.505, 0], [0.095, 0.022, 0.083]);
    torso.add(cube, lining, [0, 0.455, 0.113], [0.018, 0.075, 0.016]);
    torso.add(cylinder, skin, [0, 0.56, 0], [0.064, 0.105, 0.065]);
    if (dress) {
      for (const side of [-1, 1]) {
        torso.add(cube, shaded(cloth, 0.8), [side * 0.12, 0.39, 0.133], [0.04, 0.18, 0.018]);
        torso.add(sphere, bronze, [side * 0.12, 0.32, 0.154], [0.021, 0.03, 0.012]);
      }
    }
    const skirt = new Parts();
    if (dress) {
      const underdress = garment(
        [
          [-0.67, 0.265, 0.23],
          [-0.42, 0.245, 0.23],
          [0.02, 0.175, 0.12],
        ],
        0.04,
      );
      const apron = garment(
        [
          [-0.57, 0.28, 0.245],
          [-0.36, 0.25, 0.24],
          [0.02, 0.19, 0.13],
        ],
        0.045,
      );
      skirt.add(underdress, lining);
      skirt.add(apron, cloth);
      underdress.dispose();
      apron.dispose();
    }
    const head = new Parts();
    head.add(sphere, skin, [0, 0, 0], [0.118, 0.166, 0.113]);
    head.add(sphere, skin, [0, -0.088, 0.038], [0.084, 0.075, 0.082]);
    for (const side of [-1, 1])
      head.add(sphere, skin, [side * 0.117, -0.005, 0], [0.025, 0.042, 0.02]);
    const hairCap = new THREE.SphereGeometry(1, 12, 7, 0, TAU, 0, 1.65);
    head.add(hairCap, hair, [0, 0.025, -0.008], [0.124, 0.154, 0.118]);
    hairCap.dispose();
    if (dress) {
      head.add(sphere, hair, [0, -0.04, -0.105], [0.098, 0.12, 0.055]);
      for (let braid = 0; braid < 4; braid++)
        head.add(
          sphere,
          hair,
          [0, -0.14 - braid * 0.038, -0.1],
          [0.03 - braid * 0.003, 0.028, 0.028],
        );
    }
    const face = new Parts();
    face.add(sphere, skin, [0, -0.018, 0.111], [0.025, 0.045, 0.041]);
    for (const side of [-1, 1]) {
      face.add(sphere, '#4b4036', [side * 0.045, 0.016, 0.106], [0.021, 0.01, 0.01]);
      face.add(sphere, '#d6c7ae', [side * 0.045, 0.017, 0.113], [0.014, 0.007, 0.004]);
      face.add(sphere, '#34352e', [side * 0.045, 0.017, 0.117], [0.006, 0.006, 0.003]);
      face.add(cube, hair, [side * 0.045, 0.045, 0.105], [0.04, 0.009, 0.012], [0, 0, side * -0.1]);
    }
    face.add(sphere, '#976956', [0, -0.073, 0.111], [0.029, 0.006, 0.009]);
    if (!dress && !child && index % 4 !== 2) {
      face.add(sphere, hair, [0, -0.098, 0.055], [0.092, 0.085, 0.085]);
      face.add(sphere, hair, [0, -0.054, 0.117], [0.047, 0.015, 0.014]);
    }
    const upperArm = new Parts();
    upperArm.add(sphere, cloth, [0, -0.03, 0], [0.078, 0.09, 0.076]);
    upperArm.add(cylinder, cloth, [0, -0.15, 0], [0.067, 0.29, 0.068]);
    const forearm = new Parts();
    forearm.add(sphere, cloth, [0, -0.015, 0], [0.062, 0.065, 0.062]);
    forearm.add(cylinder, cloth, [0, -0.132, 0], [0.052, 0.265, 0.055]);
    forearm.add(cylinder, lining, [0, -0.258, 0], [0.049, 0.035, 0.052]);
    const hand = new Parts();
    hand.add(sphere, skin, [0, -0.028, 0.005], [0.041, 0.064, 0.026]);
    hand.add(sphere, skin, [0.03, -0.017, 0.012], [0.021, 0.033, 0.024]);
    const thigh = new Parts();
    thigh.add(cylinder, shaded(cloth, 0.7), [0, -0.19, 0], [0.082, THIGH_LENGTH, 0.085]);
    const shin = new Parts();
    shin.add(sphere, shaded(cloth, 0.7), [0, 0, 0], [0.073, 0.075, 0.074]);
    shin.add(cylinder, '#807461', [0, -0.17, 0], [0.06, 0.34, 0.064]);
    for (let wrap = 0; wrap < 4; wrap++)
      shin.add(cylinder, '#665b4a', [0, -0.08 - wrap * 0.065, 0], [0.061, 0.012, 0.065]);
    const foot = new Parts();
    foot.add(sphere, leather, [0, -0.034, 0.045], [0.07, 0.049, 0.135]);
    foot.add(sphere, shaded(leather, 0.7), [0, -0.065, 0.05], [0.071, 0.018, 0.139]);
    const distantBody = new Parts();
    const distantTunic = garment(
      [
        [-0.29, 0.225, 0.14],
        [0, 0.18, 0.115],
        [0.36, 0.235, 0.14],
        [0.51, 0.09, 0.08],
      ],
      0,
      8,
    );
    distantBody.add(distantTunic, cloth);
    distantTunic.dispose();
    distantBody.add(cylinder, leather, [0, 0.02, 0], [0.185, 0.04, 0.122]);
    distantBody.add(lowSphere, skin, [0, 0.55, 0], [0.064, 0.09, 0.065]);
    distantBody.add(lowSphere, skin, [0, 0.73, 0], [0.12, 0.17, 0.115]);
    distantBody.add(lowSphere, hair, [0, 0.8, -0.015], [0.124, 0.11, 0.116]);
    if (dress) distantBody.add(cylinder, cloth, [0, -0.27, 0], [0.23, 0.72, 0.15]);
    const distantLeg = new Parts();
    if (!dress) distantLeg.add(cylinder, '#675b49', [0, -0.36, 0], [0.065, 0.73, 0.065]);
    distantLeg.add(lowSphere, leather, [0, -0.77, 0.045], [0.07, 0.05, 0.13]);
    const distantArm = new Parts();
    distantArm.add(cylinder, cloth, [0, -0.26, 0], [0.065, 0.53, 0.065]);
    distantArm.add(lowSphere, skin, [0, -0.56, 0], [0.041, 0.06, 0.03]);
    const geometries = Object.fromEntries(
      Object.entries({
        torso,
        skirt,
        head,
        face,
        upperArm,
        forearm,
        hand,
        thigh,
        shin,
        foot,
        distantBody,
        distantLeg,
        distantArm,
      }).map(([name, parts]) => [name, parts.finish()]),
    );
    // Fold the lower garment for the five-draw distant sitting silhouette.
    // Keep the head and upper body at their normal proportions.
    const seatedBody = geometries.distantBody.clone();
    const positions = seatedBody.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      if (y < 0) {
        positions.setY(i, y * 0.35);
        positions.setZ(i, positions.getZ(i) - y * 0.55);
      }
    }
    seatedBody.computeVertexNormals();
    geometries.distantSeatedBody = seatedBody;
    return geometries;
  }

  function mesh(geometry, parent, name, x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(geometry, surface);
    object.name = name;
    object.position.set(x, y, z);
    object.castShadow = object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function joint(parent, name, x, y, z) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  }
  function createHuman(person, index) {
    const variant = index % 24;
    const child = person?.age < 16;
    const key = variant + (child ? ':child' : ':adult');
    if (!variants.has(key)) variants.set(key, createVariant(variant, child));
    const geometry = variants.get(key);
    const dress = variant % 3 === 1;
    const group = new THREE.Group();
    const detail = joint(group, 'human-detail', 0, 0, 0);
    const torso = joint(detail, 'torso', 0, HIP_HEIGHT, 0);
    mesh(geometry.torso, torso, 'clothing');
    const skirt = mesh(geometry.skirt, detail, 'skirt', 0, HIP_HEIGHT, 0);
    const head = joint(torso, 'head', 0, 0.73, 0);
    mesh(geometry.head, head, 'head-shape');
    const face = mesh(geometry.face, head, 'face-details');
    const arms = [];
    const legs = [];
    for (const side of [-1, 1]) {
      const shoulder = joint(torso, 'shoulder', side * 0.235, 0.47, 0);
      mesh(geometry.upperArm, shoulder, 'upper-arm');
      const elbow = joint(shoulder, 'elbow', 0, -0.29, 0);
      mesh(geometry.forearm, elbow, 'forearm');
      const hand = joint(elbow, 'hand', 0, -0.28, 0);
      mesh(geometry.hand, hand, 'fingers').scale.x = -side;
      arms.push({ shoulder, elbow, hand, side });
      const hip = joint(detail, 'hip', side * 0.1, HIP_HEIGHT, 0);
      mesh(geometry.thigh, hip, 'thigh').visible = !dress;
      const knee = joint(hip, 'knee', 0, -THIGH_LENGTH, 0);
      mesh(geometry.shin, knee, 'shin').visible = !dress;
      const ankle = joint(knee, 'ankle', 0, -SHIN_LENGTH, 0);
      mesh(geometry.foot, ankle, 'shoe');
      legs.push({ hip, knee, ankle, side });
    }
    const distant = joint(group, 'human-distant', 0, 0, 0);
    distant.visible = false;
    const distantBody = mesh(geometry.distantBody, distant, 'distant-body', 0, HIP_HEIGHT, 0);
    const distantLegs = legs.map(({ side }) =>
      mesh(geometry.distantLeg, distant, 'distant-leg', side * 0.1, HIP_HEIGHT, 0),
    );
    const distantArms = arms.map(({ side }) =>
      mesh(geometry.distantArm, distant, 'distant-arm', side * 0.235, 1.29, 0),
    );
    // The existing world overwrites root.userData when registering selection.
    // Keep the transient rig on its own property, never in the campaign save.
    group.characterRig = {
      detail,
      distant,
      torso,
      skirt,
      head,
      face,
      arms,
      legs,
      distantBody,
      distantLegs,
      distantArms,
      dress,
      geometry,
      phase: 0,
      workPhase: index * 0.71,
      restPhase: index * 0.71,
      restBlend: 0,
      lastPosition: null,
    };
    group.scale.setScalar(
      child ? 0.6 + clamp(person.age - 5, 0, 10) * 0.024 : 0.97 + (index % 5) * 0.014,
    );
    if (child) {
      head.scale.setScalar(1.12);
    }
    return group;
  }

  // Two-bone arm solve, with elbows hanging below and away from the target.
  const direction = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const elbowPoint = new THREE.Vector3();
  const lowerDirection = new THREE.Vector3();
  const lowerRotation = new THREE.Quaternion();
  function reach(arm, target) {
    direction.copy(target).sub(arm.shoulder.position);
    const distance = clamp(direction.length(), 0.04, 0.565);
    direction.normalize();
    const along = (0.29 ** 2 + distance ** 2 - 0.28 ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, 0.29 ** 2 - along ** 2));
    bend
      .set(arm.side * 0.3, -1, -0.2)
      .addScaledVector(direction, -bend.dot(direction))
      .normalize();
    elbowPoint
      .copy(arm.shoulder.position)
      .addScaledVector(direction, along)
      .addScaledVector(bend, height);
    lowerDirection.copy(elbowPoint).sub(arm.shoulder.position).normalize();
    arm.shoulder.quaternion.setFromUnitVectors(DOWN, lowerDirection);
    lowerDirection.copy(target).sub(elbowPoint).normalize();
    lowerRotation.setFromUnitVectors(DOWN, lowerDirection);
    arm.elbow.quaternion.copy(arm.shoulder.quaternion).invert().multiply(lowerRotation);
    arm.hand.quaternion.copy(lowerRotation).invert();
  }

  const handTarget = new THREE.Vector3();
  const toolMatrix = new THREE.Matrix4();
  const toolRotation = new THREE.Quaternion();
  const toolPosition = new THREE.Vector3();
  const unitScale = new THREE.Vector3(1, 1, 1);
  let axeHandle;
  let axeHead;
  const axeIron = new THREE.MeshStandardMaterial({
    color: '#666b69',
    roughness: 0.68,
    metalness: 0.45,
  });
  function createAxe() {
    if (!axeHandle) {
      const handle = new Parts();
      handle.add(cube, '#775537', [0, 0.18, 0], [0.027, 0.66, 0.03]);
      axeHandle = handle.finish();
      const blade = new THREE.Shape();
      blade.moveTo(-0.04, 0.43);
      blade.lineTo(0.12, 0.46);
      blade.lineTo(0.21, 0.53);
      blade.lineTo(0.2, 0.34);
      blade.lineTo(0.08, 0.39);
      blade.lineTo(-0.04, 0.39);
      blade.closePath();
      axeHead = new THREE.ExtrudeGeometry(blade, { depth: 0.027, bevelEnabled: false });
      axeHead.translate(0, 0, -0.0135);
    }
    const tool = new THREE.Group();
    tool.name = 'harvest-tool';
    mesh(axeHandle, tool, 'axe-handle');
    const head = new THREE.Mesh(axeHead, axeIron);
    head.castShadow = head.receiveShadow = true;
    tool.add(head);
    tool.visible = false;
    return tool;
  }
  function poseHuman(
    object,
    {
      distance = 0,
      seconds = 0,
      moving = false,
      sprinting = false,
      swimming = false,
      wading = false,
      carrying = false,
      chopping = false,
      resting = null,
      paused = false,
      cameraDistance = 0,
      tool = null,
    },
  ) {
    const rig = object.characterRig;
    if (!rig) return;
    rig.detail.visible = cameraDistance < 38;
    rig.distant.visible = !rig.detail.visible;
    rig.face.visible = cameraDistance < 22;
    // Freeze motion while paused, but still show an item picked up or put down
    // through the hearth/inventory controls during that pause.
    if (
      paused &&
      rig.posed &&
      carrying === rig.carrying &&
      swimming === rig.swimming &&
      wading === rig.wading &&
      resting === rig.resting
    )
      return;
    rig.posed = true;
    rig.carrying = carrying;
    rig.swimming = swimming;
    rig.wading = wading;
    rig.resting = resting;
    const dt = paused ? 0 : Math.min(seconds, 0.1);
    const relaxed = !!resting && !moving && !carrying && !chopping && !swimming;
    const seated = relaxed && resting === 'seated';
    if (relaxed) rig.restPhase += dt;
    rig.restBlend = paused
      ? Number(seated)
      : THREE.MathUtils.damp(rig.restBlend, Number(seated), 10, dt);
    const restBlend = rig.restBlend;
    const stride = wading ? 0.85 : sprinting ? 2.1 : 1.15;
    if (moving && !paused) rig.phase += (Math.min(distance / object.scale.y, 1.5) / stride) * TAU;
    if (chopping && !paused) rig.workPhase += dt * 3.2;
    // Keep a slow tread when stationary; movement adds a broader stroke.
    if (swimming && !paused) rig.swimPhase = (rig.swimPhase || 0) + dt * (moving ? 3.2 : 1.8);
    const phase = rig.phase;
    const bob = moving ? Math.cos(phase * 2) * (sprinting ? 0.025 : 0.008) : 0;
    const bodyHeight = swimming
      ? HIP_HEIGHT + 0.06 + Math.sin(rig.swimPhase || 0) * 0.008
      : HIP_HEIGHT - 0.51 * restBlend - (moving ? (sprinting ? 0.12 : 0.04) : 0) + bob;
    rig.torso.position.y = bodyHeight;
    rig.torso.rotation.set(
      swimming
        ? moving
          ? 0.95
          : 0.45
        : chopping
          ? 0.12 + Math.sin(rig.workPhase) * 0.09
          : sprinting && moving
            ? 0.19
            : carrying
              ? 0.07
              : restBlend * 0.07,
      moving ? Math.sin(phase) * 0.035 : 0,
      relaxed ? Math.sin(rig.restPhase * 0.55) * 0.007 : 0,
    );
    rig.skirt.position.y = bodyHeight;
    rig.skirt.rotation.x = swimming ? rig.torso.rotation.x * 0.5 : -restBlend * 1.02;
    rig.skirt.rotation.z = moving ? Math.sin(phase) * 0.018 : 0;
    // Long garments cover the legs. Give the lower cloth room for the stride;
    // its hidden trouser meshes must not poke through the outer dress.
    rig.skirt.scale.z = moving ? (sprinting ? 1.8 : 1.45) : 1;
    rig.skirt.scale.y = 1 - restBlend * 0.5;
    rig.head.rotation.x = -rig.torso.rotation.x * (swimming ? 0.85 : 0.6);
    rig.head.rotation.y = relaxed ? Math.sin(rig.restPhase * 0.35) * 0.09 : 0;
    for (let index = 0; index < rig.legs.length; index++) {
      const leg = rig.legs[index];
      const cycle = (((phase / TAU + index * 0.5) % 1) + 1) % 1;
      const stance = sprinting ? 0.42 : 0.6;
      let forward = 0.56 * restBlend;
      let lift = 0;
      if (moving) {
        const reach = (stride * stance) / 2;
        if (cycle < stance) forward = reach * (1 - (2 * cycle) / stance);
        else {
          const swing = (cycle - stance) / (1 - stance);
          forward = reach * (-1 + 2 * swing);
          lift = Math.sin(swing * Math.PI) * (wading ? 0.21 : sprinting ? 0.27 : 0.13);
        }
      }
      const down = bodyHeight - 0.084 - lift;
      const length = clamp(Math.hypot(forward, down), 0.1, THIGH_LENGTH + SHIN_LENGTH - 0.002);
      const hipAngle =
        Math.atan2(-forward, down) -
        Math.acos(
          clamp(
            (THIGH_LENGTH ** 2 + length ** 2 - SHIN_LENGTH ** 2) / (2 * THIGH_LENGTH * length),
            -1,
            1,
          ),
        );
      const kneeAngle =
        Math.PI -
        Math.acos(
          clamp(
            (THIGH_LENGTH ** 2 + SHIN_LENGTH ** 2 - length ** 2) / (2 * THIGH_LENGTH * SHIN_LENGTH),
            -1,
            1,
          ),
        );
      leg.hip.position.y = bodyHeight;
      leg.hip.rotation.x = hipAngle;
      leg.knee.rotation.x = kneeAngle;
      leg.ankle.rotation.x = -hipAngle - kneeAngle;
      if (swimming) {
        const kick = Math.sin((rig.swimPhase || 0) * 1.7 + index * Math.PI);
        leg.hip.rotation.x = (moving ? 1.0 : 0.35) + kick * 0.16;
        leg.knee.rotation.x = 0.18 + Math.max(0, -kick) * 0.3;
        leg.ankle.rotation.x = -0.15;
      }
    }
    const strike = (Math.sin(rig.workPhase) + 1) / 2;
    toolPosition.set(0.07, 0.39 + (1 - strike) * 0.14, 0.27 + strike * 0.13);
    toolRotation.setFromAxisAngle(RIGHT, -0.65 + strike * 2.8);
    for (let index = 0; index < rig.arms.length; index++) {
      const arm = rig.arms[index];
      if (swimming && !carrying) {
        const stroke = (rig.swimPhase || 0) + index * Math.PI;
        handTarget.set(
          arm.side * (0.29 + Math.sin(stroke) * 0.12),
          0.2 + Math.cos(stroke) * 0.09,
          0.08 + Math.cos(stroke) * (moving ? 0.38 : 0.18),
        );
      } else if (chopping) {
        handTarget
          .set(0, index === 1 ? 0.06 : -0.13, 0)
          .applyQuaternion(toolRotation)
          .add(toolPosition);
      } else if (carrying) handTarget.set(arm.side * 0.17, 0.18, 0.29);
      else if (seated) handTarget.set(arm.side * 0.22, 0.08, 0.38);
      else if (sprinting && moving)
        handTarget.set(arm.side * 0.27, 0.1, 0.08 + Math.sin(phase + index * Math.PI) * 0.22);
      else
        handTarget.set(
          arm.side * 0.27,
          -0.07,
          moving ? Math.sin(phase + index * Math.PI) * 0.15 : 0.015,
        );
      reach(arm, handTarget);
    }
    if (tool) {
      tool.visible = chopping;
      rig.torso.updateMatrix();
      toolMatrix.compose(toolPosition, toolRotation, unitScale).premultiply(rig.torso.matrix);
      toolMatrix.decompose(tool.position, tool.quaternion, tool.scale);
    }
    rig.distantBody.position.y = rig.torso.position.y;
    rig.distantBody.rotation.copy(rig.torso.rotation);
    rig.distantBody.geometry =
      restBlend > 0.5 ? rig.geometry.distantSeatedBody : rig.geometry.distantBody;
    rig.legs.forEach((leg, index) => {
      rig.distantLegs[index].position.y = leg.hip.position.y;
      rig.distantLegs[index].rotation.x = swimming
        ? leg.hip.rotation.x
        : moving
          ? Math.sin(phase + index * Math.PI) * 0.4
          : 0;
      rig.distantLegs[index].scale.y = 1;
      if (restBlend > 0.001) {
        const down = bodyHeight - 0.084;
        const forward = 0.56 * restBlend;
        rig.distantLegs[index].rotation.x = -Math.atan2(forward, down);
        rig.distantLegs[index].scale.y = Math.hypot(forward, down) / 0.79;
      }
      rig.distantArms[index].position.y = bodyHeight + 0.47;
      rig.distantArms[index].quaternion.copy(rig.arms[index].shoulder.quaternion);
    });
  }
  // Dimensions are restrained presentation estimates, not breed identifications.
  // +Z is forward, matching human headings and the world's movement vectors.
  const livestockShapes = {
    cattle: {
      hip: 0.68,
      width: 0.27,
      depth: 0.58,
      bodyY: 0.84,
      belly: 0.29,
      legX: 0.19,
      legZ: 0.39,
      neckY: 0.83,
      neckZ: 0.36,
      neckLength: 0.4,
      neckRise: 0.07,
      headScale: 1,
      hoof: 0.055,
    },
    sheep: {
      hip: 0.4,
      width: 0.22,
      depth: 0.4,
      bodyY: 0.51,
      belly: 0.21,
      legX: 0.14,
      legZ: 0.27,
      neckY: 0.56,
      neckZ: 0.28,
      neckLength: 0.23,
      neckRise: 0.05,
      headScale: 0.63,
      hoof: 0.037,
    },
    goat: {
      hip: 0.45,
      width: 0.18,
      depth: 0.42,
      bodyY: 0.56,
      belly: 0.2,
      legX: 0.13,
      legZ: 0.29,
      neckY: 0.59,
      neckZ: 0.29,
      neckLength: 0.3,
      neckRise: 0.13,
      headScale: 0.7,
      hoof: 0.039,
    },
  };
  const livestockCoats = {
    cattle: ['#88533a', '#514134', '#a58a60', '#c1af88'],
    sheep: ['#d0c7ad', '#746552', '#9b9686', '#b4a58a'],
    goat: ['#a28b67', '#a7a69a', '#554c40', '#c6b99e'],
  };
  const livestockVariants = new Map();

  function curvedHorn(points, radius) {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    const geometry = new THREE.TubeGeometry(curve, 12, radius, 7, false);
    const positions = geometry.attributes.position;
    // TubeGeometry supplies a stable frame. Taper each ring about its centre.
    for (let row = 0; row <= 12; row++) {
      const centre = curve.getPointAt(row / 12);
      const taper = Math.max(0.05, Math.pow(1 - row / 12, 0.75));
      for (let column = 0; column <= 7; column++) {
        const index = row * 8 + column;
        const point = new THREE.Vector3().fromBufferAttribute(positions, index);
        point.sub(centre).multiplyScalar(taper).add(centre);
        positions.setXYZ(index, point.x, point.y, point.z);
      }
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  function createLivestockVariant(kind, variant) {
    const shape = livestockShapes[kind];
    const coat = livestockCoats[kind][variant];
    const faceColor = kind === 'sheep' ? '#645645' : shaded(coat, 0.83);
    const body = new Parts();
    if (kind === 'sheep') {
      // A continuous rippled fleece avoids separate cotton-ball lumps. Higher
      // tessellation is used only for this close-range coat and shared by sheep.
      const fleece = new THREE.SphereGeometry(1, 32, 20);
      const positions = fleece.attributes.position;
      for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index);
        const y = positions.getY(index);
        const z = positions.getZ(index);
        const curl =
          1 +
          Math.sin(x * 28 + Math.sin(z * 17)) * Math.cos(y * 23 + z * 11) * 0.035 +
          Math.sin(z * 31 + y * 18) * 0.018;
        positions.setXYZ(index, x * curl, y * curl, z * curl);
      }
      fleece.computeVertexNormals();
      body.add(fleece, coat, [0, shape.bodyY, 0], [shape.width, shape.belly, shape.depth]);
      fleece.dispose();
    } else body.add(sphere, coat, [0, shape.bodyY, 0], [shape.width, shape.belly, shape.depth]);
    const neck = new Parts();
    const neckLength = Math.hypot(shape.neckRise, shape.neckLength);
    neck.add(
      sphere,
      coat,
      [0, shape.neckRise / 2, shape.neckLength / 2],
      [shape.headScale * 0.16, shape.headScale * 0.18, neckLength * 0.7],
      [-Math.atan2(shape.neckRise, shape.neckLength), 0, 0],
    );
    const head = new Parts();
    const muzzleColor = kind === 'cattle' ? '#57463d' : faceColor;
    const distantHead = new Parts();
    distantHead.add(lowSphere, faceColor, [0, 0.035, 0.025], [0.13, 0.17, 0.2]);
    distantHead.add(lowSphere, muzzleColor, [0, -0.08, 0.24], [0.12, 0.09, 0.13]);
    for (const side of [-1, 1])
      distantHead.add(lowSphere, coat, [side * 0.16, 0.1, -0.01], [0.1, 0.04, 0.06]);

    head.add(sphere, faceColor, [0, 0.035, 0.025], [0.13, 0.17, 0.2]);
    head.add(sphere, muzzleColor, [0, -0.08, 0.24], [kind === 'cattle' ? 0.14 : 0.1, 0.09, 0.13]);
    for (const side of [-1, 1]) {
      head.add(sphere, '#29251f', [side * 0.075, -0.055, 0.355], [0.023, 0.014, 0.009]);
      head.add(sphere, '#342e25', [side * 0.117, 0.073, 0.105], [0.012, 0.022, 0.028]);
      head.add(sphere, '#ae9a68', [side * 0.127, 0.075, 0.109], [0.006, 0.012, 0.019]);
      head.add(cube, '#24221d', [side * 0.133, 0.075, 0.111], [0.004, 0.008, 0.025]);
      let hornPoints;
      if (kind === 'cattle')
        hornPoints = [
          [side * 0.1, 0.16, -0.04],
          [side * 0.19, 0.2, -0.08],
          [side * 0.28, 0.29, -0.02],
        ];
      else if (kind === 'goat')
        hornPoints = [
          [side * 0.08, 0.17, -0.04],
          [side * 0.11, 0.33, -0.16],
          [side * 0.1, 0.38, -0.34],
        ];
      else if (variant === 1)
        hornPoints = [
          [side * 0.12, 0.13, -0.03],
          [side * 0.24, 0.11, -0.13],
          [side * 0.26, -0.09, -0.06],
          [side * 0.19, -0.09, 0.09],
          [side * 0.16, 0.02, 0.11],
        ];
      if (hornPoints) {
        const horn = curvedHorn(hornPoints, kind === 'sheep' ? 0.046 : 0.035);
        head.add(horn, '#b2a58a');
        distantHead.add(horn, '#b2a58a');
        horn.dispose();
      }
    }
    if (kind === 'goat') {
      const beard = new THREE.ConeGeometry(0.065, 0.21, 8);
      head.add(beard, shaded(coat, 0.66), [0, -0.21, 0.15], [1, 1, 0.65], [0, 0, Math.PI]);
      beard.dispose();
    }
    const ear = new Parts();
    ear.add(sphere, coat, [0.07, 0, 0], [0.11, 0.04, 0.065]);
    ear.add(sphere, shaded(coat, 0.73), [0.08, 0.014, 0.02], [0.074, 0.023, 0.038]);
    const jaw = new Parts();
    jaw.add(sphere, muzzleColor, [0, -0.1, 0.19], [0.1, 0.052, 0.14]);
    const upperLeg = new Parts();
    upperLeg.add(
      sphere,
      coat,
      [0, -shape.hip * 0.13, 0],
      [shape.width * 0.27, shape.hip * 0.18, shape.width * 0.29],
    );
    upperLeg.add(
      cylinder,
      coat,
      [0, -shape.hip * 0.255, 0],
      [shape.width * 0.2, shape.hip * 0.51, shape.width * 0.22],
    );
    const lowerLeg = new Parts();
    lowerLeg.add(
      sphere,
      faceColor,
      [0, 0, 0],
      [shape.width * 0.2, shape.width * 0.22, shape.width * 0.21],
    );
    lowerLeg.add(
      cylinder,
      faceColor,
      [0, -shape.hip * 0.235, 0],
      [shape.width * 0.13, shape.hip * 0.47, shape.width * 0.15],
    );
    const hoof = new Parts();
    for (const side of [-1, 1])
      hoof.add(
        cube,
        '#38322b',
        [side * shape.width * 0.065, -shape.hoof * 0.42, 0.022],
        [shape.width * 0.12, shape.hoof * 1.02, shape.width * 0.34],
      );
    const tail = new Parts();
    if (kind === 'cattle') {
      tail.add(cylinder, coat, [0, -0.2, 0], [0.016, 0.4, 0.016]);
      tail.add(sphere, '#45382b', [0, -0.42, 0], [0.035, 0.09, 0.04]);
    } else
      tail.add(
        sphere,
        coat,
        [0, kind === 'goat' ? 0.06 : -0.07, -0.04],
        [0.037, 0.1, 0.045],
        [kind === 'goat' ? -0.5 : 0.2, 0, 0],
      );
    const distantBody = new Parts();
    distantBody.add(lowSphere, coat, [0, shape.bodyY, 0], [shape.width, shape.belly, shape.depth]);
    const distantLeg = new Parts();
    distantLeg.add(
      cylinder,
      faceColor,
      [0, -shape.hip * 0.45, 0],
      [shape.width * 0.15, shape.hip * 0.9, shape.width * 0.17],
    );
    distantLeg.add(
      cube,
      '#38322b',
      [0, -shape.hip + shape.hoof * 0.6, 0.022],
      [shape.width * 0.28, shape.hoof, shape.width * 0.34],
    );
    const geometries = Object.fromEntries(
      Object.entries({
        body,
        neck,
        head,
        ear,
        jaw,
        upperLeg,
        lowerLeg,
        hoof,
        tail,
        distantBody,
        distantHead,
        distantLeg,
      }).map(([name, parts]) => [name, parts.finish()]),
    );
    if (kind === 'cattle') {
      // Pigment belongs on the hide, never in raised geometric patches.
      const tint = new THREE.Color(coat);
      for (const geometry of [geometries.body, geometries.distantBody]) {
        const positions = geometry.attributes.position;
        const colors = geometry.attributes.color;
        for (let index = 0; index < positions.count; index++) {
          const field =
            Math.sin(positions.getZ(index) * 8 + variant) +
            Math.cos((positions.getY(index) - shape.bodyY) * 15 + positions.getX(index) * 3);
          const shade = 0.82 + THREE.MathUtils.smoothstep(field, -0.3, 0.8) * 0.25;
          colors.setXYZ(index, tint.r * shade, tint.g * shade, tint.b * shade);
        }
      }
    }
    return geometries;
  }

  function createLivestock(kind, index) {
    if (!livestockShapes[kind]) throw Error('Unknown livestock kind: ' + kind);
    const shape = livestockShapes[kind];
    const variant = index % 4;
    const key = kind + ':' + variant;
    if (!livestockVariants.has(key))
      livestockVariants.set(key, createLivestockVariant(kind, variant));
    const geometry = livestockVariants.get(key);
    const group = new THREE.Group();
    const detail = joint(group, 'livestock-detail', 0, 0, 0);
    const body = mesh(geometry.body, detail, 'livestock-body');
    const neck = joint(detail, 'livestock-neck', 0, shape.neckY, shape.neckZ);
    mesh(geometry.neck, neck, 'neck-shape');
    const head = joint(neck, 'livestock-head', 0, shape.neckRise, shape.neckLength);
    head.scale.setScalar(shape.headScale);
    mesh(geometry.head, head, 'head-shape');
    const jaw = joint(head, 'jaw', 0, 0, 0);
    mesh(geometry.jaw, jaw, 'lower-jaw');
    const ears = [-1, 1].map((side) => {
      const ear = joint(head, 'ear', side * 0.12, 0.12, -0.025);
      mesh(geometry.ear, ear, 'ear-shape').scale.x = side;
      return ear;
    });
    const legs = [];
    for (const front of [false, true])
      for (const side of [-1, 1]) {
        const hip = joint(
          detail,
          'livestock-hip',
          side * shape.legX,
          shape.hip,
          front ? shape.legZ : -shape.legZ,
        );
        mesh(geometry.upperLeg, hip, 'upper-leg');
        const knee = joint(hip, 'livestock-knee', 0, -shape.hip * 0.51, 0);
        mesh(geometry.lowerLeg, knee, 'lower-leg');
        const foot = joint(knee, 'hoof', 0, -shape.hip * 0.47, 0);
        mesh(geometry.hoof, foot, 'cloven-hoof');
        legs.push({
          hip,
          knee,
          foot,
          front,
          side,
          phase: front ? (side < 0 ? 0.25 : 0.75) : side < 0 ? 0 : 0.5,
        });
      }
    const tail = joint(detail, 'tail', 0, shape.bodyY + shape.belly * 0.4, -shape.depth * 0.94);
    mesh(geometry.tail, tail, 'tail-shape');
    const distant = joint(group, 'livestock-distant', 0, 0, 0);
    distant.visible = false;
    mesh(geometry.distantBody, distant, 'distant-livestock-body');
    const distantNeck = joint(distant, 'distant-neck', 0, shape.neckY, shape.neckZ);
    mesh(geometry.neck, distantNeck, 'distant-neck-shape');
    const distantHead = mesh(
      geometry.distantHead,
      distantNeck,
      'distant-head',
      0,
      shape.neckRise,
      shape.neckLength,
    );
    distantHead.scale.setScalar(shape.headScale);
    const distantLegs = legs.map(({ hip }) =>
      mesh(
        geometry.distantLeg,
        distant,
        'distant-livestock-leg',
        hip.position.x,
        hip.position.y,
        hip.position.z,
      ),
    );
    group.livestockRig = {
      kind,
      shape,
      detail,
      distant,
      body,
      neck,
      head,
      ears,
      jaw,
      legs,
      tail,
      distantNeck,
      distantHead,
      distantLegs,
      phase: 0,
      clock: index * 1.37,
      grazing: 0,
      posed: false,
      muzzle: new THREE.Vector3(0, -0.08, 0.24),
    };
    return group;
  }

  function poseLivestock(
    object,
    {
      distance = 0,
      seconds = 0,
      moving = false,
      grazing = false,
      paused = false,
      cameraDistance = 0,
      groundAt = null,
    } = {},
  ) {
    const rig = object.livestockRig;
    const shape = rig.shape;
    rig.detail.visible = cameraDistance < 42;
    rig.distant.visible = !rig.detail.visible;
    if (paused && rig.posed) return;
    rig.posed = true;
    const dt = paused ? 0 : Math.min(seconds, 0.1);
    const stride = shape.hip * 0.9;
    if (moving && !paused) rig.phase += Math.min(distance, 0.25) / stride;
    rig.clock += dt;
    rig.grazing += ((grazing && !moving ? 1 : 0) - rig.grazing) * (1 - Math.exp(-dt * 3.5));
    rig.body.scale.y = 1 + Math.sin(rig.clock * 1.7) * 0.004;
    rig.neck.rotation.x = rig.grazing * 1.3;
    rig.head.rotation.x = rig.grazing * 0.5;
    rig.head.rotation.y = Math.sin(rig.clock * 0.55) * 0.04 * (1 - rig.grazing);
    rig.neck.position.y = shape.neckY;
    // Lower the muzzle to the grass without driving it through the ground.
    // This is a visual reach approximation; it does not consume pasture/feed.
    const angle = rig.neck.rotation.x + rig.head.rotation.x;
    const muzzleZ =
      shape.neckZ +
      shape.neckRise * Math.sin(rig.neck.rotation.x) +
      shape.neckLength * Math.cos(rig.neck.rotation.x) +
      shape.headScale * (rig.muzzle.y * Math.sin(angle) + rig.muzzle.z * Math.cos(angle));
    const muzzleY =
      shape.neckY +
      shape.neckRise * Math.cos(rig.neck.rotation.x) -
      shape.neckLength * Math.sin(rig.neck.rotation.x) +
      shape.headScale * (rig.muzzle.y * Math.cos(angle) - rig.muzzle.z * Math.sin(angle));
    const grassHeight = groundAt ? groundAt(0, muzzleZ) : 0;
    rig.neck.position.y += (grassHeight + shape.headScale * 0.15 - muzzleY) * rig.grazing;
    rig.jaw.rotation.x = rig.grazing * (0.035 + Math.sin(rig.clock * 8) * 0.025);
    rig.tail.rotation.z =
      Math.sin(rig.clock * 1.4) * 0.07 +
      Math.pow(Math.max(0, Math.sin(rig.clock * 0.6)), 12) * Math.sin(rig.clock * 11) * 0.35;
    rig.ears.forEach((ear, index) => {
      ear.rotation.z =
        Math.pow(Math.max(0, Math.sin(rig.clock * 0.7 + index * 2)), 16) *
        Math.sin(rig.clock * 9) *
        0.22;
    });
    for (let index = 0; index < rig.legs.length; index++) {
      const leg = rig.legs[index];
      const cycle = (((rig.phase + leg.phase) % 1) + 1) % 1;
      let forward = 0;
      let lift = 0;
      if (moving) {
        const reach = (stride * 0.68) / 2;
        if (cycle < 0.68) forward = reach * (1 - (2 * cycle) / 0.68);
        else {
          const swing = (cycle - 0.68) / 0.32;
          forward = reach * (-1 + 2 * swing);
          lift = Math.sin(swing * Math.PI) * shape.hip * 0.15;
        }
      }
      const upper = shape.hip * 0.51;
      const lower = shape.hip * 0.47;
      const groundHeight = groundAt
        ? groundAt(leg.hip.position.x, leg.hip.position.z + forward)
        : 0;
      const down = shape.hip - shape.hoof - lift - groundHeight;
      const length = clamp(Math.hypot(forward, down), 0.03, upper + lower - 0.001);
      const bend = leg.front ? -1 : 1;
      leg.hip.rotation.x =
        Math.atan2(-forward, down) -
        bend *
          Math.acos(clamp((upper ** 2 + length ** 2 - lower ** 2) / (2 * upper * length), -1, 1));
      leg.knee.rotation.x =
        bend *
        (Math.PI -
          Math.acos(clamp((upper ** 2 + lower ** 2 - length ** 2) / (2 * upper * lower), -1, 1)));
      leg.foot.rotation.x = -leg.hip.rotation.x - leg.knee.rotation.x;
      rig.distantLegs[index].rotation.x = moving
        ? Math.sin((rig.phase + leg.phase) * TAU) * 0.24
        : 0;
    }
    rig.distantNeck.position.copy(rig.neck.position);
    rig.distantNeck.rotation.copy(rig.neck.rotation);
    rig.distantHead.rotation.copy(rig.head.rotation);
  }

  root.VinlandCharacters = { createHuman, createAxe, poseHuman, createLivestock, poseLivestock };
})(window);
