const { startDefaultCampaign } = require('./browser-session.cjs');
/** Offline rendered sky, solar angular size, occlusion and camera independence. */
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
    const errors = [],
      requests = [];
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
    await page.evaluate(() => {
      Vinland.setPaused(true);
      Vinland.view('walk');
    });
    const result = await page.evaluate(() => {
      const world = Vinland.world,
        sim = Vinland.simulation;
      const weather = { ...sim.weather, rain: false, gale: false, snow: false, wind: 10 };
      const camera = world.camera;
      const sunMeasurements = [];
      function render() {
        world.renderer.render(world.scene, camera);
        const gl = world.renderer.getContext();
        const width = gl.drawingBufferWidth,
          height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return { pixels, width, height };
      }
      function aimAtSun() {
        const sun = VinlandSolar.forSimulation(sim);
        const direction = new THREE.Vector3(sun.direction.x, sun.direction.y, sun.direction.z);
        camera.lookAt(camera.position.clone().add(direction));
        world.updateLightingAndWeather(1, 0, weather);
        return sun;
      }
      sim.state.time = 12;
      camera.position.set(0, 50, 0);
      for (const fov of [39, 65]) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
        const sun = aimAtSun();
        const visible = render();
        world.sky.uniforms.sunRadius.value = 0;
        const withoutDisc = render();
        const y = Math.floor(visible.height / 2);
        let diameterPixels = 0;
        for (let x = Math.floor(visible.width / 2) - 80; x < visible.width / 2 + 80; x++) {
          const index = (y * visible.width + x) * 4;
          if (visible.pixels[index] - withoutDisc.pixels[index] > 20) diameterPixels++;
        }
        const expected =
          (visible.height * Math.tan(sun.angularRadius)) /
          Math.tan(THREE.MathUtils.degToRad(fov / 2));
        sunMeasurements.push({ fov, diameterPixels, expected });
        world.sky.uniforms.sunRadius.value = sun.angularRadius;
      }
      const directionBefore = world.sky.sunDirection.clone();
      camera.position.set(400, 75, 400);
      aimAtSun();
      const invariant = world.sky.sunDirection.distanceTo(directionBefore) < 1e-12;
      const shadowDirection = world.sun.position.clone().sub(world.sun.target.position).normalize();
      const aligned = shadowDirection.distanceTo(world.sky.sunDirection) < 1e-12;
      const waterAligned =
        world.water.material.uniforms.sun.value.distanceTo(world.sky.sunDirection) < 1e-12;

      // A room's physical roof/walls must cover the background sky.
      camera.position.set(0, 50, 0);
      aimAtSun();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(4, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x100804 }),
      );
      box.position.copy(camera.position).addScaledVector(world.sky.sunDirection, 6);
      world.scene.add(box);
      const blocked = render();
      const center =
        (Math.floor(blocked.height / 2) * blocked.width + Math.floor(blocked.width / 2)) * 4;
      const occluded = blocked.pixels[center] < 150;
      box.removeFromParent();
      box.geometry.dispose();
      box.material.dispose();

      camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, 0.7, -1)));
      world.updateLightingAndWeather(1, 0, weather);
      const day = render();
      const sample = (Math.floor(day.height / 2) * day.width + Math.floor(day.width / 2)) * 4;
      const dayColor = Array.from(day.pixels.slice(sample, sample + 3));
      sim.state.time = 0;
      world.updateLightingAndWeather(1, 0, weather);
      const night = render();
      const nightColor = Array.from(night.pixels.slice(sample, sample + 3));
      const nightSun = world.sun.intensity;
      sim.state.time = 12;
      world.updateLightingAndWeather(1, 0, { ...weather, rain: true, gale: true });
      const stormSun = world.sun.intensity;
      world.updateLightingAndWeather(1, 0, weather);
      const clearSun = world.sun.intensity;
      world.setView('district');
      world.updateLightingAndWeather(1, 0, weather);
      const mapBlack = world.sky.mesh.visible === false && world.scene.background.getHex() === 0;
      world.setView('walk');
      world.keys.clear();
      world.rotateWalkView(0, -100);
      world.updateCamera(10);
      const canLookUp =
        world.camera.getWorldDirection(new THREE.Vector3()).y > Math.sin(Math.PI / 3);
      return {
        sunMeasurements,
        invariant,
        aligned,
        waterAligned,
        occluded,
        dayColor,
        nightColor,
        nightSun,
        stormSun,
        clearSun,
        mapBlack,
        canLookUp,
      };
    });
    for (const measurement of result.sunMeasurements) {
      assert.ok(measurement.diameterPixels > 0);
      assert.ok(
        Math.abs(measurement.diameterPixels - measurement.expected) <= 3,
        JSON.stringify(measurement),
      );
    }
    for (const key of ['invariant', 'aligned', 'waterAligned', 'occluded', 'mapBlack', 'canLookUp'])
      assert.equal(result[key], true, key);
    assert.ok(result.dayColor[2] > result.dayColor[0]);
    assert.ok(
      result.dayColor.reduce((a, b) => a + b) > result.nightColor.reduce((a, b) => a + b) * 2,
    );
    assert.equal(result.nightSun, 0);
    assert.ok(result.stormSun < result.clearSun);
    await page.evaluate(() => {
      const world = Vinland.world;
      Vinland.view('walk');
      Vinland.simulation.state.time = 16;
      Object.defineProperty(Vinland.simulation, 'weather', {
        configurable: true,
        get: () => ({
          name: 'FAIR',
          rain: false,
          snow: false,
          gale: false,
          wind: 10,
          temp: 15,
          feels: 15,
          factor: 1,
          daylight: 15.5,
        }),
      });
      world.walkYaw = 1.8;
      world.walkPitch = 0.08;
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/vinland-daytime-sky.png' });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(JSON.stringify({ ...result, offline: true }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
