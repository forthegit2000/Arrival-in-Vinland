/**
 * Dedicated geographic screen: map navigation, harbours, voyage planning, journeys.
 * Economic decisions remain in Simulation; app.launchVoyage submits real orders.
 * The coastline SVG is bundled locally. No tiles, fetch, or server are required.
 */
(function (root) {
  'use strict';

  const Geography = root.VinlandAtlanticGeography;
  const UI = root.VinlandInterface;
  const getElement = (id) => document.getElementById(id);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const LAND_LABELS = [
    ['Greenland', [-42, 73]],
    ['Iceland', [-18, 66.2]],
    ['Labrador', [-64, 55]],
    ['Newfoundland', [-56, 47.5]],
    ['Norway', [10, 64]],
    ['British Isles', [-5, 55]],
    ['North Atlantic', [-30, 52]],
    ['60°N', [-76, 60]],
    ['70°N', [-76, 70]],
  ];

  function journeyFraction(voyage, day) {
    if (voyage.phase === 'returning') {
      return clamp((voyage.due - day) / Math.max(1, voyage.plannedDays * 0.45), 0, 1);
    }
    return clamp((day - voyage.start) / Math.max(1, voyage.plannedDays * 0.55), 0, 1);
  }

  class AtlanticScreen {
    constructor(app) {
      this.app = app;
      this.element = getElement('atlantic-screen');
      this.map = getElement('atlantic-map');
      this.selectedPort = 'greenland';
      this.viewBox = { x: 0, y: 0, width: Geography.WIDTH, height: Geography.HEIGHT };
      this.pointers = new Map();
      this.drag = null;
      this.pinchDistance = null;
      this.shipSignature = '';
      this.drawReferenceLayers();
      this.bindControls();
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.element.hidden) {
          this.updateMapSizing();
        }
      });
      this.resizeObserver.observe(this.map);
    }

    show() {
      this.element.hidden = false;
      this.render();
      this.updateMapSizing();
      this.map.focus({ preventScroll: true });
    }

    hide() {
      this.element.hidden = true;
      this.pointers.clear();
      this.drag = null;
      this.pinchDistance = null;
    }

    drawReferenceLayers() {
      getElement('atlantic-land-labels').innerHTML = LAND_LABELS.map(([name, coordinate]) => {
        const [x, y] = Geography.project(coordinate);
        return `<text x="${x}" y="${y}" text-anchor="middle">${name}</text>`;
      }).join('');
      getElement('atlantic-routes').innerHTML = Object.entries(Geography.ROUTES)
        .map(([id, route]) => `<path data-route="${id}" d="${Geography.path(route)}" />`)
        .join('');
      getElement('atlantic-ports').innerHTML = Object.entries(Geography.PORTS)
        .map(([id, port]) => {
          const [x, y] = Geography.project(port.coordinate);
          return /* HTML */ `
            <g data-port="${id}" transform="translate(${x}, ${y})">
              <title>${UI.esc(port.name)}</title>
              <circle class="port-hit-area" r="20" />
              <circle class="port-dot" r="6" />
              <text>
                ${UI.esc(
                  id === 'home' ? 'Home harbour' : id === 'greenland' ? 'Brattahlíð' : 'Reykjavík',
                )}
              </text>
            </g>
          `;
        })
        .join('');
    }

    render() {
      if (this.element.hidden) {
        return;
      }
      const simulation = this.app.sim;
      const state = simulation.state;
      const port = Geography.PORTS[this.selectedPort];
      getElement('atlantic-date').textContent = UI.date(simulation);
      const pause = getElement('atlantic-pause');
      pause.textContent = this.app.paused ? 'Resume time' : 'Pause time';
      pause.setAttribute('aria-pressed', String(this.app.paused));
      for (const element of this.element.querySelectorAll('[data-port]')) {
        const selected = element.dataset.port === this.selectedPort;
        element.classList.toggle('active', selected);
        element.classList.toggle('selected-port', selected);
        if (element.tagName === 'BUTTON') {
          element.setAttribute('aria-pressed', String(selected));
        }
      }
      for (const route of this.element.querySelectorAll('[data-route]')) {
        route.classList.toggle('selected-route', route.dataset.route === this.selectedPort);
      }
      getElement('atlantic-port-name').textContent =
        this.selectedPort === 'home' && state.config.site !== 'meadows'
          ? simulation.homeName
          : port.name;
      getElement('atlantic-port-description').textContent =
        this.selectedPort === 'home' && state.config.site !== 'meadows'
          ? 'Fictional campaign harbour · Newfoundland regional reference'
          : port.description;
      const [longitude, latitude] = port.coordinate;
      getElement('atlantic-port-coordinate').textContent =
        `${latitude.toFixed(2)}°N · ${Math.abs(longitude).toFixed(2)}°W`;
      const route = Geography.ROUTES[this.selectedPort];
      getElement('atlantic-route-summary').innerHTML = route
        ? UI.informationRow(
            'Sea corridor',
            UI.number(Geography.routeDistance(route), 0) + ' nautical miles',
          )
        : UI.informationRow(
            'Knarrs at anchor',
            state.ships.filter((ship) => ship.status === 'anchored').length,
          );
      getElement('atlantic-voyage-form').hidden = !route;
      this.renderShipChoices();
      this.updateQuote();
      this.renderJourneys();
    }

    renderShipChoices() {
      const ships = this.app.sim.state.ships;
      const signature = ships
        .map((ship) => `${ship.id}:${ship.name}:${ship.status}:${ship.sail}`)
        .join('|');
      if (signature === this.shipSignature) {
        return;
      }
      const select = getElement('atlantic-ship');
      const previous = select.value;
      select.innerHTML = ships
        .map(
          (ship) => /* HTML */ `
            <option
              value="${ship.id}"
              ${ship.status !== 'anchored' || !ship.sail ? 'disabled' : ''}
            >
              ${UI.esc(ship.name)} · ${UI.esc(ship.status)}${!ship.sail ? ' · sail in use' : ''}
            </option>
          `,
        )
        .join('');
      if ([...select.options].some((option) => option.value === previous && !option.disabled)) {
        select.value = previous;
      } else {
        select.value = [...select.options].find((option) => !option.disabled)?.value || '';
      }
      this.shipSignature = signature;
    }

    updateQuote() {
      if (!Geography.ROUTES[this.selectedPort]) {
        return;
      }
      const shipId = Number(getElement('atlantic-ship').value);
      const crew = Number(getElement('atlantic-crew').value);
      const timber = Number(getElement('atlantic-timber').value);
      const valid =
        getElement('atlantic-ship').value !== '' &&
        Number.isInteger(crew) &&
        crew >= 6 &&
        crew <= 16 &&
        Number.isFinite(timber) &&
        timber >= 0;
      const quote = this.app.sim.voyageQuote(shipId, this.selectedPort, crew, timber);
      getElement('atlantic-quote').innerHTML =
        UI.informationRow('Round trip', `${quote.days} nominal days`) +
        UI.informationRow('Dried provisions', UI.number(quote.provisions, 0) + ' kg') +
        UI.informationRow(
          'Payload',
          UI.number(quote.mass / 1000) + ' / ' + quote.capacity / 1000 + ' t',
        );
      getElement('atlantic-blocked').textContent = !valid
        ? 'Choose an available knarr, 6–16 crew, and a nonnegative cargo.'
        : quote.reason || '';
      getElement('atlantic-launch').disabled = !valid || Boolean(quote.reason);
    }

    renderJourneys() {
      const simulation = this.app.sim;
      const state = simulation.state;
      const entries = [];
      const markers = [];
      for (const voyage of state.voyages) {
        const route = Geography.ROUTES[voyage.region];
        if (!route) {
          continue;
        }
        const ship = state.ships.find((ship) => ship.id === voyage.shipId);
        const coordinate = Geography.pointAlongRoute(
          route,
          journeyFraction(voyage, simulation.state.time / 24),
        );
        const [x, y] = Geography.project(coordinate);
        markers.push(
          `<g transform="translate(${x}, ${y})"><title>${UI.esc(ship?.name)} · estimated position</title><circle r="7" /></g>`,
        );
        entries.push(/* HTML */ `
          <article class="atlantic-journey">
            <strong>${UI.esc(ship?.name)} · ${UI.esc(Geography.PORTS[voyage.region].name)}</strong>
            <p>${UI.esc(voyage.phase)} · ${voyage.crew.length} crew</p>
            <p>
              ${Math.max(0, voyage.due - simulation.day)} days to estimated
              return${voyage.delay ? ` · ${voyage.delay} gale delays` : ''}
            </p>
          </article>
        `);
      }
      for (const mission of state.scouts) {
        const region = state.regions.find((region) => region.id === mission.region);
        entries.push(/* HTML */ `
          <article class="atlantic-journey">
            <strong>${UI.esc(region?.name)} · ${UI.esc(mission.kind)}</strong>
            <p>${mission.crew.length} people · ${Math.max(0, mission.due - simulation.day)} days</p>
            <p>Local expedition · location not plotted</p>
          </article>
        `);
      }
      getElement('atlantic-journey-list').innerHTML =
        entries.join('') || '<p>No journeys underway.</p>';
      getElement('atlantic-ships').innerHTML = markers.join('');
      this.updateMapSizing();
    }

    mapPoint(clientX, clientY) {
      const point = this.map.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      return point.matrixTransform(this.map.getScreenCTM().inverse());
    }

    updateMapSizing() {
      const bounds = this.map.getBoundingClientRect();
      if (!bounds.width || !bounds.height) {
        return;
      }
      const pixelsPerUnit = Math.min(
        bounds.width / this.viewBox.width,
        bounds.height / this.viewBox.height,
      );
      const textScale = this.app.settings.textScale;
      const size = (14 * textScale) / pixelsPerUnit;
      this.map.querySelectorAll('text').forEach((text) => (text.style.fontSize = size + 'px'));
      for (const group of this.map.querySelectorAll('#atlantic-ports > g')) {
        const text = group.querySelector('text');
        const left = group.dataset.port !== 'iceland';
        text.setAttribute('x', (left ? -10 : 10) / pixelsPerUnit);
        text.setAttribute('y', (left ? 22 : -12) / pixelsPerUnit);
        text.setAttribute('text-anchor', left ? 'end' : 'start');
        group.querySelector('.port-dot').setAttribute('r', 5 / pixelsPerUnit);
        group.querySelector('.port-hit-area').setAttribute('r', 20 / pixelsPerUnit);
      }
      this.map
        .querySelectorAll('#atlantic-ships circle')
        .forEach((circle) => circle.setAttribute('r', 6 / pixelsPerUnit));
    }

    applyViewBox() {
      const box = this.viewBox;
      box.x = clamp(box.x, -Geography.WIDTH / 2, Geography.WIDTH * 1.5 - box.width);
      box.y = clamp(box.y, -Geography.HEIGHT / 2, Geography.HEIGHT * 1.5 - box.height);
      this.map.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
      this.updateMapSizing();
    }

    zoom(factor, clientX, clientY) {
      const bounds = this.map.getBoundingClientRect();
      const anchor = this.mapPoint(
        clientX ?? bounds.x + bounds.width / 2,
        clientY ?? bounds.y + bounds.height / 2,
      );
      const width = clamp(this.viewBox.width * factor, Geography.WIDTH / 6, Geography.WIDTH);
      const ratio = width / this.viewBox.width;
      this.viewBox.x = anchor.x - (anchor.x - this.viewBox.x) * ratio;
      this.viewBox.y = anchor.y - (anchor.y - this.viewBox.y) * ratio;
      this.viewBox.width = width;
      this.viewBox.height *= ratio;
      this.applyViewBox();
    }

    bindControls() {
      this.element.addEventListener('click', (event) => {
        const port = event.target.closest('[data-port]');
        if (port && (!port.closest('svg') || !this.dragged)) {
          this.selectedPort = port.dataset.port;
          this.render();
        }
        const command = event.target.closest('[data-atlantic]')?.dataset.atlantic;
        if (command === 'district' || command === 'walk') {
          this.app.setView(command);
        }
        if (command === 'pause') {
          this.app.setPaused(!this.app.paused);
          this.render();
        }
        if (command === 'zoom-in') {
          this.zoom(0.75);
        }
        if (command === 'zoom-out') {
          this.zoom(1 / 0.75);
        }
        if (command === 'fit') {
          this.viewBox = { x: 0, y: 0, width: Geography.WIDTH, height: Geography.HEIGHT };
          this.applyViewBox();
        }
      });
      getElement('atlantic-voyage-form').addEventListener('input', () => this.updateQuote());
      getElement('atlantic-voyage-form').addEventListener('change', () => this.updateQuote());
      getElement('atlantic-voyage-form').addEventListener('submit', (event) => {
        event.preventDefault();
        this.updateQuote();
        if (getElement('atlantic-launch').disabled) {
          return;
        }
        this.app.launchVoyage(
          Number(getElement('atlantic-ship').value),
          this.selectedPort,
          Number(getElement('atlantic-crew').value),
          Number(getElement('atlantic-timber').value),
        );
        this.render();
      });
      this.map.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault();
          this.zoom(Math.exp(clamp(event.deltaY, -250, 250) * 0.002), event.clientX, event.clientY);
        },
        { passive: false },
      );
      this.map.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
          return;
        }
        this.map.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
        this.drag = { clientX: event.clientX, clientY: event.clientY };
        this.dragOrigin = { ...this.drag };
        this.pointerPort = event.target.closest('[data-port]')?.dataset.port;
        this.dragged = false;
      });
      this.map.addEventListener('pointermove', (event) => {
        if (!this.pointers.has(event.pointerId)) {
          return;
        }
        this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (this.pinchDistance && distance) {
            this.zoom(this.pinchDistance / distance, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          }
          this.pinchDistance = distance;
          this.dragged = true;
          return;
        }
        if (!this.drag) {
          return;
        }
        const previous = this.mapPoint(this.drag.clientX, this.drag.clientY);
        const current = this.mapPoint(event.clientX, event.clientY);
        this.viewBox.x += previous.x - current.x;
        this.viewBox.y += previous.y - current.y;
        if (
          Math.hypot(
            event.clientX - this.dragOrigin.clientX,
            event.clientY - this.dragOrigin.clientY,
          ) > 4
        ) {
          this.dragged = true;
        }
        this.drag = { clientX: event.clientX, clientY: event.clientY };
        this.applyViewBox();
      });
      const releasePointer = (event) => {
        if (this.pointerPort && !this.dragged && event.type !== 'pointercancel') {
          this.selectedPort = this.pointerPort;
          this.render();
        }
        this.pointerPort = null;
        this.pointers.delete(event.pointerId);
        this.drag = null;
        this.pinchDistance = null;
      };
      this.map.addEventListener('pointerup', releasePointer);
      this.map.addEventListener('pointercancel', releasePointer);
      this.map.addEventListener('keydown', (event) => {
        const shifts = {
          ArrowLeft: [-40, 0],
          ArrowRight: [40, 0],
          ArrowUp: [0, -40],
          ArrowDown: [0, 40],
        };
        if (shifts[event.code]) {
          event.preventDefault();
          const [x, y] = shifts[event.code];
          this.viewBox.x += (x * this.viewBox.width) / Geography.WIDTH;
          this.viewBox.y += (y * this.viewBox.height) / Geography.HEIGHT;
          this.applyViewBox();
        }
        if (event.code === 'Equal' || event.code === 'NumpadAdd') {
          this.zoom(0.75);
        }
        if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
          this.zoom(1 / 0.75);
        }
      });
    }
  }
  root.VinlandAtlantic = { AtlanticScreen, journeyFraction };
})(window);
