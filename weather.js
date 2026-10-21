/**
 * Local, procedural weather graphics. The simulation decides the weather;
 * this renderer handles rain, snow, impacts and surface wetness in real time.
 * Two instanced draws animate on the GPU, without image downloads or per-drop
 * JavaScript updates. All positions and velocities use metres and seconds.
 */
(function (root) {
  'use strict';

  const THREE = root.THREE;
  const Model = root.VinlandModel;
  const MAX_ROOFS = 48;
  const RAIN_CAPACITY = 10000;
  const IMPACT_CAPACITY = 1600;
  const FIELD_SIZES = { near: 80, middle: 320, distant: 1280 };

  // A packed height texture follows the rendered terrain. Lightweight roof
  // profiles stop drops at actual roof elevations, including rotated buildings.
  const SURFACE_SHADER = `
    uniform sampler2D groundMap;
    uniform vec4 groundExtent;
    uniform int roofCount;
    uniform vec4 roofFootprint[48];
    uniform vec4 roofProfile[48];

    float groundHeight(vec2 point) {
      vec2 uv = (point - groundExtent.xy) / groundExtent.zw;
      vec2 bytes = texture2D(groundMap, uv).rg * 255.0;
      return (bytes.r * 256.0 + bytes.g) / 128.0 - 64.0;
    }

    float surfaceHeight(vec2 point) {
      float height = groundHeight(point);
      for (int index = 0; index < 48; index++) {
        if (index >= roofCount) break;
        vec4 footprint = roofFootprint[index];
        vec4 profile = roofProfile[index];
        vec2 offset = point - footprint.xy;
        vec2 local = vec2(
          profile.z * offset.x - profile.w * offset.y,
          profile.w * offset.x + profile.z * offset.y
        );
        if (abs(local.x) < footprint.z && abs(local.y) < footprint.w) {
          float roof = profile.x + profile.y * (1.0 - abs(local.x) / footprint.z);
          height = max(height, roof);
        }
      }
      return height;
    }
  `;

  // Each particle belongs to a fixed-size world-space field. Zoom may fade
  // detail layers, but must never stretch the field or move its particles.
  const FIELD_SHADER = `
    attribute float fieldSpan;
    uniform vec2 anchor;
    uniform float viewDistance;

    vec2 fieldPosition(vec2 seed, vec2 drift) {
      return mod(seed * fieldSpan + drift - anchor + fieldSpan * 0.5, fieldSpan)
        - fieldSpan * 0.5 + anchor;
    }

    float fieldVisibility(vec2 point) {
      vec2 edge = abs((point - anchor) / fieldSpan) * 2.0;
      float visibility = 1.0 - smoothstep(0.75, 1.0, max(edge.x, edge.y));
      if (fieldSpan < 100.0) {
        visibility *= 1.0 - smoothstep(20.0, 90.0, viewDistance);
      } else if (fieldSpan < 500.0) {
        visibility *= 1.0 - smoothstep(450.0, 1100.0, viewDistance);
      } else {
        visibility *= smoothstep(160.0, 550.0, viewDistance);
      }
      return visibility;
    }
  `;

  const RAIN_VERTEX_SHADER = `
    attribute vec4 seed;
    attribute vec3 shape;
    uniform float time;
    uniform float snowMode;
    uniform vec2 wind;
    uniform float fallHeight;
    uniform float pixelWorldSize;
    varying vec2 rainUv;
    varying vec3 weatherPosition;
    varying float dropOpacity;
    varying float hitHeight;
    ${SURFACE_SHADER}
    ${FIELD_SHADER}

    void main() {
      vec2 impact = fieldPosition(seed.xy, vec2(0.0));
      float speed = mix(seed.w, 0.6 + seed.w * 0.04, snowMode);
      float phase = fract(seed.z - time * speed / fallHeight);
      float surface = surfaceHeight(impact);
      float height = phase * fallHeight;
      vec2 drift = wind * mix(1.0, 0.18, snowMode);
      vec2 head = impact - drift * height / speed;
      head += snowMode * vec2(sin(time + seed.z * 30.0), cos(time * 0.7 + seed.z * 20.0)) * 0.45;
      hitHeight = surfaceHeight(head);
      float length = mix(shape.x, 0.12 + shape.y * 2.0, snowMode);
      float width = max(mix(shape.y, length, snowMode), pixelWorldSize * 0.8);
      vec3 tail = vec3(-drift.x / speed, 1.0, -drift.y / speed) * length;
      vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 cameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 offset = mix(tail * uv.y, cameraUp * (uv.y - 0.5) * length, snowMode);
      weatherPosition = vec3(head.x, surface + height, head.y) + offset + cameraRight * position.x * width;
      rainUv = uv;
      dropOpacity = shape.z * fieldVisibility(impact) * smoothstep(0.0, 0.8, height);
      gl_Position = projectionMatrix * viewMatrix * vec4(weatherPosition, 1.0);
    }
  `;

  const WEATHER_FRAGMENT_HEADER = `
    uniform vec4 tileBounds;
    uniform float intensity;
    uniform float daylight;
    uniform float fogDensity;
    varying vec3 weatherPosition;

    bool outsideTile() {
      return any(lessThan(weatherPosition.xz, tileBounds.xy)) ||
        any(greaterThan(weatherPosition.xz, tileBounds.xy + tileBounds.zw));
    }
    float atmosphericVisibility() {
      float range = distance(cameraPosition, weatherPosition);
      return exp(-fogDensity * fogDensity * range * range);
    }
  `;

  const RAIN_FRAGMENT_SHADER = `
    ${WEATHER_FRAGMENT_HEADER}
    uniform float snowMode;
    varying vec2 rainUv;
    varying float dropOpacity;
    varying float hitHeight;

    void main() {
      if (outsideTile() || weatherPosition.y < hitHeight + 0.025) discard;
      float across = 1.0 - smoothstep(0.05, 0.5, abs(rainUv.x - 0.5));
      float along = smoothstep(0.0, 0.13, rainUv.y) * pow(1.0 - rainUv.y, 0.65);
      float flake = 1.0 - smoothstep(0.08, 0.5, length(rainUv - 0.5));
      float alpha = mix(across * along, flake, snowMode) * dropOpacity * intensity;
      alpha *= atmosphericVisibility() * mix(0.75, 0.65, snowMode);
      alpha *= smoothstep(1.2, 3.0, distance(cameraPosition, weatherPosition));
      vec3 color = mix(vec3(0.64, 0.78, 0.85), vec3(0.9, 0.94, 0.96), snowMode);
      color *= 0.35 + daylight * 0.65;
      gl_FragColor = vec4(color, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  const IMPACT_VERTEX_SHADER = `
    attribute vec4 seed;
    attribute vec3 shape;
    attribute float impactKind;
    uniform float time;
    varying vec2 impactUv;
    varying float impactAge;
    varying float impactOpacity;
    varying float surfaceIsRoof;
    varying float splashKind;
    varying vec3 weatherPosition;
    ${SURFACE_SHADER}
    ${FIELD_SHADER}

    void main() {
      vec2 point = fieldPosition(seed.xy, vec2(0.0));
      float ground = groundHeight(point);
      float surface = surfaceHeight(point);
      surfaceIsRoof = step(ground + 0.5, surface);
      impactAge = fract(time * (1.5 + seed.w * 0.045) + seed.z);
      float size = shape.x * 0.5;
      weatherPosition = vec3(point.x + position.x * size, surface + 0.065, point.y + position.y * size);
      if (impactKind > 0.5) {
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        weatherPosition = vec3(point.x, surface + 0.065, point.y) + right * position.x * size;
        weatherPosition.y += (position.y + 0.5) * size;
      }
      splashKind = impactKind;
      impactUv = uv * 2.0 - 1.0;
      impactOpacity = shape.z * fieldVisibility(point);
      gl_Position = projectionMatrix * viewMatrix * vec4(weatherPosition, 1.0);
    }
  `;

  const IMPACT_FRAGMENT_SHADER = `
    ${WEATHER_FRAGMENT_HEADER}
    varying vec2 impactUv;
    varying float impactAge;
    varying float impactOpacity;
    varying float surfaceIsRoof;
    varying float splashKind;

    void main() {
      if (outsideTile()) discard;
      float radius = length(impactUv);
      float spread = 0.08 + impactAge * 0.8;
      float ring = 1.0 - smoothstep(0.025, 0.095, abs(radius - spread));
      float angle = atan(impactUv.y, impactUv.x);
      float crown = pow(max(0.0, sin(angle * 7.0 + impactAge * 3.0)), 12.0);
      crown *= 1.0 - smoothstep(0.03, 0.12, abs(radius - spread * 0.7));
      float alpha = (ring * 0.5 + crown) * pow(1.0 - impactAge, 2.0);
      // Three short ballistic arcs accompany the expanding ground ring.
      if (splashKind > 0.5) {
        alpha = 0.0;
        for (int drop = -1; drop <= 1; drop++) {
          vec2 center = vec2(float(drop) * impactAge * 0.8,
            -0.85 + impactAge * (1.0 - impactAge) * 5.0);
          alpha += 1.0 - smoothstep(0.04, 0.12, length(impactUv - center));
        }
        alpha *= pow(1.0 - impactAge, 1.5);
      } else {
        // Avoid horizontal rings floating over a sloping roof.
        alpha *= mix(1.0, 0.18, surfaceIsRoof);
      }
      alpha *= impactOpacity * intensity;
      alpha *= atmosphericVisibility() * 0.32;
      gl_FragColor = vec4(vec3(0.58, 0.73, 0.78) * (0.4 + daylight * 0.6), alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  const MIST_VERTEX_SHADER = `
    attribute vec4 seed;
    attribute vec3 shape;
    uniform float time;
    uniform vec2 wind;
    varying vec2 mistUv;
    varying vec3 weatherPosition;
    varying float mistOpacity;
    ${SURFACE_SHADER}
    ${FIELD_SHADER}

    void main() {
      vec2 drift = wind * time * 0.12;
      vec2 point = fieldPosition(seed.xy, drift);
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      float width = 16.0 + seed.w;
      float height = 2.0 + shape.x * 2.0;
      weatherPosition = vec3(point.x, surfaceHeight(point) + height * 0.45, point.y);
      weatherPosition += right * position.x * width + up * position.y * height;
      mistUv = uv;
      mistOpacity = fieldVisibility(point);
      mistOpacity *= 0.6 + sin(time * 0.25 + seed.z * 20.0) * 0.2;
      gl_Position = projectionMatrix * viewMatrix * vec4(weatherPosition, 1.0);
    }
  `;

  const MIST_FRAGMENT_SHADER = `
    ${WEATHER_FRAGMENT_HEADER}
    uniform float time;
    varying vec2 mistUv;
    varying float mistOpacity;

    void main() {
      if (outsideTile()) discard;
      vec2 point = (mistUv - 0.5) * 2.0;
      float edge = exp(-dot(point * vec2(1.5, 2.0), point * vec2(1.5, 2.0))) - 0.018;
      float billow = 0.65 + sin(point.x * 7.0 + time * 0.6 + sin(point.y * 6.0)) * 0.2;
      float alpha = max(0.0, edge) * billow * mistOpacity * intensity * 0.09;
      alpha *= atmosphericVisibility();
      gl_FragColor = vec4(vec3(0.52, 0.64, 0.68) * (0.4 + daylight * 0.6), alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  function createInstances(count, random, splash = false) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
        3,
      ),
    );
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2),
    );
    if (splash) {
      for (const name of ['position', 'uv']) {
        const attribute = geometry.getAttribute(name);
        const values = new Float32Array(attribute.array.length * 2);
        values.set(attribute.array);
        values.set(attribute.array, attribute.array.length);
        geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
      }
      geometry.setAttribute(
        'impactKind',
        new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], 1),
      );
    }
    const seeds = [];
    const shapes = [];
    const fields = [];
    for (let index = 0; index < count; index++) {
      seeds.push(random(), random(), random(), 12 + random() * 11);
      // Interleave layers so lower quality keeps a sample of every field.
      const layer = index % 10;
      fields.push(
        layer < 4 ? FIELD_SIZES.near : layer < 9 ? FIELD_SIZES.middle : FIELD_SIZES.distant,
      );
      shapes.push(0.7 + random() * 1.25, 0.018 + random() * 0.028, 0.4 + random() * 0.6);
    }
    geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 4));
    geometry.setAttribute('shape', new THREE.InstancedBufferAttribute(new Float32Array(shapes), 3));
    geometry.setAttribute(
      'fieldSpan',
      new THREE.InstancedBufferAttribute(new Float32Array(fields), 1),
    );
    geometry.instanceCount = count;
    return geometry;
  }

  class WeatherEffects {
    constructor(world) {
      this.world = world;
      this.wetness = { value: 0 };
      this.rainAmount = 0;
      this.snowAmount = 0;
      this.roofTimer = 0;
      this.roofs = [];
      this.roofMaterialCache = new Map();
      this.ownedRoofMaterials = new Set();
      this.roofFootprints = Array.from({ length: MAX_ROOFS }, () => new THREE.Vector4());
      this.roofProfiles = Array.from({ length: MAX_ROOFS }, () => new THREE.Vector4());
      const { texture, extent } = this.createGroundMap();
      this.groundMap = texture;
      const size = world.terrain.geometry.parameters.width;
      this.uniforms = {
        time: { value: 0 },
        snowMode: { value: 0 },
        intensity: { value: 0 },
        daylight: { value: 1 },
        fogDensity: { value: 0.002 },
        anchor: { value: new THREE.Vector2() },
        viewDistance: { value: 210 },
        wind: { value: new THREE.Vector2() },
        fallHeight: { value: 38 },
        pixelWorldSize: { value: 0.2 },
        groundMap: { value: texture },
        groundExtent: { value: extent },
        tileBounds: { value: new THREE.Vector4(-size / 2, -size / 2, size, size) },
        roofCount: { value: 0 },
        roofFootprint: { value: this.roofFootprints },
        roofProfile: { value: this.roofProfiles },
      };
      const random = Model.seeded(world.sim.state.config.seed + ':precipitation');
      this.rain = this.createMesh(
        createInstances(RAIN_CAPACITY, random),
        RAIN_VERTEX_SHADER,
        RAIN_FRAGMENT_SHADER,
      );
      this.rain.name = 'Wind-driven precipitation';
      // Shared surface and weather uniforms; impacts fade with liquid rain only.
      this.impactUniforms = { ...this.uniforms, intensity: { value: 0 } };
      this.impacts = this.createMesh(
        createInstances(IMPACT_CAPACITY, random, true),
        IMPACT_VERTEX_SHADER,
        IMPACT_FRAGMENT_SHADER,
        this.impactUniforms,
      );
      this.impacts.name = 'Rain impact crowns and rings';
      this.mist = this.createMesh(
        createInstances(72, random),
        MIST_VERTEX_SHADER,
        MIST_FRAGMENT_SHADER,
        this.impactUniforms,
      );
      this.mist.name = 'Wind-blown ground spray';
      this.mist.renderOrder = 2;
      world.scene.add(this.rain, this.impacts, this.mist);
      this.installWetGround();
      this.setQuality('high');
    }

    createMesh(geometry, vertexShader, fragmentShader, uniforms = this.uniforms) {
      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      // Particle positions are computed in world space by the vertex shader.
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 3;
      return mesh;
    }

    createGroundMap() {
      const geometry = this.world.terrain.geometry;
      const positions = geometry.attributes.position;
      const columns = geometry.parameters.widthSegments + 1;
      const rows = geometry.parameters.heightSegments + 1;
      const step = geometry.parameters.width / (columns - 1);
      const bytes = new Uint8Array(columns * rows * 4);
      for (let index = 0; index < positions.count; index++) {
        const height = Math.max(0.02, positions.getY(index));
        const packed = Math.round((height + 64) * 128);
        bytes[index * 4] = packed >> 8;
        bytes[index * 4 + 1] = packed & 255;
        bytes[index * 4 + 3] = 255;
      }
      const texture = new THREE.DataTexture(bytes, columns, rows);
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return {
        texture,
        extent: new THREE.Vector4(
          -geometry.parameters.width / 2 - step / 2,
          -geometry.parameters.height / 2 - step / 2,
          columns * step,
          rows * step,
        ),
      };
    }

    refreshRoofs() {
      const world = this.world;
      const candidates = [];
      world.scene.traverse((object) => {
        if (!object.userData.rainRoof) {
          return;
        }
        let parent = object;
        while (parent) {
          if (!parent.visible && parent !== world.hallRoofs) {
            return;
          }
          parent = parent.parent;
        }
        candidates.push(object);
      });
      candidates.sort((a, b) => {
        const first = a.getWorldPosition(new THREE.Vector3());
        const second = b.getWorldPosition(new THREE.Vector3());
        return first.distanceToSquared(world.target) - second.distanceToSquared(world.target);
      });
      this.roofs = candidates.slice(0, MAX_ROOFS);
      const scale = new THREE.Vector3();
      const point = new THREE.Vector3();
      this.roofs.forEach((roof, index) => {
        roof.updateWorldMatrix(true, false);
        roof.getWorldPosition(point);
        roof.getWorldScale(scale);
        const profile = roof.userData.rainRoof;
        const angle = Math.atan2(-roof.matrixWorld.elements[2], roof.matrixWorld.elements[0]);
        this.roofFootprints[index].set(
          point.x,
          point.z,
          (profile.width * scale.x) / 2,
          (profile.depth * scale.z) / 2,
        );
        this.roofProfiles[index].set(
          point.y + profile.eave * scale.y,
          profile.rise * scale.y,
          Math.cos(angle),
          Math.sin(angle),
        );
      });
      this.uniforms.roofCount.value = this.roofs.length;
      for (const roof of this.roofs) {
        roof.traverse((object) => {
          if (!object.isMesh || !object.material || object.userData.indoorLining) {
            return;
          }
          object.material = Array.isArray(object.material)
            ? object.material.map((material) => this.wetRoofMaterial(material))
            : this.wetRoofMaterial(object.material);
        });
      }
    }

    wetRoofMaterial(original) {
      if (
        !original.isMeshStandardMaterial ||
        this.ownedRoofMaterials.has(original) ||
        original.userData.vinlandWetRoof
      ) {
        return original;
      }
      if (this.roofMaterialCache.has(original)) {
        return this.roofMaterialCache.get(original);
      }
      // Clone per world: shared building materials must not retain wetness from
      // another campaign or darken sheltered interiors using the same material.
      const material = original.clone();
      material.userData.vinlandWetRoof = true;
      const previous = original.onBeforeCompile;
      const wetness = this.wetness;
      material.onBeforeCompile = function (shader, renderer) {
        previous.call(this, shader, renderer);
        shader.uniforms.uRoofWetness = wetness;
        shader.fragmentShader = 'uniform float uRoofWetness;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.86, uRoofWetness);',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.52, uRoofWetness);',
        );
      };
      material.customProgramCacheKey = () => 'vinland-wet-roof-v1';
      this.roofMaterialCache.set(original, material);
      this.ownedRoofMaterials.add(material);
      return material;
    }

    surfaceHeight(x, z) {
      let height = Math.max(0.02, Model.elevation(x, z, this.world.sim.state.config));
      this.roofs.forEach((roof, index) => {
        const footprint = this.roofFootprints[index];
        const profile = this.roofProfiles[index];
        const dx = x - footprint.x;
        const dz = z - footprint.y;
        const localX = profile.z * dx - profile.w * dz;
        const localZ = profile.w * dx + profile.z * dz;
        if (Math.abs(localX) < footprint.z && Math.abs(localZ) < footprint.w) {
          height = Math.max(height, profile.x + profile.y * (1 - Math.abs(localX) / footprint.z));
        }
      });
      return height;
    }

    installWetGround() {
      const material = this.world.terrain.material;
      const previous = material.onBeforeCompile;
      const wetness = this.wetness;
      material.onBeforeCompile = function (shader, renderer) {
        previous.call(this, shader, renderer);
        shader.uniforms.uWetness = wetness;
        shader.fragmentShader = 'uniform float uWetness;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `
          #include <color_fragment>
          diffuseColor.rgb *= mix(1.0, 0.72, uWetness);
        `,
        );
      };
      material.customProgramCacheKey = () => 'vinland-snow-and-wet-ground-v2';
      material.needsUpdate = true;
    }

    setQuality(quality) {
      this.rain.geometry.instanceCount = quality === 'low' ? 3200 : RAIN_CAPACITY;
      this.impacts.geometry.instanceCount = quality === 'low' ? 450 : IMPACT_CAPACITY;
      this.mist.geometry.instanceCount = quality === 'low' ? 24 : 72;
    }

    update(deltaSeconds, elapsedSeconds, weather, daylight) {
      const world = this.world;
      const liquid = weather.rain && !weather.snow;
      const target = liquid ? (weather.gale ? 1 : 0.62) : 0;
      const blend = 1 - Math.exp(-deltaSeconds * 1.6);
      this.rainAmount += (target - this.rainAmount) * blend;
      this.snowAmount += ((weather.snow ? 0.8 : 0) - this.snowAmount) * blend;
      const wetTarget = liquid ? 1 : 0;
      const wetSpeed = liquid ? 0.12 : 0.018;
      this.wetness.value +=
        (wetTarget - this.wetness.value) * (1 - Math.exp(-deltaSeconds * wetSpeed));
      this.rain.visible = this.rainAmount > 0.005 || this.snowAmount > 0.005;
      this.mist.visible = this.rainAmount > 0.1 && (world.view === 'walk' || world.distance < 500);
      this.impacts.visible =
        this.rainAmount > 0.02 && (world.view === 'walk' || world.distance < 700);
      this.uniforms.intensity.value = Math.max(this.rainAmount, this.snowAmount);
      this.impactUniforms.intensity.value = this.rainAmount;
      this.uniforms.snowMode.value = weather.snow ? 1 : 0;
      this.uniforms.time.value = elapsedSeconds;
      this.uniforms.daylight.value = daylight;
      this.uniforms.fogDensity.value = world.scene.fog.density;
      this.uniforms.anchor.value.set(world.target.x, world.target.z);
      this.uniforms.viewDistance.value = world.view === 'walk' ? 0 : world.distance;
      this.uniforms.pixelWorldSize.value =
        world.view === 'district' ? (world.distance * 0.7) / Math.max(1, world.h) : 0;
      this.uniforms.fallHeight.value = 42;
      const gust =
        0.85 + Math.sin(elapsedSeconds * 0.48) * 0.12 + Math.sin(elapsedSeconds * 1.3) * 0.06;
      const wind = Math.min(7, weather.wind / 8) * gust;
      this.uniforms.wind.value.set(wind * 0.82, wind * 0.57);
      // Use the precipitation direction for the sea as well. The simulation
      // supplies wind speed, but has no changing compass direction yet.
      const coastal = world.coastalUniforms;
      const seaTarget = THREE.MathUtils.clamp(weather.wind / 50, 0, 1);
      coastal.windStrength.value +=
        (seaTarget - coastal.windStrength.value) * (1 - Math.exp(-deltaSeconds * 0.18));
      if (wind > 0.001) coastal.windDirection.value.copy(this.uniforms.wind.value).normalize();
      coastal.rainWetness.value = this.wetness.value;
      this.roofTimer -= deltaSeconds;
      if (this.roofTimer <= 0) {
        this.refreshRoofs();
        this.roofTimer = 0.4;
      }
      world.water.material.uniforms.rainIntensity.value = this.rainAmount;
    }

    dispose() {
      for (const mesh of [this.rain, this.impacts, this.mist]) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      this.groundMap.dispose();
      for (const material of this.ownedRoofMaterials) {
        material.dispose();
      }
    }
  }

  root.VinlandWeather = { WeatherEffects };
})(window);
