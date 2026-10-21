const { startDefaultCampaign, loadSavedCampaign } = require('./browser-session.cjs');
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
    const page = await browser.newPage({
      viewport: {
        width: 1512,
        height: 982,
      },
      deviceScaleFactor: 1,
      hasTouch: true,
    });
    const errors = [];
    const network = [];
    page.on('pageerror', (event) => errors.push(event.message));
    page.on('console', (m) => {
      if (m.type() === 'error') {
        errors.push(m.text());
      }
    });
    await page.route(/^https?:/, (r) => {
      network.push(r.request().url());
      return r.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    await page.waitForTimeout(700);
    const content = page.locator('#modal-content');
    const resources = page.locator('.resource');
    const resourceTooltip = page.locator('#resource-tooltip');
    assert.equal(await resources.count(), 7);
    assert.equal(await resources.locator('small, [title]').count(), 0);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.resource img')].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    const topbar = await page.locator('.topbar').boundingBox();
    const resourceBounds = await page.locator('#resources').boundingBox();
    const brand = await page.locator('.brand').boundingBox();
    assert.equal(topbar.height, 44);
    assert.ok(
      resourceBounds.width / topbar.width >= 0.3 && resourceBounds.width / topbar.width <= 0.4,
    );
    assert.ok(Math.abs(brand.x + brand.width / 2 - topbar.width / 2) < 1);
    const foodResource = page.locator('[data-resource="food"]');
    await foodResource.hover();
    assert.equal(await resourceTooltip.isVisible(), true);
    assert.equal(await resourceTooltip.locator('strong').innerText(), 'Food');
    assert.match(await resourceTooltip.locator('span').innerText(), /days/);
    const foodBounds = await foodResource.boundingBox();
    const hoverBounds = await resourceTooltip.boundingBox();
    assert.ok(hoverBounds.x > foodBounds.x + foodBounds.width / 2);
    await page.mouse.move(
      foodBounds.x + foodBounds.width / 2 + 5,
      foodBounds.y + foodBounds.height / 2,
    );
    assert.ok((await resourceTooltip.boundingBox()).x > hoverBounds.x);
    // HUD refreshes keep the same resource node focused and its tooltip visible.
    await foodResource.focus();
    await page.evaluate(() => {
      Vinland.app.dirty = true;
    });
    await page.waitForTimeout(650);
    assert.equal(await foodResource.evaluate((item) => item === document.activeElement), true);
    assert.equal(await resourceTooltip.isVisible(), true);
    await page.screenshot({ path: '/tmp/vinland-resource-tooltip.png' });
    await page.keyboard.press('Escape');
    assert.equal(await resourceTooltip.isVisible(), false);
    await page.mouse.move(900, 300);
    await foodResource.evaluate((item) => item.blur());
    await page.screenshot({ path: '/tmp/vinland-compact-topbar.png' });
    // The cog is the single game-menu entry point; every action has a colored icon.
    assert.equal(await page.locator('#save, #history, .command-strip #manage-button').count(), 0);
    await page.evaluate(() => Vinland.setPaused(false));
    await page.locator('#manage-button').click();
    assert.equal(await page.evaluate(() => Vinland.paused), true);
    assert.equal(await page.locator('#manage-button').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(
      await content
        .locator('.menu-action')
        .allTextContents()
        .then((labels) => labels.map((label) => label.trim())),
      [
        'Resume Game',
        'New Game',
        'Load Game',
        'Save Game',
        'Settings',
        'Cheat Mode',
        'Help',
        'Quit',
      ],
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.menu-action img')].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    for (const button of await content.locator('.menu-action').all()) {
      const icon = await button.locator('img').boundingBox();
      const label = await button.locator('span').boundingBox();
      assert.ok(icon.x + icon.width < label.x);
    }
    await page.screenshot({ path: '/tmp/vinland-game-menu.png' });
    await content.locator('[data-action="close"]').click();
    assert.equal(await page.evaluate(() => Vinland.paused), false);
    await page.evaluate(() => Vinland.setPaused(true));
    await page.locator('#manage-button').click();
    await content.locator('[data-action="scenario"]').click();
    assert.equal(await page.locator('#scenario-preset').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.locator('#manage-button').click();
    await content.locator('[data-action="help"]').click();
    assert.match(await page.locator('#window-title').innerText(), /Controls/);
    await page.keyboard.press('Escape');
    await page.locator('#manage-button').click();
    await content.locator('[data-action="quit"]').click();
    assert.equal(await page.locator('#title-screen').isVisible(), true);
    assert.equal(await page.locator('#game').evaluate((element) => element.inert), true);
    const quitTime = await page.evaluate(() => Vinland.simulation.state.time);
    // Space on the focused Continue button would legitimately activate that button.
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => Vinland.paused), true);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.time), quitTime);
    await page.locator('#title-screen [data-action="continue-game"]').click();
    assert.equal(await page.locator('#title-screen').isVisible(), false);
    assert.equal(await page.evaluate(() => Vinland.paused), false);
    await page.locator('#manage-button').click();
    await content.locator('[data-action="quit"]').click();
    await page.locator('#title-screen [data-action="load-game"]').click();
    assert.equal(
      await content.locator('[data-action="load-slot"][data-slot="autosave"]').count(),
      1,
    );
    await content.locator('[data-action="load-slot"][data-slot="autosave"]').click();
    assert.equal(await page.locator('#title-screen').isVisible(), false);
    assert.equal(await page.locator('#game').evaluate((element) => element.inert), false);
    assert.equal(await page.evaluate(() => Vinland.paused), true);
    // Planning on the Atlantic screen launches the same physical crew/ship model.
    const beforeAtlanticVoyage = await page.evaluate(() => Vinland.simulation.serialize());
    await page.locator('#atlantic-view').click();
    await page.locator('#atlantic-crew').fill('6');
    await page.locator('#atlantic-timber').fill('0');
    assert.equal(await page.locator('#atlantic-launch').isEnabled(), true);
    await page.locator('#atlantic-launch').click();
    assert.equal(await page.evaluate(() => Vinland.simulation.state.voyages.length), 1);
    assert.equal(
      await page.evaluate(
        () => Vinland.simulation.state.people.filter((person) => person.away).length,
      ),
      6,
    );
    assert.equal(await page.locator('#atlantic-ships > g').count(), 1);
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false);
    await page.evaluate(
      (saved) => Vinland.replaceSimulation(VinlandModel.Simulation.load(saved)),
      beforeAtlanticVoyage,
    );
    const screenPoint = async (x, z) =>
      page.evaluate(
        ([x, z]) => {
          const w = Vinland.world;
          const point = w.project(
            x,
            VinlandModel.elevation(x, z, Vinland.simulation.state.config),
            z,
          );
          const bounds = w.container.getBoundingClientRect();
          return {
            x: point.x + bounds.left,
            y: point.y + bounds.top,
          };
        },
        [x, z],
      );
    const validSpot = async (type, avoid = []) =>
      page.evaluate(
        ({ type, avoid }) => {
          const w = Vinland.world;
          const bounds = w.container.getBoundingClientRect();
          for (let z = -58; z <= 64; z += 4) {
            for (let x = -62; x <= 68; x += 4) {
              if (
                avoid.some((point) => Math.hypot(x - point.x, z - point.z) < 16) ||
                !w.canPlace(type, x, z, w.placing?.rotation || 0)
              ) {
                continue;
              }
              const point = w.project(
                x,
                VinlandModel.elevation(x, z, Vinland.simulation.state.config),
                z,
              );
              if (point.x > 350 && point.x < w.w - 25 && point.y > 145 && point.y < w.h - 110) {
                return {
                  x: point.x + bounds.left,
                  y: point.y + bounds.top,
                  worldX: x,
                  worldZ: z,
                };
              }
            }
          }
          return null;
        },
        {
          type,
          avoid,
        },
      );
    assert.equal(await page.locator('#date').innerText(), '1 Aug 1005 AD');
    const initial = await page.evaluate(() => ({
      people: Vinland.world.people.length,
      animals: Vinland.world.animals.length,
      ships: Vinland.world.ships.length,
      tents: Vinland.world.tents.length,
      households: Vinland.simulation.state.households.length,
    }));
    assert.deepEqual(initial, {
      people: 160,
      animals: 32,
      ships: 4,
      tents: 10,
      households: 32,
    });
    assert.equal(await page.evaluate(() => Vinland.world.camera.isOrthographicCamera), true);
    const realTerrain = await page.evaluate(() => {
      const world = Vinland.world;
      const bytes = world.water.material.uniforms.shoreMap.value.image.data;
      const grid = VinlandMeadows.data.shore;
      const column = Math.round((-100 - grid.minX) / grid.step);
      const row = Math.round((0 - grid.minZ) / grid.step);
      const pixel = (row * grid.rows[0].length + column) * 4;
      return {
        measured: world.measuredTerrain,
        hallHeight: world.hall.position.y,
        hallRotation: world.hall.rotation.y,
        sourceRotation: VinlandMeadows.hallRotation,
        canWalkInSea: world.clearAt(-100, 0),
        canBuildInSea: Vinland.simulation.canPlace('sailbudir', -100, 0),
        maskDistance: (bytes[pixel] * 256 + bytes[pixel + 1]) / 32 - 512,
        physicalDistance: VinlandMeadows.shoreDistance(-100, 0),
        mapWidth: world.mapExtent.width,
      };
    });
    assert.equal(realTerrain.measured, true);
    assert.ok(Math.abs(realTerrain.hallHeight - 4.47) < 0.02);
    assert.equal(realTerrain.hallRotation, realTerrain.sourceRotation);
    assert.equal(realTerrain.canWalkInSea, false);
    assert.equal(realTerrain.canBuildInSea, false);
    assert.ok(Math.abs(realTerrain.maskDistance - realTerrain.physicalDistance) < 0.02);
    assert.equal(realTerrain.mapWidth, 2160);
    const minimapBounds = await page.locator('#minimap').boundingBox();
    // Click events use integer client pixels; use those same known pixels for the
    // reference transform rather than assuming fractional pointer precision.
    const mapClick = {
      x: Math.round(minimapBounds.x + minimapBounds.width * 0.65),
      y: Math.round(minimapBounds.y + minimapBounds.height * 0.4),
    };
    await page.mouse.click(mapClick.x, mapClick.y);
    const mapTarget = await page.evaluate(() => Vinland.world.target.toArray());
    const expectedMapX = -1080 + ((mapClick.x - minimapBounds.x) / minimapBounds.width) * 2160;
    const expectedMapZ = -1080 + ((mapClick.y - minimapBounds.y) / minimapBounds.height) * 2160;
    assert.ok(Math.abs(mapTarget[0] - expectedMapX) < 0.1);
    assert.ok(Math.abs(mapTarget[2] - expectedMapZ) < 0.1);
    // A full overview must expose the finite tile, with black beyond every side.
    await page.locator('#map-overview').click();
    await page.waitForTimeout(1000);
    const tile = await page.evaluate(() => {
      const world = Vinland.world;
      const positions = world.terrain.geometry.attributes.position;
      let minimum = Infinity;
      let maximum = -Infinity;
      for (let index = 0; index < positions.count; index++) {
        minimum = Math.min(minimum, positions.getX(index));
        maximum = Math.max(maximum, positions.getX(index));
      }
      const regions = new Set(
        world.treePlacements.map(
          ({ x, z }) => Math.floor((x + 1080) / 540) + ':' + Math.floor((z + 1080) / 540),
        ),
      );
      return {
        minimum,
        maximum,
        background: world.scene.background.getHex(),
        clippingPlanes: world.renderer.clippingPlanes.length,
        waterWidth: world.water.geometry.parameters.width,
        overviewDistance: world.distance,
        detailedRegions: regions.size,
        hasEdge: Boolean(world.mapEdge),
      };
    });
    assert.equal(tile.minimum, -1080);
    assert.equal(tile.maximum, 1080);
    assert.equal(tile.background, 0);
    assert.equal(tile.clippingPlanes, 4);
    assert.equal(tile.waterWidth, 2160);
    assert.ok(tile.overviewDistance > 1600);
    assert.ok(tile.detailedRegions >= 6);
    assert.equal(tile.hasEdge, true);
    await page.screenshot({ path: '/tmp/vinland-map-overview.png' });
    assert.equal(await page.evaluate(() => Vinland.world.clearAt(650, 650)), true);
    assert.equal(await page.evaluate(() => Vinland.world.clearAt(1081, 650)), false);
    await page.evaluate(() => {
      const world = Vinland.world;
      world.target.set(1060, VinlandMeadows.elevation(1060, 1060) + 1, 1060);
      world.desiredDistance = 210;
    });
    await page.waitForTimeout(1000);
    const edgePixels = await page.evaluate(() => {
      const world = Vinland.world;
      world.renderer.render(world.scene, world.camera);
      const gl = world.renderer.getContext();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const read = (x, y) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return pixel[0] + pixel[1] + pixel[2];
      };
      const corner = new THREE.Vector3(1080, -12, 1080).project(world.camera);
      const center = Math.round(((corner.x + 1) * width) / 2);
      const belowEdge = Math.floor(((corner.y + 1) * height) / 2) - 12;
      let strayColor = 0;
      for (let y = 12; y < belowEdge; y += 12) {
        for (let x = center - 60; x <= center + 60; x += 12) {
          strayColor += read(x, y);
        }
      }
      const face = new THREE.Vector3(1080, 0, 1060).project(world.camera);
      return {
        strayColor,
        faceColor: read(
          Math.round(((face.x + 1) * width) / 2),
          Math.round(((face.y + 1) * height) / 2),
        ),
      };
    });
    assert.equal(edgePixels.strayColor, 0, 'nothing may float beneath the cut tile');
    assert.ok(edgePixels.faceColor > 0, 'the solid cut face must remain visible');
    await page.screenshot({ path: '/tmp/vinland-map-edge.png' });
    // Panning can reach both opposite map corners without crossing the boundary.
    await page.evaluate(() => Vinland.world.panCamera(100000, 100000));
    const corner = await page.evaluate(() => Vinland.world.target.toArray());
    assert.ok(Math.abs(corner[0]) <= 1080 && Math.abs(corner[2]) <= 1080);
    await page.locator('#center').click();
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: '/tmp/vinland-simulation-district.png',
    });
    // Middle-drag pans; left-drag is now reserved for worker selection.
    const panStart = await page.evaluate(() => ({
      target: Vinland.world.target.toArray(),
      azimuth: Vinland.world.azimuth,
    }));
    await page.mouse.move(1030, 460);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(1110, 500, {
      steps: 10,
    });
    await page.mouse.up({ button: 'middle' });
    const panEnd = await page.evaluate(() => ({
      target: Vinland.world.target.toArray(),
      azimuth: Vinland.world.azimuth,
    }));
    assert.ok(
      Math.hypot(panEnd.target[0] - panStart.target[0], panEnd.target[2] - panStart.target[2]) > 5,
    );
    assert.equal(panEnd.azimuth, panStart.azimuth);
    assert.equal(await page.evaluate(() => Vinland.paused), true);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(240);
    await page.keyboard.up('KeyW');
    assert.notDeepEqual(await page.evaluate(() => Vinland.world.target.toArray()), panEnd.target);
    const angle = await page.evaluate(() => Vinland.world.desiredAzimuth);
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(350);
    await page.keyboard.up('KeyE');
    const turnedAngle = await page.evaluate(() => Vinland.world.desiredAzimuth);
    assert.ok(turnedAngle > angle + 0.02 && turnedAngle < angle + 0.25);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => Vinland.world.desiredAzimuth), turnedAngle);
    await page.keyboard.down('KeyQ');
    await page.waitForTimeout(200);
    await page.keyboard.up('KeyQ');
    assert.ok(
      await page.evaluate((previous) => Vinland.world.desiredAzimuth < previous, turnedAngle),
    );
    // Fixed elapsed time gives exact rates regardless of frame subdivision.
    const cameraRates = await page.evaluate(() => {
      const world = Vinland.world;
      const initial = world.desiredAzimuth;
      world.keys.add('KeyE');
      for (let frame = 0; frame < 60; frame++) world.updateRotation(1 / 60);
      const normal = world.desiredAzimuth - initial;
      world.keys.add('ShiftLeft');
      for (let frame = 0; frame < 30; frame++) world.updateRotation(1 / 30);
      const fast = world.desiredAzimuth - initial - normal;
      world.keys.clear();
      world.azimuth = world.desiredAzimuth = initial;
      return { normal, fast };
    });
    assert.ok(Math.abs(cameraRates.normal - Math.PI / 12) < 1e-10);
    assert.ok(Math.abs(cameraRates.fast - Math.PI / 6) < 1e-10);
    const turnButton = page.locator('#camera-right');
    const buttonBounds = await turnButton.boundingBox();
    const beforeButton = await page.evaluate(() => Vinland.world.desiredAzimuth);
    await page.mouse.move(
      buttonBounds.x + buttonBounds.width / 2,
      buttonBounds.y + buttonBounds.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(250);
    // Capture must deliver the release even outside the held button.
    await page.mouse.move(950, 300);
    await page.mouse.up();
    const afterButton = await page.evaluate(() => Vinland.world.desiredAzimuth);
    assert.ok(afterButton > beforeButton);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => Vinland.world.desiredAzimuth), afterButton);
    await turnButton.focus();
    const beforeSpace = await page.evaluate(() => ({
      angle: Vinland.world.desiredAzimuth,
      paused: Vinland.paused,
    }));
    await page.keyboard.down('Space');
    await page.waitForTimeout(200);
    await page.keyboard.up('Space');
    assert.equal(await page.evaluate(() => Vinland.paused), beforeSpace.paused);
    assert.ok((await page.evaluate(() => Vinland.world.desiredAzimuth)) > beforeSpace.angle);
    await turnButton.evaluate((button) => button.blur());
    // Losing focus must release held rotation input.
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(100);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const blurAngle = await page.evaluate(() => Vinland.world.desiredAzimuth);
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyE');
    assert.equal(await page.evaluate(() => Vinland.world.desiredAzimuth), blurAngle);
    const distance = await page.evaluate(() => Vinland.world.desiredDistance);
    await page.mouse.wheel(0, -160);
    assert.ok((await page.evaluate(() => Vinland.world.desiredDistance)) < distance);
    await page.locator('#center').click();
    await page.waitForTimeout(750);
    // Clicking opens a compact inspector, with detailed rooms one click away.
    const hallPoint = await page.evaluate(() => {
      const w = Vinland.world;
      const point = w.project(
        0,
        VinlandModel.elevation(0, 10, Vinland.simulation.state.config) + 4.5,
        10,
      );
      const bounds = w.container.getBoundingClientRect();
      return {
        x: point.x + bounds.left,
        y: point.y + bounds.top,
      };
    });
    await page.mouse.click(hallPoint.x, hallPoint.y);
    assert.equal(await page.locator('#inspector').isVisible(), true);
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false);
    assert.equal(await page.evaluate(() => !!Vinland.world.selectionMarker), true);
    const selectionBounds = await page.evaluate(() => {
      const world = Vinland.world;
      const hall = world.hall;
      hall.updateWorldMatrix(true, true);
      const hallAxis = new THREE.Vector3(1, 0, 0).transformDirection(hall.matrixWorld);
      const markerAxis = new THREE.Vector3(1, 0, 0).transformDirection(
        world.selectionMarker.matrixWorld,
      );
      // A known rectangle must keep its dimensions at arbitrary angles, rather
      // than expanding to enclose its rotated footprint along the map axes.
      const fixture = new THREE.Group();
      const geometry = new THREE.BoxGeometry(6, 4, 12);
      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(2, 2, -1);
      fixture.add(mesh);
      fixture.position.set(300, 200, 300);
      world.scene.add(fixture);
      const samples = [];
      for (const angle of [0.37, -0.91, 1.349]) {
        fixture.rotation.y = angle;
        world.selectObject(fixture);
        fixture.updateWorldMatrix(true, true);
        samples.push({
          size: world.selectionMarker.box.getSize(new THREE.Vector3()).toArray(),
          center: world.selectionMarker.box.getCenter(new THREE.Vector3()).toArray(),
          alignment: new THREE.Vector3(1, 0, 0)
            .transformDirection(world.selectionMarker.matrixWorld)
            .dot(new THREE.Vector3(1, 0, 0).transformDirection(fixture.matrixWorld)),
        });
      }
      const oldMarker = world.selectionMarker;
      world.selectObject(hall);
      fixture.removeFromParent();
      geometry.dispose();
      material.dispose();
      return {
        hallAlignment: hallAxis.dot(markerAxis),
        samples,
        oldMarkerDetached: !oldMarker.parent,
      };
    });
    assert.ok(selectionBounds.hallAlignment > 1 - 1e-10);
    assert.equal(selectionBounds.oldMarkerDetached, true);
    for (const sample of selectionBounds.samples) {
      assert.ok(sample.alignment > 1 - 1e-10);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(Math.abs(sample.size[axis] - [6, 4, 12][axis]) < 1e-8);
        assert.ok(Math.abs(sample.center[axis] - [2, 2, -1][axis]) < 1e-8);
      }
    }
    await page.locator('[data-action="inspect-hall"]').click();
    await content.locator('[data-room="IV"]').click();
    assert.match(await page.locator('#room-description').innerText(), /double slate/);
    // Windows do not obscure the console and can be moved by their title bar.
    const winBefore = await page.locator('#modal').boundingBox();
    await page.mouse.move(winBefore.x + 130, winBefore.y + 18);
    await page.mouse.down();
    await page.mouse.move(winBefore.x + 240, winBefore.y + 48, {
      steps: 8,
    });
    await page.mouse.up();
    assert.ok((await page.locator('#modal').boundingBox()).x > winBefore.x + 50);
    await content.locator('[data-action="cutaway"]').click();
    assert.equal(await page.evaluate(() => Vinland.world.cutaway), true);
    await page.screenshot({
      path: '/tmp/vinland-simulation-hall.png',
    });
    await page.locator('#center').click();
    await page.locator('#roof-toggle').click();
    await page.locator('[data-worker-action="idle"]').click();
    await page.locator('[data-worker-action="build"]').click();
    assert.equal(await page.locator('[data-category="all"]').count(), 0);
    assert.equal(
      await page.locator('[data-category="shelter"]').getAttribute('aria-selected'),
      'true',
    );
    // Every tool carries its own name, colored illustration, and nominal work.
    const illustratedTools = [];
    for (const category of ['shelter', 'craft', 'food']) {
      await page.locator(`[data-category="${category}"]`).click();
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-build] img')].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      const tools = await page.locator('[data-build]').evaluateAll((buttons) =>
        buttons.map((button) => ({
          type: button.dataset.build,
          name: button.querySelector('.build-card-title').textContent.trim(),
          work: button.querySelector('.build-hours').textContent.trim(),
          source: button.querySelector('img').getAttribute('src'),
        })),
      );
      for (const tool of tools) {
        const actualCategory = await page.evaluate(
          (type) => VinlandContent.TYPES[type].category,
          tool.type,
        );
        assert.equal(actualCategory, category);
      }
      illustratedTools.push(...tools);
    }
    await page.locator('[data-category="shelter"]').click();
    assert.equal(illustratedTools.length, 20);
    assert.equal(new Set(illustratedTools.map((tool) => tool.source)).size, 20);
    for (const tool of illustratedTools) {
      const definition = await page.evaluate((type) => VinlandContent.TYPES[type], tool.type);
      assert.equal(tool.name, definition.name);
      assert.equal(tool.work, definition.hours.toLocaleString('en') + ' person/hours');
    }
    await page.locator('[data-build="restore"]').hover();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#tool-readout, #build-tooltip').count(), 0);
    assert.equal(
      await page.locator('[data-build][title], [data-build][aria-describedby]').count(),
      0,
    );
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false);
    await page.screenshot({ path: '/tmp/vinland-building-buttons.png' });
    await page.evaluate(() => Vinland.setPaused(false));
    await page.waitForTimeout(1100);
    assert.match(
      await page.locator('[data-build="restore"] .build-hours').innerText(),
      /640 person\/hours/,
    );
    await page.evaluate(() => Vinland.setPaused(true));
    // Full material and stage costs remain an explicit right-click / F1 action.
    await page.locator('[data-build="restore"]').click({ button: 'right' });
    assert.equal(await page.evaluate(() => Vinland.simulation.state.queue.length), 0);
    assert.match(await content.innerText(), /nominal person-hours/);
    await page.locator('#close-modal').click();
    await page.locator('#palette-next').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.build), 'restore');
    assert.equal(await page.locator('#build-tooltip').count(), 0);
    await page.keyboard.press('F1');
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), true);
    await page.locator('#close-modal').click();
    await page.locator('[data-build="restore"]').click();
    // Interface fixtures use already-delivered stock; physical harvesting has
    // its own model and terrain-route tests instead of a calendar shortcut.
    await page.evaluate(() => {
      Vinland.simulation.state.resources.turf += 20;
    });
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false);
    await page.evaluate(() => {
      const simulation = Vinland.simulation;
      const order = simulation.state.queue.find((item) => item.type === 'restore');
      // Completion fixture: transport has finished before this labor check.
      for (const material of Object.values(order.materials)) {
        material.delivered = material.required;
        material.reservations = [];
      }
      order.progress = order.hours - 1;
      for (const person of simulation.availablePeople.filter(
        (person) => person.order?.buildingId === order.id,
      )) {
        person.cargo = null;
        person.order.supplying = false;
        person.x = person.order.x;
        person.z = person.order.z;
      }
      simulation.advanceConstruction(3600);
      simulation.emit();
    });
    assert.equal(await page.evaluate(() => Vinland.simulation.state.hallReady), true);
    assert.equal(
      await page.locator('#crew-button, [data-action="crew"], [data-preset], [data-task]').count(),
      0,
    );
    assert.equal(await page.evaluate(() => typeof Vinland.simulation.setTask), 'undefined');
    await page.locator('[data-build="sailbudir"]').click();
    assert.equal(await page.evaluate(() => Vinland.world.placing.type), 'sailbudir');
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false);
    await page.keyboard.down('KeyR');
    await page.waitForTimeout(350);
    await page.keyboard.up('KeyR');
    const footprintAngle = await page.evaluate(() => Vinland.world.placing.rotation);
    assert.ok(footprintAngle < -0.02 && footprintAngle > -0.25);
    await page.keyboard.down('KeyT');
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyT');
    assert.ok((await page.evaluate(() => Vinland.world.placing.rotation)) > footprintAngle);
    const buildingRates = await page.evaluate(() => {
      const world = Vinland.world;
      const initial = world.placing.rotation;
      world.keys.add('KeyR');
      for (let frame = 0; frame < 60; frame++) world.updateRotation(1 / 60);
      const normal = world.placing.rotation - initial;
      world.keys.add('ShiftRight');
      world.updateRotation(1);
      const fast = world.placing.rotation - initial - normal;
      world.keys.clear();
      world.placing.rotation = initial;
      world.updateGhost();
      return { normal, fast, previewMatches: world.ghost.rotation.y === initial };
    });
    assert.ok(Math.abs(buildingRates.normal + Math.PI / 12) < 1e-10);
    assert.ok(Math.abs(buildingRates.fast + Math.PI / 6) < 1e-10);
    assert.equal(buildingRates.previewMatches, true);
    const beforeBuildingButton = await page.evaluate(() => Vinland.world.placing.rotation);
    await page.locator('#rotate').hover();
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.up();
    const afterBuildingButton = await page.evaluate(() => Vinland.world.placing.rotation);
    assert.ok(afterBuildingButton < beforeBuildingButton);
    await page.locator('#rotate-left').hover();
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.up();
    assert.ok((await page.evaluate(() => Vinland.world.placing.rotation)) > afterBuildingButton);
    await page.waitForTimeout(600);
    const spot = await validSpot('sailbudir');
    assert.ok(spot);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.click(spot.x, spot.y);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.resources.sails), 3);
    assert.equal(await page.evaluate(() => Vinland.paused), true);
    assert.equal(await page.evaluate(() => Vinland.world.placing), null);
    assert.equal(await page.evaluate(() => Vinland.world.ghost), null);
    assert.equal(await page.evaluate(() => Vinland.app.activeBuild), null);
    assert.equal(
      await page.evaluate(() => Vinland.world.renderer.domElement.style.cursor),
      'default',
    );
    assert.equal(await page.locator('#placement-banner').isVisible(), false);
    // A successful order releases the cursor so another person can be selected
    // immediately, without Escape, right-click, or an extra construction order.
    const count = await page.evaluate(() => Vinland.simulation.state.queue.length);
    const worker = await page.evaluate(() => {
      const world = Vinland.world;
      const rectangle = world.container.getBoundingClientRect();
      for (const person of world.sim.availablePeople) {
        const object = world.people[person.id];
        const point = world.project(object.position.x, object.position.y + 0.9, object.position.z);
        const x = point.x + rectangle.left;
        const y = point.y + rectangle.top;
        if (
          x > 350 &&
          x < rectangle.right - 30 &&
          y > 150 &&
          y < rectangle.bottom - 40 &&
          world.workerControls.hitPerson({ clientX: x, clientY: y }) === person.id
        ) {
          return { id: person.id, x, y };
        }
      }
      return null;
    });
    assert.ok(worker);
    await page.mouse.click(worker.x, worker.y);
    assert.deepEqual(await page.evaluate(() => [...Vinland.app.workerControls.selected]), [
      worker.id,
    ]);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.queue.length), count);
    await page.locator('[data-worker-action="build"]').click();
    await page.locator('[data-build="sailbudir"]').click();
    // Invalid sites retain the preview so the player can choose a clear spot.
    await page.mouse.click(spot.x, spot.y);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.queue.length), count);
    const second = await validSpot('sailbudir', [
      {
        x: spot.worldX,
        z: spot.worldZ,
      },
    ]);
    assert.ok(second);
    await page.mouse.click(second.x, second.y);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.resources.sails), 2);
    assert.equal(await page.evaluate(() => Vinland.world.placing), null);
    await page.locator('[data-build="sailbudir"]').click();
    // Right-drag pans and retains the tool; right-click cancels without adding an order.
    await page.mouse.move(1040, 420);
    await page.mouse.down({
      button: 'right',
    });
    await page.mouse.move(1090, 450, {
      steps: 8,
    });
    await page.mouse.up({
      button: 'right',
    });
    assert.equal(await page.evaluate(() => Vinland.world.placing.type), 'sailbudir');
    await page.mouse.click(1040, 420, {
      button: 'right',
    });
    assert.equal(await page.evaluate(() => Vinland.world.placing), null);
    await page.locator('.command-strip [data-action="activity"]').click();
    assert.match(await content.innerText(), /Sail-roofed búð/);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false);
    await page.evaluate(() => {
      const simulation = Vinland.simulation;
      const order = simulation.state.queue.find((item) => item.type === 'sailbudir');
      for (const material of Object.values(order.materials)) {
        material.delivered = material.required;
        material.reservations = [];
      }
      order.progress = order.hours - 1;
      for (const person of simulation.availablePeople.filter(
        (person) => person.order?.buildingId === order.id,
      )) {
        person.cargo = null;
        person.order.supplying = false;
        person.x = person.order.x;
        person.z = person.order.z;
      }
      simulation.advanceConstruction(3600);
      simulation.emit();
    });
    assert.equal(await page.evaluate(() => Vinland.simulation.has('sailbudir')), true);
    await page.locator('.command-strip [data-action="settlement"]').click();
    await page.locator('.window-tabs [data-action="stocks"]').click();
    assert.match(await content.innerText(), /Fresh fish/);
    assert.match(await content.innerText(), /firewood/);
    await page.locator('#close-modal').click();
    await page.locator('.command-strip [data-action="settlement"]').click();
    await page.locator('.window-tabs [data-action="council"]').click();
    await page.locator('#policy-workHours').selectOption('6');
    await content.locator('[data-action="propose"][data-rule="workHours"]').click();
    await page.evaluate(() => Vinland.setPaused(true));
    await page.evaluate(() => Vinland.simulation.advance(24));
    assert.equal(await page.evaluate(() => Vinland.simulation.state.politics.workHours), 6);
    await page.locator('#atlantic-view').click();
    assert.equal(await page.locator('#atlantic-screen').isVisible(), true);
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false);
    assert.equal(await page.evaluate(() => Vinland.app.screen), 'atlantic');
    assert.equal(
      await page.locator('#atlantic-map image').getAttribute('href'),
      'assets/maps/north-atlantic.svg',
    );
    const mapBox = await page.locator('#atlantic-map').getAttribute('viewBox');
    await page.locator('[data-atlantic="zoom-in"]').click();
    assert.notEqual(await page.locator('#atlantic-map').getAttribute('viewBox'), mapBox);
    await page.locator('[data-atlantic="fit"]').click();
    assert.equal(await page.locator('#atlantic-map').getAttribute('viewBox'), mapBox);
    await page.locator('.atlantic-harbours [data-port="iceland"]').click();
    assert.equal(await page.locator('#atlantic-port-name').innerText(), 'Iceland');
    assert.match(await page.locator('#atlantic-port-coordinate').innerText(), /64.15°N/);
    await page.locator('#atlantic-timber').fill('99999');
    assert.equal(await page.locator('#atlantic-launch').isDisabled(), true);
    await page.locator('#atlantic-timber').fill('6');
    await page.locator('.atlantic-harbours [data-port="greenland"]').click();
    const chartBounds = await page.locator('#atlantic-map').boundingBox();
    await page.mouse.move(
      chartBounds.x + chartBounds.width / 2,
      chartBounds.y + chartBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      chartBounds.x + chartBounds.width / 2 + 55,
      chartBounds.y + chartBounds.height / 2 + 30,
      { steps: 5 },
    );
    await page.mouse.up();
    assert.notEqual(await page.locator('#atlantic-map').getAttribute('viewBox'), mapBox);
    await page.locator('[data-atlantic="fit"]').click();
    // Map controls must never move Karlsefni or the settlement camera.
    const cameraBeforeChartKey = await page.evaluate(() => Vinland.world.target.toArray());
    await page.locator('#atlantic-map').focus();
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(
      await page.evaluate(() => Vinland.world.target.toArray()),
      cameraBeforeChartKey,
    );
    await page.locator('[data-atlantic="fit"]').click();
    await page.screenshot({
      path: '/tmp/vinland-simulation-atlantic.png',
    });
    await page.locator('[data-atlantic="district"]').click();
    assert.equal(await page.locator('#atlantic-screen').isVisible(), false);
    await page.keyboard.press('KeyE');
    const fixedAngle = await page.evaluate(() => Vinland.world.desiredAzimuth);
    await page.locator('#walk-view').click();
    assert.equal(await page.evaluate(() => Vinland.world.orbitSaved.azimuth), fixedAngle);
    assert.equal(await page.evaluate(() => Vinland.world.camera.isPerspectiveCamera), true);
    assert.equal(
      await page.evaluate(() => Vinland.world.h),
      await page.locator('#world').evaluate((event) => event.clientHeight),
    );
    const before = await page.evaluate(() => ({
      ...Vinland.simulation.state.leader,
    }));
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1200);
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => ({
      ...Vinland.simulation.state.leader,
    }));
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0.3);
    // Arrow keys turn the walk camera without moving Karlsefni, including
    // while the simulation is paused. WASD remains the movement control.
    for (const [key, yawDirection, pitchDirection] of [
      ['ArrowLeft', 1, 0],
      ['ArrowRight', -1, 0],
      ['ArrowUp', 0, -1],
      ['ArrowDown', 0, 1],
    ]) {
      await page.keyboard.down(key);
      const look = await page.evaluate(() => {
        const world = Vinland.world;
        const paused = world.paused;
        const yaw = world.walkYaw;
        const pitch = world.walkPitch;
        const leader = { ...Vinland.simulation.state.leader };
        world.paused = true;
        world.updateCamera(0.25);
        const result = {
          yaw: world.walkYaw - yaw,
          pitch: world.walkPitch - pitch,
          movement: world.readMovementInput(),
          distance: Math.hypot(
            leader.x - Vinland.simulation.state.leader.x,
            leader.z - Vinland.simulation.state.leader.z,
          ),
        };
        world.paused = paused;
        return result;
      });
      await page.keyboard.up(key);
      assert.ok(Math.abs(look.yaw - (yawDirection * Math.PI) / 12) < 1e-8);
      assert.ok(Math.abs(look.pitch - (pitchDirection * Math.PI) / 12) < 1e-8);
      assert.deepEqual(look.movement, { forward: 0, right: 0 });
      assert.equal(look.distance, 0);
    }
    const lookLimits = await page.evaluate(() => {
      const world = Vinland.world;
      const yaw = world.walkYaw,
        pitch = world.walkPitch;
      world.keys.clear();
      world.keys.add('ArrowRight');
      world.updateWalkLook(1);
      const singleFrame = world.walkYaw;
      world.walkYaw = yaw;
      for (let frame = 0; frame < 60; frame++) world.updateWalkLook(1 / 60);
      const frameDifference = world.walkYaw - singleFrame;
      world.keys.add('ArrowLeft');
      const beforeOpposites = world.walkYaw;
      world.updateWalkLook(1);
      const opposites = world.walkYaw - beforeOpposites;
      world.rotateWalkView(0, 100);
      const downLimit = world.walkPitch;
      world.rotateWalkView(0, -100);
      const upLimit = world.walkPitch;
      world.keys.clear();
      world.walkYaw = yaw;
      world.walkPitch = pitch;
      return { frameDifference, opposites, downLimit, upLimit };
    });
    assert.ok(Math.abs(lookLimits.frameDifference) < 1e-8);
    assert.equal(lookLimits.opposites, 0);
    assert.ok(lookLimits.upLimit >= -Math.PI * 0.44);
    assert.ok(lookLimits.downLimit <= Math.PI * 0.4);
    // Lateral movement must follow camera-right at every viewing angle.
    for (const yaw of [0, Math.PI / 2, 1.1]) {
      for (const [key, direction, sprintKey] of [
        ['KeyA', -1],
        ['KeyA', -1, 'ShiftLeft'],
        ['KeyD', 1],
        ['KeyD', 1, 'ShiftRight'],
      ]) {
        if (sprintKey) {
          await page.keyboard.down(sprintKey);
        }
        await page.keyboard.down(key);
        const horizontalMovement = await page.evaluate(
          ({ yaw }) => {
            const world = Vinland.world;
            const leader = Vinland.simulation.state.leader;
            const savedLeader = { ...leader };
            const savedYaw = world.walkYaw;
            const savedPaused = world.paused;
            // Use open terrain so a collision cannot hide an inverted control.
            let origin;
            for (let x = -100; x <= 100 && !origin; x += 10) {
              for (let z = -100; z <= 100 && !origin; z += 10) {
                if (
                  world.clearAt(x - 2, z) &&
                  world.clearAt(x + 2, z) &&
                  world.clearAt(x, z - 2) &&
                  world.clearAt(x, z + 2)
                ) {
                  origin = { x, z };
                }
              }
            }
            if (!origin) throw new Error('No open walking test location');
            Object.assign(leader, origin);
            world.walkYaw = yaw;
            world.paused = true;
            // Settle the damped camera before measuring exact movement along
            // camera-right; the camera transition itself is tested separately.
            world.updateCamera(10);
            world.camera.updateMatrixWorld(true);
            const cameraRight = new THREE.Vector3().setFromMatrixColumn(
              world.camera.matrixWorld,
              0,
            );
            world.paused = false;
            world.stepLeader(0.25);
            world.updateCamera(0.25);
            const movement =
              (leader.x - origin.x) * cameraRight.x + (leader.z - origin.z) * cameraRight.z;
            Object.assign(leader, savedLeader);
            world.walkYaw = savedYaw;
            world.paused = savedPaused;
            world.updateCamera(0);
            return movement;
          },
          { yaw },
        );
        await page.keyboard.up(key);
        if (sprintKey) {
          await page.keyboard.up(sprintKey);
        }
        assert.ok(horizontalMovement * direction > 0.3, `${key} inverted at yaw ${yaw}`);
        const expectedDistance = 1.4 * 0.25 * (sprintKey ? 3 : 1);
        assert.ok(
          Math.abs(Math.abs(horizontalMovement) - expectedDistance) < 1e-8,
          `${key} with ${sprintKey || 'no Shift'} must move at the expected speed`,
        );
      }
    }
    await page.screenshot({
      path: '/tmp/vinland-simulation-walk.png',
    });
    await page.locator('#district-view').click();
    assert.equal(await page.evaluate(() => Vinland.world.camera.isOrthographicCamera), true);
    assert.equal(await page.evaluate(() => Vinland.world.desiredAzimuth), fixedAngle);
    await page.evaluate(() => Vinland.setPaused(true));
    await page.locator('#manage-button').click();
    await content.locator('[data-action="save"]').click();
    const day = await page.evaluate(() => Vinland.simulation.day);
    await page.reload();
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    assert.equal(await page.locator('#title-screen').isVisible(), true);
    await loadSavedCampaign(page);
    assert.equal(await page.evaluate(() => Vinland.simulation.day), day);
    await page.locator('#manage-button').click();
    await content.locator('[data-action="scenario"]').click();
    await page.locator('#scenario-preset').selectOption('traders');
    await content.locator('[data-action="start-campaign"]').click();
    assert.equal(await page.evaluate(() => Vinland.simulation.state.population), 48);
    assert.equal(await page.evaluate(() => Vinland.world.people.length), 48);
    assert.equal(await page.evaluate(() => Vinland.world.ships.length), 2);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#hall-label').isVisible(), false);
    await page.locator('[data-worker-action="idle"]').click();
    await page.locator('[data-worker-action="build"]').click();
    // Three sizes keep the canvas clear of the dock and all text at least 14 px.
    for (const [name, width, height] of [
      ['tablet', 1024, 768],
      ['mobile', 390, 844],
      ['short', 1280, 640],
    ]) {
      await page.setViewportSize({
        width,
        height,
      });
      await page.waitForTimeout(550);
      const bounds = await page.evaluate(() => {
        const a = document.querySelector('#world').getBoundingClientRect();
        const b = document.querySelector('.simulation-console').getBoundingClientRect();
        return {
          worldBottom: a.bottom,
          dockTop: b.top,
          worldHeight: a.height,
          canvasHeight: Vinland.world.h,
        };
      });
      assert.ok(Math.abs(bounds.worldBottom - bounds.dockTop) < 2);
      assert.equal(bounds.worldHeight, bounds.canvasHeight);
      assert.ok(bounds.worldHeight > 240);
      const responsiveBar = await page.locator('.topbar').boundingBox();
      const responsiveTitle = await page.locator('.brand').boundingBox();
      assert.equal(responsiveBar.height, width <= 700 ? 64 : 44);
      assert.ok(Math.abs(responsiveTitle.x + responsiveTitle.width / 2 - width / 2) < 1);
      if (name === 'mobile') {
        const overflow = await page
          .locator('#resources')
          .evaluate((bar) => bar.scrollWidth - bar.clientWidth);
        assert.ok(overflow <= 1, 'all seven resource quantities should fit on the phone');
      }
      const firstResource = page.locator('[data-resource="food"]');
      await firstResource.tap();
      assert.equal(await resourceTooltip.isVisible(), true);
      const touchTooltip = await resourceTooltip.boundingBox();
      assert.ok(touchTooltip.x >= 0 && touchTooltip.x + touchTooltip.width <= width);
      await page.mouse.move(width / 2, 200);
      await firstResource.evaluate((item) => item.blur());
      const tiny = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#game button,#game small,.build-cost,.build-labor'))
          .filter(
            (event) =>
              event.getClientRects().length && parseFloat(getComputedStyle(event).fontSize) < 14,
          )
          .map((event) => event.textContent),
      );
      assert.deepEqual(tiny, []);
      const tool = page.locator('[data-build="sailbudir"]');
      await tool.hover();
      assert.equal(await page.locator('#build-tooltip').count(), 0);
      const titleBounds = await tool.locator('.build-card-title').boundingBox();
      const imageBounds = await tool.locator('.building-icon img').boundingBox();
      const workBounds = await tool.locator('.build-hours').boundingBox();
      const toolBounds = await tool.boundingBox();
      assert.ok(titleBounds.y < imageBounds.y);
      assert.ok(imageBounds.y + imageBounds.height <= workBounds.y + 1);
      const topGap = imageBounds.y - (titleBounds.y + titleBounds.height);
      const bottomGap = workBounds.y - (imageBounds.y + imageBounds.height);
      assert.ok(Math.abs(topGap - bottomGap) < 0.1, `${name}: unequal icon gaps`);
      assert.ok(
        workBounds.x >= toolBounds.x &&
          workBounds.x + workBounds.width <= toolBounds.x + toolBounds.width,
      );
      assert.equal(
        await tool.evaluate((button) => button.scrollHeight <= button.clientHeight + 1),
        true,
      );
      await page.screenshot({
        path: '/tmp/vinland-simulation-' + name + '.png',
      });
      await page.locator('#manage-button').click();
      const menuBounds = await page.locator('#modal').boundingBox();
      assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width);
      assert.ok(menuBounds.y >= 0 && menuBounds.y + menuBounds.height <= height);
      assert.equal(await content.locator('[data-action="quit"]').isVisible(), true);
      await page.screenshot({ path: '/tmp/vinland-menu-' + name + '.png' });
      await page.keyboard.press('Escape');
      await page.evaluate(() => Vinland.view('atlantic'));
      assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false);
      const atlanticBounds = await page.locator('#atlantic-screen').boundingBox();
      assert.ok(atlanticBounds.y + atlanticBounds.height <= height);
      assert.ok((await page.locator('#atlantic-map').boundingBox()).height >= 200);
      await page.screenshot({ path: '/tmp/vinland-atlantic-' + name + '.png' });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#atlantic-screen').isVisible(), false);
    }
    await page.setViewportSize({
      width: 390,
      height: 844,
    });
    await page.waitForTimeout(400);
    await page.locator('#mobile-walk').click();
    assert.equal(await page.evaluate(() => Vinland.world.view), 'walk');
    await page.locator('#mobile-walk').click();
    assert.equal(await page.evaluate(() => Vinland.world.view), 'district');
    await page.evaluate(() => Vinland.setPaused(true));
    // Touch pinch zooms without producing clicks or construction orders.
    const cdp = await page.context().newCDPSession(page);
    const zoom = await page.evaluate(() => Vinland.world.desiredDistance);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        {
          x: 140,
          y: 300,
          id: 1,
        },
        {
          x: 250,
          y: 300,
          id: 2,
        },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: 110,
          y: 300,
          id: 1,
        },
        {
          x: 280,
          y: 300,
          id: 2,
        },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    assert.ok((await page.evaluate(() => Vinland.world.desiredDistance)) < zoom);
    assert.equal(await page.evaluate(() => Vinland.world.pointer.down), false);
    await page.locator('#manage-button').click();
    await content.locator('[data-action="campaign"]').click();
    await page.locator('#text-scale').selectOption('1.3');
    await page.locator('#close-modal').click();
    await page.waitForTimeout(200);
    assert.ok(
      (await page
        .locator('.command-strip [data-action="settlement"]')
        .evaluate((event) => parseFloat(getComputedStyle(event).fontSize))) >= 18,
    );
    const largeTool = page.locator('[data-build="sailbudir"]');
    await largeTool.hover();
    assert.equal(await page.locator('#build-tooltip').count(), 0);
    assert.equal(
      await largeTool.evaluate((button) => button.scrollHeight <= button.clientHeight + 1),
      true,
    );
    assert.ok(
      (await largeTool
        .locator('.build-hours')
        .evaluate((label) => parseFloat(getComputedStyle(label).fontSize))) >= 18,
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-build] img')].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    const illustration = await largeTool.locator('img').boundingBox();
    assert.ok(illustration.width > 20 && illustration.height > 20);
    await page.screenshot({ path: '/tmp/vinland-simulation-large-text.png' });
    assert.equal(await page.locator('#error').isVisible(), false);
    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: 'PASS',
        initial,
        offlineRequests: network.length,
        errors,
        controls: [
          'pan',
          'keyboard pan',
          'zoom',
          'continuous rotation',
          'direct inspection',
          'window drag',
          'direct placement',
          'placement releases cursor for worker selection',
          'blocked site',
          'right-drag',
          'right-click cancel',
          'touch pinch',
          'walking',
        ],
        layouts: ['desktop', 'tablet', 'mobile', 'short'],
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((event) => {
  console.error(event);
  process.exit(1);
});
