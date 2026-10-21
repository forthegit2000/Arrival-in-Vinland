/**
 * BaseWorld: terrain, buildings, shared geometry, and renderer helpers.
 * Instantiate the final World class exported by controls.js, not this base.
 * The constructor calls buildScene() and bindControls() on the derived instance;
 * those methods must be safe before the constructor's final resize and sync.
 * Coordinates and model dimensions use metres; y is up, x/z are ground axes.
 */
(function (root) {
  'use strict';

  const THREE = root.THREE;
  const Meadows = root.VinlandMeadows;
  if (!THREE) {
    return;
  }
  const WATER_VERTEX_SHADER = `
    varying vec3 worldPosition;

    void main() {
      worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const WATER_FRAGMENT_SHADER = `
    varying vec3 worldPosition;
    uniform float time;
    uniform vec3 sun;
    uniform bool useMeasuredShore;
    uniform highp sampler2D shoreMap;
    uniform vec4 shoreExtent;
    uniform float fogDensity;
    uniform vec3 fogColor;
    uniform float rainIntensity;
    uniform float windStrength;
    uniform vec2 windDirection;

    ${root.VinlandWaterShading.glsl}

    float shoreDistanceAt(vec2 point) {
      if (!useMeasuredShore) {
        float coastX = -83.0 + sin(point.y * 0.034) * 7.0 + sin(point.y * 0.093) * 2.0;
        return point.x - coastX - 1.8;
      }
      vec2 uv = (point - shoreExtent.xy) / shoreExtent.zw;
      return texture2D(shoreMap, uv).r;
    }

    float brokenPattern(vec2 point) {
      return 0.5 + 0.25 * sin(point.x * 1.7 + sin(point.y * 0.9))
        + 0.25 * sin(point.y * 2.3 - sin(point.x * 0.7));
    }

    void main() {
      vec2 point = worldPosition.xz;
      float signedDistance = shoreDistanceAt(point);
      if (signedDistance > 0.0) discard;
      float offshore = max(0.0, -signedDistance);
      vec2 gradient = vec2(
        shoreDistanceAt(point + vec2(2.0, 0.0)) - shoreDistanceAt(point - vec2(2.0, 0.0)),
        shoreDistanceAt(point + vec2(0.0, 2.0)) - shoreDistanceAt(point - vec2(0.0, 2.0))
      );
      vec2 inland = length(gradient) > 0.001 ? normalize(gradient) : windDirection;
      float onshore = max(0.0, dot(windDirection, inland));
      float exposure = mix(0.22, 1.0, onshore);
      float surf = windStrength * exposure;
      vec2 alongWind = vec2(-windDirection.y, windDirection.x);
      float amplitude = mix(0.018, 0.27, windStrength);
      vec3 waves = waterWaveAt(point, windDirection, 12.0, amplitude, 1.8, time)
        + waterWaveAt(point, normalize(windDirection + alongWind * 0.42), 4.8, amplitude * 0.32, 2.7, time)
        + waterWaveAt(point, alongWind, 1.1, mix(0.003, 0.018, windStrength), 3.4, time);
      // Wave fronts turn to follow the shore in the last few metres.
      float nearShore = 1.0 - smoothstep(2.0, 18.0, offshore);
      float breakerPhase = offshore * 1.3 + time * 1.6;
      waves.xy = mix(waves.xy, -inland * cos(breakerPhase) * (0.015 + surf * 0.22), nearShore);
      waves.xy *= smoothstep(0.0, 0.6, offshore);
      vec3 normal = normalize(vec3(-waves.x, 1.0, -waves.y));

      // This is the existing modeled underwater apron, not surveyed bathymetry.
      float depth = 0.15 + min(4.0, offshore * 0.06);
      vec3 color = shadeNaturalWater(worldPosition, normal, depth, 1.0, sun, fogColor, windStrength, rainIntensity);
      color += waves.z * vec3(0.010, 0.018, 0.020);

      // Discontinuous, narrow wash: never a bright ribbon around the whole map.
      float washWidth = mix(0.8, 3.8, surf);
      float foamBand = (1.0 - smoothstep(washWidth, washWidth + 1.5, offshore))
        * smoothstep(0.0, 0.22, offshore);
      float crest = smoothstep(0.72, 0.99, sin(breakerPhase + brokenPattern(point * 0.3)));
      float fragments = smoothstep(0.42, 0.78, brokenPattern(point + inland * time * 0.12));
      float foam = foamBand * crest * fragments * (0.025 + surf * 0.32);
      color = mix(color, vec3(0.58, 0.63, 0.59) * waterDaylight(sun), foam);
      if (rainIntensity > 0.01) {
        float rippleVisibility = 1.0 - smoothstep(350.0, 850.0, distance(cameraPosition, worldPosition));
        color += waterRainRipples(worldPosition.xz, time) * rainIntensity * rippleVisibility * vec3(0.018, 0.025, 0.028);
      }

      // Match the scene's distance fog before Three.js applies output conversion.
      color = waterDistanceFog(color, worldPosition, fogColor, fogDensity);
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
  const createSeededRandom = (seed) => {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  };
  let random = createSeededRandom(1601005);
  let activeConfig = null;
  const TAU = Math.PI * 2;
  const Models = root.VinlandWorldModels;
  const { materials, geometries, createMaterial, addMesh, addBox } = Models;
  function terrainNoise(x, z) {
    return (
      Math.sin(x * 0.083 + Math.cos(z * 0.044) * 2) * Math.cos(z * 0.093) * 0.55 +
      Math.sin(x * 0.21 - z * 0.18) * 0.2 +
      Math.sin(x * 0.51 + z * 0.34) * 0.09
    );
  }
  function coast(z) {
    return root.VinlandModel.coast(z, activeConfig || root.VinlandModel.PRESETS.karlsefni);
  }
  function elevation(x, z) {
    return root.VinlandModel.elevation(x, z, activeConfig || root.VinlandModel.PRESETS.karlsefni);
  }
  function landDistance(x, z) {
    return root.VinlandModel.landDistance(x, z, activeConfig);
  }
  function texture(kind) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const context = c.getContext('2d');
    context.fillStyle = kind === 'turf' ? '#8d9562' : '#b6a88a';
    context.fillRect(0, 0, 256, 256);
    const rr = createSeededRandom(kind === 'turf' ? 983 : 234);
    for (let i = 0; i < 17000; i++) {
      const v = rr();
      context.fillStyle =
        kind === 'turf'
          ? v > 0.5
            ? 'rgba(36,57,29,.15)'
            : 'rgba(212,210,135,.15)'
          : v > 0.5
            ? 'rgba(72,62,43,.12)'
            : 'rgba(234,222,179,.15)';
      context.fillRect(rr() * 256, rr() * 256, kind === 'turf' ? 1 : 2, rr() * 5 + 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 6);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  materials.turf.map = texture('turf');
  materials.wall.map = materials.turf.map;
  materials.linen.map = texture('linen');
  const HALL_ROOMS = root.VinlandBuildingSpaces.HALL_ROOMS;

  class BaseWorld {
    constructor(container, simulation) {
      activeConfig = simulation.state.config;
      random = createSeededRandom(activeConfig.seed);
      this.container = container;
      this.sim = simulation;
      this.measuredTerrain = activeConfig.site === 'meadows';
      this.mapExtent = this.measuredTerrain
        ? { ...Meadows.bounds }
        : { minX: -125, minZ: -100, width: 230, depth: 200 };
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(this.measuredTerrain ? '#000000' : '#9baea2');
      this.scene.fog = new THREE.FogExp2('#a0b3a6', 0.00265);
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
      if (this.measuredTerrain) {
        const { minX, minZ, width, depth } = this.mapExtent;
        // Clip every standard material, including streams, clouds and weather,
        // to the same square. A 10 cm tolerance keeps coplanar cut faces stable.
        // The custom sea shader uses a tile-sized mesh.
        this.renderer.clippingPlanes = [
          new THREE.Plane(new THREE.Vector3(1, 0, 0), -minX + 0.1),
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), minX + width + 0.1),
          new THREE.Plane(new THREE.Vector3(0, 0, 1), -minZ + 0.1),
          new THREE.Plane(new THREE.Vector3(0, 0, -1), minZ + depth + 0.1),
        ];
      }
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.18;
      this.container.appendChild(this.renderer.domElement);
      this.camera = new THREE.PerspectiveCamera(39, 1, 0.5, this.measuredTerrain ? 10000 : 750);
      this.target = new THREE.Vector3(0, 1, 0);
      this.azimuth = 0.61;
      this.polar = 0.69;
      this.distance = 224;
      this.desiredDistance = 224;
      this.raycaster = new THREE.Raycaster();
      this.mouse = new THREE.Vector2();
      this.objects = new Map();
      this.smokes = [];
      this.fires = [];
      this.people = [];
      this.animals = [];
      this.ships = [];
      this.tents = [];
      this.elapsed = 0;
      this.cutaway = false;
      this.placing = null;
      this.pointer = {
        x: 0,
        y: 0,
        down: false,
        moved: false,
      };
      this.onSelect = () => {};
      this.onPlace = () => {};
      this.onInvalid = () => {};
      this.buildScene();
      this.bindControls();
      this.resize();
      this.sync();
      this.resizeHandler = () => this.resize();
      window.addEventListener('resize', this.resizeHandler);
    }

    buildScene() {
      const hemi = new THREE.HemisphereLight('#d6e2dc', '#747456', 2.4);
      this.scene.add(hemi);
      this.sun = new THREE.DirectionalLight('#ffe2ad', 3.6);
      this.sun.position.set(-70, 110, 40);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      Object.assign(this.sun.shadow.camera, {
        left: -140,
        right: 140,
        top: 140,
        bottom: -140,
        near: 1,
        far: 350,
      });
      this.sun.shadow.bias = -0.00025;
      this.sun.shadow.normalBias = 0.06;
      this.sun.shadow.radius = 3;
      this.scene.add(this.sun);
      this.scene.add(this.sun.target);
      this.buildTerrain();
      this.buildWater();
      this.buildVegetation();
      this.hall = this.buildHall();
      this.hall.position.y = elevation(0, 0);
      this.hall.rotation.y = this.measuredTerrain ? Meadows.hallRotation : 0;
      this.scene.add(this.hall);
      this.hall.userData.select = 'hall';
      this.shipPositions = [
        [-107, -45],
        [-109, -21],
        [-107, 3],
        [-112, 29],
      ];
      if (this.measuredTerrain) {
        this.shipPositions = this.shipPositions.map((_, index) => Meadows.anchorage(index));
      }
      this.shipPositions.forEach(([x, z], i) => {
        const s = this.buildKnarr(i);
        s.position.set(x, 0.08, z);
        s.rotation.y = -0.24 + i * 0.04;
        this.ships.push(s);
        this.scene.add(s);
      });
      this.tentPositions = [
        [-21, 19],
        [-30, 14],
        [-34, 3],
        [-28, -9],
        [-20, -20],
        [19, 19],
        [29, 14],
        [32, 3],
        [28, -9],
        [20, -19],
      ];
      this.tentPositions.forEach(([x, z], i) => {
        const tent = this.buildTent(i);
        tent.position.set(x, elevation(x, z), z);
        tent.rotation.y = Math.atan2(x, z) + 0.4;
        this.scene.add(tent);
        this.tents.push(tent);
      });
      const landing = new THREE.Group();
      this.landingSupplies = landing;
      const landingPoint = this.measuredTerrain ? Meadows.landing : [-72, -5];
      landing.position.set(landingPoint[0], elevation(...landingPoint), landingPoint[1]);
      this.scene.add(landing);
      for (let i = 0; i < 14; i++) {
        this.barrel(landing, random() * 7 - 3, 0, random() * 10 - 5, 0.7 + random() * 0.35);
      }
      for (let i = 0; i < 5; i++) {
        addBox(landing, -3 + random() * 6, 0.4, random() * 9 - 4, 1.1, 0.8, 0.9, materials.wood);
      }
      for (let i = 0; i < 160; i++) {
        const p = this.buildPerson(i);
        const angle = random() * TAU;
        const r = 15 + random() * 57;
        p.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        p.userData = {
          select: 'person',
          phase: random() * TAU,
          angle,
          r,
          speed: 0.025 + random() * 0.02,
          index: i,
        };
        this.people.push(p);
        this.scene.add(p);
      }
      for (let i = 0; i < 32; i++) {
        const a = this.buildAnimal(i < 8 ? 'cattle' : i < 20 ? 'sheep' : 'goat', i);
        a.userData = {
          phase: random() * TAU,
          index: i,
          ox: random() * 28 - 14,
          oz: random() * 18 - 9,
        };
        this.animals.push(a);
        this.scene.add(a);
      }
      this.buildClouds();
      this.buildBirds();
    }

    groundTexture() {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const context = c.getContext('2d');
      context.fillStyle = '#d2d2bb';
      context.fillRect(0, 0, 256, 256);
      const rr = createSeededRandom(580);
      for (let i = 0; i < 22000; i++) {
        context.fillStyle = rr() > 0.5 ? 'rgba(39,64,28,.13)' : 'rgba(235,227,181,.15)';
        context.fillRect(rr() * 256, rr() * 256, 1 + rr() * 3, 1 + rr() * 3);
      }
      for (let i = 0; i < 80; i++) {
        context.fillStyle = 'rgba(85,87,47,.04)';
        context.beginPath();
        context.ellipse(rr() * 256, rr() * 256, rr() * 30 + 5, rr() * 15 + 4, rr() * 6, 0, TAU);
        context.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(
        this.measuredTerrain ? this.mapExtent.width / 24 : 50,
        this.measuredTerrain ? this.mapExtent.depth / 24 : 50,
      );
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      return tex;
    }

    buildTerrain() {
      this.coastalUniforms = {
        windStrength: { value: 0 },
        windDirection: { value: new THREE.Vector2(0.82, 0.57).normalize() },
        rainWetness: { value: 0 },
      };
      const size = this.measuredTerrain ? this.mapExtent.width : 440;
      const segments = this.measuredTerrain ? size / 4 : 180;
      const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.attributes.position;
      const colors = [];
      const color = new THREE.Color();
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const h = elevation(x, z);
        positions.setY(i, h);
        const v = terrainNoise(x * 0.8, z * 0.8);
        const distanceFromWater = this.measuredTerrain
          ? Meadows.shoreDistance(x, z)
          : landDistance(x, z);
        if (distanceFromWater < 8) {
          color.set('#aba78b');
        } else if (h > 11) {
          color.set('#738466');
        } else if (
          this.measuredTerrain
            ? Meadows.freshwaterDistance(x, z) < 20 && h < 7
            : Math.sin(x * 0.04 + z * 0.05) > 0.58 && Math.hypot(x, z) > 35
        ) {
          color.set('#647758');
        } else {
          color.set('#738565');
        }
        color.multiplyScalar(0.92 + v * 0.12 + random() * 0.06);
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      if (this.measuredTerrain) root.VinlandFreshwater.refineTerrain(geometry, Meadows);
      else geometry.computeVertexNormals();
      this.terrain = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 1,
          map: this.groundTexture(),
        }),
      );
      this.terrain.receiveShadow = true;
      this.scene.add(this.terrain);
      if (this.measuredTerrain) {
        this.buildMapEdge();
      }
      const rockCount = this.measuredTerrain ? this.landscapeCount(4200) : 340;
      const rocks = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 1),
        this.coastalRockMaterial(),
        rockCount,
      );
      const dummy = new THREE.Object3D();
      const shoreDistances = new Float32Array(rockCount);
      for (let i = 0; i < rockCount; i++) {
        let x;
        let z;
        if (this.measuredTerrain) {
          ({ x, z } = this.landscapePoint());
          if (landDistance(x, z) < -3 || Math.hypot(x, z) < 18) {
            dummy.scale.setScalar(0);
            dummy.updateMatrix();
            rocks.setMatrixAt(i, dummy.matrix);
            continue;
          }
        } else if (i < 180) {
          z = random() * 290 - 145;
          x = coast(z) + random() * 13 - 4;
        } else {
          x = random() * 330 - 165;
          z = random() * 330 - 165;
        }
        shoreDistances[i] = this.measuredTerrain ? Meadows.shoreDistance(x, z) : landDistance(x, z);
        dummy.position.set(x, elevation(x, z), z);
        const s = 0.25 + random() * 1.3;
        dummy.scale.set(s * (0.8 + random()), s * 0.5, s);
        dummy.rotation.set(random(), random() * TAU, random());
        dummy.updateMatrix();
        rocks.setMatrixAt(i, dummy.matrix);
      }
      rocks.geometry.setAttribute(
        'coastDistance',
        new THREE.InstancedBufferAttribute(shoreDistances, 1),
      );
      rocks.name = 'Landscape rocks';
      rocks.userData.clearsForBuildings = true;
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      this.scene.add(rocks);
      if (this.measuredTerrain) this.buildShoreStones();
    }

    coastalRockMaterial() {
      const material = createMaterial('#8c9181');
      const coast = this.coastalUniforms;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.coastalWind = coast.windStrength;
        shader.uniforms.coastalRain = coast.rainWetness;
        shader.vertexShader =
          'attribute float coastDistance;\nvarying float stoneShoreDistance;\nvarying float stoneHeight;\n' +
          shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          stoneShoreDistance = coastDistance;
          stoneHeight = (modelMatrix * instanceMatrix * vec4(position, 1.0)).y;
        `,
        );
        shader.fragmentShader =
          'uniform float coastalWind;\nuniform float coastalRain;\nvarying float stoneShoreDistance;\nvarying float stoneHeight;\n' +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `
          #include <color_fragment>
          float sprayReach = mix(0.5, 2.3, coastalWind);
          float shoreWet = (1.0 - smoothstep(0.0, sprayReach, stoneShoreDistance))
            * (1.0 - smoothstep(0.06, 0.3 + coastalWind * 0.25, stoneHeight));
          float stoneWetness = max(shoreWet, coastalRain * 0.8);
          diffuseColor.rgb *= mix(1.0, 0.56, stoneWetness);
        `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, stoneWetness);',
        );
      };
      material.customProgramCacheKey = () => 'vinland-coastal-stone-v1';
      return material;
    }

    buildShoreStones() {
      const rng = createSeededRandom(52741);
      const placements = [];
      // Sample actual coastline segments at a steady metre spacing; no single
      // coast-X approximation can follow this map's bays and offshore islands.
      for (const line of Meadows.data.coast) {
        for (let index = 1; index < line.length; index++) {
          const a = line[index - 1],
            b = line[index];
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const steps = Math.ceil(length / 2.2);
          for (let step = 0; step < steps; step++) {
            const t = (step + rng()) / steps;
            const x = a[0] + (b[0] - a[0]) * t + (rng() - 0.5) * 2.5;
            const z = a[1] + (b[1] - a[1]) * t + (rng() - 0.5) * 2.5;
            if (!Meadows.containsPoint(x, z)) continue;
            const distance = Meadows.shoreDistance(x, z);
            if (distance < -1.8 || distance > 2.5 || Meadows.freshwaterDistance(x, z) < 2) continue;
            placements.push({ x, z, distance });
          }
        }
      }
      const geometry = new THREE.IcosahedronGeometry(1, 1);
      geometry.setAttribute(
        'coastDistance',
        new THREE.InstancedBufferAttribute(
          new Float32Array(placements.map((point) => point.distance)),
          1,
        ),
      );
      const stones = new THREE.InstancedMesh(
        geometry,
        this.coastalRockMaterial(),
        placements.length,
      );
      const dummy = new THREE.Object3D();
      placements.forEach((point, index) => {
        const size = 0.09 + Math.pow(rng(), 2) * 0.42;
        dummy.position.set(point.x, elevation(point.x, point.z) + size * 0.12, point.z);
        dummy.scale.set(size * (0.9 + rng() * 0.6), size * 0.45, size);
        dummy.rotation.set(rng() * 0.3, rng() * TAU, rng() * 0.3);
        dummy.updateMatrix();
        stones.setMatrixAt(index, dummy.matrix);
        stones.setColorAt(
          index,
          new THREE.Color().setHSL(0.12 + rng() * 0.06, 0.06 + rng() * 0.08, 0.38 + rng() * 0.16),
        );
      });
      stones.name = 'Shoreline stones';
      stones.receiveShadow = true;
      stones.userData.clearsForBuildings = true;
      this.shoreStones = stones;
      this.scene.add(stones);
    }

    buildWater() {
      const geometry = new THREE.PlaneGeometry(
        this.measuredTerrain ? this.mapExtent.width : 500,
        this.measuredTerrain ? this.mapExtent.depth : 650,
      );
      geometry.rotateX(-Math.PI / 2);
      const grid = Meadows.data.shore;
      // Store signed metres directly. Interpolating two packed byte channels
      // loses precision at byte boundaries and shifts the visible waterline.
      const pixels = new Uint16Array(grid.rows.length * grid.rows[0].length);
      grid.rows.forEach((row, z) =>
        row.forEach((distance, x) => {
          pixels[z * row.length + x] = THREE.DataUtils.toHalfFloat(
            Math.max(-512, Math.min(511, distance)),
          );
        }),
      );
      const shoreMap = new THREE.DataTexture(
        pixels,
        grid.rows[0].length,
        grid.rows.length,
        THREE.RedFormat,
        THREE.HalfFloatType,
      );
      shoreMap.minFilter = shoreMap.magFilter = THREE.LinearFilter;
      shoreMap.needsUpdate = true;
      const waterMaterial = new THREE.ShaderMaterial({
        uniforms: {
          rainIntensity: { value: 0 },
          windStrength: this.coastalUniforms.windStrength,
          windDirection: this.coastalUniforms.windDirection,
          fogDensity: { value: this.scene.fog.density },
          fogColor: { value: this.scene.fog.color.clone() },
          useMeasuredShore: { value: this.measuredTerrain },
          shoreMap: { value: shoreMap },
          shoreExtent: {
            value: new THREE.Vector4(
              grid.minX - grid.step / 2,
              grid.minZ - grid.step / 2,
              grid.step * grid.rows[0].length,
              grid.step * grid.rows.length,
            ),
          },
          time: {
            value: 0,
          },
          sun: {
            value: new THREE.Vector3(-0.5, 0.8, 0.4),
          },
        },
        vertexShader: WATER_VERTEX_SHADER,
        fragmentShader: WATER_FRAGMENT_SHADER,
        side: THREE.DoubleSide,
      });
      this.water = new THREE.Mesh(geometry, waterMaterial);
      this.water.position.set(this.measuredTerrain ? 0 : -235, 0.02, 0);
      this.water.castShadow = false;
      this.water.receiveShadow = false;
      this.scene.add(this.water);
      if (this.measuredTerrain) {
        this.buildMappedFreshwater();
      }
    }

    buildMappedFreshwater() {
      this.freshwater = root.VinlandFreshwater.create(Meadows, this.water.material.uniforms);
      this.scene.add(this.freshwater);
    }

    landscapePoint() {
      const { minX, minZ, width, depth } = this.mapExtent;
      return { x: minX + random() * width, z: minZ + random() * depth };
    }

    landscapeCount(originalCount) {
      // Preserve vegetation and rock density as the measured tile grows.
      const originalArea = 1440 * 1440;
      return Math.round(
        (originalCount * this.mapExtent.width * this.mapExtent.depth) / originalArea,
      );
    }

    woodlandSuitable(x, z) {
      // Habitat is modeled, rather than a claim of mapped AD 1005 vegetation.
      // Leave wind-exposed shores, wet ground and the occupied camp open.
      return (
        landDistance(x, z) > 18 &&
        Math.hypot(x, z) > 54 &&
        (!this.measuredTerrain ||
          (Math.abs(x) < this.mapExtent.width / 2 - 4 &&
            Math.abs(z) < this.mapExtent.depth / 2 - 4 &&
            Meadows.freshwaterDistance(x, z) > 14 &&
            terrainNoise(x * 0.09, z * 0.09) > 0.05))
      );
    }

    buildMapEdge() {
      const { minX, minZ, width, depth } = this.mapExtent;
      const corners = [
        [minX, minZ],
        [minX + width, minZ],
        [minX + width, minZ + depth],
        [minX, minZ + depth],
      ];
      const vertices = [];
      const rim = [];
      const bottom = -12;
      for (let side = 0; side < 4; side++) {
        const start = corners[side];
        const end = corners[(side + 1) % 4];
        const steps = Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 4);
        const point = (step) => {
          const x = start[0] + ((end[0] - start[0]) * step) / steps;
          const z = start[1] + ((end[1] - start[1]) * step) / steps;
          return [x, Math.max(0.02, elevation(x, z)), z];
        };
        for (let step = 0; step < steps; step++) {
          const a = point(step);
          const b = point(step + 1);
          const lowA = [a[0], bottom, a[2]];
          const lowB = [b[0], bottom, b[2]];
          vertices.push(...a, ...lowA, ...b, ...b, ...lowA, ...lowB);
          rim.push(a[0], a[1] + 0.06, a[2], b[0], b[1] + 0.06, b[2]);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      this.mapEdge = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: '#27302b',
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      this.mapEdge.name = 'Map tile cut edge';
      const rimGeometry = new THREE.BufferGeometry();
      rimGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
      this.scene.add(
        this.mapEdge,
        new THREE.LineSegments(
          rimGeometry,
          new THREE.LineBasicMaterial({ color: '#879080', fog: false }),
        ),
      );
    }

    buildVegetation() {
      const dummy = new THREE.Object3D();
      const placements = [];
      const treeAttempts = this.measuredTerrain ? this.landscapeCount(20000) : 1050;
      for (let i = 0; i < treeAttempts; i++) {
        const { x, z } = this.measuredTerrain
          ? this.landscapePoint()
          : { x: random() * 350 - 160, z: random() * 330 - 160 };
        if (this.measuredTerrain && !this.woodlandSuitable(x, z)) {
          continue;
        }
        if (landDistance(x, z) < 18 || Math.hypot(x, z) < 54 || (x < -40 && Math.abs(z) < 43)) {
          continue;
        }
        const edge = Math.hypot(x, z);
        if (edge < 75 && random() > 0.3) {
          continue;
        }
        placements.push({
          x,
          z,
          h: 5 + random() * 7,
          s: 0.75 + random() * 0.9,
        });
      }
      this.treePlacements = placements;
      const trunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.15, 0.26, 1, 6),
        materials.darkwood,
        placements.length,
      );
      this.coniferTrunks = trunks;
      const greens = ['#4c6650', '#547158', '#627b58', '#5d7250'];
      const count = placements.length * 4;
      const crowns = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1, 1, 9, 2),
        createMaterial('#607550'),
        count,
      );
      this.coniferCrowns = crowns;
      placements.forEach(({ x, z, h, s }, i) => {
        const y = elevation(x, z);
        dummy.position.set(x, y + h * 0.38, z);
        dummy.scale.set(s, h * 0.76, s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        for (let j = 0; j < 4; j++) {
          dummy.position.set(
            x + Math.sin(i + j) * 0.14,
            y + h * (0.36 + j * 0.155),
            z + Math.cos(i + j) * 0.14,
          );
          dummy.scale.set(s * (1.6 - j * 0.27), h * 0.38, s * (1.6 - j * 0.27));
          dummy.rotation.y = i;
          dummy.updateMatrix();
          crowns.setMatrixAt(i * 4 + j, dummy.matrix);
          crowns.setColorAt(
            i * 4 + j,
            new THREE.Color(greens[i % 4]).multiplyScalar(0.9 + random() * 0.2),
          );
        }
      });
      trunks.userData.clearsForBuildings = true;
      crowns.userData.clearsForBuildings = true;
      trunks.castShadow = true;
      crowns.castShadow = true;
      crowns.receiveShadow = true;
      this.scene.add(trunks, crowns);
      const grassCount = this.measuredTerrain ? this.landscapeCount(48000) : 11000;
      const grass = new THREE.InstancedMesh(
        new THREE.ConeGeometry(0.14, 0.55, 3),
        createMaterial('#819563'),
        grassCount,
      );
      grass.name = 'Ground grass';
      grass.userData.clearsForBuildings = true;
      for (let i = 0; i < grassCount; i++) {
        const { x, z } = this.measuredTerrain
          ? this.landscapePoint()
          : { x: random() * 260 - 115, z: random() * 260 - 130 };
        const r = Math.hypot(x, z);
        const exclude = landDistance(x, z) < 2 || r < 15;
        dummy.position.set(x, elevation(x, z) + 0.15, z);
        dummy.scale.set(1, 1 + random() * 1.8, 1);
        if (exclude) {
          dummy.scale.setScalar(0);
        }
        dummy.rotation.y = random() * TAU;
        dummy.updateMatrix();
        grass.setMatrixAt(i, dummy.matrix);
        grass.setColorAt(
          i,
          new THREE.Color().setHSL(
            0.18 + random() * 0.04,
            0.18 + random() * 0.17,
            0.35 + random() * 0.13,
          ),
        );
      }
      grass.receiveShadow = true;
      this.scene.add(grass);
      const shrubCount = this.measuredTerrain ? this.landscapeCount(6000) : 350;
      const shrub = new THREE.InstancedMesh(
        geometries.sphere,
        createMaterial('#6c8054'),
        shrubCount,
      );
      shrub.name = 'Ground shrubs';
      for (let i = 0; i < shrubCount; i++) {
        const { x, z } = this.measuredTerrain
          ? this.landscapePoint()
          : { x: random() * 235 - 80, z: random() * 260 - 130 };
        const r = Math.hypot(x, z);
        dummy.position.set(x, elevation(x, z) + 0.25, z);
        const s = 0.35 + random() * 0.8;
        dummy.scale.set(s, s * 0.6, s);
        if (r < 42 || landDistance(x, z) < 3) {
          dummy.scale.setScalar(0);
        }
        dummy.updateMatrix();
        shrub.setMatrixAt(i, dummy.matrix);
      }
      shrub.userData.clearsForBuildings = true;
      shrub.castShadow = true;
      this.scene.add(shrub);
    }

    barrel(parent, x, y, z, scale = 1) {
      const object = Models.createBarrel(x, y, z, scale);
      parent.add(object);
      return object;
    }

    roof(parent, x, z, w, d, height = 2.5, rise = 1.8, turf = true, smokeOpening = false) {
      const roof = Models.createRoof(x, z, w, d, height, rise, turf, smokeOpening);
      parent.add(roof);
      return roof;
    }

    hearth(parent, x, z, long = true) {
      const hearth = Models.createHearth(x, z, long);
      this.fires.push(hearth.userData.flame);
      parent.add(hearth);
      return hearth;
    }

    buildHall() {
      const hall = Models.createHall(HALL_ROOMS);
      this.hallWalls = hall.walls;
      this.hallInside = hall.inside;
      this.hallRoofs = hall.roofs;
      this.roomMeshes = hall.roomMeshes;
      for (const hearth of hall.hearths) this.fires.push(hearth.userData.flame);
      for (const source of hall.smokeSources) this.addSmoke(source.x, source.z, source.y);
      return hall.object;
    }

    addSmoke(x, z, y) {
      const count = 22;
      const geometry = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = x;
        pos[i * 3 + 1] = y + i * 0.45;
        pos[i * 3 + 2] = z;
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const context = c.getContext('2d');
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(190,195,178,.5)');
      gradient.addColorStop(1, 'rgba(190,195,178,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      const m = new THREE.PointsMaterial({
        size: 3.4,
        map: new THREE.CanvasTexture(c),
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        color: '#c9cabc',
      });
      const object = new THREE.Points(geometry, m);
      this.scene.add(object);
      this.smokes.push({
        o: object,
        x,
        z,
        y,
        seed: random() * 10,
      });
      return object;
    }

    buildTent(index) {
      return Models.createTent(index);
    }

    buildHull(length, width, deck = true) {
      return Models.createHull(length, width, deck);
    }

    buildKnarr(index) {
      const livestock =
        this.sim.state.ships[index]?.role === 'livestock' ||
        (!this.sim.state.arrival && index === 3);
      const model = Models.createKnarr({ livestock, arriving: !!this.sim.state.arrival, random });
      this.shipsSails ||= [];
      this.shipsSails.push(model.sail);
      return model.object;
    }

    buildAnimal(kind, index) {
      return root.VinlandCharacters.createLivestock(kind, index);
    }

    buildClouds() {
      const clouds = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({
        color: '#e1e4d4',
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
      });
      for (let i = 0; i < 25; i++) {
        const object = addMesh(
          geometries.sphere,
          m,
          clouds,
          random() * 500 - 250,
          65 + random() * 25,
          random() * 500 - 250,
          20 + random() * 30,
          2 + random() * 3,
          10 + random() * 20,
        );
        object.castShadow = false;
        object.receiveShadow = false;
      }
      this.clouds = clouds;
      this.scene.add(clouds);
    }

    buildBirds() {
      this.birds = [];
      const birdMat = createMaterial('#d2d5c7');
      for (let i = 0; i < 12; i++) {
        const bird = new THREE.Group();
        for (const side of [-1, 1]) {
          const wing = addBox(bird, side * 0.28, 0, 0, 0.55, 0.035, 0.14, birdMat);
          wing.rotation.z = side * 0.2;
        }
        this.birds.push(bird);
        this.scene.add(bird);
      }
    }

    buildGeneric(type) {
      const model = Models.createBuilding(
        type,
        root.VinlandModel.TYPES[type],
        root.VinlandBuildingSpaces.plan(type),
      );
      for (const hearth of model.hearths) this.fires.push(hearth.userData.flame);
      return model.object;
    }

    terrainSurfaceHeight(x, z) {
      return root.VinlandFreshwater.terrainHeight(this.terrain.geometry, x, z, elevation);
    }

    syncTurfGrounding(object, wallRoot, visible = true) {
      // Dress the existing wall footprint, rather than adding a stone footing
      // or a berm. The floor and authoritative collision plan stay untouched.
      let dressing = object.userData.turfGrounding;
      if (dressing) dressing.visible = visible;
      if (!visible) return;
      const signature = [...object.position.toArray(), object.rotation.y].join(':');
      if (dressing?.userData.signature === signature) return;
      object.updateWorldMatrix(true, false);
      const positions = [];
      const colors = [];
      const uvs = [];
      const wallColor = materials.wall.color;
      const point = new THREE.Vector3();
      const addTriangle = (a, b, c, shade) => {
        for (const vertex of [a, b, c]) {
          positions.push(vertex.x, vertex.y, vertex.z);
          colors.push(wallColor.r * shade, wallColor.g * shade, wallColor.b * shade);
          uvs.push(vertex.u / 3, vertex.y / 6);
        }
      };
      wallRoot.traverse((wall) => {
        if (!wall.userData.turfGroundWall) return;
        const { x, z } = wall.position;
        const halfWidth = wall.scale.x / 2;
        const halfDepth = wall.scale.z / 2;
        const corners = [
          { x: x - halfWidth, z: z - halfDepth },
          { x: x + halfWidth, z: z - halfDepth },
          { x: x + halfWidth, z: z + halfDepth },
          { x: x - halfWidth, z: z + halfDepth },
        ];
        for (let edge = 0; edge < corners.length; edge++) {
          const start = corners[edge];
          const end = corners[(edge + 1) % corners.length];
          const length = Math.hypot(end.x - start.x, end.z - start.z);
          const steps = Math.max(1, Math.ceil(length / 0.45));
          const outward = { x: (end.z - start.z) / length, z: -(end.x - start.x) / length };
          const columns = [];
          for (let index = 0; index <= steps; index++) {
            const fraction = index / steps;
            const localX = start.x + (end.x - start.x) * fraction;
            const localZ = start.z + (end.z - start.z) * fraction;
            // No random draws: detail must not change the seeded settlement or
            // flicker when syncing, loading, or rotating a building.
            const variation = Math.sin(localX * 7.13 + localZ * 5.71);
            const projection = 0.025 + (variation + 1) * 0.012;
            const px = localX + outward.x * projection;
            const pz = localZ + outward.z * projection;
            point.set(px, 0, pz).applyMatrix4(object.matrixWorld);
            const ground = this.terrainSurfaceHeight(point.x, point.z) - object.position.y;
            const top = Math.max(0.58, ground + 0.14) + variation * 0.012;
            const bottom = Math.min(-0.12, ground - 0.12);
            columns.push(
              [bottom, Math.max(bottom + 0.06, top - 0.42), top - 0.21, top].map((y, row) => ({
                x: px + outward.x * (row % 2) * 0.006,
                y,
                z: pz + outward.z * (row % 2) * 0.006,
                u: length * fraction,
              })),
            );
          }
          for (let index = 0; index < steps; index++) {
            for (let row = 0; row < 3; row++) {
              // Subtle course and block variation, not black mortar joints.
              const shade = 0.88 + row * 0.035 + Math.sin(index * 2.3 + edge + row * 4.1) * 0.035;
              const a = columns[index][row];
              const b = columns[index + 1][row];
              const c = columns[index + 1][row + 1];
              const d = columns[index][row + 1];
              addTriangle(a, c, b, shade);
              addTriangle(a, d, c, shade);
            }
          }
        }
      });
      if (!positions.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      if (dressing) {
        dressing.geometry.dispose();
        dressing.geometry = geometry;
      } else {
        const material = materials.wall.clone();
        material.color.set('#ffffff');
        material.vertexColors = true;
        dressing = new THREE.Mesh(geometry, material);
        dressing.name = 'Terrain-following turf courses';
        dressing.castShadow = dressing.receiveShadow = true;
        object.add(dressing);
        object.userData.turfGrounding = dressing;
      }
      dressing.userData.signature = signature;
    }

    sync() {
      const state = this.sim.state;
      this.tents.forEach((t, i) => (t.visible = i < Math.round(state.resources.tents)));
      const used = 4 - Math.round(state.resources.sails);
      this.shipsSails.forEach((s, i) => (s.visible = i >= used));
      const all = [...state.buildings, ...state.queue].filter(
        (order) => order.type !== 'restore' && !order.kind,
      );
      const active = new Set(all.map((b) => b.id));
      for (const [id, object] of this.objects) {
        if (!active.has(id)) {
          object.userData.turfGrounding?.geometry.dispose();
          this.scene.remove(object);
          this.objects.delete(id);
        }
      }
      for (const building of all) {
        let object = this.objects.get(building.id);
        if (object && object.userData.buildingType !== building.type) {
          object.userData.turfGrounding?.geometry.dispose();
          this.scene.remove(object);
          this.objects.delete(building.id);
          object = null;
        }
        if (!object) {
          object = this.buildGeneric(building.type);
          object.position.set(building.x, elevation(building.x, building.z), building.z);
          object.rotation.y = building.rotation;
          object.userData.buildingId = building.id;
          object.userData.buildingType = building.type;
          this.scene.add(object);
          this.objects.set(building.id, object);
        }
        object.position.set(building.x, elevation(building.x, building.z), building.z);
        object.rotation.y = building.rotation;
        const ratio = building.progress / building.hours;
        object.userData.roof.visible = ratio > 0.52;
        object.userData.base.scale.y = Math.max(0.18, Math.min(1, ratio * 2));
        object.userData.roof.scale.y = Math.min(1, Math.max(0.3, (ratio - 0.5) * 2));
        if (state.buildings.some((order) => order.id === building.id)) {
          object.userData.base.scale.y = 1;
          object.userData.roof.scale.y = 1;
        }
        this.syncTurfGrounding(object, object.userData.base, ratio >= 0.5);
      }
      this.syncTurfGrounding(this.hall, this.hallWalls);
      this.hallRoofs.visible = !this.cutaway;
      this.hallWalls.scale.y = this.cutaway ? 0.4 : 1;
    }

    toggleRoof() {
      this.cutaway = !this.cutaway;
      this.sync();
      return this.cutaway;
    }

    focus(x, z, dist = 80) {
      this.target.set(x, elevation(x, z) + 1, z);
      this.desiredDistance = dist;
    }

    resize() {
      this.w = this.container.clientWidth;
      this.h = this.container.clientHeight;
      this.renderer.setSize(this.w, this.h);
      this.camera.aspect = this.w / this.h;
      this.camera.updateProjectionMatrix();
      if (this.w < 650) {
        this.desiredDistance = 185;
      }
    }

    project(x, y, z) {
      const point = new THREE.Vector3(x, y, z).project(this.camera);
      return {
        x: (point.x * 0.5 + 0.5) * this.w,
        y: (-0.5 * point.y + 0.5) * this.h,
        visible: point.z < 1 && point.z > -1,
      };
    }

    pointFromMouse(event) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(this.mouse, this.camera);
      return this.raycaster.intersectObject(this.terrain)[0]?.point || null;
    }

    startPlacement(type) {
      this.endPlacement();
      this.placing = {
        type,
        rotation: 0,
        x: 0,
        z: 35,
        valid: false,
      };
      const d = root.VinlandModel.TYPES[type];
      const group = new THREE.Group();
      const fill = new THREE.Mesh(
        new THREE.BoxGeometry(d.w, 0.3, d.d),
        new THREE.MeshBasicMaterial({
          color: '#e3c78e',
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        }),
      );
      group.add(fill);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(d.w, 1, d.d)),
        new THREE.LineBasicMaterial({
          color: '#e3c78e',
        }),
      );
      edges.position.y = 0.5;
      group.add(edges);
      this.ghost = group;
      this.scene.add(group);
      this.renderer.domElement.style.cursor = 'crosshair';
      this.updateGhost();
    }

    rotatePlacement(angle) {
      if (this.placing) {
        this.placing.rotation += angle;
        this.updateGhost();
      }
    }

    updateGhost() {
      if (!this.placing) {
        return;
      }
      const placement = this.placing;
      placement.valid = this.canPlace(placement.type, placement.x, placement.z, placement.rotation);
      this.ghost.position.set(placement.x, elevation(placement.x, placement.z) + 0.2, placement.z);
      this.ghost.rotation.y = placement.rotation;
      this.ghost.children.forEach((object) =>
        object.material.color.set(placement.valid ? '#dcd69a' : '#d48c75'),
      );
    }

    endPlacement() {
      if (this.ghost) {
        this.scene.remove(this.ghost);
        this.ghost.traverse((object) => {
          object.geometry?.dispose();
          object.material?.dispose();
        });
      }
      this.ghost = null;
      this.placing = null;
      this.renderer.domElement.style.cursor = 'default';
    }

    drawMap(canvas) {
      const context = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      context.fillStyle = '#324b3d';
      context.fillRect(0, 0, w, h);
      const extent = this.mapExtent;
      const map = (x, z) => [
        ((x - extent.minX) / extent.width) * w,
        ((z - extent.minZ) / extent.depth) * h,
      ];
      if (this.measuredTerrain) {
        if (!this.mapBackground) {
          this.mapBackground = document.createElement('canvas');
          this.mapBackground.width = w;
          this.mapBackground.height = h;
          const background = this.mapBackground.getContext('2d');
          const pixels = background.createImageData(w, h);
          for (let row = 0; row < h; row++) {
            for (let column = 0; column < w; column++) {
              const x = extent.minX + ((column + 0.5) / w) * extent.width;
              const z = extent.minZ + ((row + 0.5) / h) * extent.depth;
              const sea = Meadows.shoreDistance(x, z);
              const fresh = sea > 0 && Meadows.freshwaterDistance(x, z) < 0;
              const color =
                sea < 0
                  ? [69, 104, 113]
                  : fresh
                    ? [83, 121, 126]
                    : sea < 6
                      ? [160, 156, 126]
                      : [101, 123, 88];
              const index = (row * w + column) * 4;
              pixels.data.set([...color, 255], index);
            }
          }
          background.putImageData(pixels, 0, 0);
        }
        context.drawImage(this.mapBackground, 0, 0);
      } else {
        context.fillStyle = '#52726a';
        context.beginPath();
        context.moveTo(0, 0);
        for (let z = -100; z <= 100; z += 5) {
          const p = map(coast(z), z);
          context.lineTo(...p);
        }
        context.lineTo(0, h);
        context.fill();
      }
      context.strokeStyle = '#81916c';
      context.lineWidth = 0.5;
      for (const r of [19, 37, 63]) {
        const center = map(0, 0);
        context.beginPath();
        context.ellipse(
          center[0],
          center[1],
          (r / extent.width) * w,
          (r / extent.depth) * h,
          0,
          0,
          TAU,
        );
        context.stroke();
      }
      context.fillStyle = '#879975';
      const rr = createSeededRandom(55);
      const forest = this.measuredTerrain
        ? this.treePlacements
        : Array.from({ length: 95 }, () => ({ x: rr() * 220 - 65, z: rr() * 200 - 100 }));
      for (const { x, z } of forest) {
        const sourceId = root.VinlandGathering?.sourceId('tree', x, z);
        if (
          this.sim.state.harvest?.nodes[sourceId]?.felled ||
          Math.hypot(x, z) < 54 ||
          landDistance(x, z) < 10
        ) {
          continue;
        }
        context.fillRect(...map(x, z), 1.5, 2);
      }
      const b = map(-7, -14);
      const end = map(7, 14);
      context.fillStyle = '#d9c28b';
      if (this.measuredTerrain) {
        context.beginPath();
        Meadows.data.hallFootprint.forEach(([x, z], index) => {
          const point = map(x, z);
          if (index === 0) {
            context.moveTo(...point);
          } else {
            context.lineTo(...point);
          }
        });
        context.fill();
      } else {
        context.fillRect(b[0], b[1], end[0] - b[0], end[1] - b[1]);
      }
      this.tents.forEach((t) => {
        if (t.visible) {
          const p = map(t.position.x, t.position.z);
          context.fillStyle = '#cec9a5';
          context.fillRect(p[0] - 1, p[1] - 1, 3, 3);
        }
      });
      [...this.sim.state.buildings, ...this.sim.state.queue].forEach((b) => {
        if (b.type === 'restore') {
          return;
        }
        const p = map(b.x, b.z);
        context.fillStyle = this.sim.state.queue.includes(b) ? '#d9a579' : '#bac69c';
        context.fillRect(p[0] - 2, p[1] - 2, 4, 4);
      });
      this.shipPositions.forEach(([x, z]) => {
        const p = map(x, z);
        context.fillStyle = '#c0ab88';
        context.fillRect(p[0] - 1, p[1] - 4, 2, 8);
      });
      context.fillStyle = '#d9cfaa';
      context.font = '20px system-ui';
      context.fillText('N', w - 20, 20);
      context.beginPath();
      context.moveTo(w - 13, 25);
      context.lineTo(w - 16, 33);
      context.lineTo(w - 10, 33);
      context.fill();
      context.strokeStyle = '#d9cfaa';
      context.beginPath();
      context.moveTo(8, h - 10);
      const scaleMetres = this.measuredTerrain ? 250 : 100;
      document.getElementById('map-scale').textContent = scaleMetres + ' m';
      context.lineTo(8 + (scaleMetres / extent.width) * w, h - 10);
      context.stroke();
      const focus = map(this.target.x, this.target.z);
      context.strokeStyle = '#e0d7b6';
      context.beginPath();
      context.arc(focus[0], focus[1], 6, 0, TAU);
      context.stroke();
      context.globalAlpha = 0.2;
      context.strokeRect(focus[0] - 18, focus[1] - 14, 36, 28);
      context.globalAlpha = 1;
    }
  }
  root.VinlandWorld = {
    BaseWorld,
    rooms: HALL_ROOMS,
    elevation,
    coast,
  };
})(window);
