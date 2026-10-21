/** One contextual G action, using the same visible pile locations as workers. */
(function (root) {
  'use strict';
  const Supplies = root.VinlandSupplies;
  class SupplyControls {
    constructor(app, notify) {
      this.app = app;
      this.notify = notify;
      this.button = document.getElementById('supply-button');
      this.button.onclick = () => this.interact();
    }
    available() {
      return (
        this.app.world.view === 'walk' &&
        this.app.screen === 'settlement' &&
        !this.app.atTitleScreen &&
        !this.app.conversation?.active &&
        !document.querySelector('dialog[open]')
      );
    }
    context() {
      const person = this.app.sim.state.people[this.app.sim.state.leader.id];
      const load = Supplies.carried(person);
      if (load) {
        const target = this.app.world.supplyPlacement(person, load);
        return {
          person,
          load,
          target,
          text: 'G · ' + (target?.storeId ? 'Store ' : 'Place ') + Supplies.describe(load),
        };
      }
      const source = Supplies.nearest(this.app.sim, person);
      if (!source) return null;
      return { person, source, text: 'G · Take ' + Supplies.label(source.pile.resource) };
    }
    interact() {
      if (!this.available()) return;
      const context = this.context();
      if (!context) return this.notify('Stand beside a supply pile.');
      const error = context.load
        ? Supplies.place(this.app.sim, context.person, context.target)
        : Supplies.pickup(this.app.sim, context.person, context.source.pile.id);
      const remaining = Supplies.carried(context.person);
      this.notify(
        error ||
          (remaining ? 'Carrying ' + Supplies.describe(remaining) + '.' : 'Supplies placed.'),
      );
      // Synchronize both ends of a transfer before drawing the next frame.
      this.app.world.update(0);
      this.app.dirty = true;
      this.update();
    }
    update() {
      const context = this.available() ? this.context() : null;
      this.button.hidden = !context;
      if (context) this.button.textContent = context.text;
    }
  }
  root.VinlandSupplyControls = SupplyControls;
})(window);
