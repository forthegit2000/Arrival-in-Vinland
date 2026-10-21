/**
 * Author the fixed knarr structure and export matching GLB/offline assets.
 * Run: node tools/build-knarr.cjs
 * Metres, Y up, bow at negative Z. No runtime geometry generation is needed.
 * See assets/models/README.md for references and deliberate gameplay dimensions.
 */
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('../vendor/three.min.js');

const LENGTH = 17.5;
const WIDTH = 5.2;
const DECK_HEIGHT = 1.16;
const STRAKES = 10;
const STATIONS = 48;
const directory = path.join(__dirname, '..', 'assets', 'models');

// The keel line and every plank use the same longitudinal curve. The bottom
// closes at X=0; it cannot acquire the old gap beneath the lowest strakes.
function keelHeight(z) {
  const end = Math.abs((z * 2) / LENGTH);
  return -1.03 + 0.12 * end ** 2 + 3.25 * end ** 8;
}

function hullPoint(z, fraction, side, thickness = 0) {
  const end = Math.abs((z * 2) / LENGTH);
  const breadth = (WIDTH / 2) * Math.max(0, Math.cos((z / LENGTH) * Math.PI)) ** 0.58;
  const sheer = 1.9 + 0.95 * end ** 4;
  const angle = (fraction * Math.PI) / 2;
  return [
    side * (breadth + thickness) * Math.sin(angle),
    keelHeight(z) + (sheer - keelHeight(z)) * (1 - Math.cos(angle)) - thickness * Math.cos(angle),
    z,
  ];
}

class GeometryBatch {
  constructor(name, material) {
    this.name = name;
    this.material = material;
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
  }

  add(geometry, color, matrix = new THREE.Matrix4()) {
    geometry.applyMatrix4(matrix);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const offset = this.positions.length / 3;
    const tint = new THREE.Color(color);
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      this.positions.push(...geometry.attributes.position.array.slice(i * 3, i * 3 + 3));
      this.normals.push(...geometry.attributes.normal.array.slice(i * 3, i * 3 + 3));
      this.colors.push(tint.r, tint.g, tint.b);
    }
    const indices =
      geometry.index?.array ||
      Array.from({ length: geometry.attributes.position.count }, (_, i) => i);
    for (const index of indices) this.indices.push(offset + index);
    geometry.dispose();
  }

  ribbon(rows, color, reverse = false) {
    const geometry = new THREE.BufferGeometry();
    const positions = rows.flat(2);
    const indices = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const a = i * 2;
      const triangles = [a, a + 1, a + 2, a + 1, a + 3, a + 2];
      if (reverse) triangles.reverse();
      indices.push(...triangles);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    this.add(geometry, color);
  }

  box(center, size, color) {
    this.add(new THREE.BoxGeometry(...size), color, new THREE.Matrix4().makeTranslation(...center));
  }

  beam(start, end, radius, color, tipRadius = radius) {
    const a = new THREE.Vector3(...start),
      b = new THREE.Vector3(...end),
      direction = b.clone().sub(a);
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize(),
    );
    const matrix = new THREE.Matrix4().compose(
      a.add(b).multiplyScalar(0.5),
      rotation,
      new THREE.Vector3(1, 1, 1),
    );
    this.add(new THREE.CylinderGeometry(tipRadius, radius, direction.length(), 8), color, matrix);
  }
}

const wood = new GeometryBatch('Clinker hull, framing and deck', 0);
const iron = new GeometryBatch('Steering-oar fittings', 1);
const stations = Array.from({ length: STATIONS + 1 }, (_, i) => (i / STATIONS - 0.5) * LENGTH);

for (const side of [-1, 1]) {
  for (let band = 0; band < STRAKES; band++) {
    const lower = band / STRAKES,
      upper = (band + 1) / STRAKES;
    const color = band % 2 ? '#796047' : '#85694c';
    const outer = stations.map((z) => [
      hullPoint(z, lower, side, 0.045),
      hullPoint(z, upper, side, 0.045),
    ]);
    const inner = stations.map((z) => [
      hullPoint(z, lower, side, -0.025),
      hullPoint(z, upper, side, -0.025),
    ]);
    wood.ribbon(outer, color, side < 0);
    wood.ribbon(inner, '#826d50', side > 0);
    // The exposed lower edge gives each overlapping strake a real lip and
    // a narrow dark seam; this detail remains in the same rendered mesh.
    wood.ribbon(
      stations.map((z, i) => [outer[i][0], inner[i][0]]),
      '#483b2c',
      side > 0,
    );
    if (band === STRAKES - 1)
      wood.ribbon(
        stations.map((z, i) => [outer[i][1], inner[i][1]]),
        '#b18b59',
        side < 0,
      );
  }
}

// A narrow timber follows the entire underside, then joins the rising stem
// faces. Its lower edge projects just below the planking, not metres away.
wood.ribbon(
  stations.map((z) => [
    [-0.085, keelHeight(z) - 0.19, z],
    [-0.085, keelHeight(z) + 0.045, z],
  ]),
  '#4a3a28',
  true,
);
wood.ribbon(
  stations.map((z) => [
    [0.085, keelHeight(z) - 0.19, z],
    [0.085, keelHeight(z) + 0.045, z],
  ]),
  '#4a3a28',
);
wood.ribbon(
  stations.map((z) => [
    [-0.085, keelHeight(z) - 0.19, z],
    [0.085, keelHeight(z) - 0.19, z],
  ]),
  '#382e22',
);
for (const side of [-1, 1]) {
  const gunwale = new THREE.CatmullRomCurve3(
    stations.map((z) => new THREE.Vector3(...hullPoint(z, 1, side, 0.025))),
  );
  wood.add(new THREE.TubeGeometry(gunwale, STATIONS, 0.075, 6, false), '#57432e');
  const z = (side * LENGTH) / 2;
  wood.box([0, (keelHeight(z) + 2.99) / 2, z], [0.17, 2.99 - keelHeight(z), 0.13], '#665036');
}

// Bent frames stay against the inside skin. There are no chest-high cross
// beams through the walkable cargo floor.
for (let z = -6.75; z <= 6.75; z += 1.35) {
  const points = [];
  for (let i = 0; i <= 20; i++) {
    const across = (i - 10) / 10;
    points.push(
      new THREE.Vector3(...hullPoint(z, Math.abs(across), Math.sign(across) || 1, -0.13)),
    );
  }
  const frame = new THREE.CatmullRomCurve3(points);
  wood.add(new THREE.TubeGeometry(frame, 24, 0.07, 5, false), '#624d35');
}

// Keep the existing usable floor height and outline for passengers/cargo.
// The narrower visible end platforms and plank seams distinguish it from a
// modern flat slab; exact archaeological hold access is not simulated here.
for (let z = -7.95; z <= 7.95; z += 0.24) {
  const deckEnvelope =
    Math.max(0, Math.cos(((Math.abs(z) + 0.12) / LENGTH) * Math.PI)) ** 0.6 * WIDTH * 0.46 * 0.95;
  // Near the rising stems the floor narrows faster than the gunwale. Trim
  // each board against the inner hull at its outermost corner, so no pale
  // deck ends protrude through the dark exterior planking.
  const endZ = Math.abs(z) + 0.12,
    end = (endZ * 2) / LENGTH,
    base = keelHeight(endZ),
    sheer = 1.9 + 0.95 * end ** 4;
  const angle = Math.acos(THREE.MathUtils.clamp(1 - (DECK_HEIGHT - base) / (sheer - base), 0, 1));
  const inside = hullPoint(endZ, (angle * 2) / Math.PI, 1, -0.09)[0];
  const halfWidth = Math.min(deckEnvelope, inside);
  const tint = Math.round((z + 8) / 0.24) % 3;
  wood.box(
    [0, DECK_HEIGHT - 0.035, z],
    [halfWidth * 2, 0.07, 0.229],
    ['#ad8b5c', '#a38357', '#98794f'][tint],
  );
}
for (const x of [-0.55, 0.55]) wood.box([x, 1.03, 0], [0.14, 0.18, 12.8], '#624a30');
wood.box([0, 1.24, 0], [0.74, 0.16, 1.35], '#624a30');
wood.beam([0, 1.1, 0], [0, 12.7, 0], 0.18, '#95754a', 0.075);
wood.beam([-4.4, 10.3, 0], [4.4, 10.3, 0], 0.09, '#755333');

// Starboard quarter steering oar: a shaped blade, shaft and dark lashings.
wood.beam([2.0, 2.03, 5.7], [2.73, -0.45, 7.7], 0.08, '#80603e', 0.055);
const blade = new THREE.BoxGeometry(0.12, 1.0, 0.42);
const bladeMatrix = new THREE.Matrix4().makeRotationX(0.48);
bladeMatrix.setPosition(2.7, -0.35, 7.75);
wood.add(blade, '#685035', bladeMatrix);
iron.box([2.21, 1.35, 6.27], [0.24, 0.1, 0.26], '#35352d');

function exportGLB(batches) {
  const binaryParts = [];
  const bufferViews = [];
  const accessors = [];
  let binaryLength = 0;
  function attribute(array, componentType, type, target, bounds = false) {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.length, target });
    binaryParts.push(bytes);
    binaryLength += bytes.length;
    const padding = (4 - (binaryLength % 4)) % 4;
    if (padding) {
      binaryParts.push(Buffer.alloc(padding));
      binaryLength += padding;
    }
    const components = type === 'SCALAR' ? 1 : 3;
    const accessor = { bufferView: view, componentType, count: array.length / components, type };
    if (bounds) {
      accessor.min = [Infinity, Infinity, Infinity];
      accessor.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < array.length; i++) {
        const axis = i % 3;
        accessor.min[axis] = Math.min(accessor.min[axis], array[i]);
        accessor.max[axis] = Math.max(accessor.max[axis], array[i]);
      }
    }
    accessors.push(accessor);
    return accessors.length - 1;
  }
  const meshes = batches.map((batch) => ({
    name: batch.name,
    primitives: [
      {
        attributes: {
          POSITION: attribute(new Float32Array(batch.positions), 5126, 'VEC3', 34962, true),
          NORMAL: attribute(new Float32Array(batch.normals), 5126, 'VEC3', 34962),
          COLOR_0: attribute(new Float32Array(batch.colors), 5126, 'VEC3', 34962),
        },
        indices: attribute(new Uint32Array(batch.indices), 5125, 'SCALAR', 34963),
        material: batch.material,
      },
    ],
  }));
  const json = {
    asset: { version: '2.0', generator: 'Vinland tools/build-knarr.cjs' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: batches.map((batch, mesh) => ({ name: batch.name, mesh })),
    meshes,
    materials: [
      {
        name: 'Weathered timber',
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
      },
      {
        name: 'Dark fittings',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.35,
          roughnessFactor: 0.85,
        },
      },
    ],
    buffers: [{ byteLength: binaryLength }],
    bufferViews,
    accessors,
    extras: { length: LENGTH, width: WIDTH, deckHeight: DECK_HEIGHT },
  };
  const text = JSON.stringify(json);
  const jsonChunk = Buffer.from(text + ' '.repeat((4 - (Buffer.byteLength(text) % 4)) % 4));
  const binChunk = Buffer.concat(binaryParts);
  const output = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binChunk.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  const binHeader = 20 + jsonChunk.length;
  output.writeUInt32LE(binChunk.length, binHeader);
  output.writeUInt32LE(0x004e4942, binHeader + 4);
  binChunk.copy(output, binHeader + 8);
  return output;
}

const binary = exportGLB([wood, iron]);
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'knarr.glb'), binary);
// A classic script carries identical GLB bytes through file:// without fetch,
// module imports, external textures, asynchronous startup or a local server.
const chunks = binary.toString('base64').match(/.{1,96}/g);
const companion = `/** Generated by tools/build-knarr.cjs; edit the authoring source, not these bytes. */\nwindow.VinlandKnarrData = [\n${chunks.map((chunk) => `  '${chunk}',`).join('\n')}\n].join('');\n`;
fs.writeFileSync(path.join(directory, 'knarr-data.js'), companion);
console.log({
  bytes: binary.length,
  fixedMeshes: 2,
  triangles: (wood.indices.length + iron.indices.length) / 3,
});
