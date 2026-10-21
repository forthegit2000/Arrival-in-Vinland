/** Local fire tending. Time keeps running while this panel is open. */
(function (root) {
  'use strict';
  const Hearths = root.VinlandHearths;
  const Storage = root.VinlandStorage;
  const element = (id) => document.getElementById(id);
  class HearthControls {
    constructor(app, notify) {
      this.app = app;
      this.notify = notify;
      this.id = null;
      this.lastRefresh = 0;
      this.message = '';
      const panel = element('hearth-panel');
      panel.innerHTML = `
        <header><strong id="hearth-name">Hearth</strong><button data-hearth="close" aria-label="Close hearth">×</button></header>
        <p id="hearth-readings"></p>
        <div class="hearth-actions">
          <button data-hearth="light">Light</button>
          <button data-hearth="small">+0.5 kg wood</button>
          <button data-hearth="large">+2 kg wood</button>
          <button data-hearth="bank">Smother flames</button>
        </div>
        <p id="hearth-stores"></p>
        <button data-hearth="supply">Send selected workers to supply</button>
        <div class="hearth-recipe">
          <label>Soup <select id="hearth-recipe">${Object.entries(Hearths.RECIPES)
            .map(([id, recipe]) => `<option value="${id}">${recipe.name}</option>`)
            .join('')}</select></label>
          <label>Water <select id="hearth-size"><option value="2">2 L</option><option value="4" selected>4 L</option><option value="8">8 L</option></select></label>
        </div>
        <p id="hearth-ingredients"></p>
        <div class="hearth-actions">
          <button data-hearth="cook">Start soup</button>
          <button data-hearth="lift">Lift pot</button>
          <button data-hearth="serve">Take bowl</button>
          <button data-hearth="crew">Serve nearby crew</button>
          <button data-hearth="empty">Empty pot</button>
        </div>
        <p id="hearth-pot"></p>
        <p id="hearth-message" role="status"></p>`;
      panel.addEventListener('click', (event) => {
        const button = event.target.closest('[data-hearth]');
        if (button) this.action(button.dataset.hearth);
      });
      panel.addEventListener('change', () => this.render());
      // Stop camera movement/zoom when operating the panel.
      for (const type of ['pointerdown', 'wheel'])
        panel.addEventListener(type, (event) => event.stopPropagation());
      element('hearth-button').onclick = () => this.toggle();
    }
    person() {
      return this.app.sim.state.people[this.app.sim.state.leader.id];
    }
    close() {
      this.id = null;
      element('hearth-panel').hidden = true;
    }
    toggle() {
      if (this.id) return this.close();
      const definition = Hearths.nearest(this.app.sim, this.person());
      if (!definition) return;
      this.id = definition.id;
      this.message = '';
      element('hearth-panel').hidden = false;
      this.render();
    }
    action(action) {
      if (action === 'close') return this.close();
      const sim = this.app.sim,
        person = this.person();
      if (!this.id) return;
      const definition = Hearths.definitions(sim.state).find((item) => item.id === this.id);
      if (!Hearths.near(sim, person, definition)) return this.close();
      const fire = Hearths.stateFor(sim, this.id);
      this.message = '';
      if (action === 'light') this.message = Hearths.light(sim, person, this.id);
      if (action === 'bank') this.message = Hearths.bank(sim, person, this.id);
      if (action === 'small' || action === 'large')
        this.message = Hearths.addFuel(sim, person, this.id, action === 'small' ? 0.5 : 2);
      if (action === 'cook')
        this.message = Hearths.startSoup(
          sim,
          person,
          this.id,
          element('hearth-recipe').value,
          Number(element('hearth-size').value),
        );
      if (action === 'lift' && fire.pot) fire.pot.onFire = !fire.pot.onFire;
      if (action === 'serve') this.message = Hearths.serve(sim, person, this.id);
      if (action === 'crew') {
        let served = 0;
        for (const guest of sim.presentPeople) {
          if (!Hearths.near(sim, guest, definition)) continue;
          if (!Hearths.serve(sim, guest, this.id)) served++;
        }
        this.message = served
          ? `${served} bowls served.`
          : 'Soup must be cooked and cooled, with people beside the hearth.';
      }
      if (action === 'empty' && fire.pot) {
        sim.flow('losses', 'soupKcal', fire.pot.kcal);
        fire.pot = null;
      }
      if (action === 'supply') this.app.workerControls.assignHauling(definition.storeId);
      this.app.dirty = true;
      this.render();
    }
    update() {
      const walking =
        this.app.world.view === 'walk' &&
        this.app.screen === 'settlement' &&
        !this.app.atTitleScreen;
      const person = this.person();
      const nearby = walking && Hearths.nearest(this.app.sim, person);
      element('hearth-button').hidden = !nearby;
      if (
        this.id &&
        (!walking ||
          nearby?.id !== this.id ||
          this.app.conversation?.active ||
          element('modal').open)
      )
        this.close();
      if (this.id && performance.now() - this.lastRefresh > 250) this.render();
    }
    render() {
      if (!this.id) return;
      const sim = this.app.sim,
        person = this.person();
      const definition = Hearths.definitions(sim.state).find((item) => item.id === this.id);
      if (!definition) return this.close();
      const fire = Hearths.view(sim, this.id),
        pot = fire.pot;
      const stock = sim.state.storage.stores[definition.storeId]?.stock || {};
      const recipeId = element('hearth-recipe').value,
        litres = Number(element('hearth-size').value);
      const recipe = Hearths.RECIPES[recipeId];
      element('hearth-name').textContent = definition.name;
      element('hearth-readings').textContent =
        `${fire.fuelKg.toFixed(2)} / ${definition.maxFuelKg} kg wood · ${fire.embersKg.toFixed(2)} kg embers · ${fire.powerKW.toFixed(1)} kW · room ${fire.airTemperature.toFixed(1)} °C`;
      element('hearth-stores').textContent =
        `Carrying ${((person.carriedFirewood || 0) + (person.cargo?.resource === 'firewood' ? person.cargo.amount : 0)).toFixed(1)} kg wood. Here: ${(stock.firewood || 0).toFixed(1)} kg wood, ${(stock.water || 0).toFixed(1)} L water. Wood moisture: ${Math.round(fire.moisture * 100)}%.`;
      const ingredients = Object.entries(recipe.ingredients).map(
        ([key, kg]) =>
          `${((kg * litres) / 4).toFixed(2)} kg ${key === 'freshFish' ? 'fresh fish' : key} (${(stock[key] || 0).toFixed(1)} here)`,
      );
      element('hearth-ingredients').textContent =
        `${litres} L water + ${ingredients.join(', ')}. Simmer ${recipe.simmerSeconds / 60} min. Rough fuel estimate ${Hearths.estimate(sim, this.id, recipeId, litres).toFixed(1)} kg; damp wood and waiting use more.`;
      const status =
        pot &&
        (pot.spoiled
          ? 'Spoiled'
          : pot.scorched
            ? 'Scorched'
            : Hearths.ready(pot)
              ? 'Cooked'
              : 'Cooking');
      element('hearth-pot').textContent = pot
        ? `${status} · ${Hearths.potTemperature(pot).toFixed(1)} °C · ${(pot.waterKg + pot.foodKg).toFixed(1)} kg · simmer ${Math.floor(pot.cookedSeconds / 60)} / ${Hearths.RECIPES[pot.recipe].simmerSeconds / 60} min · ${pot.fuelUsedKg.toFixed(2)} kg wood burned. ${pot.onFire ? 'Over the fire.' : 'Lifted to cool.'} Lift and cool below 65 °C to serve.`
        : 'No pot. Ingredients and water must be delivered here.';
      const buttons = element('hearth-panel');
      buttons.querySelector('[data-hearth="lift"]').textContent = pot?.onFire
        ? 'Lift pot'
        : 'Hang pot';
      for (const action of ['lift', 'empty'])
        buttons.querySelector(`[data-hearth="${action}"]`).disabled = !pot;
      for (const action of ['serve', 'crew'])
        buttons.querySelector(`[data-hearth="${action}"]`).disabled =
          !Hearths.ready(pot) || Hearths.potTemperature(pot) > 65;
      buttons.querySelector('[data-hearth="cook"]').disabled = !!pot;
      buttons.querySelector('[data-hearth="supply"]').disabled =
        !this.app.workerControls?.selected.size;
      element('hearth-message').textContent = this.message;
      this.lastRefresh = performance.now();
    }
  }
  root.VinlandHearthControls = HearthControls;
})(window);
