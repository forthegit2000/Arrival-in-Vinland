/** Selection/inspection are the default; placement has explicit cancellation. */
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
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    await page.evaluate(() => Vinland.setPaused(true));
    assert.equal(await page.locator('#query-tool').count(), 0);
    assert.equal(await page.locator('#mode-status').count(), 0);
    const panel = page.locator('#selection-panel');
    assert.equal(await panel.getAttribute('data-context'), 'none');
    assert.equal(await page.locator('#worker-orders').isVisible(), false);
    assert.equal(await page.locator('[data-worker-action="idle"]').isVisible(), true);
    assert.equal(await page.locator('.build-panel').isVisible(), false);
    const emptyWorldHeight = await page
      .locator('#world')
      .evaluate((element) => element.clientHeight);
    const clearCentre = await page.evaluate(() => {
      const box = document.getElementById('selection-panel').getBoundingClientRect();
      return (
        document.elementFromPoint(box.x + box.width / 2, box.y + 10) ===
        Vinland.world.renderer.domElement
      );
    });
    assert.equal(clearCentre, true, 'Empty central panel lets world clicks through');

    async function clickObject(type, id) {
      const pixel = await page.evaluate(
        ({ type, id }) => {
          const world = Vinland.world;
          const object =
            type === 'hall'
              ? world.hall
              : type === 'building'
                ? world.objects.get(id)
                : world.people[id];
          const position = object.position;
          world.focus(position.x, position.z, type === 'hall' ? 70 : 35);
          world.distance = world.desiredDistance;
          world.updateProjection();
          world.updateCamera(1);
          world.scene.updateMatrixWorld(true);
          world.camera.updateMatrixWorld(true);
          const bounds = world.container.getBoundingClientRect();
          let pixel = null;
          object.traverse((child) => {
            if (pixel || !child.isMesh) return;
            for (let parent = child; parent; parent = parent.parent) if (!parent.visible) return;
            child.geometry.computeBoundingBox();
            const center = child.geometry.boundingBox.getCenter(new THREE.Vector3());
            child.localToWorld(center);
            const point = world.project(center.x, center.y, center.z);
            const x = point.x + bounds.left,
              y = point.y + bounds.top;
            if (!point.visible || document.elementFromPoint(x, y) !== world.renderer.domElement)
              return;
            const hit = world.workerControls.hitSelectable({ clientX: x, clientY: y });
            if (hit?.type === type && (type === 'hall' || hit.id === id)) pixel = { x, y };
          });
          if (!pixel) throw Error('No visible click target for ' + type + ':' + id);
          return pixel;
        },
        { type, id },
      );
      await page.mouse.click(pixel.x, pixel.y);
    }

    await clickObject('person', 1);
    assert.deepEqual(await page.evaluate(() => [...Vinland.app.workerControls.selected]), [1]);
    assert.equal(await panel.getAttribute('data-context'), 'people');
    assert.equal(await page.locator('#worker-selection-title').innerText(), '1 worker selected');
    assert.equal(await page.locator('#selection-empty').isVisible(), false);
    assert.equal(
      await page.locator('#world').evaluate((element) => element.clientHeight),
      emptyWorldHeight,
      'Selection leaves the world viewport stable',
    );
    await page.keyboard.down('Shift');
    await clickObject('person', 2);
    await page.keyboard.up('Shift');
    assert.deepEqual(await page.evaluate(() => [...Vinland.app.workerControls.selected]), [1, 2]);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => Vinland.app.workerControls.selected.size), 0);
    await clickObject('hall');
    assert.equal(await page.locator('#inspector').isVisible(), true);
    assert.equal(await panel.getAttribute('data-context'), 'object');
    assert.equal(await page.locator('#worker-orders').isVisible(), false);
    assert.equal(await page.locator('#selection-panel #inspector').count(), 1);
    assert.equal(await page.evaluate(() => !!Vinland.world.selectionMarker), true);
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false);
    await page.locator('#close-inspector').click();

    for (const cancellation of ['button', 'escape', 'right-click']) {
      await clickObject('person', 1);
      await page.evaluate(() => Vinland.startPlacement('turfhouse'));
      assert.equal(await page.locator('#placement-banner').isVisible(), true);
      assert.equal(await page.locator('#mode-status').count(), 0);
      assert.match(await page.locator('#cancel-place').innerText(), /^Cancel\s+Esc$/);
      await page.keyboard.press('i');
      assert.equal(await page.evaluate(() => Vinland.world.placing?.type), 'turfhouse');
      if (cancellation === 'button') await page.locator('#cancel-place').click();
      else if (cancellation === 'escape') await page.keyboard.press('Escape');
      else {
        const bounds = await page.locator('#world canvas').boundingBox();
        await page.mouse.click(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.3, {
          button: 'right',
        });
      }
      assert.equal(await page.evaluate(() => Vinland.world.placing), null);
      assert.equal(await page.locator('#placement-banner').isVisible(), false);
      assert.equal(await page.locator('#mode-status').count(), 0);
      // Cancelling returns directly to selection, with no tool activation.
      await clickObject('person', 2);
      assert.deepEqual(await page.evaluate(() => [...Vinland.app.workerControls.selected]), [2]);
    }

    // Select a completed physical store without bypassing the real scene hit.
    await page.evaluate(() => {
      const sim = Vinland.simulation;
      sim.state.buildings.push({
        id: 9001,
        type: 'storehouse',
        x: 70,
        z: 60,
        rotation: 0.37,
        hours: 120,
        progress: 120,
        condition: 100,
        owner: 'Expedition',
        cost: {},
      });
      VinlandStorage.syncStores(sim.state);
      VinlandStorage.deposit(sim.state, 'building:9001', 'firewood', 25);
      Vinland.world.sync();
      sim.emit();
    });
    await clickObject('building', 9001);
    assert.match(
      await page.locator('#inspect-details [data-stock-resource="firewood"]').innerText(),
      /25.*kg/,
    );
    const inventory = page.locator('#inspect-actions [data-action="inventory"]');
    assert.equal(await inventory.isVisible(), true);
    await inventory.focus();
    await page.evaluate(() => {
      VinlandStorage.deposit(Vinland.simulation.state, 'building:9001', 'firewood', 10);
      Vinland.simulation.emit();
    });
    await page.waitForFunction(() =>
      document
        .querySelector('#inspect-details [data-stock-resource="firewood"]')
        .textContent.includes('35'),
    );
    assert.equal(
      await inventory.evaluate((button) => button === document.activeElement),
      true,
      'Inventory refresh preserves action focus',
    );
    await inventory.click();
    assert.equal(await page.locator('#modal').evaluate((dialog) => dialog.open), true);
    await page.locator('#close-modal').click();

    await page.evaluate(() => {
      const sim = Vinland.simulation;
      sim.state.queue.push({
        id: 9002,
        type: 'storehouse',
        x: 95,
        z: 60,
        rotation: 0.2,
        hours: 100,
        progress: 25,
        workers: 0,
        cost: {},
      });
      Vinland.world.sync();
      sim.emit();
    });
    await clickObject('building', 9002);
    assert.match(await page.locator('#inspect-details').innerText(), /25%/);
    assert.match(await page.locator('#inspect-details').innerText(), /75.*person-hours/);
    await page.evaluate(() => {
      Vinland.simulation.state.queue.find((entry) => entry.id === 9002).progress = 50;
      Vinland.simulation.emit();
    });
    await page.waitForFunction(() =>
      document.getElementById('inspect-details').textContent.includes('50%'),
    );
    await page.screenshot({ path: '/tmp/vinland-context-construction.png' });
    await page.evaluate(() => {
      const sim = Vinland.simulation;
      const site = sim.state.queue.find((entry) => entry.id === 9002);
      sim.state.queue = sim.state.queue.filter((entry) => entry.id !== site.id);
      sim.state.buildings.push({ ...site, progress: site.hours, condition: 100 });
      VinlandStorage.syncStores(sim.state);
      Vinland.world.sync();
      sim.emit();
    });
    await page.waitForFunction(
      () => !document.getElementById('inspect-details').textContent.includes('Work remaining'),
    );
    assert.equal(
      await panel.getAttribute('data-context'),
      'object',
      'Completed site stays selected',
    );
    assert.equal(
      await page.locator('#inspect-actions [data-action="inventory"]').isVisible(),
      true,
    );

    // Removal of the selected object falls back to the compact idle control.
    await page.evaluate(() => {
      const sim = Vinland.simulation;
      sim.state.queue = sim.state.queue.filter((entry) => entry.id !== 9002);
      sim.state.buildings = sim.state.buildings.filter((entry) => entry.id !== 9002);
      Vinland.world.sync();
      sim.emit();
    });
    await page.waitForFunction(
      () => document.getElementById('selection-panel').dataset.context === 'none',
    );
    await page.evaluate(() => {
      VinlandCheats.configure(Vinland.simulation, { enabled: true });
      Vinland.app.workerControls.render();
    });
    await page.locator('#selection-cheat-build').click();
    assert.equal(await panel.getAttribute('data-context'), 'build');
    assert.equal(await page.locator('#construction-palette').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await panel.getAttribute('data-context'), 'none');
    await page.locator('[data-worker-action="idle"]').click();
    assert.equal(await panel.getAttribute('data-context'), 'people');
    await page.locator('[data-worker-action="build"]').click();
    assert.equal(await panel.getAttribute('data-context'), 'build');
    await page.locator('[data-worker-action="back"]').click();
    assert.equal(await panel.getAttribute('data-context'), 'people');
    await page.evaluate(() => VinlandCheats.configure(Vinland.simulation, { enabled: false }));

    await page.evaluate(() => {
      Vinland.view('walk');
      Vinland.setPaused(true);
    });
    assert.equal(await page.locator('#mode-status').count(), 0);
    await page.keyboard.press('i');
    assert.equal(await page.evaluate(() => Vinland.world.view), 'walk');
    await page.evaluate(() => {
      const saved = Vinland.simulation.serialize();
      const loaded = VinlandModel.Simulation.load(saved);
      if (!loaded) throw Error('Save rejected');
      Vinland.replaceSimulation(loaded);
      Vinland.setPaused(true);
    });
    assert.equal(await page.locator('#mode-status').count(), 0);
    await page.evaluate(() => Vinland.view('district'));
    assert.equal(await page.locator('#mode-status').count(), 0);
    await page.evaluate(() => Vinland.view('atlantic'));
    await page.locator('[data-atlantic="district"]').click();
    assert.equal(await page.locator('#mode-status').count(), 0);
    await clickObject('hall');
    assert.equal(await page.locator('#inspector').isVisible(), true);
    await page.locator('#close-inspector').click();
    await page.locator('#manage-button').click();
    await page.locator('#modal-content [data-action="help"]').click();
    assert.match(
      await page.locator('#modal-content').innerText(),
      /Click a building to inspect it/,
    );
    assert.doesNotMatch(
      await page.locator('#modal-content').innerText(),
      /query tool|quick query/i,
    );
    await page.locator('#close-modal').click();
    for (const size of [
      { width: 1512, height: 982 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
      { width: 1280, height: 640 },
    ]) {
      await page.setViewportSize(size);
      assert.equal(await page.locator('#query-tool').count(), 0);
      assert.equal(await page.locator('#mode-status').count(), 0);
      for (const scale of [1, 1.3]) {
        await page.evaluate((scale) => {
          document.documentElement.style.setProperty('--text-scale', scale);
          Vinland.world.resize();
        }, scale);
        for (const selection of ['none', 'people', 'object', 'build']) {
          await page.evaluate((selection) => {
            const controls = Vinland.app.workerControls;
            if (selection === 'none') {
              document.getElementById('close-inspector').click();
              controls.select([]);
            } else if (selection === 'object') {
              controls.clear();
              Vinland.world.onSelect('building', 9001);
            } else {
              controls.select([1]);
              if (selection === 'build') controls.action('build');
            }
          }, selection);
          const fits = await panel.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const inspector = document.getElementById('inspector').getBoundingClientRect();
            return (
              box.left >= 0 &&
              box.right <= innerWidth + 1 &&
              box.top >= 0 &&
              box.bottom <= innerHeight &&
              (document.getElementById('inspector').hidden ||
                (inspector.left >= box.left &&
                  inspector.right <= box.right + 1 &&
                  inspector.bottom <= box.bottom + 1))
            );
          });
          assert.equal(fits, true, `${size.width}px ${scale} text ${selection} panel fits`);
        }
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--text-scale', 1);
      Vinland.replaceSimulation(new VinlandModel.Simulation());
      Vinland.setPaused(true);
    });
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.screenshot({ path: '/tmp/vinland-context-empty.png' });
    await clickObject('person', 1);
    await page.screenshot({ path: '/tmp/vinland-context-people.png' });
    // The new campaign's shore/boat commands stay available for selected crew.
    await page.evaluate(() => {
      const sim = new VinlandModel.Simulation();
      VinlandArrival.start(sim);
      Vinland.replaceSimulation(sim);
      Vinland.view('district');
      Vinland.setPaused(true);
      Vinland.app.workerControls.select([1]);
    });
    assert.equal(await page.locator('#arrival-orders').isVisible(), true);
    assert.equal(await panel.getAttribute('data-context'), 'people');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      'Default selection/inspection, Shift selection, three cancellation paths, view changes, save/load and offline UI passed.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
