const { startDefaultCampaign } = require('./browser-session.cjs');
/** Conversations use the real keyboard, local renderer, and worker commands. */
const { chromium } = require('playwright');
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
    await page.route(/^https?:/, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
    await page.waitForFunction(() => window.Vinland && document.querySelector('#loading.ready'));
    await startDefaultCampaign(page);
    const personName = await page.evaluate(() => {
      Vinland.setPaused(true);
      Vinland.view('walk');
      const world = Vinland.world;
      const simulation = Vinland.simulation;
      // Put two people on a clear route away from the initial crowd, so the
      // test exercises conversation rather than an unrelated crowd detour.
      let origin;
      for (let x = 60; x <= 110 && !origin; x += 4) {
        for (let z = 40; z <= 90 && !origin; z += 4) {
          if (world.segmentClear({ x, z }, { x: x + 14, z }, 0.6)) origin = { x, z };
        }
      }
      if (!origin) throw Error('No clear conversation test route');
      for (const [id, point] of [
        [0, origin],
        [1, { x: origin.x + 1.5, z: origin.z }],
      ]) {
        world.agentPositions.set(id, { ...point });
        Object.assign(simulation.state.people[id], point);
        world.people[id].position.set(
          point.x,
          VinlandModel.elevation(point.x, point.z, simulation.state.config),
          point.z,
        );
        world.actorCollisions.set('person:' + id, { ...point, radius: 0.34 });
      }
      Object.assign(simulation.state.leader, origin);
      world.relocateActors = false;
      simulation.commandWorkers([1], { type: 'move', x: origin.x + 12, z: origin.z });
      world.paused = false;
      world.animatePeople(0.25, world.elapsed);
      world.paused = true;
      if (world.nearby()?.id !== 1) throw Error('Companion was not the nearest reachable person');
      return simulation.state.people[1].name;
    });
    await page.keyboard.press('KeyE');
    const panel = page.locator('#walk-conversation');
    assert.equal(await panel.isVisible(), true);
    assert.equal(await panel.locator('strong').innerText(), personName);
    assert.equal(await panel.locator('p').innerText(), "I'm on my way.");
    assert.equal(await page.locator('#modal').evaluate((element) => element.open), false);
    const stopped = await page.evaluate(() => {
      const world = Vinland.world;
      const person = Vinland.simulation.state.people[1];
      const point = { ...world.agentPositions.get(1) };
      const order = JSON.stringify(person.order);
      Vinland.setPaused(false);
      Vinland.simulation.advanceRealtime(3, world);
      world.animatePeople(3, world.elapsed + 3);
      world.keys.add('KeyW');
      const leader = { ...Vinland.simulation.state.leader };
      world.stepLeader(1);
      world.updateCamera(1);
      const worldStayedUnpaused = !world.paused && !Vinland.paused;
      Vinland.setPaused(true);
      return {
        distance: Math.hypot(point.x - person.x, point.z - person.z),
        leaderDistance: Math.hypot(
          leader.x - Vinland.simulation.state.leader.x,
          leader.z - Vinland.simulation.state.leader.z,
        ),
        unchanged: order === JSON.stringify(person.order),
        worldStayedUnpaused,
      };
    });
    assert.equal(stopped.distance, 0);
    assert.equal(stopped.leaderDistance, 0);
    assert.equal(stopped.unchanged, true);
    assert.equal(stopped.worldStayedUnpaused, true);
    await page.keyboard.press('KeyE');
    assert.equal(await panel.isVisible(), false);
    const resumed = await page.evaluate(() => {
      const world = Vinland.world;
      const person = Vinland.simulation.state.people[1];
      const point = { ...world.agentPositions.get(1) };
      world.paused = false;
      Vinland.simulation.advanceRealtime(0.75, world);
      world.animatePeople(0.75, world.elapsed + 4);
      world.paused = true;
      return Math.hypot(point.x - person.x, point.z - person.z);
    });
    assert.ok(resumed > 0.1, 'walking resumes after closing the conversation');

    // Every number command uses automatic reachable gathering for this person
    // alone, then immediately ends the conversation and releases the speaker.
    for (const [key, resource] of [
      ['Digit1', 'timber'],
      ['Digit2', 'turf'],
      ['Digit3', 'firewood'],
      ['Digit4', 'hay'],
    ]) {
      await page.keyboard.press('KeyE');
      assert.equal(await panel.isVisible(), true);
      await page.keyboard.press(key);
      const result = await page.evaluate(() => {
        const simulation = Vinland.simulation;
        const person = simulation.state.people[1];
        return {
          resource: person.order?.resource,
          pausedPerson: simulation.conversationPersonId,
          othersIdle: simulation.state.people.slice(2).every((other) => !other.order),
          selection: [...Vinland.app.workerControls.selected],
        };
      });
      assert.equal(result.resource, resource);
      assert.equal(result.pausedPerson, null);
      assert.equal(result.othersIdle, true);
      assert.deepEqual(result.selection, []);
      assert.equal(await panel.isVisible(), false);
      assert.equal(
        await page.evaluate(() => Vinland.simulation.state.people[1].order.resource),
        resource,
      );
    }
    await page.keyboard.press('KeyE');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/vinland-conversation-mobile.png' });
    for (const scale of [1, 1.3]) {
      await page.evaluate(
        (scale) => document.documentElement.style.setProperty('--text-scale', scale),
        scale,
      );
      const fits = await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const commands = document.querySelector('.command-strip').getBoundingClientRect();
        const clock = document.querySelector('.camp-console').getBoundingClientRect();
        const padHidden = getComputedStyle(document.querySelector('.walk-pad')).display === 'none';
        return {
          inside: bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
          separateRows: bounds.top >= commands.bottom && bounds.bottom <= clock.top,
          padHidden,
        };
      });
      assert.deepEqual(fits, { inside: true, separateRows: true, padHidden: true });
    }
    await page.evaluate(() => document.documentElement.style.setProperty('--text-scale', 1));
    await page.keyboard.press('Digit0');
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.evaluate(() => Vinland.simulation.conversationPersonId), null);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.people[1].order), null);
    await page.keyboard.press('KeyE');
    await panel.locator('[data-conversation="stop"]').click();
    assert.equal(await panel.isVisible(), false);
    await page.keyboard.press('KeyE');
    await panel.locator('[data-conversation="leave"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.evaluate(() => Vinland.simulation.state.people[1].order), null);

    // Opening management or leaving walk mode ends the temporary pause too.
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.keyboard.press('KeyE');
    await page.evaluate(() => Vinland.showCodex());
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.evaluate(() => Vinland.simulation.conversationPersonId), null);
    await page.locator('#close-modal').click();
    await page.keyboard.press('KeyE');
    assert.equal(await panel.isVisible(), true);
    await page.screenshot({ path: '/tmp/vinland-conversation-desktop.png' });
    await page.evaluate(() => Vinland.view('district'));
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.evaluate(() => Vinland.simulation.conversationPersonId), null);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      'Conversations passed: E, brief introductions, pause/resume, all four gather keys, idle, view/menu cleanup and mobile layout; no network requests.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
