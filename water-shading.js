/** Shared optical palette, sky reflection and small surface disturbances.
 * World coordinates are metres, normals point upward. These are visual
 * approximations, not a fluid or spectral light-transport simulation.
 */
(function (root) {
  'use strict';

  const glsl = `
    float waterDaylight(vec3 sunDirection) {
      return 0.12 + max(0.0, sunDirection.y) * 0.88;
    }

    float waterFresnel(vec3 normal, vec3 towardEye) {
      return 0.02 + 0.98 * pow(1.0 - max(0.0, dot(normal, towardEye)), 5.0);
    }

    float waterCoverage(float depth, float fresnel) {
      // Shallow water transmits the bed; grazing views reflect more of the sky.
      float absorption = 1.0 - exp(-max(0.0, depth) * 0.85);
      return clamp(fresnel + (1.0 - fresnel) * absorption, 0.035, 1.0);
    }

    vec3 shadeNaturalWater(vec3 position, vec3 normal, float depth, float opacity,
        vec3 sunDirection, vec3 skyColor, float wind, float rain) {
      vec3 towardEye = normalize(cameraPosition - position);
      float fresnel = waterFresnel(normal, towardEye);
      vec3 deep = vec3(0.025, 0.095, 0.135);
      vec3 shallow = vec3(0.105, 0.225, 0.235);
      vec3 body = mix(deep, shallow, exp(-max(0.0, depth) * 0.65));
      body *= waterDaylight(sunDirection);
      // Use one sky response for rivers, ponds and sea. No metallic lighting or
      // white diffuse layer: the bed supplies the colour of clear shallows.
      vec3 sky = mix(vec3(0.20, 0.31, 0.43), skyColor * 0.82, 0.65);
      sky *= 0.28 + max(0.0, sunDirection.y) * 0.72;
      vec3 color = mix(body, sky, clamp(fresnel / max(opacity, 0.035), 0.0, 1.0));
      float glint = pow(max(0.0, dot(reflect(-sunDirection, normal), towardEye)), mix(210.0, 90.0, wind));
      color += glint * vec3(0.33, 0.32, 0.27) * smoothstep(0.0, 0.12, sunDirection.y) * (1.0 - rain * 0.7);
      return color;
    }

    // Warped metre-scale wave phases, filtered before they become subpixel lines.
    vec3 waterWaveAt(vec2 point, vec2 direction, float wavelength, float amplitude, float speed, float time) {
      float frequency = 6.283185 / wavelength;
      float phase = dot(point, direction) * frequency - time * speed;
      phase += sin(point.x * 0.13 + point.y * 0.09) * 0.7
        + sin(point.y * 0.21 - point.x * 0.06) * 0.4;
      float resolved = 1.0 - smoothstep(0.5, 2.0, fwidth(phase));
      amplitude *= resolved;
      return vec3(direction * cos(phase) * amplitude * frequency, sin(phase) * amplitude);
    }

    float waterRainRipples(vec2 point, float time) {
      vec2 cell = floor(point / 1.7);
      float rings = 0.0;
      for (int x = -1; x <= 1; x++) {
        for (int z = -1; z <= 1; z++) {
          vec2 neighbor = cell + vec2(float(x), float(z));
          float seed = fract(sin(dot(neighbor, vec2(127.1, 311.7))) * 43758.5453);
          vec2 center = (neighbor + vec2(seed, fract(seed * 19.7))) * 1.7;
          float age = fract(time * (1.0 + seed) + seed * 9.0);
          float radius = distance(point, center);
          // The hashed drop centre jumps at cell boundaries. Bound its
          // derivative so antialiasing cannot draw bright grid lines there.
          float width = clamp(fwidth(radius), 0.012, 0.035);
          float ring = 1.0 - smoothstep(width, width * 2.5, abs(radius - age * 0.38));
          rings += ring * (1.0 - age) * smoothstep(0.0, 0.12, age);
        }
      }
      float resolved = 1.0 - smoothstep(0.08, 0.22, length(fwidth(point)));
      return rings * resolved;
    }

    vec3 waterDistanceFog(vec3 color, vec3 position, vec3 fogColor, float density) {
      float cameraRange = distance(cameraPosition, position);
      float fog = 1.0 - exp(-density * density * cameraRange * cameraRange);
      return mix(color, fogColor, fog);
    }
  `;

  root.VinlandWaterShading = { glsl };
})(window);
