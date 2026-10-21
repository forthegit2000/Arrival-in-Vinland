/** Testing panel and visible, usable resource piles. All commands require opt-in. */
(function (root) {
  'use strict';
  const Cheats = root.VinlandCheats;
  const Storage = root.VinlandStorage;
  const Content = root.VinlandContent;
  const element = (id) => document.getElementById(id);
  const resourceName = (key) => key.replace(/([A-Z])/g, ' $1').toLowerCase();
  class CheatControls {
    constructor(app, callbacks) {
      this.app = app;
      this.callbacks = callbacks;
      this.meshes = new Map();
      this.lastSync = 0;
      const panel = element('cheat-panel');
      panel.innerHTML = `
        <header><strong>Cheat Mode · Testing</strong><button data-cheat="close" aria-label="Close cheats">×</button></header>
        <label class="cheat-toggle"><input id="cheats-enabled" type="checkbox"> Enable cheat mode</label>
        <fieldset id="cheat-tools">
          <label class="cheat-toggle"><input id="cheats-instant" type="checkbox"> Instant, free building & repairs</label>
          <label class="cheat-toggle"><input id="cheats-protect" type="checkbox"> Keep crew healthy, rested & content</label>
          <label>Weather<select id="cheat-weather">${Object.entries(Cheats.WEATHER_PRESETS)
            .map(([preset, name]) => `<option value="${preset}">${name}</option>`)
            .join('')}</select></label>
          <div class="cheat-fields">
            <label>Resource<select id="cheat-resource">${Storage.KEYS.map((key) => `<option value="${key}" ${key === 'firewood' ? 'selected' : ''}>${resourceName(key)}</option>`).join('')}</select></label>
            <label><span>Amount (<span id="cheat-unit">kg</span>)</span><input id="cheat-amount" type="number" min="0.01" max="1000000" step="any" value="25"></label>
            <label>Destination<select id="cheat-destination"><option value="ground">Pile in front / map centre</option><option value="camp">Camp inventory</option><option value="hearth">Nearby hearth inventory</option></select></label>
            <label id="cheat-moisture-label">Wood moisture<select id="cheat-moisture"><option value="0.2">Seasoned · 20%</option><option value="0.5">Fresh · 50%</option><option value="0.1">Very dry · 10%</option></select></label>
          </div>
          <button data-cheat="spawn">Create resources</button>
          <div class="cheat-fields cheat-building">
            <label>Building<select id="cheat-building">${Object.entries(Content.TYPES)
              .filter(([type]) => type !== 'restore')
              .map(([type, definition]) => `<option value="${type}">${definition.name}</option>`)
              .join('')}</select></label>
            <button data-cheat="place">Place building</button>
          </div>
          <div class="cheat-actions">
            <button data-cheat="finish">Finish all construction</button>
            <button data-cheat="repair">Repair all + Hall F</button>
            <button data-cheat="heal">Restore crew & herd</button>
            <button data-cheat="supplies">Supply nearby hearth</button>
            <button data-cheat="soup">Finish nearby soup</button>
            <button data-cheat="noon">Set noon</button>
            <button data-cheat="night">Set midnight</button>
          </div>
        </fieldset>
        <p id="cheat-message" role="status">F10 opens this panel. Cheat use is marked in this campaign’s save.</p>`;
      panel.addEventListener('click', (event) => {
        const button = event.target.closest('[data-cheat]');
        if (button) this.action(button.dataset.cheat);
      });
      for (const [id, key] of [
        ['cheats-enabled', 'enabled'],
        ['cheats-instant', 'instantBuild'],
        ['cheats-protect', 'protectCrew'],
      ])
        element(id).onchange = () => {
          Cheats.configure(this.app.sim, { [key]: element(id).checked });
          this.app.workerControls.render();
          this.refresh();
        };
      element('cheat-resource').onchange = () => {
        const key = element('cheat-resource').value;
        element('cheat-unit').textContent = Storage.unit(key);
        element('cheat-moisture-label').hidden = key !== 'firewood';
      };
      element('cheat-weather').onchange = () => this.action('weather');
      element('cheat-indicator').onclick = () => this.toggle();
      for (const type of ['pointerdown', 'wheel'])
        panel.addEventListener(type, (event) => event.stopPropagation());
    }
    toggle(open = element('cheat-panel').hidden) {
      element('cheat-panel').hidden = !open;
      if (open) {
        this.app.hearthControls.close();
        this.app.world.clearInput();
        this.refresh();
      }
    }
    person() {
      return this.app.sim.state.people[this.app.sim.state.leader.id];
    }
    spawnPoint() {
      const world = this.app.world,
        walking = world.view === 'walk';
      const origin = walking ? this.person() : world.target;
      const yaw = walking ? world.walkYaw : 0;
      for (const distance of walking ? [2.4, 1.8, 1.3] : [0, 1, 2, 3])
        for (const offset of [0, -0.4, 0.4, -0.8, 0.8]) {
          const point = {
            x: origin.x + Math.sin(yaw + offset) * distance,
            z: origin.z + Math.cos(yaw + offset) * distance,
          };
          if (!world.actorClearAt(point.x, point.z, 0.7, 'person:' + this.person().id)) continue;
          if (walking && !world.segmentClear(origin, point, 0.1)) continue;
          return point;
        }
      return null;
    }
    action(action) {
      if (action === 'close') return this.toggle(false);
      const sim = this.app.sim;
      if (!Cheats.settings(sim.state).enabled) return;
      let message = '';
      if (action === 'weather') {
        const preset = element('cheat-weather').value;
        if (Cheats.setWeather(sim, preset))
          message =
            preset === 'natural'
              ? 'Natural weather restored.'
              : `${Cheats.WEATHER_PRESETS[preset]} selected. Remains until changed or cheats are disabled.`;
      }
      if (action === 'spawn') {
        const key = element('cheat-resource').value,
          amount = Number(element('cheat-amount').value);
        const destination = element('cheat-destination').value;
        const hearth = root.VinlandHearths.nearest(sim, this.person());
        const target =
          destination === 'hearth' ? hearth?.storeId : destination === 'camp' ? 'camp' : null;
        if (destination === 'hearth' && !hearth) message = 'Stand beside a hearth first.';
        else {
          const store = Cheats.spawn(
            sim,
            key,
            amount,
            target ? null : this.spawnPoint(),
            target,
            Number(element('cheat-moisture').value),
          );
          message = store
            ? `Created ${amount} ${Storage.unit(key)} ${resourceName(key)}.`
            : 'Choose a positive amount and clear ground in front of you.';
        }
      }
      if (action === 'place') {
        if (!Cheats.instant(sim.state)) message = 'Enable instant, free building first.';
        else {
          this.toggle(false);
          this.callbacks.startPlacement(element('cheat-building').value);
        }
      }
      if (action === 'finish')
        message = `${Cheats.finishSites(sim)} construction orders completed.`;
      if (action === 'repair')
        message = Cheats.repairAll(sim)
          ? 'Buildings, Hall F and anchored ships repaired.'
          : 'Enable instant, free building first.';
      if (action === 'heal') {
        Cheats.heal(sim);
        message = 'Living crew and herd restored.';
      }
      if (action === 'supplies')
        message = Cheats.supplyHearth(sim, this.person())
          ? 'Hearth stocked with wood, water and soup ingredients.'
          : 'Stand beside a hearth first.';
      if (action === 'soup')
        message = Cheats.finishSoup(sim, this.person())
          ? 'Soup cooked and cooled, ready to serve.'
          : 'Start a pot at the nearby hearth first.';
      if (action === 'noon' || action === 'night') {
        Cheats.setHour(sim, action === 'noon' ? 12 : 0);
        message = 'Lighting time changed; no work or fuel advanced.';
      }
      element('cheat-message').textContent = message;
      this.app.dirty = true;
      this.app.world.sync();
      this.app.workerControls.render();
      this.refresh();
    }
    refresh() {
      const settings = Cheats.settings(this.app.sim.state);
      element('cheats-enabled').checked = settings.enabled;
      element('cheats-instant').checked = settings.instantBuild;
      element('cheats-protect').checked = settings.protectCrew;
      element('cheat-weather').value = settings.weather || 'natural';
      element('cheat-tools').disabled = !settings.enabled;
      for (const action of ['place', 'finish', 'repair'])
        element('cheat-panel').querySelector(`[data-cheat="${action}"]`).disabled =
          !settings.instantBuild;
    }
    update() {
      const settings = Cheats.settings(this.app.sim.state),
        badge = element('cheat-indicator');
      badge.hidden = !settings.enabled && !settings.used;
      badge.textContent = settings.enabled ? 'CHEATS ON · F10' : 'CHEAT SAVE · F10';
      if (this.app.atTitleScreen || this.app.screen !== 'settlement') this.toggle(false);
      if (this.world !== this.app.world) {
        this.meshes.clear();
        this.world = this.app.world;
        this.refresh();
      }
      if (performance.now() - this.lastSync > 400) {
        this.syncPiles();
        this.lastSync = performance.now();
      }
    }
    syncPiles() {
      const world = this.app.world;
      const live = new Set();
      for (const store of Object.values(this.app.sim.state.storage.stores)) {
        if (!store.cheatPile || !Object.values(store.stock).some((amount) => amount > 0.000001))
          continue;
        live.add(store.id);
        let mesh = this.meshes.get(store.id);
        if (!mesh) {
          mesh = this.pileMesh(Object.keys(store.stock)[0]);
          mesh.name = 'Resource pile · ' + store.id;
          mesh.userData.storeId = store.id;
          world.scene.add(mesh);
          this.meshes.set(store.id, mesh);
        }
        mesh.visible = true;
        mesh.position.set(store.x, world.actorElevation(store.x, store.z), store.z);
      }
      for (const [id, mesh] of this.meshes) if (!live.has(id)) mesh.visible = false;
    }
    pileMesh(resource) {
      const THREE = root.THREE,
        group = new THREE.Group();
      const colors = {
        turf: '#5e7040',
        hay: '#c8ac59',
        stone: '#899291',
        iron: '#525d63',
        charcoal: '#282c30',
        water: '#5d847d',
        grain: '#c4a67a',
        plants: '#6e9148',
        freshFish: '#8bacb8',
        driedFish: '#a18c72',
        meat: '#994e3f',
        dairy: '#dbd1ad',
        fat: '#d1c3a1',
        seeds: '#af8856',
        cloth: '#a3977e',
      };
      const wood = ['timber', 'firewood'].includes(resource);
      const geometry = wood
        ? new THREE.CylinderGeometry(0.11, 0.13, 1.1, 8)
        : new THREE.BoxGeometry(0.38, 0.28, 0.4);
      const material = new THREE.MeshStandardMaterial({
        color: wood ? '#775039' : colors[resource] || '#a48a63',
        roughness: 0.95,
      });
      for (let index = 0; index < 6; index++) {
        const item = new THREE.Mesh(geometry, material);
        item.position.set(
          ((index % 3) - 1) * 0.25,
          0.15 + Math.floor(index / 3) * 0.25,
          ((index % 2) - 0.5) * 0.12,
        );
        if (wood) item.rotation.x = Math.PI / 2;
        item.castShadow = true;
        group.add(item);
      }
      return group;
    }
  }
  root.VinlandCheatControls = CheatControls;
})(window);
