const { startDefaultCampaign } = require('./browser-session.cjs');
/** Offline rendering checks for precipitation, roof cover and weather transitions. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const coast = await page.evaluate(() => {
      const world = Vinland.world,
        effects = world.weatherEffects;
      const uniforms = world.water.material.uniforms;
      const stored = {
        sun: uniforms.sun.value.clone(),
        time: uniforms.time.value,
        wind: uniforms.windStrength.value,
        fog: uniforms.fogDensity.value,
        rain: uniforms.rainIntensity.value,
      };
      const renderer = world.renderer,
        previous = renderer.getRenderTarget();
      const clear = renderer.getClearColor(new THREE.Color()),
        alpha = renderer.getClearAlpha();
      const resolution = 128,
        span = 160,
        center = VinlandMeadows.landing;
      const target = new THREE.WebGLRenderTarget(resolution, resolution);
      const camera = new THREE.OrthographicCamera(
        -span / 2,
        span / 2,
        span / 2,
        -span / 2,
        0.1,
        600,
      );
      camera.position.set(center[0], 300, center[1]);
      camera.up.set(0, 0, -1);
      camera.lookAt(center[0], 0, center[1]);
      const scene = new THREE.Scene(),
        water = world.water.clone();
      scene.add(water);
      const render = () => {
        renderer.setRenderTarget(target);
        renderer.setClearColor(0, 0);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(resolution * resolution * 4);
        renderer.readRenderTargetPixels(target, 0, 0, resolution, resolution, pixels);
        return pixels;
      };
      const alignmentSamples = [];
      let alignmentErrors = 0,
        seaPixels = 0,
        landPixels = 0,
        shallowSum = 0,
        shallowCount = 0,
        deepSum = 0,
        deepCount = 0;
      let windPixels = 0,
        animatedPixels = 0;
      try {
        uniforms.sun.value.set(0.2, 1, 0.2).normalize();
        uniforms.fogDensity.value = 0;
        uniforms.rainIntensity.value = 0;
        uniforms.time.value = 42;
        uniforms.windStrength.value = 0;
        const calm = render();
        uniforms.windStrength.value = 1;
        const storm = render();
        uniforms.time.value = 44;
        const later = render();
        for (let row = 0; row < resolution; row++)
          for (let column = 0; column < resolution; column++) {
            const index = (row * resolution + column) * 4;
            const x = center[0] + ((column + 0.5) / resolution - 0.5) * span;
            const z = center[1] + (0.5 - (row + 0.5) / resolution) * span;
            const distance = VinlandMeadows.shoreDistance(x, z);
            if (Math.abs(distance) > 0.12) {
              if (calm[index + 3] > 0 !== distance < 0) {
                alignmentErrors++;
                if (alignmentSamples.length < 10)
                  alignmentSamples.push({ x, z, distance, alpha: calm[index + 3] });
              }
              if (distance < 0) seaPixels++;
              else landPixels++;
            }
            const brightness = calm[index] + calm[index + 1] + calm[index + 2];
            if (distance < -2 && distance > -8) {
              shallowSum += brightness;
              shallowCount++;
            }
            if (distance < -55) {
              deepSum += brightness;
              deepCount++;
            }
            if (
              Math.abs(calm[index] - storm[index]) +
                Math.abs(calm[index + 1] - storm[index + 1]) +
                Math.abs(calm[index + 2] - storm[index + 2]) >
              3
            )
              windPixels++;
            if (
              Math.abs(later[index] - storm[index]) +
                Math.abs(later[index + 1] - storm[index + 1]) +
                Math.abs(later[index + 2] - storm[index + 2]) >
              3
            )
              animatedPixels++;
          }
      } finally {
        renderer.setRenderTarget(previous);
        renderer.setClearColor(clear, alpha);
        target.dispose();
        uniforms.sun.value.copy(stored.sun);
        uniforms.time.value = stored.time;
        uniforms.windStrength.value = stored.wind;
        uniforms.fogDensity.value = stored.fog;
        uniforms.rainIntensity.value = stored.rain;
      }
      const matrix = new THREE.Matrix4(),
        stones = world.shoreStones;
      let misplacedStones = 0;
      for (let index = 0; index < stones.count; index++) {
        stones.getMatrixAt(index, matrix);
        const x = matrix.elements[12],
          z = matrix.elements[14],
          distance = VinlandMeadows.shoreDistance(x, z);
        if (distance < -1.81 || distance > 2.51 || !VinlandMeadows.containsPoint(x, z))
          misplacedStones++;
      }
      const weather = { ...world.sim.weather, rain: false, snow: false, wind: 0 };
      effects.update(30, 42, weather, 1);
      const calmStrength = uniforms.windStrength.value;
      effects.update(30, 42, { ...weather, wind: 50 }, 1);
      const stormStrength = uniforms.windStrength.value;
      const windAlignment = uniforms.windDirection.value.dot(
        effects.uniforms.wind.value.clone().normalize(),
      );
      effects.update(1, 42, weather, 1);
      const settlingStrength = uniforms.windStrength.value;
      return {
        alignmentSamples,
        alignmentErrors,
        seaPixels,
        landPixels,
        shallowBrightness: shallowSum / shallowCount,
        deepBrightness: deepSum / deepCount,
        windPixels,
        animatedPixels,
        stones: stones.count,
        misplacedStones,
        calmStrength,
        stormStrength,
        settlingStrength,
        windAlignment,
      };
    });
    assert.equal(
      coast.alignmentErrors,
      0,
      'rendered water must follow the mapped shore: ' + JSON.stringify(coast),
    );
    assert.ok(coast.seaPixels > 1000 && coast.landPixels > 1000);
    assert.ok(
      coast.shallowBrightness > coast.deepBrightness + 20,
      'shallows must differ from deeper sea',
    );
    assert.ok(
      coast.windPixels > 100 && coast.animatedPixels > 100,
      'wind and time must visibly affect waves',
    );
    assert.ok(coast.windAlignment > 0.999);
    assert.ok(coast.stones > 100);
    assert.equal(coast.misplacedStones, 0);
    assert.ok(coast.calmStrength < 0.02 && coast.stormStrength > 0.98);
    assert.ok(
      coast.settlingStrength > coast.calmStrength && coast.settlingStrength < coast.stormStrength,
      'waves settle gradually',
    );
    await page.evaluate(() => {
      Vinland.setPaused(false);
      const simulation = Vinland.simulation;
      const weather = { ...simulation.weather, rain: true, snow: false, gale: true, wind: 46 };
      window.testWeather = weather;
      Object.defineProperty(simulation, 'weather', {
        configurable: true,
        get: () => window.testWeather,
      });
      Vinland.world.weatherEffects.wetness.value = 0.8;
      Vinland.world.focus(12, 20, 120);
    });
    await page.waitForTimeout(1500);
    const rain = await page.evaluate(() => {
      const world = Vinland.world;
      const effects = world.weatherEffects;
      effects.refreshRoofs();
      const roof = effects.roofFootprints[0];
      const profile = effects.roofProfiles[0];
      const ground = VinlandModel.elevation(roof.x, roof.y, world.sim.state.config);
      return {
        visible: effects.rain.visible,
        impacts: effects.impacts.visible,
        drops: effects.rain.geometry.instanceCount,
        roofCount: effects.roofs.length,
        coveredHeight: effects.surfaceHeight(roof.x, roof.y),
        roofHeight: profile.x + profile.y,
        ground,
        wetness: effects.wetness.value,
        waterRain: world.water.material.uniforms.rainIntensity.value,
      };
    });
    assert.equal(rain.visible, true);
    assert.equal(rain.impacts, true);
    assert.equal(rain.drops, 10000);
    assert.ok(rain.roofCount >= 10);
    assert.ok(rain.coveredHeight >= rain.roofHeight - 0.001);
    assert.ok(rain.coveredHeight > rain.ground + 1);
    assert.ok(rain.wetness > 0.8 && rain.waterRain > 0.5);
    const weatherMotion = () =>
      page.evaluate(() => {
        const world = Vinland.world,
          effects = world.weatherEffects;
        return {
          water: world.water.material.uniforms.time.value,
          rain: effects.uniforms.time.value,
          wind: world.coastalUniforms.windStrength.value,
          gust: effects.uniforms.wind.value.toArray(),
          intensity: effects.rainAmount,
          wetness: effects.wetness.value,
        };
      });
    await page.evaluate(() => Vinland.setPaused(true));
    const frozen = await weatherMotion();
    await page.waitForTimeout(400);
    assert.deepEqual(await weatherMotion(), frozen, 'rain and water remain frozen while paused');
    const resumed = await page.evaluate(() => {
      const world = Vinland.world;
      const camera = world.camera.position.clone();
      world.desiredDistance *= 0.9;
      world.update(0.05);
      const cameraMoved = camera.distanceTo(world.camera.position) > 0.001;
      const before = world.water.material.uniforms.time.value;
      Vinland.setPaused(false);
      world.update(0.05);
      return { cameraMoved, advance: world.water.material.uniforms.time.value - before };
    });
    assert.equal(resumed.cameraMoved, true, 'camera controls remain available while paused');
    assert.ok(Math.abs(resumed.advance - 0.05) < 1e-6, 'resume advances without a pause-time jump');
    // Compare actual rendered pixels with the particle draws disabled, keeping
    // terrain, lighting, camera and animation time identical in both renders.
    const changedPixels = await page.evaluate(() => {
      const world = Vinland.world;
      const effects = world.weatherEffects;
      const gl = world.renderer.getContext();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const before = new Uint8Array(width * height * 4);
      const after = new Uint8Array(before.length);
      world.renderer.render(world.scene, world.camera);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, before);
      effects.rain.visible = effects.impacts.visible = false;
      world.renderer.render(world.scene, world.camera);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, after);
      effects.rain.visible = effects.impacts.visible = true;
      let changed = 0;
      for (let index = 0; index < before.length; index += 4) {
        const difference =
          Math.abs(before[index] - after[index]) +
          Math.abs(before[index + 1] - after[index + 1]) +
          Math.abs(before[index + 2] - after[index + 2]);
        if (difference > 5) changed++;
      }
      return changed;
    });
    assert.ok(changedPixels > 1000, `rain must be visibly rendered (${changedPixels} pixels)`);
    // Freeze the clock and rendering camera while updating the weather for
    // different zoom distances. With LOD opacity and pixel width held constant,
    // identical pixels prove particles, impacts and spray keep their positions.
    const zoomStability = await page.evaluate(() => {
      const world = Vinland.world;
      const effects = world.weatherEffects;
      const renderer = world.renderer;
      const originalDistance = world.distance;
      const originalTime = effects.uniforms.time.value;
      const originalLight = effects.uniforms.daylight.value;
      const originalPixelSize = effects.uniforms.pixelWorldSize.value;
      const originalDetail = effects.uniforms.viewDistance.value;
      const camera = world.camera.clone();
      const target = new THREE.WebGLRenderTarget(512, 256);
      const previousTarget = renderer.getRenderTarget();
      const clearColor = renderer.getClearColor(new THREE.Color());
      const clearAlpha = renderer.getClearAlpha();
      const results = [];
      const render = (scene, distance) => {
        world.distance = distance;
        effects.update(0, originalTime, window.testWeather, originalLight);
        effects.uniforms.pixelWorldSize.value = originalPixelSize;
        effects.uniforms.viewDistance.value = originalDetail;
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(512 * 256 * 4);
        renderer.readRenderTargetPixels(target, 0, 0, 512, 256, pixels);
        return pixels;
      };
      try {
        for (const mesh of [effects.rain, effects.impacts, effects.mist]) {
          const scene = new THREE.Scene();
          const particle = new THREE.Mesh(mesh.geometry, mesh.material);
          particle.frustumCulled = false;
          scene.add(particle);
          const reference = render(scene, originalDistance);
          let visible = 0;
          for (let index = 0; index < reference.length; index += 4) {
            if (reference[index] + reference[index + 1] + reference[index + 2] > 0) visible++;
          }
          let changed = 0;
          for (const distance of [60, 240, 650]) {
            const pixels = render(scene, distance);
            for (let index = 0; index < pixels.length; index++) {
              if (pixels[index] !== reference[index]) changed++;
            }
          }
          results.push({ name: mesh.name, visible, changed });
        }
      } finally {
        world.distance = originalDistance;
        effects.update(0, originalTime, window.testWeather, originalLight);
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(clearColor, clearAlpha);
        target.dispose();
      }
      return results;
    });
    for (const result of zoomStability) {
      assert.ok(result.visible > 0, result.name + ' must render in the comparison');
      assert.equal(result.changed, 0, result.name + ' must not drift when zoom changes');
    }
    await page.screenshot({ path: '/tmp/vinland-rain-district.png' });
    await page.evaluate(() => {
      Vinland.world.weatherEffects.setQuality('low');
      // Enter walking from a far overview: close-range effects must return.
      Vinland.world.distance = Vinland.world.desiredDistance = 1800;
      Vinland.view('walk');
      Vinland.setPaused(false);
    });
    await page.waitForTimeout(1000);
    assert.equal(
      await page.evaluate(() => Vinland.world.weatherEffects.rain.geometry.instanceCount),
      3200,
    );
    assert.equal(await page.evaluate(() => Vinland.world.weatherEffects.impacts.visible), true);
    assert.equal(await page.evaluate(() => Vinland.world.weatherEffects.mist.visible), true);
    await page.screenshot({ path: '/tmp/vinland-rain-walk.png' });
    await page.evaluate(() => {
      window.testWeather = { ...window.testWeather, rain: true, snow: true, temp: -3 };
    });
    await page.waitForTimeout(3500);
    assert.equal(
      await page.evaluate(() => Vinland.world.weatherEffects.uniforms.snowMode.value),
      1,
    );
    assert.equal(await page.evaluate(() => Vinland.world.weatherEffects.impacts.visible), false);
    await page.screenshot({ path: '/tmp/vinland-weather-snow.png' });
    const wetBeforeDry = await page.evaluate(() => Vinland.world.weatherEffects.wetness.value);
    await page.evaluate(() => {
      window.testWeather = {
        ...window.testWeather,
        rain: false,
        snow: false,
        gale: false,
        temp: 12,
      };
    });
    await page.waitForTimeout(3500);
    assert.equal(await page.evaluate(() => Vinland.world.weatherEffects.rain.visible), false);
    const wetAfterDry = await page.evaluate(() => Vinland.world.weatherEffects.wetness.value);
    assert.ok(wetAfterDry < wetBeforeDry && wetAfterDry > 0.1, 'ground dries gradually');
    await page.evaluate(() => {
      Vinland.view('district');
      const world = Vinland.world;
      world.sim.state.time = 12;
      window.testWeather = {
        ...window.testWeather,
        rain: false,
        snow: false,
        gale: false,
        wind: 6,
      };
      world.coastalUniforms.windStrength.value = 0.12;
      world.weatherEffects.wetness.value = 0;
      world.weatherEffects.rainAmount = 0;
      world.weatherEffects.snowAmount = 0;
      world.azimuth = world.desiredAzimuth = 1.2;
      world.polar = 0.85;
      world.distance = world.desiredDistance = 115;
      world.focus(-76, 0, 115);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/vinland-coast-calm.png' });
    await page.evaluate(() => {
      window.testWeather = { ...window.testWeather, wind: 50, gale: true };
      Vinland.world.weatherEffects.update(20, Vinland.world.elapsed, window.testWeather, 1);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/vinland-coast-wind.png' });
    await page.evaluate(() => {
      Vinland.view('walk');
      Vinland.setPaused(true);
      const sim = Vinland.simulation,
        world = Vinland.world,
        point = { x: -72, z: -20, heading: -Math.PI / 2 };
      Object.assign(sim.state.leader, point);
      Object.assign(sim.state.people[0], point);
      world.agentPositions.set(0, { x: point.x, z: point.z });
      world.actorCollisions.set('person:0', { x: point.x, z: point.z, radius: 0.34 });
      world.previousWalkPose = world.currentWalkPose = null;
      world.walkYaw = -Math.PI / 2;
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/vinland-coast-walk.png' });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      JSON.stringify({
        result: 'PASS',
        coast,
        changedPixels,
        zoomStability,
        roofCount: rain.roofCount,
        offlineRequests: 0,
        errors,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
