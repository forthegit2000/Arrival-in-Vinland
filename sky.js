/** Camera-independent sky directions and a physically sized solar disc. No textures/network. */
(function (root) {
  'use strict';
  const THREE = root.THREE;
  const Solar = root.VinlandSolar;
  const smoothstep = THREE.MathUtils.smoothstep;

  const VERTEX_SHADER = /* glsl */ `
    uniform mat4 inverseProjection;
    uniform mat4 cameraWorld;
    varying vec3 viewDirection;
    void main() {
      vec4 cameraRay = inverseProjection * vec4(position.xy, 1.0, 1.0);
      viewDirection = mat3(cameraWorld) * cameraRay.xyz;
      gl_Position = vec4(position.xy, 1.0, 1.0);
    }
  `;
  const FRAGMENT_SHADER = /* glsl */ `
    uniform vec3 sunDirection;
    uniform float sunRadius;
    uniform float sunAltitude;
    uniform float daylight;
    uniform float twilight;
    uniform float overcast;
    uniform vec2 cloudOffset;
    varying vec3 viewDirection;

    float hash(vec2 point) {
      return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 point) {
      vec2 cell = floor(point);
      vec2 blend = fract(point);
      blend = blend * blend * (3.0 - 2.0 * blend);
      return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
                 mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), blend.x), blend.y);
    }
    float cloudCover(vec3 direction) {
      // Fixed angular sky field: walking or zooming never translates the sun/clouds.
      vec2 point = direction.xz / (max(0.08, direction.y) + 0.28) * 3.0 + cloudOffset;
      float field = noise(point) * 0.55 + noise(point * 2.1) * 0.28 + noise(point * 4.3) * 0.17;
      return smoothstep(0.57 - overcast * 0.30, 0.76 - overcast * 0.28, field) *
        smoothstep(-0.01, 0.12, direction.y);
    }
    void main() {
      vec3 direction = normalize(viewDirection);
      float height = pow(max(0.0, direction.y), 0.45);
      float towardSun = pow(max(0.0, dot(direction, sunDirection)), 5.0);
      float sunset = (1.0 - smoothstep(0.0, 18.0, sunAltitude)) * twilight;
      vec3 zenith = mix(vec3(0.002, 0.005, 0.014), vec3(0.065, 0.26, 0.56), daylight);
      vec3 horizon = mix(vec3(0.012, 0.023, 0.044), vec3(0.49, 0.68, 0.82), daylight);
      horizon = mix(horizon, vec3(0.7, 0.25, 0.08), sunset * towardSun * 0.7);
      vec3 color = mix(horizon, zenith, height);
      color += vec3(0.16, 0.10, 0.035) * towardSun * daylight * (1.0 - overcast);
      color = mix(color, mix(vec3(0.018, 0.025, 0.034), vec3(0.39, 0.46, 0.51), daylight), overcast * 0.86);
      float cloud = cloudCover(direction);
      vec3 cloudColor = mix(vec3(0.012, 0.018, 0.027), vec3(0.76, 0.81, 0.84), daylight);
      cloudColor = mix(cloudColor, vec3(0.36, 0.40, 0.45) * (0.1 + daylight * 0.9), overcast);
      color = mix(color, cloudColor, cloud * (0.76 + overcast * 0.2));

      // An angular disc, not a billboard scaled by zoom or distance. Soft glare
      // is separate; only the disc itself occupies the true solar diameter.
      float separation = atan(length(cross(direction, sunDirection)), dot(direction, sunDirection));
      float antialias = max(fwidth(separation), 0.00002);
      float disc = 1.0 - smoothstep(sunRadius - antialias, sunRadius + antialias, separation);
      float aboveHorizon = smoothstep(-0.0004, 0.0004, direction.y);
      float transmission = (1.0 - overcast * 0.985) * (1.0 - cloud * 0.97) * aboveHorizon;
      float glare = exp(-separation * separation / 0.00045) * 0.18;
      vec3 sunlight = mix(vec3(1.0, 0.27, 0.035), vec3(1.0, 0.94, 0.78), smoothstep(0.0, 15.0, sunAltitude));
      color += sunlight * (disc * 12.0 + glare) * transmission;
      // The lower hemisphere meets distant terrain fog without a hard sky seam.
      color = mix(color, horizon, 1.0 - smoothstep(-0.35, 0.0, direction.y));
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  class Sky {
    constructor(world) {
      this.world = world;
      this.uniforms = {
        inverseProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        sunRadius: { value: 0.00465 },
        sunAltitude: { value: 45 },
        daylight: { value: 1 },
        twilight: { value: 1 },
        overcast: { value: 0 },
        cloudOffset: { value: new THREE.Vector2() },
      };
      this.material = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        depthWrite: false,
        depthTest: false,
        fog: false,
      });
      this.material.extensions.derivatives = true;
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
      this.mesh.name = 'astronomical-sky';
      this.mesh.renderOrder = -10000;
      this.mesh.frustumCulled = false;
      this.mesh.raycast = () => {};
      world.scene.add(this.mesh);
      this.sunDirection = new THREE.Vector3();
      this.horizonColor = new THREE.Color();
      this.nightHorizon = new THREE.Color(0.012, 0.023, 0.044);
      this.dayHorizon = new THREE.Color(0.49, 0.68, 0.82);
      this.cloudHorizon = new THREE.Color(0.39, 0.46, 0.51);
    }

    update(elapsedSeconds, weather) {
      const world = this.world;
      this.solarPosition = Solar.forSimulation(world.sim);
      const solar = this.solarPosition;
      this.sunDirection.set(solar.direction.x, solar.direction.y, solar.direction.z);
      const altitude = solar.apparentElevationDegrees;
      this.daylight = smoothstep(altitude, -6, 12);
      const twilight = smoothstep(altitude, -12, 0);
      const overcast = weather.gale ? 0.98 : weather.rain || weather.snow ? 0.88 : 0;
      const uniforms = this.uniforms;
      uniforms.sunDirection.value.copy(this.sunDirection);
      uniforms.sunRadius.value = solar.angularRadius;
      uniforms.sunAltitude.value = altitude;
      uniforms.daylight.value = this.daylight;
      uniforms.twilight.value = twilight;
      uniforms.overcast.value = overcast;
      uniforms.cloudOffset.value.set(
        elapsedSeconds * weather.wind * 0.00008,
        elapsedSeconds * 0.0003,
      );
      world.camera.updateMatrixWorld(true);
      uniforms.inverseProjection.value.copy(world.camera.projectionMatrixInverse);
      uniforms.cameraWorld.value.copy(world.camera.matrixWorld);
      // Three.js skips only `visible === false`; camera type flags can be undefined.
      this.mesh.visible = world.view === 'walk' && !!world.camera.isPerspectiveCamera;
      this.horizonColor.copy(this.nightHorizon).lerp(this.dayHorizon, this.daylight);
      this.horizonColor.lerp(this.cloudHorizon, overcast * this.daylight * 0.86);
      return solar;
    }

    dispose() {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }
  root.VinlandSky = Sky;
})(window);
