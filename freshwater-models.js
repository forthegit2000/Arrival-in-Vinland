/** Freshwater presentation. Levels and modeled beds come from VinlandMeadows.
 * Refine only bank cells; distant terrain keeps its original resolution.
 */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  const SUBDIVISIONS = 4;

  function refineTerrain(geometry, geography) {
    const { width, height, widthSegments: columns, heightSegments: rows } = geometry.parameters;
    const position = geometry.attributes.position;
    const sourceColor = geometry.attributes.color;
    const sourceUv = geometry.attributes.uv;
    const positions = Array.from(position.array);
    const colors = Array.from(sourceColor.array);
    const uvs = Array.from(sourceUv.array);
    const refined = new Set();
    const patches = new Map();
    const sharedVertices = new Map();
    const indices = [];
    const cellWidth = width / columns,
      cellDepth = height / rows;
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const sample = geography.freshwaterAt(
          -width / 2 + (column + 0.5) * cellWidth,
          -height / 2 + (row + 0.5) * cellDepth,
        );
        if (sample && Math.abs(sample.distance) < 7) refined.add(row * columns + column);
      }
    function triangles(a, b, c, d) {
      indices.push(a, b, d, b, c, d);
    }
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const a = row * (columns + 1) + column,
          b = a + columns + 1,
          c = b + 1,
          d = a + 1;
        if (!refined.has(row * columns + column)) {
          triangles(a, b, c, d);
          continue;
        }
        const patch = [];
        for (let z = 0; z <= SUBDIVISIONS; z++)
          for (let x = 0; x <= SUBDIVISIONS; x++) {
            const vertexKey =
              (row * SUBDIVISIONS + z) * (columns * SUBDIVISIONS + 1) + column * SUBDIVISIONS + x;
            if (sharedVertices.has(vertexKey)) {
              patch.push(sharedVertices.get(vertexKey));
              continue;
            }
            const fx = x / SUBDIVISIONS,
              fz = z / SUBDIVISIONS;
            const worldX = position.getX(a) + fx * cellWidth;
            const worldZ = position.getZ(a) + fz * cellDepth;
            const boundary =
              (x === 0 && !refined.has(row * columns + column - 1)) ||
              (x === SUBDIVISIONS && !refined.has(row * columns + column + 1)) ||
              (z === 0 && !refined.has((row - 1) * columns + column)) ||
              (z === SUBDIVISIONS && !refined.has((row + 1) * columns + column));
            const blend = (attribute, component) => {
              const get = (index) => attribute.array[index * attribute.itemSize + component];
              return fx + fz <= 1
                ? get(a) * (1 - fx - fz) + get(b) * fz + get(d) * fx
                : get(c) * (fx + fz - 1) + get(b) * (1 - fx) + get(d) * (1 - fz);
            };
            const ground = boundary ? blend(position, 1) : geography.elevation(worldX, worldZ);
            sharedVertices.set(vertexKey, positions.length / 3);
            patch.push(positions.length / 3);
            positions.push(worldX, ground, worldZ);
            const sample = geography.freshwaterAt(worldX, worldZ);
            const wet = sample ? 1 - THREE.MathUtils.smoothstep(sample.distance, 0, 4) : 0;
            // Muted gravel/earth variation shows through clear shallows. Blend
            // gently into the existing green bank, rather than painting a ditch.
            const grain =
              0.5 +
              0.25 * Math.sin(worldX * 2.3 + Math.sin(worldZ * 1.7)) +
              0.25 * Math.sin(worldZ * 3.1 - worldX * 0.8);
            const soil = new THREE.Color().setRGB(
              0.1 + grain * 0.055,
              0.115 + grain * 0.05,
              0.105 + grain * 0.05,
            );
            for (let channel = 0; channel < 3; channel++)
              colors.push(
                THREE.MathUtils.lerp(
                  blend(sourceColor, channel),
                  [soil.r, soil.g, soil.b][channel],
                  wet * 0.66,
                ),
              );
            uvs.push(blend(sourceUv, 0), blend(sourceUv, 1));
          }
        for (let z = 0; z < SUBDIVISIONS; z++)
          for (let x = 0; x < SUBDIVISIONS; x++) {
            const i = z * (SUBDIVISIONS + 1) + x;
            triangles(
              patch[i],
              patch[i + SUBDIVISIONS + 1],
              patch[i + SUBDIVISIONS + 2],
              patch[i + 1],
            );
          }
        patches.set(row * columns + column, patch);
      }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.userData.freshwaterPatches = patches;
    // The plane's original normal buffer is too short after adding bank vertices.
    geometry.deleteAttribute('normal');
    geometry.computeVertexNormals();
    return geometry;
  }

  function terrainHeight(geometry, x, z, fallback) {
    const { width, height, widthSegments: columns, heightSegments: rows } = geometry.parameters;
    const gridX = ((x + width / 2) / width) * columns,
      gridZ = ((z + height / 2) / height) * rows;
    if (gridX < 0 || gridX >= columns || gridZ < 0 || gridZ >= rows) return fallback(x, z);
    const column = Math.floor(gridX),
      row = Math.floor(gridZ);
    let fx = gridX - column,
      fz = gridZ - row;
    const patch = geometry.userData.freshwaterPatches?.get(row * columns + column);
    let a, b, c, d;
    if (patch) {
      fx *= SUBDIVISIONS;
      fz *= SUBDIVISIONS;
      const i = Math.floor(fz) * (SUBDIVISIONS + 1) + Math.floor(fx);
      a = patch[i];
      b = patch[i + SUBDIVISIONS + 1];
      c = patch[i + SUBDIVISIONS + 2];
      d = patch[i + 1];
      fx %= 1;
      fz %= 1;
    } else {
      a = row * (columns + 1) + column;
      b = a + columns + 1;
      c = b + 1;
      d = a + 1;
    }
    const p = geometry.attributes.position;
    return fx + fz <= 1
      ? p.getY(a) * (1 - fx - fz) + p.getY(b) * fz + p.getY(d) * fx
      : p.getY(c) * (fx + fz - 1) + p.getY(b) * (1 - fx) + p.getY(d) * (1 - fz);
  }

  function pondDepthMap(geography, pond) {
    const size = 128;
    const pixels = new Uint16Array(size * size);
    for (let row = 0; row < size; row++)
      for (let column = 0; column < size; column++) {
        const x = pond.minX + (column / (size - 1)) * (pond.maxX - pond.minX);
        const z = pond.minZ + (row / (size - 1)) * (pond.maxZ - pond.minZ);
        const sample = geography.freshwaterAt(x, z);
        pixels[row * size + column] = THREE.DataUtils.toHalfFloat(
          sample?.kind === 'pond' ? sample.depth : 0,
        );
      }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RedFormat, THREE.HalfFloatType);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return {
      texture,
      bounds: new THREE.Vector4(pond.minX, pond.minZ, pond.maxX - pond.minX, pond.maxZ - pond.minZ),
    };
  }

  function waterMaterial(uniforms, pond = null) {
    const depthTexture =
      pond?.texture ||
      new THREE.DataTexture(new Uint16Array([0]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
    depthTexture.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: uniforms.time,
        windStrength: uniforms.windStrength,
        windDirection: uniforms.windDirection,
        rainIntensity: uniforms.rainIntensity,
        sun: uniforms.sun,
        fogColor: uniforms.fogColor,
        fogDensity: uniforms.fogDensity,
        isPond: { value: !!pond },
        depthMap: { value: depthTexture },
        depthBounds: { value: pond?.bounds || new THREE.Vector4(0, 0, 1, 1) },
      },
      vertexShader: `
        #include <common>
        #include <clipping_planes_pars_vertex>
        attribute float waterDepth;
        attribute vec2 flow;
        attribute float seaDistance;
        varying vec3 waterPosition;
        varying float localDepth;
        varying vec2 currentDirection;
        varying float seaRange;
        void main() {
          waterPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          localDepth = waterDepth; currentDirection = flow; seaRange = seaDistance;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <clipping_planes_vertex>
        }
      `,
      fragmentShader: `
        #include <clipping_planes_pars_fragment>
        uniform float time;
        uniform float windStrength;
        uniform vec2 windDirection;
        uniform float rainIntensity;
        uniform vec3 sun;
        uniform vec3 fogColor;
        uniform float fogDensity;
        uniform bool isPond;
        uniform sampler2D depthMap;
        uniform vec4 depthBounds;
        varying vec3 waterPosition;
        varying float localDepth;
        varying vec2 currentDirection;
        varying float seaRange;
        ${root.VinlandWaterShading.glsl}
        void main() {
          #include <clipping_planes_fragment>
          if (seaRange < 0.0) discard;
          float depth = isPond ? texture2D(depthMap, (waterPosition.xz - depthBounds.xy) / depthBounds.zw).r : localDepth;
          float inland = smoothstep(0.0, 6.0, seaRange);
          float flowing = clamp(length(currentDirection), 0.0, 1.0);
          vec2 direction = flowing > 0.01 ? normalize(currentDirection) : windDirection;
          // A few millimetres of irregular flow ripples. Wind acts across both
          // streams and ponds; there is no repeated stripe drawn into the color.
          vec3 currentWave = waterWaveAt(waterPosition.xz, direction, 0.85, 0.0025 * flowing, 1.6, time);
          vec3 windWave = waterWaveAt(waterPosition.xz, windDirection, 2.1, mix(0.001, 0.010, windStrength), 1.1, time);
          vec3 crossWave = waterWaveAt(waterPosition.xz, normalize(vec2(-direction.y, direction.x) + windDirection * 0.3), 0.43, 0.0007, 1.3, time);
          vec2 slopes = (currentWave.xy + windWave.xy + crossWave.xy) * inland;
          vec3 normal = normalize(vec3(-slopes.x, 1.0, -slopes.y));
          vec3 towardEye = normalize(cameraPosition - waterPosition);
          float fresnel = waterFresnel(normal, towardEye);
          float opacity = mix(1.0, waterCoverage(depth, fresnel), inland);
          // The same depth, reflection and lighting as the sea at the contact.
          float opticalDepth = mix(0.15, depth, inland);
          vec3 color = shadeNaturalWater(waterPosition, normal, opticalDepth, opacity,
            sun, fogColor, windStrength, rainIntensity);
          float visibleRipples = 1.0 - smoothstep(120.0, 350.0, distance(cameraPosition, waterPosition));
          color += waterRainRipples(waterPosition.xz, time) * rainIntensity * visibleRipples * vec3(0.018, 0.025, 0.028);
          color = waterDistanceFog(color, waterPosition, fogColor, fogDensity);
          gl_FragColor = vec4(color, opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      clipping: true,
      transparent: true,
      side: THREE.DoubleSide,
    });
    material.userData.depthTexture = depthTexture;
    material.addEventListener('dispose', () => depthTexture.dispose());
    return material;
  }

  function create(geography, uniforms) {
    const group = new THREE.Group();
    group.name = 'Mapped freshwater';
    const material = waterMaterial(uniforms);
    function mesh(name, vertices, indices, pond = null) {
      const depth = [],
        flow = [],
        shore = [];
      for (let i = 0; i < vertices.length; i += 3) {
        const sample = geography.freshwaterAt(vertices[i], vertices[i + 2]);
        depth.push(sample?.depth || 0);
        flow.push(sample?.flowX || 0, sample?.flowZ || 0);
        shore.push(geography.shoreDistance(vertices[i], vertices[i + 2]));
        // Slightly beneath sea level at the overlap, avoiding coplanar flicker.
        if (shore.at(-1) < 0) vertices[i + 1] = 0.015;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(depth, 1));
      geometry.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
      geometry.setAttribute('seaDistance', new THREE.Float32BufferAttribute(shore, 1));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const object = new THREE.Mesh(
        geometry,
        pond ? waterMaterial(uniforms, pondDepthMap(geography, pond)) : material,
      );
      object.name = name;
      object.receiveShadow = true;
      group.add(object);
    }
    for (const stream of geography.streamProfiles) {
      const samples = [];
      for (let i = 1; i < stream.points.length; i++) {
        const a = stream.points[i - 1],
          b = stream.points[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
        for (let step = 0; step < steps; step++)
          samples.push([
            a[0] + ((b[0] - a[0]) * step) / steps,
            a[1] + ((b[1] - a[1]) * step) / steps,
          ]);
      }
      samples.push(stream.points.at(-1));
      const vertices = [],
        indices = [];
      samples.forEach((point, i) => {
        const previous = samples[Math.max(0, i - 1)],
          next = samples[Math.min(samples.length - 1, i + 1)];
        const dx = next[0] - previous[0],
          dz = next[1] - previous[1],
          length = Math.hypot(dx, dz) || 1;
        for (const offset of [-1.2, -0.6, 0, 0.6, 1.2]) {
          const x = point[0] - (dz / length) * offset,
            z = point[1] + (dx / length) * offset;
          const sample = geography.freshwaterAt(x, z) || geography.freshwaterAt(...point);
          vertices.push(x, sample.surface + 0.012, z);
        }
        if (!i) return;
        for (let j = 0; j < 4; j++) {
          const a = (i - 1) * 5 + j,
            b = i * 5 + j;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      });
      mesh(stream.name, vertices, indices);
    }
    for (const pond of geography.pondProfiles) {
      const ring = [];
      for (let i = 1; i < pond.ring.length; i++) {
        const a = pond.ring[i - 1],
          b = pond.ring[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
        for (let j = 0; j < steps; j++)
          ring.push(
            new THREE.Vector2(
              a[0] + ((b[0] - a[0]) * j) / steps,
              -a[1] - ((b[1] - a[1]) * j) / steps,
            ),
          );
      }
      const shape = new THREE.ShapeGeometry(new THREE.Shape(ring));
      shape.rotateX(-Math.PI / 2);
      const p = shape.attributes.position;
      const vertices = [];
      for (let i = 0; i < p.count; i++) vertices.push(p.getX(i), pond.level + 0.012, p.getZ(i));
      const indices = Array.from(shape.index.array);
      shape.dispose();
      // A small depth texture gives continuous shallows across the whole pond,
      // independent of its triangulation; no fan-shaped color wedges.
      mesh('Mapped pond ' + pond.index, vertices, indices, pond);
    }
    return group;
  }
  root.VinlandFreshwater = { create, refineTerrain, terrainHeight };
})(window);
