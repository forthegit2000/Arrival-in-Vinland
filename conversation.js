/** Brief local conversations. Pausing a person never replaces their saved order. */
(function (root) {
  'use strict';

  const Orders =
    typeof module !== 'undefined' ? require('./worker-orders.js') : root.VinlandWorkerOrders;
  const Content = typeof module !== 'undefined' ? require('./content.js') : root.VinlandContent;
  const Timing =
    typeof module !== 'undefined' ? require('./work-timing.js') : root.VinlandWorkTiming;
  const Arrival = typeof module !== 'undefined' ? require('./arrival.js') : root.VinlandArrival;
  const LANDING_KEYS = {
    Digit1: 'land',
    Digit2: 'unload',
    Digit3: 'livestock',
    Digit4: 'pitch',
    Numpad1: 'land',
    Numpad2: 'unload',
    Numpad3: 'livestock',
    Numpad4: 'pitch',
  };
  const GATHER_KEYS = {
    Digit1: 'timber',
    Digit2: 'turf',
    Digit3: 'firewood',
    Digit4: 'hay',
    Numpad1: 'timber',
    Numpad2: 'turf',
    Numpad3: 'firewood',
    Numpad4: 'hay',
  };

  function activityLine(person, simulation) {
    if (person.age < 16) return "I'm helping my household.";
    if (person.health < 35) return "I'm resting. I feel unwell.";
    const order = person.order;
    if (!order) return "I'm idle, waiting for orders.";
    if (order.type === 'shelter')
      return person.insideSpace ? "I'm resting inside." : "I'm going to shelter.";
    if (order.type === 'move') return "I'm on my way.";
    if (order.type === 'arrival') {
      if (order.action === 'pitch' && !Orders.isWorkingHour(simulation.hour))
        return "I'm resting until work starts.";
      return (
        order.status ||
        {
          land: "I'm waiting for passage ashore.",
          row: "I'm crewing the landing boat.",
          unload: "I'm waiting to unload supplies.",
          livestock: "I'm preparing to bring the animals ashore.",
          pitch: "I'm preparing to pitch a tent.",
        }[order.action]
      );
    }
    const working =
      order.type === 'work'
        ? simulation.hour >= 8 && simulation.hour < 8 + simulation.state.politics.workHours
        : Orders.isWorkingHour(simulation.hour);
    if (!working) return "I'm resting until work starts.";
    const gathering = Timing.gatheringState(simulation, person);
    if (gathering) {
      const resource =
        order.type === 'gather'
          ? Orders.GATHERING[Orders.resourceForOrder(order)].label
          : order.task === 'fishing'
            ? 'fish'
            : 'plants';
      if (gathering.phase === 'waiting') return gathering.reason;
      if (gathering.phase === 'travelling') {
        if (gathering.destination === 'store') return "I'm bringing " + resource + ' to the store.';
        const woodcutting =
          order.type === 'gather' &&
          ['timber', 'firewood'].includes(Orders.resourceForOrder(order));
        return "I'm walking to the " + (woodcutting ? 'woodcutting' : 'gathering') + ' site.';
      }
      if (gathering.phase === 'loading') return "I'm loading " + resource + '.';
      if (gathering.phase === 'unloading') return "I'm unloading " + resource + ' at the store.';
      if (gathering.phase === 'working')
        return Timing.ACTIVITIES[gathering.activity]
          ? Timing.ACTIVITIES[gathering.activity] + '.'
          : "I'm processing " + resource + '.';
      return "I'm looking for a reachable gathering site.";
    }
    if (order.status) return order.status;
    if (order.type === 'haul') return "I'm hauling supplies between stores.";
    if (order.type === 'build') {
      const building = simulation.state.queue.find((entry) => entry.id === order.buildingId);
      if (!building) return "I've finished my work.";
      if (building.paused) return "I'm waiting for work to resume.";
      return "I'm working on " + Content.TYPES[building.type].name + '.';
    }
    if (person.moving) return "I'm walking to my work site.";
    if (Timing.ACTIVITIES[order.activity]) return Timing.ACTIVITIES[order.activity] + '.';
    return {
      fishing: "I'm fishing.",
      foraging: "I'm foraging.",
      herding: "I'm tending the camp and animals.",
      craft: "I'm crafting.",
    }[order.task];
  }

  class ConversationSession {
    constructor(simulation) {
      this.simulation = simulation;
      this.personId = null;
    }

    get person() {
      return this.simulation.state.people[this.personId];
    }

    start(id) {
      const person = this.simulation.state.people[id];
      const leader = this.simulation.state.leader;
      if (
        !person?.alive ||
        person.away ||
        id === leader.id ||
        !Number.isFinite(person.x) ||
        !Number.isFinite(person.z) ||
        Math.hypot(person.x - leader.x, person.z - leader.z) > 5
      )
        return false;
      this.close();
      this.personId = id;
      // Presentation/session state lives outside the serialized campaign.
      this.simulation.conversationPersonId = id;
      this.simulation.invalidateRoster();
      return true;
    }

    close() {
      if (this.personId === null) return;
      this.personId = null;
      this.simulation.conversationPersonId = null;
      this.simulation.invalidateRoster();
    }
  }

  class ConversationPanel {
    constructor(app, element, summary) {
      this.app = app;
      this.element = element;
      this.summary = summary;
      this.session = null;
      element.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-conversation]');
        if (button) this.command(button.dataset.conversation);
      });
    }

    get active() {
      return this.session !== null && this.session.personId !== null;
    }

    start(id) {
      this.close();
      this.session = new ConversationSession(this.app.sim);
      if (!this.session.start(id)) return false;
      this.app.world.clearInput();
      this.element.querySelector('strong').textContent = this.session.person.name;
      this.element.querySelector('p').textContent = activityLine(this.session.person, this.app.sim);
      this.element.hidden = false;
      this.summary.hidden = true;
      this.response = null;
      this.landingMenu = Arrival.landingOptions(this.app.sim, id).length > 0;
      document.body.dataset.conversation = 'true';
      this.refreshCommands();
      this.element.querySelector('[data-conversation="leave"]').focus();
      return true;
    }

    refreshCommands() {
      const available = this.app.sim.availablePeople.some(
        (person) => person.id === this.session.personId,
      );
      const options = Arrival.landingOptions(this.app.sim, this.session.personId);
      for (const button of this.element.querySelectorAll('[data-conversation]')) {
        const resource = button.dataset.conversation;
        if (resource.startsWith('arrival-')) {
          const option = options.find((item) => item.action === resource.slice(8));
          button.hidden = !this.landingMenu || !option;
          button.disabled = !option || !!option.reason;
          continue;
        }
        if (['landing', 'landing-back'].includes(resource)) {
          button.hidden =
            resource === 'landing' ? this.landingMenu || !options.length : !this.landingMenu;
          button.disabled = false;
          continue;
        }
        button.hidden = this.landingMenu && Object.hasOwn(Orders.GATHERING, resource);
        button.disabled =
          resource !== 'leave' &&
          (!available ||
            (resource !== 'stop' &&
              (Arrival.aboard(this.session.person) ||
                !!Orders.gatheringBlockedReason(this.app.sim, resource))));
      }
      const arrival = this.app.sim.state.arrival;
      const progress =
        this.landingMenu && arrival
          ? this.app.sim.presentPeople.filter(
              (person) => Arrival.aboard(person) && person.id !== arrival.ferry.workerId,
            ).length +
            ' people aboard · ' +
            arrival.tents.filter((tent) => ['packed', 'transit'].includes(tent.status)).length +
            ' tents aboard · ' +
            arrival.animals.filter((animal) => animal.shipId !== null).length +
            ' animals aboard.'
          : '';
      this.element.querySelector('p').textContent =
        this.response ||
        [
          !this.landingMenu || this.session.person.order
            ? activityLine(this.session.person, this.app.sim)
            : '',
          progress,
          this.landingMenu && options.every((option) => option.reason) ? options[0]?.reason : '',
        ]
          .filter(Boolean)
          .join(' ');
    }

    command(action) {
      if (!this.active) return;
      if (action === 'leave') {
        this.close();
        return;
      }
      const id = this.session.personId;
      if (['landing', 'landing-back'].includes(action)) {
        if (action === 'landing' && !Arrival.landingOptions(this.app.sim, id).length) return;
        this.landingMenu = action === 'landing';
        this.response = null;
        this.refreshCommands();
        return;
      }
      if (action.startsWith('arrival-')) {
        const task = action.slice(8);
        const option = Arrival.landingOptions(this.app.sim, id).find(
          (item) => item.action === task,
        );
        if (!option || option.reason) {
          this.response = option?.reason || 'That landing task is no longer available.';
          this.refreshCommands();
          return;
        }
        if (task === 'pitch') {
          this.close();
          this.tentSpeakerId = id;
          this.app.world.setWalkTentPlacement(true);
          this.app.notify?.('Move and look to place the tent. E confirms; Esc cancels.');
        } else {
          const result = Arrival.requestLanding(this.app.sim, id, task, null, this.app.world);
          if (result.count) {
            this.close();
            this.app.notify?.(
              result.count + (task === 'land' ? ' people ordered ashore.' : ' helpers assigned.'),
            );
          } else {
            this.response = result.reason;
            this.refreshCommands();
          }
        }
        return;
      }
      let response;
      let accepted = false;
      if (action === 'stop') {
        const count = this.app.sim.commandWorkers([id], { type: 'stop' });
        accepted = count > 0;
        response = "I'm unable to work just now.";
      } else if (Object.hasOwn(Orders.GATHERING, action)) {
        const result = this.app.workerControls.assignGathering([id], action);
        accepted = result.count > 0;
        response = result.reason;
      } else return;
      if (accepted) {
        this.close();
        return;
      }
      this.response = response;
      this.refreshCommands();
    }

    get placingTent() {
      return this.tentSpeakerId !== undefined;
    }

    confirmTent() {
      if (!this.placingTent) return;
      this.app.world.updateWalkTentPlacement();
      const target = this.app.world.walkTentPlacement;
      const result = target?.valid
        ? Arrival.requestLanding(this.app.sim, this.tentSpeakerId, 'pitch', target, this.app.world)
        : { count: 0, reason: 'Choose clear, dry ground with room to work beside the tent.' };
      if (!result.count) {
        this.app.notify?.(result.reason);
        return;
      }
      this.cancelTent();
      this.app.notify?.(result.count + ' helpers assigned to pitch the tent.');
    }

    cancelTent() {
      delete this.tentSpeakerId;
      this.app.world?.setWalkTentPlacement(false);
      this.app.world?.clearInput();
    }

    handleKey(event) {
      if (this.placingTent && ['KeyE', 'Escape'].includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) event.code === 'KeyE' ? this.confirmTent() : this.cancelTent();
        return true;
      }
      if (!this.active) return false;
      const nativeButton =
        ['Enter', 'Space'].includes(event.code) &&
        event.target.closest('button[data-conversation]');
      if (event.code !== 'Tab' && !nativeButton) event.preventDefault();
      if (!event.repeat) {
        if (['KeyE', 'Escape'].includes(event.code)) this.close();
        else if (['Digit0', 'Numpad0'].includes(event.code)) this.command('stop');
        else if (['Digit5', 'Numpad5'].includes(event.code))
          this.command(this.landingMenu ? 'landing-back' : 'landing');
        else if (this.landingMenu && LANDING_KEYS[event.code])
          this.command('arrival-' + LANDING_KEYS[event.code]);
        else if (!this.landingMenu && GATHER_KEYS[event.code])
          this.command(GATHER_KEYS[event.code]);
      }
      return true;
    }

    update() {
      if (this.placingTent && (this.app.world.view !== 'walk' || this.app.atTitleScreen))
        this.cancelTent();
      if (!this.active) return;
      const person = this.session.person;
      const leader = this.app.sim.state.leader;
      if (
        !person?.alive ||
        person.away ||
        this.app.world.view !== 'walk' ||
        Math.hypot(person.x - leader.x, person.z - leader.z) > 6
      )
        this.close();
      else this.refreshCommands();
    }

    close() {
      this.cancelTent();
      const wasActive = this.active;
      this.session?.close();
      this.element.hidden = true;
      this.summary.hidden = false;
      delete document.body.dataset.conversation;
      if (wasActive) {
        this.app.world?.clearInput();
        if (this.element.contains(document.activeElement))
          document.getElementById('interact-button').focus();
      }
    }
  }

  const api = { activityLine, ConversationSession, ConversationPanel };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandConversation = api;
})(typeof window !== 'undefined' ? window : globalThis);
