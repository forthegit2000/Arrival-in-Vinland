/** Arrival actions share the existing worker selection and order console. */
(function (root) {
  'use strict';
  const Arrival = root.VinlandArrival;
  const ACTIONS = [
    ['land', 'Land people', 'assets/buildings/boatyard.svg'],
    ['row', 'Row boat', 'assets/buildings/boatyard.svg'],
    ['unload', 'Unload supplies', 'assets/buildings/storehouse.svg'],
    ['landing', 'Landing site', 'assets/buildings/fishing.svg'],
    ['pitch', 'Pitch tent · 2 h', 'assets/buildings/tentbudir.svg'],
    ['livestock', 'Land livestock', 'assets/buildings/boatyard.svg'],
  ];
  function install(controls) {
    document.getElementById('arrival-orders')?.remove();
    if (!controls.app.sim.state.arrival) return;
    const group = document.createElement('div');
    group.className = 'worker-gathering-actions';
    group.id = 'arrival-orders';
    group.setAttribute('aria-label', 'Landing orders');
    for (const [action, title, icon] of ACTIONS) {
      const button = document.createElement('button');
      button.dataset.workerAction = 'arrival-' + action;
      const image = document.createElement('img');
      image.src = icon;
      image.alt = '';
      button.append(image, document.createTextNode(title));
      group.append(button);
    }
    document.querySelector('.worker-actions').prepend(group);
  }
  function handle(controls, action) {
    if (!action.startsWith('arrival-')) return false;
    const task = action.slice(8);
    if (['landing', 'pitch'].includes(task)) {
      controls.mode = 'arrival-' + task;
      controls.workOpen = false;
      controls.buildOpen = false;
    } else {
      const count = Arrival.order(controls.app.sim, [...controls.selected], task);
      controls.callbacks.notify(count + ' people ordered: ' + task + '.');
      controls.mode = null;
    }
    controls.render();
    return true;
  }
  function ground(controls, event) {
    if (!controls.mode?.startsWith('arrival-')) return false;
    const p = controls.world.pointFromMouse(event);
    if (!p) return true;
    if (controls.mode === 'arrival-landing') {
      const ok = Arrival.setLanding(controls.app.sim, p, controls.world);
      controls.callbacks.notify(
        ok ? 'Landing area chosen.' : 'Use a clear beach before unloading begins.',
      );
      if (ok) controls.mode = null;
    } else {
      if (!controls.world.canPitchArrivalTent(p)) {
        controls.callbacks.notify('The tent needs clear, dry, reasonably level ground.');
        return true;
      }
      const count = Arrival.order(controls.app.sim, [...controls.selected], 'pitch', p);
      controls.callbacks.notify(count + ' people assigned to pitch the tent.');
      controls.mode = null;
    }
    controls.render();
    return true;
  }
  function render(controls) {
    const group = document.getElementById('arrival-orders');
    if (!group) return;
    group.hidden = !controls.selected.size || controls.buildOpen || controls.workOpen;
    const people = [...controls.selected].map((id) => controls.app.sim.state.people[id]);
    const state = controls.app.sim.state,
      a = state.arrival;
    const cargo = Object.values(state.storage.stores).some(
      (s) => ['ship', 'ferry'].includes(s.type) && Object.values(s.stock).some((n) => n > 1e-7),
    );
    const packed = a.tents.some((t) => ['packed', 'transit'].includes(t.status));
    const passengers = state.people.some((p) => Arrival.aboard(p) && p.id !== a.ferry.workerId);
    const visible = {
      land: people.some((p) => Number.isInteger(p.arrivalShip) && !p.arrivalFerry),
      row: cargo || packed || passengers,
      unload: cargo || packed || state.people.some((p) => p.arrivalCarry),
      landing:
        !a.deployment &&
        a.tents.every((t) => t.status === 'packed') &&
        !Object.values(state.storage.stores.camp.stock).some((n) => n > 1e-7),
      pitch: a.tents.some((t) => ['landed', 'carried', 'pitching'].includes(t.status)),
      livestock: a.animals.some((animal) => animal.shipId !== null),
    };
    for (const button of group.querySelectorAll('button')) {
      const action = button.dataset.workerAction.slice(8);
      button.disabled =
        !people.length ||
        (action === 'livestock' && people.filter((p) => !Arrival.aboard(p)).length < 2);
      button.hidden = !visible[action];
    }
    if (people.some(Arrival.aboard))
      for (const button of document.querySelectorAll('[data-worker-action]')) {
        if (
          !button.dataset.workerAction.startsWith('arrival-') &&
          !['idle', 'stop'].includes(button.dataset.workerAction)
        ) {
          button.disabled = true;
          if (people.every(Arrival.aboard)) button.hidden = true;
        }
      }
    if (!Object.values(visible).some(Boolean)) group.hidden = true;
    if (controls.mode === 'arrival-landing')
      controls.targetHint = 'Click a clear beach to choose the landing area';
    else if (controls.mode === 'arrival-pitch')
      controls.targetHint = 'Click clear ground to pitch a packed tent';
    else if (people.length)
      document.getElementById('worker-order-status').textContent =
        people.find((p) => p.order?.status)?.order.status ||
        people.filter(Arrival.aboard).length +
          ' aboard · ' +
          a.tents.filter((t) => t.status === 'landed').length +
          ' packed tents ashore';
  }
  root.VinlandArrivalControls = { install, handle, ground, render };
})(window);
