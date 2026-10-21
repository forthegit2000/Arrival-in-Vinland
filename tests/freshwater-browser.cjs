/** Freshwater surfaces, local terrain refinement, and visual/physical agreement. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startDefaultCampaign } = require('./browser-session.cjs');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
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
    await page.waitForFunction(
      () => window.Vinland && document.querySelector('#loading.ready'),
      null,
      { timeout: 120000 },
    );
    await startDefaultCampaign(page);
    const checks = await page.evaluate(() => {
      Vinland.setPaused(true);
      const world = Vinland.world,
        geography = VinlandMeadows;
      if (
        !world.freshwater ||
        world.freshwater.children.length !==
          geography.streamProfiles.length + geography.pondProfiles.length
      )
        throw Error('Missing water bodies');
      const seaUniforms = world.water.material.uniforms;
      for (const mesh of world.freshwater.children) {
        for (const key of [
          'time',
          'sun',
          'fogColor',
          'fogDensity',
          'windStrength',
          'windDirection',
          'rainIntensity',
        ]) {
          if (mesh.material.uniforms[key] !== seaUniforms[key])
            throw Error('Water weather diverges: ' + key);
        }
      }
      const geometry = world.terrain.geometry;
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        if (attribute.count !== geometry.attributes.position.count)
          throw Error('Terrain buffer length mismatch: ' + name);
      }
      if (Math.abs(geometry.attributes.normal.getY(0)) < 0.01)
        throw Error('Missing terrain normals');
      if (!geometry.userData.freshwaterPatches.size) throw Error('Banks were not refined');
      if (geometry.attributes.position.count > 1000000)
        throw Error('Terrain was unnecessarily refined across the tile');
      let channels = 0;
      for (const mesh of world.freshwater.children) {
        const positions = mesh.geometry.attributes.position;
        for (let index = 0; index < positions.count; index++) {
          const x = positions.getX(index),
            y = positions.getY(index),
            z = positions.getZ(index);
          if (![x, y, z].every(Number.isFinite)) throw Error('Invalid surface vertex');
        }
        if (mesh.name.startsWith('Mapped pond')) {
          const pond = geography.pondProfiles[Number(mesh.name.split(' ').at(-1))];
          for (let index = 0; index < positions.count; index++)
            if (Math.abs(positions.getY(index) - pond.level - 0.012) > 0.00001)
              throw Error('Pond surface slopes');
        }
      }
      for (const stream of geography.streamProfiles) {
        for (let i = 1; i < stream.points.length; i++) {
          const a = stream.points[i - 1],
            b = stream.points[i];
          const point = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 };
          if (
            !geography.containsPoint(point.x, point.z) ||
            geography.shoreDistance(point.x, point.z) < 10
          )
            continue;
          const water = geography.freshwaterAt(point.x, point.z);
          if (water.kind !== 'stream') continue;
          const ground = world.terrainSurfaceHeight(point.x, point.z);
          if (ground > water.surface + 0.04)
            throw Error('Terrain protrudes through stream at ' + JSON.stringify(point));
          const surface = world.leaderSurfaceAt(point);
          if (
            surface.mode !== 'wade' ||
            Math.abs(surface.surface - water.surface - 0.012) > 0.00001
          )
            throw Error('Wading disagrees with water');
          channels++;
        }
      }
      return {
        channels,
        vertices: geometry.attributes.position.count,
        patches: geometry.userData.freshwaterPatches.size,
        ponds: geography.pondProfiles.length,
      };
    });
    assert.ok(checks.channels > 100);
    // Inspect the same connections under three lighting/weather conditions.
    await page.evaluate(() => {
      window.waterWeather = { ...Vinland.simulation.weather };
      Object.defineProperty(Vinland.simulation, 'weather', {
        configurable: true,
        get: () => window.waterWeather,
      });
    });
    const frames = [];
    for (const [weather, rain, wind] of [
      ['sun', false, 3],
      ['overcast', false, 16],
      ['rain', true, 35],
    ]) {
      await page.evaluate(
        ({ weather, rain, wind }) => {
          const world = Vinland.world;
          Vinland.simulation.state.time = 12;
          window.waterWeather = {
            ...window.waterWeather,
            rain,
            snow: false,
            fog: weather === 'overcast',
            gale: weather === 'overcast',
            wind,
          };
          world.weatherEffects.update(30, world.elapsed, window.waterWeather, 1);
          world.updateLightingAndWeather(30, world.elapsed, window.waterWeather);
        },
        { weather, rain, wind },
      );
      for (const [name, point, distance] of [
        ['mouth', [-75, -2], 25],
        ['bend', [-30, 150], 35],
        ['pond', await page.evaluate(() => VinlandMeadows.pondProfiles[14].ring[0]), 60],
      ]) {
        await page.evaluate(
          ({ point, distance }) => {
            Vinland.view('district');
            const world = Vinland.world;
            world.focus(point[0], point[1], distance);
            world.distance = world.desiredDistance;
            world.updateProjection();
            world.updateCamera(1);
          },
          { point, distance },
        );
        await page.waitForTimeout(400);
        await page.screenshot({ path: `/tmp/vinland-natural-water-${weather}-${name}.png` });
        frames.push(weather + ':' + name);
      }
    }
    await page.evaluate(() => {
      window.waterWeather = {
        ...window.waterWeather,
        rain: false,
        fog: false,
        gale: false,
        wind: 3,
      };
      Vinland.view('walk');
      Vinland.setPaused(true);
      const world = Vinland.world,
        sim = Vinland.simulation;
      const stream = VinlandMeadows.streamProfiles.at(-1);
      let index = 1;
      for (let i = 2; i < stream.points.length - 1; i++)
        if (
          Math.hypot(stream.points[i][0] + 30, stream.points[i][1] - 150) <
          Math.hypot(stream.points[index][0] + 30, stream.points[index][1] - 150)
        )
          index = i;
      const p = stream.points[index],
        q = stream.points[index - 1];
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const point = {
        x: p[0] - ((q[1] - p[1]) / length) * 2.5,
        z: p[1] + ((q[0] - p[0]) / length) * 2.5,
      };
      Object.assign(sim.state.leader, point);
      Object.assign(sim.state.people[0], point);
      world.agentPositions.set(0, { ...point });
      world.actorCollisions.set('person:0', { ...point, radius: 0.34 });
      world.previousWalkPose = world.currentWalkPose = null;
      world.walkYaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
      world.walkPitch = 0.3;
      world.updateCamera(1);
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: '/tmp/vinland-natural-water-walk.png' });
    await page.evaluate(() => {
      delete Vinland.simulation.weather;
      Vinland.view('district');
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      JSON.stringify({
        ...checks,
        frames,
        sharedWaterLighting: true,
        offline: true,
        shaderErrors: 0,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
