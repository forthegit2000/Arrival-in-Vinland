/** Offline human/livestock rigs, ground contact and actual worker/herd integration. */
const { startDefaultCampaign } = require('./browser-session.cjs');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await startDefaultCampaign(page);
    const checks = await page.evaluate(() => {
      Vinland.setPaused(true);
      const world = Vinland.world;
      const sim = Vinland.simulation;
      const Characters = VinlandCharacters;
      const assert = (condition, message) => {
        if (!condition) throw Error(message);
      };
      assert(
        world.people.every((person) => person.characterRig),
        'Missing human rig',
      );
      assert(
        world.people.every((person) => person.userData.select === 'person'),
        'Lost selection metadata',
      );
      const adult = Characters.createHuman({ age: 35 }, 0);
      const duplicate = Characters.createHuman({ age: 35 }, 24);
      const child = Characters.createHuman({ age: 9 }, 0);
      assert(
        adult.getObjectByName('clothing').geometry ===
          duplicate.getObjectByName('clothing').geometry,
        'Geometry not shared',
      );
      assert(child.scale.y < adult.scale.y, 'Child proportions');
      const dress = Characters.createHuman({ age: 30 }, 1);
      assert(
        !dress.getObjectByName('thigh').visible &&
          !dress.getObjectByName('shin').visible &&
          dress.getObjectByName('shoe').visible,
        'Legs protrude through long clothing',
      );
      const tool = Characters.createAxe();
      adult.add(tool);
      const rig = adult.characterRig;
      const ankle = new THREE.Vector3();
      const wrist = new THREE.Vector3();
      let plantedError = 0;
      let slidingError = 0;
      let swingHeight = 0;
      for (const sprinting of [false, true]) {
        rig.phase = 0;
        const stride = sprinting ? 2.1 : 1.15;
        const previousFeet = [null, null];
        for (let frame = 0; frame < 120; frame++) {
          adult.position.z += (stride * adult.scale.y) / 120;
          Characters.poseHuman(adult, {
            moving: true,
            sprinting,
            distance: (stride * adult.scale.y) / 120,
            seconds: 1 / 60,
          });
          adult.updateMatrixWorld(true);
          for (let index = 0; index < rig.legs.length; index++) {
            const leg = rig.legs[index];
            leg.ankle.getWorldPosition(ankle);
            const height = ankle.y / adult.scale.y;
            const cycle = (((rig.phase / (Math.PI * 2) + index * 0.5) % 1) + 1) % 1;
            if (cycle < (sprinting ? 0.42 : 0.6)) {
              plantedError = Math.max(plantedError, Math.abs(height - 0.084));
              if (previousFeet[index] !== null)
                slidingError = Math.max(slidingError, Math.abs(ankle.z - previousFeet[index]));
              previousFeet[index] = ankle.z;
            } else previousFeet[index] = null;
            swingHeight = Math.max(swingHeight, height);
            assert(height > 0.075, 'Foot sinks into ground');
            assert(leg.knee.rotation.x >= 0, 'Knee bends backwards');
          }
          for (const arm of rig.arms) {
            const shoulder = arm.shoulder.getWorldPosition(new THREE.Vector3());
            const elbow = arm.elbow.getWorldPosition(new THREE.Vector3());
            arm.hand.getWorldPosition(wrist);
            assert(
              Math.abs(shoulder.distanceTo(elbow) / adult.scale.y - 0.29) < 1e-6,
              'Shoulder detached',
            );
            assert(
              Math.abs(elbow.distanceTo(wrist) / adult.scale.y - 0.28) < 1e-6,
              'Hand detached',
            );
          }
        }
      }
      assert(plantedError < 0.005, 'Planted feet float: ' + plantedError);
      assert(slidingError < 0.001, 'Planted feet slide: ' + slidingError);
      assert(swingHeight > 0.3, 'No articulated swing');
      let gripError = 0;
      for (let frame = 0; frame < 120; frame++) {
        Characters.poseHuman(adult, { chopping: true, seconds: 1 / 60, tool });
        adult.updateMatrixWorld(true);
        for (let index = 0; index < rig.arms.length; index++) {
          const grip = tool.localToWorld(new THREE.Vector3(0, index === 1 ? 0.06 : -0.13, 0));
          rig.arms[index].hand.getWorldPosition(wrist);
          gripError = Math.max(gripError, grip.distanceTo(wrist));
        }
      }
      assert(tool.visible && gripError < 0.01, 'Hands leave axe handle: ' + gripError);
      const frozen = rig.arms.map((arm) => arm.shoulder.quaternion.toArray());
      const phase = rig.workPhase;
      Characters.poseHuman(adult, {
        chopping: true,
        seconds: 1,
        paused: true,
        tool,
        cameraDistance: 100,
      });
      assert(
        phase === rig.workPhase &&
          JSON.stringify(frozen) ===
            JSON.stringify(rig.arms.map((arm) => arm.shoulder.quaternion.toArray())),
        'Pause changes pose',
      );
      assert(!rig.detail.visible && rig.distant.visible, 'Distant model missing');
      let farDraws = 0;
      rig.distant.traverse((object) => {
        if (object.isMesh) farDraws++;
      });
      assert(farDraws <= 5, 'Distant model draw budget');
      Characters.poseHuman(adult, { carrying: true, paused: true, cameraDistance: 4, tool });
      assert(
        rig.detail.visible && !rig.distant.visible && !tool.visible,
        'Near/carry pose incorrect',
      );
      const rootPosition = adult.position.toArray();
      Characters.poseHuman(adult, { moving: true, distance: 0.03, seconds: 1 / 60 });
      assert(
        JSON.stringify(adult.position.toArray()) === JSON.stringify(rootPosition),
        'Animation moves authoritative root',
      );
      Characters.poseHuman(adult, { swimming: true, moving: true, seconds: 0.1, distance: 0.07 });
      const stroke = rig.arms[0].shoulder.quaternion.clone();
      assert(rig.torso.rotation.x > 0.8, 'Swimming torso remains upright');
      const originalY = adult.position.y;
      adult.position.y = 0.02 - 1.15;
      adult.updateMatrixWorld(true);
      assert(
        rig.head.getWorldPosition(new THREE.Vector3()).y > 0.1,
        'Swimming head goes below water',
      );
      adult.position.y = originalY;
      for (let frame = 0; frame < 20; frame++)
        Characters.poseHuman(adult, {
          swimming: true,
          moving: true,
          seconds: 0.05,
          distance: 0.035,
        });
      assert(stroke.angleTo(rig.arms[0].shoulder.quaternion) > 0.1, 'No swimming stroke');
      assert(
        rig.legs.every((leg) => leg.hip.rotation.x > 0.7),
        'No swimming leg kick',
      );
      Characters.poseHuman(adult, { swimming: true, paused: true });
      const pausedStroke = rig.arms[0].shoulder.quaternion.clone();
      Characters.poseHuman(adult, { swimming: true, paused: true, seconds: 1 });
      assert(pausedStroke.angleTo(rig.arms[0].shoulder.quaternion) < 1e-6, 'Paused swimmer moves');
      Characters.poseHuman(adult, { wading: true, moving: true, distance: 0.02, seconds: 0.05 });
      assert(
        rig.torso.rotation.x < 0.3 && rig.skirt.rotation.x === 0,
        'Water pose survives return to walking',
      );
      for (const model of [adult, dress, child]) {
        const root = model.position.clone();
        Characters.poseHuman(model, { resting: 'seated', paused: true });
        model.updateMatrixWorld(true);
        assert(model.position.equals(root), 'Sitting moves authoritative position');
        assert(model.characterRig.torso.position.y < 0.4, 'Sitting stays upright');
        for (const leg of model.characterRig.legs) {
          const foot = leg.ankle.getWorldPosition(new THREE.Vector3());
          assert(Math.abs((foot.y - root.y) / model.scale.y - 0.084) < 0.002, 'Seated foot floats');
        }
        const phase = model.characterRig.restPhase;
        Characters.poseHuman(model, { resting: 'seated', paused: true, seconds: 1 });
        assert(model.characterRig.restPhase === phase, 'Paused resting person moves');
        for (let frame = 0; frame < 60; frame++)
          Characters.poseHuman(model, { moving: true, seconds: 1 / 60, distance: 0.02 });
        assert(model.characterRig.restBlend < 0.001, 'Walking fails to leave seated pose');
      }
      // Exercise the real worker integration, not just isolated pose helpers.
      const person = sim.state.people[3];
      sim.state.time = 9;
      sim.commandWorkers([3], { type: 'gather', resource: 'timber', x: 50, z: 50 });
      person.order.phase = 'working';
      person.order.activity = 'felling';
      person.moving = false;
      world.paused = false;
      world.animatePeople(1 / 60, world.elapsed);
      const workerTool = world.people[3].getObjectByName('harvest-tool');
      assert(workerTool.visible, 'Working axe hidden');
      person.order.activity = 'sharpening';
      world.animatePeople(1 / 60, world.elapsed);
      assert(!workerTool.visible, 'Axe chopping while sharpening');
      person.carriedFirewood = 1;
      world.animatePeople(1 / 60, world.elapsed);
      assert(world.people[3].getObjectByName('carried-firewood').visible, 'Lost carried load');
      person.carriedFirewood = 0;
      sim.commandWorkers([3], { type: 'stop' });
      assert(VinlandModel.Simulation.load(sim.serialize()), 'Save rejected with new models');
      world.paused = true;
      const livestock = [];
      for (const kind of ['cattle', 'sheep', 'goat']) {
        const animal = Characters.createLivestock(kind, 1);
        const matching = Characters.createLivestock(kind, 5);
        assert(
          animal.getObjectByName('livestock-body').geometry ===
            matching.getObjectByName('livestock-body').geometry,
          'Animal geometry not shared',
        );
        const rig = animal.livestockRig;
        let contactError = 0;
        let slideError = 0;
        const previousFeet = [null, null, null, null];
        const point = new THREE.Vector3();
        const step = (rig.shape.hip * 0.9) / 120;
        for (let frame = 0; frame < 240; frame++) {
          animal.position.z += step;
          Characters.poseLivestock(animal, { moving: true, distance: step, seconds: 1 / 60 });
          animal.updateMatrixWorld(true);
          for (let index = 0; index < rig.legs.length; index++) {
            const leg = rig.legs[index];
            leg.foot.getWorldPosition(point);
            const cycle = (((rig.phase + leg.phase) % 1) + 1) % 1;
            if (cycle < 0.68) {
              contactError = Math.max(contactError, Math.abs(point.y - rig.shape.hoof));
              if (previousFeet[index] !== null)
                slideError = Math.max(slideError, Math.abs(point.z - previousFeet[index]));
              previousFeet[index] = point.z;
            } else previousFeet[index] = null;
            assert(point.y >= rig.shape.hoof - 0.004, kind + ' hoof sinks');
          }
        }
        assert(contactError < 0.004 && slideError < 0.002, kind + ' planted hoof drifts');
        Characters.poseLivestock(animal, { seconds: 0 });
        const standing = rig.head.localToWorld(rig.muzzle.clone()).y;
        for (let frame = 0; frame < 180; frame++)
          Characters.poseLivestock(animal, { grazing: true, seconds: 1 / 60 });
        animal.updateMatrixWorld(true);
        const grazing = rig.head.localToWorld(rig.muzzle.clone()).y;
        assert(
          grazing > 0.04 && grazing < 0.17 && grazing < standing - 0.15,
          kind + ' grazing misses grass: ' + grazing,
        );
        const clock = rig.clock;
        const pose = rig.neck.rotation.x;
        Characters.poseLivestock(animal, {
          seconds: 1,
          paused: true,
          grazing: true,
          cameraDistance: 100,
        });
        assert(clock === rig.clock && pose === rig.neck.rotation.x, 'Paused animal changes pose');
        assert(!rig.detail.visible && rig.distant.visible, 'Animal distance detail');
        let draws = 0;
        rig.distant.traverse((object) => {
          if (object.isMesh) draws++;
        });
        assert(draws <= 7, 'Animal distance draw budget');
        const terrain = (x, z) => 0.05 + z * 0.02;
        for (let frame = 0; frame < 120; frame++)
          Characters.poseLivestock(animal, { grazing: true, seconds: 1 / 60, groundAt: terrain });
        animal.updateMatrixWorld(true);
        const muzzle = rig.head.localToWorld(rig.muzzle.clone()).sub(animal.position);
        const terrainError = Math.abs(
          muzzle.y - terrain(muzzle.x, muzzle.z) - rig.shape.headScale * 0.15,
        );
        assert(terrainError < 0.001, kind + ' muzzle ignores slope');
        for (const leg of rig.legs) {
          leg.foot.getWorldPosition(point).sub(animal.position);
          assert(
            Math.abs(point.y - terrain(point.x, point.z) - rig.shape.hoof) < 0.004,
            kind + ' hoof ignores slope',
          );
        }
        livestock.push({ kind, contactError, slideError, grazing, terrainError, draws });
      }
      world.animateLivestock(20);
      const counts = () =>
        world.animals
          .filter((animal) => animal.visible)
          .reduce((result, animal) => {
            const kind = animal.livestockRig.kind;
            result[kind] = (result[kind] || 0) + 1;
            return result;
          }, {});
      assert(
        JSON.stringify(counts()) === JSON.stringify({ cattle: 8, sheep: 12, goat: 12 }),
        'Initial herd mismatch',
      );
      sim.state.livestock.cattle = 7;
      sim.state.livestock.sheep = 13;
      world.animateLivestock(20.1);
      assert(world.animals[7].livestockRig.kind === 'sheep', 'Herd change keeps wrong species');
      sim.state.livestock.cattle = 8;
      sim.state.livestock.sheep = 12;
      world.animateLivestock(20.2);
      world.paused = false;
      let headingError = 0;
      let travelled = 0;
      for (let frame = 0; frame < 30; frame++) {
        const animal = world.animals[0];
        const before = animal.position.clone();
        world.animateLivestock(21 + frame * 0.1);
        const dx = animal.position.x - before.x;
        const dz = animal.position.z - before.z;
        const distance = Math.hypot(dx, dz);
        travelled += distance;
        if (frame > 10 && distance > 0.00001)
          headingError = Math.max(
            headingError,
            1 - (Math.sin(animal.rotation.y) * dx + Math.cos(animal.rotation.y) * dz) / distance,
          );
      }
      assert(travelled > 0.005 && headingError < 0.05, 'Livestock faces away from movement');
      world.paused = true;
      const frozenHerd = world.animals.map((animal) => [
        ...animal.position.toArray(),
        animal.livestockRig.clock,
      ]);
      world.animateLivestock(25);
      assert(
        JSON.stringify(frozenHerd) ===
          JSON.stringify(
            world.animals.map((animal) => [
              ...animal.position.toArray(),
              animal.livestockRig.clock,
            ]),
          ),
        'Paused herd moves',
      );
      assert(VinlandModel.Simulation.load(sim.serialize()), 'Herd graphics break saves');

      return {
        livestock,
        headingError,
        population: world.people.length,
        plantedError,
        slidingError,
        swingHeight,
        gripError,
        farDraws,
        saved: true,
      };
    });
    console.log(JSON.stringify(checks));
    assert.equal(checks.population, 160);
    const resting = await page.evaluate(() => {
      const sim = Vinland.simulation,
        world = Vinland.world;
      const leader = { ...sim.state.leader };
      const stocks = { timber: sim.state.resources.timber, firewood: sim.state.resources.firewood };
      for (let step = 0; step < 300; step++) sim.advanceRealtime(0.2, world);
      world.animatePeople(0.1, world.elapsed);
      const settled = [...world.idlePeople.entries()].filter(([, rest]) => rest.settled);
      if (settled.length < 20)
        throw Error('Idle crew failed to reach resting places: ' + settled.length);
      for (const [id, rest] of settled) {
        if (!world.clearAt(rest.target.x, rest.target.z, 0.34))
          throw Error('Resting inside an obstacle');
        if (VinlandMeadows.freshwaterDistance(rest.target.x, rest.target.z) < 3)
          throw Error('Resting in freshwater');
        if (sim.state.people[id].order) throw Error('Resting created a worker order');
      }
      if (sim.state.leader.x !== leader.x || sim.state.leader.z !== leader.z)
        throw Error('Idle behavior moved Karlsefni');
      for (const resource of Object.keys(stocks))
        if (sim.state.resources[resource] !== stocks[resource])
          throw Error('Idle crew produced resources');
      const [id] = settled.find(([id]) => id % 3 !== 0);
      const person = sim.state.people[id];
      const position = { x: person.x, z: person.z };
      sim.conversationPersonId = id;
      sim.advanceRealtime(0.2, world);
      world.animatePeople(0.1, world.elapsed);
      if (
        person.x !== position.x ||
        person.z !== position.z ||
        world.people[id].characterRig.resting
      )
        throw Error('Resting ignored conversation');
      sim.conversationPersonId = null;
      const destination = world.findIdleRestSpot({ x: person.x + 4, z: person.z, heading: 0 }, id);
      if (!destination) throw Error('Missing move-order destination');
      sim.commandWorkers([id], { type: 'move', ...destination });
      sim.advanceRealtime(0.2, world);
      world.animatePeople(0.1, world.elapsed);
      if (world.idlePeople.has(id) || world.people[id].characterRig.resting)
        throw Error('Resting ignored a player order');
      if (!VinlandModel.Simulation.load(sim.serialize())) throw Error('Resting broke save/load');
      return { settled: settled.length, orderInterrupted: true, conversationInterrupted: true };
    });
    console.log(JSON.stringify({ resting }));
    // Render close-up silhouettes and poses using the same model builders and
    // Three.js renderer, independently of the campaign's weather/camera.
    await page.evaluate(() => {
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(1400, 850);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const canvas = renderer.domElement;
      canvas.id = 'character-preview';
      canvas.style.cssText = 'position:fixed;inset:0;z-index:99999;width:1400px;height:850px';
      document.body.appendChild(canvas);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#879ba4');
      scene.add(new THREE.HemisphereLight('#e4eff6', '#75634f', 2.2));
      const sun = new THREE.DirectionalLight('#fff0d9', 3);
      sun.position.set(-3, 5, 4);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, {
        left: -4,
        right: 4,
        top: 4,
        bottom: -4,
        near: 0.1,
        far: 20,
      });
      sun.shadow.normalBias = 0.015;
      scene.add(sun);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshStandardMaterial({ color: '#6f7663', roughness: 1 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.01;
      ground.receiveShadow = true;
      scene.add(ground);
      const samples = [
        { index: 0, age: 35, pose: {} },
        { index: 1, age: 30, pose: {} },
        { index: 5, age: 42, pose: { carrying: true } },
        { index: 3, age: 28, pose: { chopping: true } },
        { index: 7, age: 9, pose: {} },
      ];
      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        const person = VinlandCharacters.createHuman({ age: sample.age }, sample.index);
        const tool = VinlandCharacters.createAxe();
        person.add(tool);
        person.previewPose = sample.pose;
        person.position.x = (index - 2) * 1.05;
        person.rotation.y = -0.22;
        VinlandCharacters.poseHuman(person, { ...sample.pose, tool, seconds: 0 });
        if (sample.pose.carrying) person.add(Vinland.world.buildGatheringLoad('timber'));
        const load = person.getObjectByName('carried-timber');
        if (load) load.visible = true;
        scene.add(person);
      }
      const camera = new THREE.PerspectiveCamera(32, 1400 / 850, 0.1, 30);
      camera.position.set(2.4, 2.0, 8);
      camera.lookAt(0, 0.9, 0);
      renderer.render(scene, camera);
      window.characterPreview = { renderer, scene, camera };
    });
    await page.locator('#character-preview').screenshot({ path: '/tmp/vinland-human-models.png' });
    await page.evaluate(() => {
      const preview = window.characterPreview;
      for (const object of preview.scene.children.filter((object) => object.characterRig)) {
        VinlandCharacters.poseHuman(object, {
          ...object.previewPose,
          chopping: false,
          tool: object.getObjectByName('harvest-tool'),
          moving: true,
          sprinting: object.position.x > 0,
          distance: 0.32,
          seconds: 1 / 60,
        });
      }
      preview.renderer.render(preview.scene, preview.camera);
    });
    await page
      .locator('#character-preview')
      .screenshot({ path: '/tmp/vinland-human-movement.png' });
    await page.evaluate(() => {
      const preview = window.characterPreview;
      for (const object of preview.scene.children.filter((object) => object.characterRig)) {
        for (const load of object.children.filter((child) => child.name.startsWith('carried-')))
          load.visible = false;
        VinlandCharacters.poseHuman(object, {
          resting: object.position.x < 1 ? 'seated' : 'standing',
          paused: true,
          tool: object.getObjectByName('harvest-tool'),
        });
      }
      preview.renderer.render(preview.scene, preview.camera);
    });
    await page.locator('#character-preview').screenshot({ path: '/tmp/vinland-human-resting.png' });
    await page.evaluate(() => {
      const preview = window.characterPreview;
      for (const object of [...preview.scene.children])
        if (object.characterRig) preview.scene.remove(object);
      const samples = [
        ['cattle', 0, -1.7, 0.1],
        ['sheep', 0, 0.15, 0.55],
        ['goat', 2, 1.55, 0.5],
      ];
      for (const [kind, index, x, z] of samples) {
        const animal = VinlandCharacters.createLivestock(kind, index);
        animal.position.set(x, 0, z);
        animal.rotation.y = -0.6;
        VinlandCharacters.poseLivestock(animal, { seconds: 0 });
        preview.scene.add(animal);
      }
      preview.camera.position.set(2.8, 1.75, 6.4);
      preview.camera.lookAt(0, 0.55, 0.3);
      preview.renderer.render(preview.scene, preview.camera);
    });
    await page
      .locator('#character-preview')
      .screenshot({ path: '/tmp/vinland-livestock-models.png' });
    await page.evaluate(() => {
      const preview = window.characterPreview;
      for (const animal of preview.scene.children.filter((object) => object.livestockRig))
        for (let frame = 0; frame < 180; frame++)
          VinlandCharacters.poseLivestock(animal, { grazing: true, seconds: 1 / 60 });
      preview.renderer.render(preview.scene, preview.camera);
    });
    await page
      .locator('#character-preview')
      .screenshot({ path: '/tmp/vinland-livestock-grazing.png' });
    await page.evaluate(() => {
      window.characterPreview.renderer.dispose();
      document.getElementById('character-preview').remove();
    });
    const arrivalRest = await page.evaluate(() => {
      const sim = new VinlandModel.Simulation();
      VinlandArrival.start(sim);
      Vinland.replaceSimulation(sim);
      Vinland.setPaused(true);
      const world = Vinland.world;
      const initial = sim.state.people.map((person) => ({
        x: person.x,
        z: person.z,
        ship: person.arrivalShip,
      }));
      sim.advanceRealtime(10, world);
      world.animatePeople(0, world.elapsed);
      for (const person of sim.state.people) {
        const saved = initial[person.id];
        if (person.x !== saved.x || person.z !== saved.z || person.arrivalShip !== saved.ship)
          throw Error('Waiting passenger left their assigned boat');
      }
      const seated = world.people.filter(
        (object) => object.characterRig.resting === 'seated',
      ).length;
      if (seated < 50) throw Error('Waiting passengers are not resting aboard');
      if (
        sim.state.arrival.animals.some(
          (animal) => animal.shipId !== sim.state.arrival.livestockShip,
        )
      )
        throw Error('Idle people released livestock');
      const landing = sim.state.arrival.landing;
      const normal = VinlandArrival.shoreNormal(landing.x, landing.z);
      for (const person of sim.state.people.slice(1, 13)) {
        person.arrivalShip = null;
        const target = world.arrivalAssemblyTarget(person.id);
        Object.assign(person, target);
        world.syncArrivalPerson(person);
        const dx = target.x - landing.x,
          dz = target.z - landing.z;
        if (dx * normal.x + dz * normal.z < 30 && Math.abs(-dx * normal.z + dz * normal.x) < 3.5)
          throw Error('Assembly group blocks the unloading route');
      }
      const snapshot = VinlandModel.Simulation.load(sim.serialize());
      if (!snapshot || snapshot.state.people[20].arrivalShip !== initial[20].ship)
        throw Error('Resting passenger manifest failed save/load');
      return { seated, assignedShipsPreserved: true, unloadingRouteClear: true };
    });
    console.log(JSON.stringify({ arrivalRest }));
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
