/** Baked knarr geometry, offline loading, shared resources and isolated rendering. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { startDefaultCampaign } = require('./browser-session.cjs');

const directory = path.join(__dirname, '..');
const binary = fs.readFileSync(path.join(directory, 'assets/models/knarr.glb'));
const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(directory, 'assets/models/knarr-data.js'), 'utf8'),
  context,
);
assert.deepEqual(Buffer.from(context.window.VinlandKnarrData, 'base64'), binary);
assert.equal(binary.readUInt32LE(0), 0x46546c67);
assert.equal(binary.readUInt32LE(4), 2);
assert.equal(binary.readUInt32LE(8), binary.length);
const jsonLength = binary.readUInt32LE(12);
const document = JSON.parse(binary.subarray(20, 20 + jsonLength).toString());
assert.equal(document.asset.version, '2.0');
assert.equal(document.meshes.length, 2);
assert.ok(
  document.buffers.every((buffer) => !buffer.uri),
  'GLB has no external buffers',
);
assert.equal(document.images, undefined, 'No external texture requests');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
    const errors = [],
      requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page, { arrival: true });
    const checks = await page.evaluate(() => {
      Vinland.setPaused(true);
      const world = Vinland.world;
      const structures = world.ships.map((ship) => ship.getObjectByName('Baked knarr structure'));
      const first = structures[0].children[0];
      let finite = true,
        indicesValid = true;
      for (const mesh of structures[0].children) {
        const geometry = mesh.geometry;
        for (const attribute of Object.values(geometry.attributes))
          finite &&= attribute.array.every(Number.isFinite);
        indicesValid &&= geometry.index.array.every(
          (index) => index < geometry.attributes.position.count,
        );
      }
      const positions = first.geometry.attributes.position;
      const keel = [];
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(positions.getX(i) + 0.085) < 1e-5 && positions.getY(i) < 2.5)
          keel.push({ y: positions.getY(i), z: positions.getZ(i) });
      }
      const sections = [];
      for (let step = 1; step < 48; step++) {
        const z = (step / 48 - 0.5) * 17.5;
        const end = Math.abs((z * 2) / 17.5);
        const base = -1.03 + 0.12 * end ** 2 + 3.25 * end ** 8;
        let closedBottom = false;
        for (let i = 0; i < positions.count; i++) {
          if (
            Math.abs(positions.getZ(i) - z) < 1e-5 &&
            Math.abs(positions.getX(i)) < 1e-6 &&
            Math.abs(positions.getY(i) - (base - 0.045)) < 1e-5
          )
            closedBottom = true;
        }
        const underside = keel.filter((p) => Math.abs(p.z - z) < 1e-5);
        const lowest = Math.min(...underside.map((p) => p.y));
        sections.push(closedBottom && Math.abs(base - lowest - 0.19) < 1e-5);
      }
      const geometry = world.ships[0].userData.boatGeometry;
      return {
        finite,
        indicesValid,
        sections,
        shared: structures.every(
          (group) =>
            group.children[0].geometry === first.geometry &&
            group.children[0].material === first.material,
        ),
        separateObstacles:
          world.ships[0].userData.boatGeometry.obstacles !==
          world.ships[1].userData.boatGeometry.obstacles,
        geometry,
        saved: !!VinlandModel.Simulation.load(Vinland.simulation.serialize()),
        passengers: Vinland.simulation.state.people.filter(VinlandArrival.aboard).length,
      };
    });
    assert.equal(checks.finite, true);
    assert.equal(checks.indicesValid, true);
    assert.ok(
      checks.sections.every(Boolean),
      'Bottom closes and keel follows the hull at every station',
    );
    assert.equal(checks.shared, true);
    assert.equal(checks.separateObstacles, true);
    assert.equal(checks.geometry.length, 17.5);
    assert.equal(checks.geometry.width, 5.2);
    assert.equal(checks.geometry.deckHeight, 1.16);
    assert.equal(checks.saved, true);
    assert.equal(checks.passengers, 160);

    const render = await page.evaluate(() => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#70838a');
      scene.add(new THREE.HemisphereLight('#fff0d7', '#586373', 2.3));
      const sunlight = new THREE.DirectionalLight('#fff0d8', 3.2);
      sunlight.position.set(12, 18, 9);
      scene.add(sunlight);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1200, 760);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.domElement.id = 'knarr-preview';
      renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:99999;';
      document.body.appendChild(renderer.domElement);
      const camera = new THREE.OrthographicCamera(-11.5, 11.5, 7.283, -7.283, 0.1, 150);
      camera.position.set(25, 6, 0);
      camera.lookAt(0, 2, 0);
      function measure(group) {
        scene.add(group);
        for (let i = 0; i < 20; i++) renderer.render(scene, camera);
        const start = performance.now();
        for (let i = 0; i < 60; i++) renderer.render(scene, camera);
        const result = {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          submissionMilliseconds: (performance.now() - start) / 60,
        };
        scene.remove(group);
        return result;
      }
      const oldHull = Vinland.world.buildHull(17.5, 5.2, true);
      const asset = VinlandKnarr.create();
      const before = measure(oldHull),
        after = measure(asset);
      scene.add(asset);
      window.knarrPreview = { scene, renderer, camera, asset };
      renderer.render(scene, camera);
      return { before, after };
    });
    assert.ok(render.before.calls >= 40);
    assert.equal(render.after.calls, 2);
    await page.locator('#knarr-preview').screenshot({ path: '/tmp/vinland-knarr-side.png' });
    for (const [name, position, target] of [
      ['underside', [18, -12, 14], [0, 0, 0]],
      ['three-quarter', [20, 16, 25], [0, 4.7, 0]],
    ]) {
      await page.evaluate(
        ({ position, target, name }) => {
          const { camera, scene, renderer } = knarrPreview;
          const halfWidth = name === 'three-quarter' ? 13.8 : 11.5;
          camera.left = -halfWidth;
          camera.right = halfWidth;
          camera.top = (halfWidth * 760) / 1200;
          camera.bottom = -camera.top;
          camera.updateProjectionMatrix();
          camera.position.set(...position);
          camera.lookAt(...target);
          renderer.render(scene, camera);
        },
        { position, target, name },
      );
      await page
        .locator('#knarr-preview')
        .screenshot({ path: '/tmp/vinland-knarr-' + name + '.png' });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log('Knarr asset checks passed:', { ...render, assetBytes: binary.length });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
