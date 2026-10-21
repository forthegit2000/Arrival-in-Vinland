/** Cargo must occupy bounded vessel bays rather than growing above the mast. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { startDefaultCampaign } = require('./browser-session.cjs');

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
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page, { arrival: true });
    const initial = await page.evaluate(() => {
      Vinland.setPaused(true);
      const world = Vinland.world,
        sim = Vinland.simulation;
      window.cargoStockBefore = JSON.stringify(
        Object.values(sim.state.storage.stores).map((store) => [store.id, store.stock]),
      );
      world.updateArrivalPresentation();
      window.checkCargoBounds = () => {
        const summary = [];
        for (const [id, cargo] of world.arrivalCargo) {
          const bay = cargo.userData.bay;
          const box = new THREE.Box3();
          const localBounds = new THREE.Box3();
          cargo.updateMatrixWorld(true);
          const inverse = cargo.matrixWorld.clone().invert();
          // Include actual instance geometry, not merely declared layout dimensions.
          cargo.traverse((mesh) => {
            if (!mesh.isInstancedMesh) return;
            mesh.geometry.computeBoundingBox();
            for (let index = 0; index < mesh.count; index++) {
              const matrix = new THREE.Matrix4();
              mesh.getMatrixAt(index, matrix);
              matrix.premultiply(mesh.matrixWorld).premultiply(inverse);
              box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix);
              localBounds.union(box);
            }
          });
          if (!localBounds.isEmpty()) {
            const epsilon = 1e-6;
            if (
              localBounds.min.x < bay.x - bay.w / 2 - epsilon ||
              localBounds.max.x > bay.x + bay.w / 2 + epsilon ||
              localBounds.min.z < bay.z - bay.d / 2 - epsilon ||
              localBounds.max.z > bay.z + bay.d / 2 + epsilon ||
              localBounds.min.y < bay.y - epsilon ||
              localBounds.max.y > bay.y + bay.h + epsilon
            )
              throw Error('Cargo escaped its bay: ' + id + ' ' + JSON.stringify(localBounds));
            if (id.startsWith('ship:')) {
              const frame = world.boatFrame(Number(id.slice(5)));
              for (const x of [localBounds.min.x, localBounds.max.x])
                for (const z of [localBounds.min.z, localBounds.max.z]) {
                  const corner = VinlandBuildingSpaces.toWorld(frame, { x, z });
                  if (!world.deckContains(frame, corner)) throw Error('Cargo crossed hull outline');
                }
              if (localBounds.max.y >= frame.geometry.deckHeight)
                throw Error('Hold cargo intersects the walking deck');
            }
          }
          for (const entry of cargo.userData.cargo) {
            if (entry.overflowVolume > 1e-7)
              throw Error('Normal cargo does not fit: ' + id + ':' + entry.resource);
            if (
              Math.abs(
                entry.occupied -
                  VinlandStorage.volume(
                    entry.resource,
                    sim.state.storage.stores[id].stock[entry.resource],
                  ),
              ) > 1e-8
            )
              throw Error('Cargo volume disagrees with inventory');
          }
          summary.push({
            id,
            bounds: localBounds.isEmpty()
              ? null
              : { min: localBounds.min.toArray(), max: localBounds.max.toArray() },
            cargo: cargo.userData.cargo,
          });
        }
        return summary;
      };
      const result = checkCargoBounds();
      if (
        cargoStockBefore !==
        JSON.stringify(
          Object.values(sim.state.storage.stores).map((store) => [store.id, store.stock]),
        )
      )
        throw Error('Rendering changed stock');
      return result;
    });
    const livestock = initial.find((store) =>
      store.cargo.some((entry) => entry.resource === 'hay'),
    );
    assert.equal(livestock.cargo.find((entry) => entry.resource === 'hay').amount, 1200);
    assert.ok(livestock.bounds.max[1] < 1.16);

    const updates = await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world;
      const sourceId = 'ship:' + sim.state.arrival.livestockShip;
      const source = sim.state.storage.stores[sourceId];
      const before = world.arrivalCargo.get(sourceId);
      const beforeVolume = before.userData.cargo.find(
        (entry) => entry.resource === 'hay',
      ).representedVolume;
      world.updateArrivalPresentation();
      const reused = before === world.arrivalCargo.get(sourceId);
      // Perform a real transfer, leaving total resources unchanged.
      const moved = VinlandStorage.withdraw(sim.state, sourceId, 'hay', 200);
      const deposited = VinlandStorage.deposit(sim.state, 'ferry', 'hay', moved);
      if (deposited !== moved) throw Error('Tender transfer failed');
      world.updateArrivalPresentation();
      const after = world.arrivalCargo.get(sourceId);
      const smaller =
        after.userData.cargo.find((entry) => entry.resource === 'hay').representedVolume <
        beforeVolume;
      checkCargoBounds();
      const saved = sim.serialize();
      const restored = VinlandModel.Simulation.load(saved);
      if (
        !restored ||
        restored.state.storage.stores[sourceId].stock.hay !== source.stock.hay ||
        restored.state.storage.stores.ferry.stock.hay !== 200
      )
        throw Error('Cargo save/load failed');
      // Emptying one resource removes only that resource's visual.
      const remaining = source.stock.hay;
      const removed = VinlandStorage.withdraw(sim.state, sourceId, 'hay', remaining);
      VinlandStorage.deposit(sim.state, 'camp', 'hay', removed);
      world.updateArrivalPresentation();
      if (world.arrivalCargo.get(sourceId).userData.cargo.some((entry) => entry.resource === 'hay'))
        throw Error('Empty hay stack remains');
      const retainedWater = world.arrivalCargo
        .get(sourceId)
        .userData.cargo.some((entry) => entry.resource === 'water');
      checkCargoBounds();
      Vinland.replaceSimulation(restored);
      Vinland.setPaused(true);
      return { reused, smaller, retainedWater, moved };
    });
    assert.deepEqual(updates, { reused: true, smaller: true, retainedWater: true, moved: 200 });

    const overload = await page.evaluate(() => {
      const cargo = VinlandWorldModels.createCargoStowage(
        [{ resource: 'hay', amount: 9000, occupied: 100 }],
        [{ x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }],
      );
      const box = new THREE.Box3().setFromObject(cargo);
      const result = {
        height: box.max.y - box.min.y,
        overflow: cargo.userData.cargo[0].overflowVolume,
        amount: cargo.userData.cargo[0].amount,
      };
      Vinland.world.disposeStorageMarker(cargo);
      return result;
    });
    assert.ok(overload.height <= 1);
    assert.equal(overload.overflow, 99);
    assert.equal(overload.amount, 9000);
    await page.evaluate(() => {
      Vinland.view('district');
      const world = Vinland.world;
      const ship = world.ships[Vinland.simulation.state.arrival.livestockShip];
      world.focus(ship.position.x, ship.position.z, 35);
      world.distance = world.desiredDistance;
      world.updateProjection();
      world.updateCamera(1);
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: '/tmp/vinland-ship-cargo-district.png' });
    await page.evaluate(() => {
      Vinland.view('walk');
      Vinland.setPaused(true);
      Vinland.world.updateCamera(1);
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: '/tmp/vinland-ship-cargo-walk.png' });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(JSON.stringify({ initial, updates, overload, offline: true }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
