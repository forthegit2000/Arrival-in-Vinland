/** Model factories work independently; world controllers register their parts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { startDefaultCampaign } = require('./browser-session.cjs');
const THREE = require('../vendor/three.min.js');
const Content = require('../content.js');
const Spaces = require('../building-spaces.js');

const directory = path.join(__dirname, '..');
// No document, world, simulation or storage modules are exposed to this realm.
// Layouts, dimensions and pile-ground offsets must come through explicit inputs.
const isolated = { window: { THREE }, atob, TextDecoder };
for (const file of ['assets/models/knarr-data.js', 'knarr-model.js', 'world-models.js'])
  vm.runInNewContext(fs.readFileSync(path.join(directory, file), 'utf8'), isolated, {
    filename: file,
  });
const Models = isolated.window.VinlandWorldModels;
const oven = Models.createSlateOven({ x: -5.1, z: -9 }, () => 0.5);
assert.equal(oven.children.length, 26);
assert.ok(oven.children.every((part) => part.position.toArray().every(Number.isFinite)));
const hall = Models.createHall(Spaces.HALL_ROOMS);
assert.equal(hall.object.parent, null);
assert.equal(hall.roomMeshes.length, Spaces.HALL_ROOMS.length);
assert.equal(hall.hearths.length, 4);
assert.equal(hall.smokeSources.length, 4);
for (const hearth of hall.hearths) {
  assert.ok(hall.inside.children.includes(hearth));
  assert.ok(hearth.children.includes(hearth.userData.flame));
}
for (const type of Object.keys(Content.TYPES)) {
  const model = Models.createBuilding(type, Content.TYPES[type], Spaces.plan(type));
  assert.equal(model.object.userData.select, 'building', type);
  assert.ok(model.object.children.includes(model.object.userData.base), type + ' base');
  assert.ok(model.object.children.includes(model.object.userData.roof), type + ' roof');
  for (const hearth of model.hearths)
    assert.ok(model.object.userData.base.children.includes(hearth));
}
for (const resource of ['firewood', 'water', 'turf']) {
  const pile = {
    resource,
    occupied: 0.2,
    w: 2.4,
    d: 1.2,
    h: 1.4,
    x: 20,
    z: 35,
    indoor: false,
    storeId: 'camp',
  };
  const options = {
    isWood: resource === 'firewood',
    woodSolidFraction: 0.7,
    groundOffsetAt: () => 0,
  };
  const level = Models.createResourcePile(pile, options);
  const raised = Models.createResourcePile(pile, { ...options, groundOffsetAt: () => 0.3 });
  for (let child = 0; child < level.children.length; child++) {
    const before = level.children[child].instanceMatrix.array,
      after = raised.children[child].instanceMatrix.array;
    for (let index = 0; index < before.length; index++) {
      const expected = before[index] + (index % 16 === 13 ? 0.3 : 0);
      assert.ok(
        Math.abs(after[index] - expected) < 1e-6,
        resource + ' respects supplied ground height',
      );
    }
  }
}
const knarr = Models.createKnarr({ livestock: false, arriving: false, random: () => 0.5 });
assert.ok(knarr.object.children.includes(knarr.sail));
assert.equal(knarr.object.userData.boatGeometry.obstacles.length, 10);
console.log('Model factories work without a world, document or simulation.');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  try {
    const page = await browser.newPage();
    const errors = [],
      requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const result = await page.evaluate(() => {
      Vinland.setPaused(true);
      const world = Vinland.world,
        sim = Vinland.simulation,
        before = sim.serialize();
      const check = (value, message) => {
        if (!value) throw Error(message);
      };
      check(world.hall.children.includes(world.hallInside), 'Hall interior handle disconnected');
      check(world.hall.children.includes(world.hallWalls), 'Hall wall handle disconnected');
      check(world.hall.children.includes(world.hallRoofs), 'Hall roof handle disconnected');
      check(world.roomMeshes.length === 7, 'Hall room selection handles missing');
      for (const floor of world.roomMeshes)
        check(
          floor.parent === world.hallInside && floor.userData.room,
          'Room floor metadata missing',
        );
      let hearths = 0;
      world.hallInside.traverse((object) => {
        if (!object.userData.hearth) return;
        hearths++;
        check(world.fires.includes(object.userData.flame), 'Hearth animation not registered');
      });
      check(hearths === 4 && world.smokes.length >= 4, 'Hall hearth/smoke registration missing');
      check(world.shipsSails.length === world.ships.length, 'Sails not registered per ship');
      for (let index = 0; index < world.ships.length; index++)
        check(
          world.ships[index].children.includes(world.shipsSails[index]),
          'Wrong sail registered',
        );
      let buildings = 0;
      for (const type of Object.keys(VinlandModel.TYPES)) {
        const building = world.buildGeneric(type);
        check(building.userData.select === 'building', type + ' selection metadata missing');
        check(building.children.includes(building.userData.base), type + ' base handle missing');
        check(building.children.includes(building.userData.roof), type + ' roof handle missing');
        if (type === 'palisade') {
          let rails = 0;
          building.traverse((object) => {
            if (object.name === 'Enclosure rail') rails++;
          });
          check(rails === 50, 'Enclosure geometry lost its collision-compatible gateway');
        }
        buildings++;
      }
      for (const resource of VinlandStorage.KEYS) {
        const load = world.buildGatheringLoad(resource);
        check(
          load.name === 'carried-' + resource && !load.visible,
          resource + ' load metadata missing',
        );
        const pile = world.buildResourcePile({
          resource,
          occupied: 0.2,
          indoor: false,
          w: 2.4,
          d: 1.2,
          h: 1.4,
          x: 20,
          z: 35,
          rotation: 0.3,
          storeId: 'camp',
        });
        check(pile.userData.stackTop?.isVector3, resource + ' stack interaction point missing');
        pile.traverse((object) => {
          if (!object.isInstancedMesh) return;
          check(
            object.userData.select === 'stockpile' && object.userData.buildingId === 'camp',
            resource + ' pile selection metadata missing',
          );
          check(
            object.instanceMatrix.array.every(Number.isFinite),
            resource + ' pile has invalid ground transforms',
          );
        });
      }
      check(before === sim.serialize(), 'Model construction changed persistent simulation state');
      check(!!VinlandModel.Simulation.load(sim.serialize()), 'Model extraction broke save/load');
      return {
        buildings,
        resources: VinlandStorage.KEYS.length,
        hallRooms: world.roomMeshes.length,
        hearths,
      };
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log('World model registration passed:', result);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
