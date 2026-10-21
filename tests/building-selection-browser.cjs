const { startDefaultCampaign } = require('./browser-session.cjs');
/** Every constructed building must remain selectable throughout its lifecycle. */
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
    const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, hasTouch: true });
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const types = await page.evaluate(() => {
      Vinland.setPaused(true);
      // Provide ample materials so this checks selection rather than economics.
      for (const key of ['timber', 'turf', 'stone', 'iron', 'charcoal', 'cloth']) {
        Vinland.simulation.state.resources[key] = 100000;
      }
      return Object.keys(VinlandModel.TYPES).filter((type) => type !== 'restore');
    });

    async function selectBuilding(id, touch = false) {
      const target = await page.evaluate((id) => {
        const world = Vinland.world;
        const building = [...world.sim.state.queue, ...world.sim.state.buildings].find(
          (item) => item.id === id,
        );
        const object = world.objects.get(id);
        if (!object || object.userData.select !== 'building') {
          throw Error('Building has no selection owner: ' + building?.type);
        }
        world.clearSelection();
        world.workerControls.clear();
        world.workerControls.render();
        world.focus(building.x, building.z, 65);
        world.distance = 65;
        world.updateProjection();
        world.updateCamera(1);
        world.scene.updateMatrixWorld(true);
        world.camera.updateMatrixWorld(true);
        const rectangle = world.container.getBoundingClientRect();
        let pixel;
        let nestedOwner = false;
        object.traverse((child) => {
          if (child !== object && child.userData.select) {
            nestedOwner = true;
          }
          if (pixel || !child.isMesh) {
            return;
          }
          for (let parent = child; parent; parent = parent.parent) {
            if (!parent.visible) {
              return;
            }
          }
          child.geometry.computeBoundingBox();
          const center = child.geometry.boundingBox.getCenter(new THREE.Vector3());
          child.localToWorld(center);
          const point = world.project(center.x, center.y, center.z);
          const x = point.x + rectangle.left;
          const y = point.y + rectangle.top;
          const hit = world.workerControls.hitSelectable({ clientX: x, clientY: y });
          if (
            point.visible &&
            x > 350 &&
            y > 100 &&
            x < rectangle.right - 20 &&
            y < rectangle.bottom - 20 &&
            hit?.type === 'building' &&
            hit.id === id
          ) {
            pixel = { x, y };
          }
        });
        if (nestedOwner) {
          throw Error('A decorative child steals selection from ' + building.type);
        }
        if (!pixel) {
          throw Error('No selectable visible geometry for ' + building.type);
        }
        return { ...pixel, name: VinlandModel.TYPES[building.type].name };
      }, id);
      if (touch) {
        await page.touchscreen.tap(target.x, target.y);
      } else {
        await page.mouse.click(target.x, target.y);
      }
      assert.equal(await page.locator('#inspector').isVisible(), true, target.name);
      const selected = await page.evaluate(() => ({
        type: Vinland.app.selected?.type,
        id: Vinland.app.selected?.id,
        objectId: Vinland.world.selectedObject?.userData.buildingId,
      }));
      assert.deepEqual(selected, { type: 'building', id, objectId: id }, target.name);
      await page.locator('#inspector [data-action="building"]').click();
      assert.equal(await page.locator('#window-title').innerText(), target.name);
      await page.keyboard.press('Escape');
    }

    const built = [];
    for (const type of types) {
      const id = await page.evaluate((type) => {
        const simulation = Vinland.simulation;
        for (let z = -96; z <= 96; z += 4) {
          for (let x = -96; x <= 96; x += 4) {
            if (simulation.canPlace(type, x, z, 0.37)) {
              const order = simulation.order(type, x, z, 0.37);
              if (order) {
                Vinland.world.sync();
                return order.id;
              }
            }
          }
        }
        throw Error('No valid site for selection fixture: ' + type);
      }, type);
      // Actual pointer clicks must identify the work site while under construction.
      await selectBuilding(id);
      await page.evaluate((id) => {
        const simulation = Vinland.simulation;
        const order = simulation.state.queue.find((item) => item.id === id);
        // Selection fixture: all required supplies have reached the site.
        for (const material of Object.values(order.materials)) {
          material.delivered = material.required;
          material.reservations = [];
        }
        order.progress = order.hours - 1;
        simulation.state.time = 8;
        const point = Vinland.world.findActorPosition(
          { x: order.x + VinlandModel.TYPES[order.type].w / 2 + 3, z: order.z },
          0.45,
          'person:1',
        );
        simulation.commandWorkers([1], { type: 'build', buildingId: id, ...point });
        Object.assign(simulation.state.people[1], point);
        Vinland.world.agentPositions.set(1, { ...point });
        simulation.advanceConstruction(3600);
        if (!simulation.state.buildings.some((building) => building.id === id)) {
          throw Error('Construction did not finish');
        }
        Vinland.world.sync();
      }, id);
      await selectBuilding(id);
      built.push(id);
    }

    await page.evaluate(() => {
      const saved = Vinland.simulation.serialize();
      const loaded = VinlandModel.Simulation.load(saved);
      if (!loaded) {
        throw Error('The completed settlement could not be loaded');
      }
      Vinland.replaceSimulation(loaded);
    });
    for (const id of built) {
      // Touch uses the original pointer-selection path, rather than box selection.
      await selectBuilding(id, true);
    }
    assert.equal(await page.evaluate(() => Vinland.world.hall.userData.select), 'hall');
    assert.equal(await page.evaluate(() => Vinland.world.tents[0].userData.select), 'tent');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      `${types.length} building types selectable during construction, after completion and after save/load; mouse and touch details verified.`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
