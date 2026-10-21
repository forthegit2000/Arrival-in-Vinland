/**
 * Browser entry point: connect the campaign model, interactive world, and HUD.
 * Named bind* functions attach controls once; render* functions refresh the HUD.
 * initializeGame() at the bottom shows the startup sequence. The animation loop
 * advances the shared physical clock without making economic decisions.
 */
(function () {
  'use strict';

  const getElement = (id) => document.getElementById(id);
  const Model = window.VinlandModel;
  const Content = window.VinlandContent;
  const InterfaceHelpers = window.VinlandInterface;
  // Presentation scheduling. The model's own clock remains in game hours.
  const MAX_FRAME_SECONDS = 0.1;
  const WORLD_SYNC_INTERVAL_MS = 450;
  const HUD_REFRESH_INTERVAL_MS = 500;
  const AUTOSAVE_INTERVAL_MS = 30000;
  const TOAST_DURATION_MS = 4000;
  const resourceBar = new window.VinlandHud.ResourceBar(
    getElement('resources'),
    getElement('resource-tooltip'),
  );
  // Local SVG assets keep each building illustration editable and fully offline.
  function buildingIconMarkup(type) {
    return /* HTML */ `
      <img src="assets/buildings/${type}.svg" alt="" aria-hidden="true" />
    `;
  }
  const app = {
    sim: new Model.Simulation(),
    world: null,
    paused: true,
    speed: 1,
    category: 'shelter',
    activeBuild: null,
    dirty: true,
    modalPrior: true,
    atTitleScreen: true,
    hasStartedCampaign: false,
    screen: 'settlement',
    atlanticScreen: null,
    settings: {
      textScale: 1,
      quality: 'high',
      soundVolume: 0.6,
    },
    soundOn: false,
    audio: null,
  };
  try {
    const settings = JSON.parse(localStorage.getItem('vinland-settings') || 'null');
    if (settings && [1, 1.15, 1.3].includes(settings.textScale)) {
      app.settings = {
        ...app.settings,
        ...settings,
      };
    }
  } catch {}
  const interfaceController = new InterfaceHelpers.Interface(app);
  app.ui = interfaceController;
  app.setView = setView;
  app.setPaused = setPaused;
  app.launchVoyage = launchVoyage;
  app.notify = showToast;
  function showToast(text) {
    const modal = getElement('modal');
    if (modal.open && modal.classList.contains('system-window')) {
      let notice = getElement('menu-notice');
      if (!notice) {
        notice = document.createElement('p');
        notice.id = 'menu-notice';
        notice.className = 'menu-notice';
        notice.setAttribute('role', 'status');
        getElement('modal-content').prepend(notice);
      }
      notice.textContent = text;
      return;
    }
    getElement('event-notice').hidden = true;
    getElement('toast').textContent = text;
    getElement('toast').classList.add('visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(
      () => getElement('toast').classList.remove('visible'),
      TOAST_DURATION_MS,
    );
  }
  function setPaused(value) {
    app.paused = app.atTitleScreen || !!value;
    if (app.world) {
      app.world.paused = app.paused || app.screen === 'atlantic';
    }

    getElement('pause').textContent = app.paused ? '▶' : 'Ⅱ';
    getElement('pause').classList.toggle('active', app.paused);
    getElement('pause').setAttribute('aria-label', app.paused ? 'Resume time' : 'Pause time');
    getElement('pause-indicator').hidden = !app.paused;
  }
  app.openModal = (html, wide = false, options = {}) => {
    app.conversation?.close();
    const modal = getElement('modal');
    const isGameMenu = interfaceController.page === 'Game menu';
    const systemWindow = !!options.menuIcon;
    const wasOpen = modal.open;
    const changingWindowType =
      wasOpen && modal.classList.contains('system-window') !== systemWindow;
    if (changingWindowType) modal.close();
    modal.classList.toggle('menu-window', isGameMenu);
    modal.classList.toggle('system-window', systemWindow);
    modal.classList.toggle(
      'document-window',
      [
        'Reports & warnings',
        'Journal',
        'Expedition chronicle',
        'Controls & historical notes',
      ].includes(interfaceController.page),
    );
    const managementNavigation = interfaceController.managementNavigation();
    modal.classList.toggle('management-window', !systemWindow && !!managementNavigation);
    const navigation = modal.querySelector('.window-tabs');
    const navigatingTabs = navigation.contains(document.activeElement);
    navigation.innerHTML = managementNavigation?.markup || '';
    navigation.setAttribute('aria-label', managementNavigation?.name || 'Management pages');
    const windowIcon = getElement('window-icon');
    windowIcon.hidden = !systemWindow;
    if (systemWindow) windowIcon.src = 'assets/menu/' + options.menuIcon + '.svg';
    getElement('manage-button').setAttribute('aria-expanded', String(isGameMenu));
    if (app.world?.placing) {
      cancelPlacement();
    }
    if (!wasOpen) {
      app.modalReturnFocus = document.activeElement;
      app.modalPrior = app.paused;
      setPaused(true);
      modal.style.left = '';
      modal.style.top = '';
    }
    if (changingWindowType || systemWindow) {
      modal.style.left = '';
      modal.style.top = '';
    }
    app.world?.clearInput();
    getElement('modal-content').innerHTML = html;
    const footer = getElement('modal-content').querySelector('.menu-page-footer');
    const footerHost = getElement('window-footer');
    footerHost.replaceChildren();
    if (footer) footerHost.append(footer);
    footerHost.hidden = !footer;
    const heading = getElement('modal-content').querySelector('h2');
    getElement('window-title').textContent = heading?.textContent || 'Settlement';
    heading?.remove();
    modal.classList.toggle('wide-modal', wide);
    if (!modal.open) {
      if (systemWindow) modal.showModal();
      else modal.show();
    }
    if (navigatingTabs) {
      navigation.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
    }
    if (systemWindow) {
      // Keep transient notices from covering menu actions on small screens.
      getElement('toast').classList.remove('visible');
      const firstControl =
        getElement('modal-content').querySelector('button,input,select') ||
        getElement('window-footer').querySelector('button');
      firstControl?.focus();
    }
  };
  function closeModal() {
    if (!getElement('modal').open) {
      return;
    }

    getElement('modal').close();
    getElement('manage-button').setAttribute('aria-expanded', 'false');
    setPaused(app.modalPrior);
    app.world?.clearInput();
    if (app.modalReturnFocus?.isConnected && app.modalReturnFocus.getClientRects().length) {
      app.modalReturnFocus.focus({ preventScroll: true });
    } else if (app.atTitleScreen) {
      getElement('title-screen').querySelector('button')?.focus();
    } else if (interfaceController.page === 'Game menu') {
      getElement('manage-button').focus();
    }
  }
  // Drag management windows by their title bar; keep controls reachable at every viewport size.

  function applySettings() {
    document.documentElement.style.setProperty('--text-scale', app.settings.textScale);
    if (app.world) {
      app.world.renderer.setPixelRatio(
        Math.min(devicePixelRatio, app.settings.quality === 'low' ? 1 : 1.75),
      );
      app.world.renderer.shadowMap.enabled = app.settings.quality !== 'low';
      app.world.weatherEffects.setQuality(app.settings.quality);
      app.world.resize();
    }
    try {
      localStorage.setItem('vinland-settings', JSON.stringify(app.settings));
    } catch {}
  }
  function bindModel() {
    app.sim.onChange(() => (app.dirty = true));
  }
  function setView(mode) {
    app.conversation?.close();
    if (mode === 'atlantic') {
      closeModal();
      cancelPlacement();
      closeInspector();
      if (app.world.view === 'walk') {
        setView('district');
      }
      app.screen = 'atlantic';
      document.body.dataset.screen = 'atlantic';
      app.world.clearInput();
      app.world.paused = true;
      app.atlanticScreen.show();
      return;
    }
    if (mode === 'walk' && app.sim.state.people[app.sim.state.leader.id]?.away) {
      setView('atlantic');
      showToast('The leader is travelling; the local walking view is unavailable.');
      return;
    }
    if (app.world.placing) {
      cancelPlacement();
    }

    const returningFromAtlantic = app.screen === 'atlantic';
    app.screen = 'settlement';
    document.body.dataset.screen = 'settlement';
    app.atlanticScreen?.hide();
    app.world.paused = app.paused;

    closeInspector();
    app.world.clearInput();
    app.world.setView(mode);
    document.body.dataset.view = mode;
    app.world.resize();
    getElement('district-view').classList.toggle('active', mode === 'district');
    getElement('walk-view').classList.toggle('active', mode === 'walk');
    renderSelectionPanel();
    updateContextualHints();
    if (mode === 'walk') {
      setPaused(false);
    }
    if (returningFromAtlantic) {
      getElement(mode === 'walk' ? 'walk-view' : 'district-view').focus({ preventScroll: true });
    }
    app.dirty = true;
  }
  function centerDistrictView() {
    setView('district');
    app.world.center();
  }

  // The only instruction strip: show actions for the current interaction,
  // and leave the world clear when there is nothing to act on.
  function updateContextualHints() {
    if (!app.world) return;
    const strip = getElement('contextual-hints');
    const text = getElement('controls-hint');
    const walking = app.world.view === 'walk';
    const placing = !!app.world.placing;
    const controls = app.workerControls;
    getElement('walk-hint').hidden = !walking || placing;
    getElement('placement-banner').hidden = !placing;
    const hint =
      walking || placing || app.selected
        ? ''
        : controls?.targetHint ||
          (controls?.buildOpen
            ? 'Choose a building'
            : controls?.selected.size
              ? 'Right-click to move or assign builders'
              : '');
    if (text.textContent !== hint) text.textContent = hint;
    text.hidden = !hint;
    const nearbyActions =
      walking &&
      ['interact-button', 'hearth-button', 'supply-button'].some((id) => !getElement(id).hidden);
    strip.hidden =
      app.atTitleScreen ||
      app.screen === 'atlantic' ||
      app.conversation?.active ||
      getElement('modal').open ||
      !(placing || nearbyActions || text.textContent);
  }

  function saveCampaign() {
    if (!app.hasStartedCampaign || app.atTitleScreen) return;
    try {
      localStorage.setItem(InterfaceHelpers.saveSlots.current, app.sim.serialize());
      showToast('Campaign saved in this browser.');
    } catch {
      showToast('Local storage is unavailable. Use Export save in Settings.');
    }
  }
  function autosaveCampaign() {
    if (!app.hasStartedCampaign || app.atTitleScreen) return;
    try {
      localStorage.setItem(InterfaceHelpers.saveSlots.autosave, app.sim.serialize());
    } catch {}
  }
  function showTitleScreen() {
    app.conversation?.close();
    app.cheatControls?.toggle(false);
    app.hearthControls?.close();
    cancelPlacement();
    closeInspector();
    app.atTitleScreen = true;
    getElement('game').inert = true;
    setPaused(true);
    app.world.clearInput();
    getElement('title-screen').innerHTML = interfaceController.mainMenu();
    getElement('title-screen').hidden = false;
    getElement('title-screen').querySelector('button')?.focus();
  }
  function replaceSimulation(simulation) {
    app.conversation?.close();
    app.atTitleScreen = false;
    app.hasStartedCampaign = true;
    getElement('game').inert = false;
    getElement('title-screen').hidden = true;
    app.screen = 'settlement';
    document.body.dataset.screen = 'settlement';
    app.atlanticScreen.hide();
    closeInspector();
    app.activeBuild = null;
    app.workerControls?.dispose();
    app.world?.destroy();
    app.sim = simulation;
    bindModel();
    app.world = new window.VinlandWorld.World(getElement('world'), simulation);
    bindWorld();
    app.world.sync();
    if (simulation.state.leader.walking) {
      app.world.setView('walk');
    }

    setPaused(true);
    document.body.dataset.view = app.world.view;
    getElement('district-view').classList.toggle('active', app.world.view === 'district');
    getElement('walk-view').classList.toggle('active', app.world.view === 'walk');
    getElement('placement-banner').hidden = true;
    getElement('event-notice').hidden = true;
    updateContextualHints();
    applySettings();
    lastNotification = simulation.state.notifications.at(-1)?.id || 0;
    endingShown = false;
    app.dirty = true;
    renderInterface();
    lastSave = performance.now();
  }
  function toggleHallRoof() {
    if (app.world.view === 'walk') return app.world.cutaway;
    const active = app.world.toggleRoof();
    getElement('roof-toggle').textContent = active ? 'Show roofs' : 'Cutaway';
    getElement('roof-toggle').classList.toggle('active', active);
    return active;
  }
  function startPlacement(type) {
    if (!window.VinlandCheats.instant(app.sim.state) && !app.workerControls?.selected.size) {
      showToast('Select the people who should build first.');
      return;
    }
    if (getElement('modal').open) {
      closeModal();
    }
    if (app.world.view === 'walk') {
      setView('district');
    }

    closeInspector();
    if (type === 'restore') {
      if (app.world.placing) {
        cancelPlacement();
      }
      const order = app.sim.order(type, 0, 0);
      if (order) {
        app.world.sync();
        if (!window.VinlandCheats.instant(app.sim.state))
          app.workerControls.assignConstruction(order);
      } else {
        showToast(app.sim.blockedReason(type) || 'Hall F is already restored.');
      }
      renderInterface();
      return;
    }
    app.activeBuild = type;
    app.world.startPlacement(type);
    getElement('placement-banner').hidden = false;
    updateContextualHints();
    renderInterface();
  }
  function cancelPlacement() {
    app.world.endPlacement();
    app.activeBuild = null;
    getElement('placement-banner').hidden = true;
    updateContextualHints();
    renderInterface();
  }
  function closeInspector() {
    if (app.world) {
      app.world.clearSelection();
    }

    getElement('inspector').hidden = true;
    app.selected = null;
    renderSelectionPanel();
  }
  function inspectSelection(type, id) {
    app.world.workerControls?.clear();
    app.selected = { type, id };
    renderSelectedObject();
    renderSelectionPanel();
  }
  function selectionInventory(storeId) {
    const store = app.sim.state.storage.stores[storeId];
    if (!store) return '';
    const Storage = window.VinlandStorage;
    const entries = Storage.KEYS.filter((key) => (store.stock[key] || 0) > 1e-7);
    return /* HTML */ `
      <section class="selection-inventory" aria-label="Available supplies">
        <strong>Available supplies</strong>
        <div class="selection-stock-list">
          ${entries.length
            ? entries
                .map((key) => {
                  const label =
                    Content.FOOD[key]?.name ||
                    key
                      .replace(/([a-z])([A-Z])/g, '$1 $2')
                      .replace(/^./, (letter) => letter.toUpperCase());
                  return `<div class="selection-stock" data-stock-resource="${key}">
                  <span>${InterfaceHelpers.esc(label)}</span>
                  <strong>${InterfaceHelpers.number(store.stock[key], 2)} ${Storage.unit(key)}</strong>
                </div>`;
                })
                .join('')
            : '<span class="muted">Empty</span>'}
        </div>
      </section>
    `;
  }
  function renderSelectionPanel() {
    const panel = getElement('selection-panel');
    const controls = app.world?.workerControls;
    const context = controls?.buildOpen
      ? 'build'
      : app.selected
        ? 'object'
        : controls?.selected.size
          ? 'people'
          : 'none';
    panel.dataset.context = context;
    getElement('selection-empty').hidden = context !== 'none' || app.world?.view === 'walk';
    panel.querySelector('.build-panel').hidden = !['people', 'build'].includes(context);
    getElement('inspector').hidden = context !== 'object';
    getElement('selection-cheat-build').hidden = !window.VinlandCheats.instant(app.sim.state);
    const layout = app.world?.view === 'walk' ? 'walk' : context;
    if (document.body.dataset.selection !== layout) {
      document.body.dataset.selection = layout;
    }
    alignDistrictViewport();
    updateContextualHints();
  }
  function alignDistrictViewport() {
    if (app.world?.view !== 'district') return;
    const worldBounds = getElement('world').getBoundingClientRect();
    const dockTop = document.querySelector('.simulation-console').getBoundingClientRect().top;
    const coveredHeight = Math.max(0, worldBounds.bottom - dockTop);
    const unobscuredHeight = Math.max(1, worldBounds.height - coveredHeight);
    const camera = app.world.districtCamera;
    if (!camera || !worldBounds.width || !worldBounds.height) return;
    // Extend the image below the dock without moving or magnifying the map
    // above it. The same person stays under the pointer when details appear.
    camera.zoom = unobscuredHeight / worldBounds.height;
    camera.setViewOffset(
      worldBounds.width,
      worldBounds.height,
      0,
      coveredHeight / 2,
      worldBounds.width,
      worldBounds.height,
    );
  }
  function renderSelectedObject() {
    if (!app.selected) return;
    const { type, id } = app.selected;
    const simulation = app.sim;
    const state = simulation.state;
    let title;
    let body;
    let details;
    const { informationRow } = InterfaceHelpers;
    if (type === 'hall' || type === 'room') {
      title = 'Hall F';
      body =
        /* HTML */ `<p>Six rooms · boat-repair lean-to</p>` +
        informationRow('Condition', state.hallReady ? 'Restored' : 'Repairs needed') +
        informationRow('Winter shelter', state.hallReady ? '32 estimated berths' : 'Not ready');
      details =
        /* HTML */ `<button data-action="inspect-hall">Rooms & plan</button>` +
        (!state.hallReady
          ? /* HTML */ `
              <button data-action="build" data-type="restore">Repair</button>
            `
          : '') +
        /* HTML */ `
          <button data-action="query-cutaway">Cutaway</button>
        `;
    } else if (type === 'stockpile') {
      const store = state.storage.stores[id];
      if (!store) return closeInspector();
      title = 'Ground supplies';
      body =
        informationRow(
          'Stock volume',
          InterfaceHelpers.number(window.VinlandStorage.storeVolume(state, store), 2) + ' m³',
        ) + selectionInventory(id);
      details = `<button data-action="inventory" data-store="${InterfaceHelpers.esc(id)}">Inventory</button>`;
    } else if (type === 'building') {
      const building = [...state.buildings, ...state.queue].find((b) => b.id === id);
      if (!building) {
        closeInspector();
        return;
      }
      title = Content.TYPES[building.type].name;
      const hands = simulation.crewDistribution().find((d) => d.q.id === id)?.assigned || 0;
      const constructing = state.queue.includes(building);
      body =
        (constructing
          ? informationRow(
              'Work complete',
              InterfaceHelpers.number((building.progress / building.hours) * 100, 0) + '%',
            ) +
            informationRow(
              'Work remaining',
              InterfaceHelpers.number(Math.max(0, building.hours - building.progress), 1) +
                ' person-hours',
            )
          : '') +
        informationRow('Condition', InterfaceHelpers.number(building.condition ?? 100, 0) + '%') +
        (state.queue.includes(building)
          ? informationRow('Crew assigned', hands)
          : informationRow('Ownership', InterfaceHelpers.esc(building.owner || 'Expedition')));
      details = /* HTML */ `
        <button data-action="building" data-id="${id}">Details & work</button>
      `;
      const storeId = 'building:' + id;
      if (state.storage.stores[storeId]) {
        body += selectionInventory(storeId);
        details += `<button data-action="inventory" data-store="${storeId}">Inventory</button>`;
      }
    } else if (type === 'ship' || type === 'livestock-ship') {
      const ship = state.ships[id] || state.ships[0];
      title = ship.name;
      body =
        informationRow('Status', ship.status) +
        informationRow('Hull', ship.condition + '%') +
        informationRow('Sail', ship.sail ? 'On vessel' : 'Used for shelter');
      if (state.arrival)
        body +=
          informationRow(
            'People aboard',
            state.people.filter((p) => p.arrivalShip === ship.id && !p.arrivalFerry).length,
          ) +
          informationRow(
            'Animals aboard',
            state.arrival.animals.filter((a) => a.shipId === ship.id).length,
          );
      if (state.arrival) body += selectionInventory('ship:' + ship.id);
      details = /* HTML */ `
        <button data-action="fleet">Fleet & voyages</button>
        ${state.arrival
          ? `<button data-action="inventory" data-store="ship:${ship.id}">Cargo inventory</button>`
          : ''}
      `;
    } else if (type === 'tent') {
      title = 'Landing tent';
      body =
        informationRow('Shelter', '8 summer berths') + informationRow('Winter insulation', 'None');
      details = /* HTML */ `
        <button data-action="details" data-type="tentbudir">Convert to búð</button>
      `;
    } else {
      return;
    }
    getElement('inspect-name').textContent = title;
    // Keep action buttons and keyboard focus intact while quantities change.
    if (app.inspectorBody !== body) {
      getElement('inspect-details').innerHTML = body;
      app.inspectorBody = body;
    }
    if (app.inspectorActions !== details) {
      getElement('inspect-actions').innerHTML = details;
      app.inspectorActions = details;
    }
  }
  function inspectNearby() {
    if (app.conversation?.placingTent) {
      app.conversation.confirmTent();
      return;
    }
    if (app.conversation?.active) {
      app.conversation.close();
      return;
    }
    const n = app.world.nearby();
    if (!n) {
      showToast('Move closer to a person or building.');
      return;
    }
    if (n.type === 'go-ashore') {
      if (window.VinlandArrival.leaderAshore(app.sim, app.world)) {
        showToast(
          app.paused
            ? 'Landing ordered with a rower and companion. Space starts the crossing.'
            : 'The landing boat is being readied with a rower and a companion.',
        );
        app.dirty = true;
      }
    } else if (n.type === 'board-boat' || n.type === 'leave-boat') {
      if (app.world.useNearbyBoat()) {
        showToast(
          n.type === 'board-boat'
            ? 'Aboard ' + app.sim.state.ships[n.id].name + '.'
            : 'Back in the water.',
        );
        app.dirty = true;
      }
    } else if (n.type === 'door') {
      const open = !window.VinlandDoors.isOpen(app.sim.state, n.id);
      if (!app.world.doorControls.setOpen(n.id, open)) showToast('The doorway is occupied.');
    } else if (n.type === 'person') {
      if (app.world.view === 'walk') {
        closeInspector();
        app.conversation.start(n.id);
      } else interfaceController.person(n.id);
    } else if (n.type === 'hall') {
      interfaceController.hall();
    } else {
      interfaceController.building(n.id);
    }
  }
  function bindWorld() {
    app.workerControls = new window.VinlandWorkerControls.WorkerControls(app, {
      notify: showToast,
      cancelPlacement,
      closeInspector,
      selectionChanged: renderSelectionPanel,
    });
    app.world.onSelect = (type, id) => {
      closeModal();
      if (type === 'person') {
        app.workerControls.select(
          [id],
          app.world.keys.has('ShiftLeft') || app.world.keys.has('ShiftRight'),
        );
        return;
      }
      inspectSelection(type, id);
    };
    app.world.onClearSelection = closeInspector;
    app.world.onCancel = () => {
      if (app.world.placing) {
        cancelPlacement();
      } else {
        closeInspector();
      }
    };
    app.world.onHover = (point) =>
      (getElement('site-coordinates').textContent =
        Math.round(point.x) + ' m E / ' + Math.round(point.z) + ' m S');
    app.world.onPlacementStatus = (placement, reason) => {
      getElement('placement-text').textContent =
        reason ||
        (!placement.valid
          ? 'Site blocked — move to clear ground'
          : Content.TYPES[placement.type].name + ' · click to place');
      getElement('placement-banner').classList.toggle('invalid', !placement.valid);
    };
    app.world.onPlace = (placement) => {
      const job = app.sim.order(placement.type, placement.x, placement.z, placement.rotation);
      if (!job) {
        showToast(app.sim.blockedReason(placement.type) || 'Choose a valid site.');
        return;
      }
      app.world.sync();
      if (!window.VinlandCheats.instant(app.sim.state)) app.workerControls.assignConstruction(job);
      cancelPlacement();
      if (window.VinlandCheats.instant(app.sim.state)) {
        showToast(Content.TYPES[placement.type].name + ' built instantly for free.');
        return;
      }
      showToast(
        Content.TYPES[placement.type].name +
          ' ordered. ' +
          (app.paused ? 'Resume time to begin work.' : 'Crew will work during the working day.'),
      );
    };
    app.world.onInvalid = () =>
      showToast(
        app.sim.blockedReason(app.activeBuild) ||
          'Site blocked: allow space between buildings, avoid steep or wet ground.',
      );
  }
  // HUD sections are independent so a layout change stays local.
  function renderInterface() {
    const state = app.sim.state;
    resourceBar.render(app.sim);
    renderCalendar(app.sim);
    renderCampStatus(app.sim);
    renderBuildPalette(app.sim);
    renderWalkingStatus(app.sim);
    app.workerControls?.render();
    renderSelectedObject();
    app.atlanticScreen?.render();
    getElement('roof-toggle').disabled =
      !state.config.inheritedHall &&
      !state.buildings.some((building) => window.VinlandBuildingSpaces.plan(building.type));
    document.querySelector('.map-footer > span').innerHTML =
      '<i></i> ' + (state.config.inheritedHall ? 'Hall F' : 'Camp');
    app.dirty = false;
  }
  function renderCalendar(simulation) {
    getElement('date').textContent = InterfaceHelpers.date(simulation);
    const secondsToday = Math.floor(simulation.hour * 3600 + 0.00001);
    const clockParts = [
      Math.floor(secondsToday / 3600),
      Math.floor(secondsToday / 60) % 60,
      secondsToday % 60,
    ];
    getElement('daytime').textContent = clockParts
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
    getElement('temperature').textContent = simulation.weather.temp + '°';
    getElement('weather').textContent = simulation.weather.name
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase());
    getElement('winter-days').textContent = simulation.winterDays
      ? 'Winter in ' + simulation.winterDays + ' days'
      : simulation.season === 'winter'
        ? 'Cold season'
        : 'Spring recovery';
  }
  function renderCampStatus(simulation) {
    const state = simulation.state;
    getElement('settlement-name').textContent = simulation.homeName;
    getElement('population').textContent = state.population;
    getElement('shelter-number').textContent =
      Math.min(simulation.shelter, simulation.campPopulation) + ' / ' + simulation.campPopulation;
    getElement('shelter-bar').style.width =
      Math.min(100, (simulation.shelter / Math.max(1, simulation.campPopulation)) * 100) + '%';
    getElement('winter-shelter').textContent =
      simulation.winterShelter + ' winter berths · ' + Math.round(state.health) + '% health';
    const projects = state.queue.length;
    const warnings = simulation.alerts.length;
    const activity = getElement('activity-button');
    activity.classList.toggle('warning', warnings > 0);
    activity.setAttribute(
      'aria-label',
      'Activity, ' + projects + ' active projects, ' + warnings + ' warnings',
    );
    getElement('activity-tooltip').textContent =
      'Activity · ' + projects + ' active projects · ' + warnings + ' warnings';
    for (const [id, count, label] of [
      ['activity-projects', projects, projects === 1 ? 'project' : 'projects'],
      ['activity-warnings', warnings, warnings === 1 ? 'warning' : 'warnings'],
    ]) {
      const badge = getElement(id);
      badge.hidden = count === 0;
      badge.textContent = count + ' ' + label;
      badge.dataset.count = count > 99 ? '99+' : String(count);
    }
  }
  function renderBuildPalette(simulation) {
    const state = simulation.state;
    const palette = getElement('build-list');
    const definitions = Object.entries(Content.TYPES).filter(
      ([type, definition]) =>
        app.category === definition.category &&
        !(type === 'restore' && (!state.config.inheritedHall || state.hallReady)),
    );
    const catalog = definitions.map(([type]) => type).join('|');

    // Keep loaded SVG images and keyboard focus intact during resource updates.
    // Rebuild only when a category or Hall F's availability changes the catalog.
    if (palette.dataset.catalog !== catalog) {
      const focusedType = document.activeElement?.dataset.build;
      const scroll = palette.scrollLeft;
      palette.innerHTML = definitions
        .map(
          ([type, definition]) => /* HTML */ `
            <button class="build-card" data-build="${type}" aria-pressed="false">
              <strong class="build-card-title">${definition.name}</strong>
              <span class="building-icon">${buildingIconMarkup(type)}</span>
              <small class="build-hours">
                ${InterfaceHelpers.number(definition.hours, 0)} person/hours
              </small>
            </button>
          `,
        )
        .join('');
      palette.dataset.catalog = catalog;
      palette.scrollLeft = scroll;
      if (focusedType && !getElement('modal').open) {
        palette.querySelector('[data-build="' + focusedType + '"]')?.focus({ preventScroll: true });
      }
    }
    for (const button of palette.querySelectorAll('[data-build]')) {
      const type = button.dataset.build;
      button.classList.toggle('active', app.activeBuild === type);
      button.classList.toggle('unavailable', Boolean(simulation.blockedReason(type)));
      button.setAttribute('aria-pressed', app.activeBuild === type ? 'true' : 'false');
    }
  }
  function renderWalkingStatus(simulation) {
    const state = simulation.state;
    const leader = state.people[state.leader.id];
    getElement('mobile-walk').textContent = app.world.view === 'walk' ? 'District' : 'Walk';
    getElement('walk-leader').textContent = leader?.name || 'Expedition leader';
    getElement('walk-state').textContent =
      'Health ' +
      Math.round(leader?.health || 0) +
      '% · Fatigue ' +
      Math.round(leader?.fatigue || 0) +
      '% · ' +
      (app.paused ? 'Paused' : app.speed + '× real time');
  }
  async function setSoundEnabled(enabled) {
    app.soundOn = enabled;
    try {
      if (!app.audio && enabled) {
        app.audio = new window.VinlandAudio.AmbiencePlayer(app.settings.soundVolume);
      }
      await app.audio?.setEnabled(enabled);
    } catch {
      app.soundOn = false;
      showToast('Ambient sound could not start. Keep the media folder beside index.html.');
    }
    const checkbox = document.querySelector('[data-setting="sound"]');
    if (checkbox) {
      checkbox.checked = app.soundOn;
    }
  }
  function launchVoyage(shipId, regionId, crewCount, timber) {
    const voyage = app.sim.launch(shipId, regionId, crewCount, timber);
    if (!voyage) {
      return false;
    }
    closeModal();
    setPaused(false);
    app.world.sync();
    app.dirty = true;
    showToast('Voyage launched. Crew and cargo are now away from camp.');
    return true;
  }
  // Commands from both management windows and the dock use this dispatcher.
  function handleAction(button) {
    const actionName = button.dataset.action;
    const targetId = Number(button.dataset.id);
    const simulation = app.sim;
    const views = {
      hub: 'hub',
      settlement: 'people',
      exploration: 'fleet',
      activity: 'works',
      works: 'works',
      people: 'people',
      stocks: 'stocks',
      council: 'council',
      fleet: 'fleet',
      coast: 'coast',
      reports: 'reports',
      journal: 'journal',
      chronicle: 'chronicle',
      campaign: 'campaign',
      scenario: 'scenario',
      help: 'help',
      atlantic: 'atlantic',
      'load-game': 'loadGame',
    };
    if (views[actionName]) {
      interfaceController[views[actionName]]();
      return;
    }
    switch (actionName) {
      case 'menu-back': {
        if (app.atTitleScreen) closeModal();
        else interfaceController.menu();
        return;
      }
      case 'cheats': {
        closeModal();
        app.cheatControls.toggle(true);
        return;
      }
      case 'quit': {
        closeModal();
        autosaveCampaign();
        showTitleScreen();
        return;
      }
      case 'continue-game': {
        if (!app.hasStartedCampaign) return;
        app.atTitleScreen = false;
        getElement('game').inert = false;
        getElement('title-screen').hidden = true;
        setPaused(false);
        getElement('manage-button').focus();
        return;
      }
      case 'load-slot': {
        const slot = button.dataset.slot;
        if (!Object.hasOwn(InterfaceHelpers.saveSlots, slot)) {
          return;
        }
        let loaded;
        try {
          loaded = Model.Simulation.load(
            localStorage.getItem(InterfaceHelpers.saveSlots[slot]) || '',
          );
        } catch {}
        if (!loaded) {
          showToast('This saved game could not be loaded.');
          return;
        }
        closeModal();
        replaceSimulation(loaded);
        showToast('Saved game loaded and paused.');
        return;
      }
      case 'close': {
        closeModal();
        return;
      }
      case 'inspect-hall': {
        interfaceController.hall(app.selected?.type === 'room' ? app.selected.id : undefined);
        return;
      }
      case 'query-cutaway': {
        toggleHallRoof();
        return;
      }
      case 'details': {
        interfaceController.build(button.dataset.type);
        return;
      }
      case 'person': {
        interfaceController.person(targetId);
        return;
      }
      case 'inventory': {
        interfaceController.inventory(button.dataset.store);
        return;
      }
      case 'building': {
        interfaceController.building(targetId);
        return;
      }
      case 'voyage': {
        interfaceController.voyage(targetId);
        return;
      }
      case 'select-workers': {
        closeModal();
        setView('district');
        app.workerControls.action('idle');
        return;
      }
      case 'work-here': {
        closeModal();
        app.workerControls.assignAtBuilding(targetId);
        return;
      }
      case 'assign-workers': {
        const order = simulation.state.queue.find((item) => item.id === targetId);
        closeModal();
        setView('district');
        if (!app.workerControls.selected.size) {
          showToast('Select people, then assign them to this work order.');
        } else if (order) app.workerControls.assignConstruction(order);
        return;
      }
      case 'build': {
        const type = button.dataset.type;
        closeModal();
        startPlacement(type);
        break;
      }
      case 'cutaway': {
        closeModal();
        setView('district');
        toggleHallRoof();
        app.world.focus(0, 0, 75);
        break;
      }
      case 'focus-fleet': {
        closeModal();
        setView('district');
        const anchorage = app.world.shipPositions[
          Math.floor(app.world.shipPositions.length / 2)
        ] || [-87, 0];
        app.world.focus(anchorage[0], anchorage[1], 125);
        break;
      }
      case 'focus-building': {
        const b = [...simulation.state.buildings, ...simulation.state.queue].find(
          (v) => v.id === targetId,
        );
        closeModal();
        setView('district');
        if (b) {
          app.world.focus(b.x, b.z, 75);
        }
        break;
      }
      case 'cancel-project': {
        simulation.cancel(targetId);
        app.world.sync();
        interfaceController.works();
        return;
      }
      case 'cancel':
      case 'dismantle': {
        simulation[actionName](targetId);
        closeModal();
        app.world.sync();
        break;
      }
      case 'repair-building':
      case 'repair-ship': {
        if (simulation.repair(targetId, actionName === 'repair-ship')) {
          closeModal();
          setPaused(false);
          app.world.sync();
          const repair = simulation.state.queue.at(-1);
          if (window.VinlandCheats.instant(simulation.state))
            showToast('Repaired instantly for free.');
          else if (app.workerControls.selected.size) app.workerControls.assignConstruction(repair);
          else showToast('Repair planned. Select people and assign them to the work order.');
        } else {
          showToast('Repairs need an available target, timber and iron.');
        }
        break;
      }
      case 'appoint': {
        if (simulation.appointSteward(targetId)) {
          interfaceController.council();
          showToast('Steward appointed.');
        }
        break;
      }
      case 'visit': {
        if (simulation.visit(targetId)) {
          interfaceController.person(targetId);
          showToast('Report heard; this visit is recorded.');
        } else {
          showToast('Visit the person at camp. A visit is counted once per day.');
        }
        break;
      }
      case 'propose': {
        const rule = button.dataset.rule;
        let value = getElement('policy-' + rule).value;
        if (rule === 'workHours') {
          value = Number(value);
        }
        if (simulation.propose(rule, value)) {
          closeModal();
          setPaused(false);
          showToast('Household assembly will resolve the proposal tomorrow.');
        } else {
          showToast('An assembly is already pending, or the leader is away.');
        }
        break;
      }
      case 'cull': {
        simulation.cull(getElement('cull-species').value, 1);
        interfaceController.fleet();
        break;
      }
      case 'scout':
      case 'envoy': {
        if (
          simulation.scout(
            actionName === 'envoy' ? 'estuary' : button.dataset.region,
            actionName === 'envoy' ? 'envoy' : 'survey',
          )
        ) {
          closeModal();
          setPaused(false);
          showToast('Party sent with provisions.');
        } else {
          showToast('The party needs four available adults, dried food and no competing journey.');
        }
        break;
      }
      case 'exchange': {
        if (simulation.exchange()) {
          closeModal();
          setPaused(false);
          showToast('Reciprocal exchange party sent.');
        } else {
          showToast('Exchange requires an agreement, provisions and an available party.');
        }
        break;
      }
      case 'launch': {
        launchVoyage(
          targetId,
          getElement('voyage-region').value,
          Number(getElement('voyage-crew').value),
          Number(getElement('voyage-timber').value),
        );
        break;
      }
      case 'save': {
        saveCampaign();
        if (interfaceController.page === 'Game menu') {
          closeModal();
        }
        break;
      }
      case 'export': {
        const url = URL.createObjectURL(
          new Blob([simulation.serialize()], {
            type: 'application/json',
          }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'vinland-campaign-' + simulation.state.config.seed + '.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        break;
      }
      case 'import': {
        getElement('import-file').click();
        break;
      }
      case 'start-campaign': {
        const preset = getElement('scenario-preset').value;
        const base = Content.PRESETS[preset];
        const input = {
          ...base,
          preset,
          seed: getElement('scenario-seed').value,
          population: Number(getElement('scenario-population').value),
          ships: Number(getElement('scenario-ships').value),
          tents: Number(getElement('scenario-tents').value),
          site: getElement('scenario-site').value,
          month: Number(getElement('scenario-month').value),
          supplies: Number(getElement('scenario-supplies').value),
          severity: Number(getElement('scenario-severity').value),
          legacy: getElement('scenario-legacy').checked,
          inheritedHall: getElement('scenario-site').value === 'meadows',
        };
        try {
          if (app.hasStartedCampaign)
            localStorage.setItem('vinland-previous-campaign', simulation.serialize());
        } catch {}
        const next = new Model.Simulation(input);
        if (!window.VinlandArrival.start(next)) {
          showToast('Use more passenger knarrs or fewer people to keep a separate livestock ship.');
          break;
        }
        closeModal();
        replaceSimulation(next);
        showToast('A new seeded campaign begins.');
        break;
      }
      case 'end-campaign': {
        app.openModal(/* HTML */ `
          <h2>Close this chapter?</h2>
          <p>
            The chronicle will record the current society. Export a save before ending if you want
            to resume this state.
          </p>
          <div class="actions">
            <button class="primary" data-action="confirm-end">Record ending</button>
            <button class="outlined" data-action="close">Continue</button>
          </div>
        `);
        break;
      }
      case 'confirm-end': {
        simulation.endCampaign();
        setPaused(true);
        interfaceController.chronicle();
        autosaveCampaign();
        break;
      }
    }
    app.dirty = true;
  }
  let lastNotification = app.sim.state.notifications.at(-1)?.id || 0;
  let lastUI = 0;
  let lastSync = 0;
  let lastSave = 0;
  let endingShown = false;
  function bindRotationButton(id, control, direction) {
    const button = getElement(id);
    const start = () => app.world.heldRotationButtons.set(id, { control, direction });
    const stop = () => app.world.heldRotationButtons.delete(id);
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      start();
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
      button.addEventListener(eventName, stop);
    }
    // Holding Space/Enter on these controls turns rather than toggling pause.
    button.addEventListener('keydown', (event) => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        start();
      }
    });
    button.addEventListener('keyup', (event) => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        stop();
      }
    });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  function bindTimeControls() {
    getElement('pause').onclick = () => {
      const value = !app.paused;
      closeModal();
      setPaused(value);
    };
    const speedButtons = document.querySelectorAll('[data-speed]');
    for (const button of speedButtons) {
      button.onclick = () => {
        closeModal();
        app.speed = Number(button.dataset.speed);
        for (const speedButton of speedButtons) {
          speedButton.classList.toggle('active', speedButton === button);
        }
        setPaused(false);
      };
    }
  }
  function bindConstructionControls() {
    getElement('selection-cheat-build').onclick = () => app.workerControls.action('build');
    getElement('select-idle-workers').onclick = () => app.workerControls.action('idle');
    const palette = getElement('build-list');
    const categoryButtons = document.querySelectorAll('[data-category]');
    for (const button of categoryButtons) {
      button.onclick = () => {
        app.category = button.dataset.category;
        palette.scrollLeft = 0;
        for (const categoryButton of categoryButtons) {
          const selected = categoryButton === button;
          categoryButton.classList.toggle('active', selected);
          categoryButton.setAttribute('aria-selected', String(selected));
        }
        renderInterface();
      };
    }
    palette.onclick = (event) => {
      const button = event.target.closest('[data-build]');
      if (button) {
        startPlacement(button.dataset.build);
      }
    };
    // Extra detail is an explicit command, never a hover or focus popup.
    palette.oncontextmenu = (event) => {
      const button = event.target.closest('[data-build]');
      if (!button) {
        return;
      }
      event.preventDefault();
      interfaceController.build(button.dataset.build);
    };
    palette.onkeydown = (event) => {
      const button = event.target.closest('[data-build]');
      if (button && event.code === 'F1') {
        event.preventDefault();
        interfaceController.build(button.dataset.build);
      }
    };
    palette.addEventListener(
      'wheel',
      (event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.preventDefault();
          palette.scrollLeft += event.deltaY;
        }
      },
      {
        passive: false,
      },
    );
    getElement('palette-prev').onclick = () =>
      palette.scrollBy({
        left: -330,
        behavior: 'smooth',
      });
    getElement('palette-next').onclick = () =>
      palette.scrollBy({
        left: 330,
        behavior: 'smooth',
      });
    getElement('close-inspector').onclick = closeInspector;
    getElement('mobile-walk').onclick = () =>
      setView(app.world.view === 'walk' ? 'district' : 'walk');
    getElement('mobile-atlantic').onclick = () => interfaceController.atlantic();
    bindRotationButton('camera-left', 'camera', -1);
    bindRotationButton('camera-right', 'camera', 1);
    getElement('map-overview').onclick = () => {
      setView('district');
      app.world.overview();
    };
    getElement('zoom-in').onclick = () => app.world.zoomCamera(0.8);
    getElement('zoom-out').onclick = () => app.world.zoomCamera(1.25);
  }
  function bindManagementControls() {
    getElement('manage-button').onclick = () => {
      if (getElement('modal').open && getElement('modal').classList.contains('menu-window')) {
        closeModal();
      } else {
        interfaceController.menu();
      }
    };
    getElement('roof-toggle').onclick = toggleHallRoof;
    getElement('center').onclick = () => {
      centerDistrictView();
    };
    document.querySelector('.brand').onclick = (event) => {
      event.preventDefault();
      centerDistrictView();
    };
    getElement('district-view').onclick = () => setView('district');
    getElement('walk-view').onclick = () => setView('walk');
    getElement('atlantic-view').onclick = () => interfaceController.atlantic();
    getElement('interact-button').onclick = inspectNearby;
    app.hearthControls = new window.VinlandHearthControls(app, showToast);
    app.supplyControls = new window.VinlandSupplyControls(app, showToast);
    app.cheatControls = new window.VinlandCheatControls(app, { notify: showToast, startPlacement });
    document.querySelectorAll('[data-move]').forEach((button) => {
      button.onpointerdown = (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        app.world.keys.add(button.dataset.move);
      };
      button.onpointerup = button.onpointercancel = () =>
        app.world.keys.delete(button.dataset.move);
    });
    bindRotationButton('rotate-left', 'building', -1);
    bindRotationButton('rotate', 'building', 1);
    getElement('cancel-place').onclick = cancelPlacement;
    getElement('close-modal').onclick = closeModal;
    getElement('modal').addEventListener('cancel', (event) => {
      event.preventDefault();
      closeModal();
    });
    getElement('modal').addEventListener('click', (event) => {
      if (event.target === getElement('modal')) {
        const bounds = getElement('modal').getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          closeModal();
        }
      }
    });
  }
  function bindFormsAndActions() {
    document.addEventListener('click', (event) => {
      const room = event.target.closest('[data-room]');
      if (room && getElement('room-description')) {
        getElement('room-description').textContent =
          interfaceController.roomDescriptions[room.dataset.room];
        return;
      }
      const button = event.target.closest('[data-action]');
      if (button) {
        handleAction(button);
      }
    });
    getElement('modal-content').addEventListener('input', (event) => {
      if (event.target.dataset.setting === 'soundVolume') {
        app.settings.soundVolume = Number(event.target.value) / 100;
        app.audio?.setVolume(app.settings.soundVolume);
        getElement('sound-volume-output').textContent = event.target.value + '%';
      }
      if (event.target.id.startsWith('voyage-')) {
        const button = document.querySelector('[data-action="launch"]');
        if (button) {
          interfaceController.updateVoyageQuote(Number(button.dataset.id));
        }
      }
    });
    getElement('modal-content').addEventListener('change', (event) => {
      const setting = event.target.dataset.setting;
      if (setting === 'textScale') {
        app.settings.textScale = Number(event.target.value);
        applySettings();
      }
      if (setting === 'quality') {
        app.settings.quality = event.target.value;
        applySettings();
      }
      if (setting === 'sound') {
        setSoundEnabled(event.target.checked);
      }
      if (setting === 'soundVolume') {
        app.settings.soundVolume = Number(event.target.value) / 100;
        app.audio?.setVolume(app.settings.soundVolume);
        applySettings();
      }
      if (event.target.id === 'scenario-preset') {
        const preset = Content.PRESETS[event.target.value];
        for (const key of ['population', 'ships', 'tents', 'site', 'month', 'supplies', 'seed']) {
          const input = getElement('scenario-' + key);
          if (input) {
            input.value = preset[key];
          }
        }
      }
    });
    getElement('import-file').onchange = async () => {
      const file = getElement('import-file').files[0];
      if (!file) {
        return;
      }
      if (file.size > 5e6) {
        showToast('This file is too large for a campaign save.');
        return;
      }
      const simulation = Model.Simulation.load(await file.text());
      if (!simulation) {
        showToast('Invalid campaign save. Your current campaign is unchanged.');
        return;
      }
      closeModal();
      replaceSimulation(simulation);
      showToast('Campaign imported and paused.');
      getElement('import-file').value = '';
    };
  }
  function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.code === 'F10' && !app.atTitleScreen && !event.repeat) {
        event.preventDefault();
        if (getElement('modal').open) closeModal();
        app.cheatControls.toggle();
        return;
      }
      if (event.code === 'Escape' && !getElement('cheat-panel').hidden) {
        event.preventDefault();
        app.cheatControls.toggle(false);
        return;
      }
      if (app.conversation?.handleKey(event)) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        if (app.hearthControls?.id) {
          app.hearthControls.close();
        } else if (getElement('modal').open) {
          closeModal();
        } else if (app.atTitleScreen) {
          return;
        } else if (app.screen === 'atlantic') {
          setView('district');
        } else if (app.world.placing) {
          cancelPlacement();
        } else if (app.workerControls?.mode || app.workerControls?.buildOpen) {
          app.workerControls.mode = null;
          app.workerControls.buildOpen = false;
          app.workerControls.render();
        } else {
          closeInspector();
          app.workerControls?.clear();
          app.workerControls?.render();
        }
        return;
      }
      if (event.target.matches('input,textarea,select') || event.isComposing) {
        return;
      }
      if (app.atTitleScreen) {
        return;
      }
      if (getElement('modal').open) {
        return;
      }
      if (app.screen === 'atlantic') {
        if (event.code === 'Space') {
          event.preventDefault();
          setPaused(!app.paused);
          app.atlanticScreen.render();
        }
        return;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault();
      }
      if (
        event.repeat &&
        !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)
      ) {
        return;
      }
      if (event.code === 'Space') {
        setPaused(!app.paused);
      }
      if (event.code === 'KeyH' && app.world.view === 'district') {
        toggleHallRoof();
      }
      if (event.code === 'KeyC') {
        centerDistrictView();
      }
      if (event.code === 'KeyE' && app.world.view === 'walk') {
        if (!event.repeat) inspectNearby();
      }
      if (event.code === 'KeyF' && app.world.view === 'walk') {
        app.hearthControls.toggle();
      }
      if (event.code === 'KeyG' && app.world.view === 'walk') app.supplyControls.interact();
      if (event.code === 'Equal' || event.code === 'NumpadAdd') {
        app.world.zoomCamera(0.8);
      }
      if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
        app.world.zoomCamera(1.25);
      }
    });
  }
  function bindMapAndLandmarks() {
    getElement('minimap').onclick = (event) => {
      if (app.world.view === 'walk') {
        setView('district');
      }
      const bounds = getElement('minimap').getBoundingClientRect();
      const extent = app.world.mapExtent;
      app.world.focus(
        ((event.clientX - bounds.left) / bounds.width) * extent.width + extent.minX,
        ((event.clientY - bounds.top) / bounds.height) * extent.depth + extent.minZ,
        125,
      );
    };
    getElement('event-open').onclick = () => interfaceController.reports();
    getElement('event-dismiss').onclick = () => (getElement('event-notice').hidden = true);
    getElement('world-labels').innerHTML = /* HTML */ `
      <button class="world-label" id="hall-label">Hall F</button>
      <button class="world-label" id="fleet-label">Fleet</button>
    `;
    getElement('hall-label').onclick = () => {
      closeModal();
      app.world.selectObject(app.world.hall);
      inspectSelection('hall');
    };
    getElement('fleet-label').onclick = () => interfaceController.fleet();
  }
  function updateNotifications() {
    const notice = app.sim.state.notifications.at(-1);
    if (notice && notice.id > lastNotification) {
      lastNotification = notice.id;
      getElement('toast').classList.remove('visible');
      clearTimeout(showToast.timer);
      getElement('event-text').textContent = notice.text;
      getElement('event-notice').hidden = false;
    }
    if ((app.sim.state.gameOver || app.sim.state.ended) && !endingShown) {
      endingShown = true;
      setPaused(true);
      interfaceController.chronicle();
    }
  }
  function updateLandmarkLabels() {
    const anchorage = app.world.shipPositions[Math.floor(app.world.shipPositions.length / 2)] || [
      -91, -7,
    ];
    for (const [id, x, z, y] of [
      ['hall-label', 0, 0, 6],
      ['fleet-label', anchorage[0], anchorage[1], 5],
    ]) {
      const projectedPoint = app.world.project(
        x,
        y + Model.elevation(x, z, app.sim.state.config),
        z,
      );
      const label = getElement(id);
      const show =
        projectedPoint.visible &&
        projectedPoint.x > 20 &&
        projectedPoint.x < app.world.w - 20 &&
        projectedPoint.y > 55 &&
        projectedPoint.y < app.world.h - 45 &&
        app.world.view === 'district' &&
        (id !== 'hall-label' ||
          (app.sim.state.config.inheritedHall &&
            (!app.sim.state.arrival || app.sim.state.arrival.hallDiscovered)));
      label.style.left = projectedPoint.x + 'px';
      label.style.top = projectedPoint.y + 'px';
      label.style.display = show ? 'block' : 'none';
    }
  }
  function startAnimationLoop() {
    let previous = performance.now();
    document.addEventListener('visibilitychange', () => {
      previous = performance.now();
      if (document.hidden) {
        app.world.clearInput();
        setPaused(true);
      }
    });
    function frame(now) {
      const elapsedSeconds = Math.max(0, (now - previous) / 1000);
      const deltaSeconds = Math.min(elapsedSeconds, MAX_FRAME_SECONDS);
      previous = now;
      app.conversation?.update();
      if (!app.paused && !getElement('modal').open) {
        app.sim.advanceRealtime(elapsedSeconds * app.speed, app.world);
      }
      if (!app.atTitleScreen && app.screen === 'settlement') {
        app.world.update(deltaSeconds);
      }
      app.audio?.update(deltaSeconds, {
        simulation: app.sim,
        world: app.world,
        screen: app.screen,
        atTitleScreen: app.atTitleScreen,
        menuOpen: getElement('modal').open,
      });
      if (!app.atTitleScreen && now - lastSync > WORLD_SYNC_INTERVAL_MS) {
        app.world.sync();
        app.world.drawMap(getElement('minimap'));
        lastSync = now;
      }
      if (app.dirty && now - lastUI > HUD_REFRESH_INTERVAL_MS) {
        renderInterface();
        lastUI = now;
      }
      if (now - lastSave > AUTOSAVE_INTERVAL_MS && !app.paused) {
        autosaveCampaign();
        lastSave = now;
      }
      if (!app.atTitleScreen) {
        updateNotifications();
        updateLandmarkLabels();
      }
      app.hearthControls.update();
      app.supplyControls.update();
      app.cheatControls.update();
      if (app.world.view === 'walk') {
        const nearby = app.world.nearby();
        const interactButton = getElement('interact-button');
        interactButton.hidden = !nearby && !app.conversation?.placingTent;
        interactButton.textContent = app.conversation?.placingTent
          ? 'E · Pitch tent · Esc cancels'
          : nearby?.type === 'go-ashore'
            ? 'E · Go ashore'
            : nearby?.type === 'board-boat'
              ? 'E · Board boat'
              : nearby?.type === 'leave-boat'
                ? 'E · Leave boat'
                : nearby?.type === 'door'
                  ? window.VinlandDoors.isOpen(app.sim.state, nearby.id)
                    ? 'E · Close door'
                    : 'E · Open door'
                  : nearby?.type === 'person'
                    ? 'E · Speak'
                    : 'E · Inspect';
      }
      updateContextualHints();
      requestAnimationFrame(frame);
    }

    setPaused(true);
    renderInterface();
    requestAnimationFrame(frame);
    setTimeout(() => {
      const loading = getElement('loading');
      loading.classList.add('ready');
      loading.hidden = true;
    }, 800);
  }
  function exposeDebugInterface() {
    window.Vinland = {
      get simulation() {
        return app.sim;
      },
      get world() {
        return app.world;
      },
      get paused() {
        return app.paused;
      },
      setPaused,
      showBuild: (t) => interfaceController.build(t),
      showHall: (r) => interfaceController.hall(r),
      showCodex: () => interfaceController.help(),
      showCampaign: () => interfaceController.campaign(),
      ui: interfaceController,
      app,
      replaceSimulation,
      view: setView,
      startPlacement,
      cancelPlacement,
    };
  }
  // Keep startup in one place; replacing a campaign only rebinds model/world hooks.
  function initializeGame() {
    bindWindowDragging();
    const viewportObserver = new ResizeObserver(alignDistrictViewport);
    viewportObserver.observe(getElement('world'));
    viewportObserver.observe(document.querySelector('.simulation-console'));
    app.world = new window.VinlandWorld.World(getElement('world'), app.sim);
    app.atlanticScreen = new window.VinlandAtlantic.AtlanticScreen(app);
    bindModel();
    bindWorld();
    app.conversation = new window.VinlandConversation.ConversationPanel(
      app,
      getElement('walk-conversation'),
      getElement('walk-summary'),
    );
    applySettings();
    if (app.sim.state.leader.walking) {
      app.world.setView('walk');
      document.body.dataset.view = 'walk';
      app.world.resize();
      getElement('walk-view').classList.add('active');
      getElement('district-view').classList.remove('active');
    }
    app.world.paused = true;
    bindTimeControls();
    bindConstructionControls();
    bindManagementControls();
    bindFormsAndActions();
    bindKeyboardShortcuts();
    bindMapAndLandmarks();
    startAnimationLoop();
    exposeDebugInterface();
    showTitleScreen();
    window.addEventListener('beforeunload', autosaveCampaign);
  }
  function bindWindowDragging() {
    const titlebar = document.querySelector('.window-titlebar');
    let windowDrag = null;
    titlebar.addEventListener('pointerdown', (event) => {
      if (
        getElement('modal').classList.contains('system-window') ||
        event.target.closest('button') ||
        event.button !== 0
      ) {
        return;
      }
      const bounds = getElement('modal').getBoundingClientRect();
      windowDrag = {
        dx: event.clientX - bounds.left,
        dy: event.clientY - bounds.top,
      };
      titlebar.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    titlebar.addEventListener('pointermove', (event) => {
      if (!windowDrag) {
        return;
      }
      const modal = getElement('modal');
      const bounds = modal.getBoundingClientRect();
      modal.style.left =
        Math.max(0, Math.min(innerWidth - bounds.width, event.clientX - windowDrag.dx)) + 'px';
      modal.style.top =
        Math.max(0, Math.min(innerHeight - 45, event.clientY - windowDrag.dy)) + 'px';
    });
    titlebar.addEventListener('pointerup', () => (windowDrag = null));
    titlebar.addEventListener('pointercancel', () => (windowDrag = null));
    window.addEventListener('resize', () => {
      if (!getElement('modal').open) {
        return;
      }
      getElement('modal').style.left = '';
      getElement('modal').style.top = '';
    });
  }
  try {
    initializeGame();
  } catch (error) {
    getElement('loading').style.display = 'none';
    getElement('error').hidden = false;
    getElement('error-message').textContent = error.message;
    console.error(error);
  }
})();
