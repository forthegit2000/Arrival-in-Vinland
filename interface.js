/**
 * Management-window markup and display helpers.
 * Methods open a page through app.openModal(); delegated data-action buttons
 * are handled in game.js. Keep simulation rules out of these templates.
 * The HTML comments let the formatter indent markup inside template literals.
 */
(function (root) {
  'use strict';

  const Content = root.VinlandContent;
  const SAVE_SLOTS = {
    current: 'vinland-campaign-v3',
    autosave: 'vinland-autosave-v3',
    previous: 'vinland-previous-campaign',
    legacy: 'vinland-expedition-v1',
  };
  const menuAction = (label, action, icon) => /* HTML */ `
    <button class="menu-action" data-action="${action}">
      <img src="assets/menu/${icon}.svg" alt="" aria-hidden="true" />
      <span>${label}</span>
    </button>
  `;
  const escapeHtml = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const formatNumber = (v, d = 1) =>
    Number(v).toLocaleString('en', {
      maximumFractionDigits: d,
    });
  function formatCampaignTime(simulation) {
    const hour = String(Math.floor(simulation.hour)).padStart(2, '0');
    const minute = String(Math.floor((simulation.hour % 1) * 60 + 1e-6)).padStart(2, '0');
    return hour + ':' + minute;
  }
  function inventoryMarkup(simulation, storeId) {
    const Storage = root.VinlandStorage;
    Storage.syncStores(simulation.state);
    const store = simulation.state.storage.stores[storeId];
    if (!store) return '';
    const reserved = {};
    for (const order of simulation.state.queue)
      for (const [key, material] of Object.entries(order.materials || {}))
        for (const source of material.reservations)
          if (source.storeId === storeId) reserved[key] = (reserved[key] || 0) + source.amount;
    const keys = Storage.KEYS.filter(
      (key) => (store.stock[key] || 0) + (reserved[key] || 0) > 1e-7,
    );
    return (
      `<h3>Inventory</h3>` +
      informationRow(
        'Stacking space',
        formatNumber(Storage.storeVolume(simulation.state, store), 1) +
          ' / ' +
          formatNumber(store.capacity, 1) +
          ' m³',
      ) +
      (!Storage.operational(simulation.state, store)
        ? '<p>Stock is stranded until the building is repaired.</p>'
        : '') +
      (keys.length
        ? dataTable(
            ['Resource', 'Available', 'Reserved for sites'],
            keys.map((key) => [
              escapeHtml(key),
              formatNumber(store.stock[key] || 0, 3) + ' ' + Storage.unit(key),
              formatNumber(reserved[key] || 0, 3) + ' ' + Storage.unit(key),
            ]),
          )
        : '<p>Empty. Order selected workers to supply this building, or deliver harvested resources here.</p>')
    );
  }
  const formatDate = (simulation, time = simulation.state.time) =>
    new Date(simulation.state.startDate + Math.floor(time / 24) * 86400000).toLocaleDateString(
      'en-GB',
      {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      },
    ) + ' AD';
  const actionButton = (label, action, extra = '', primary = false) => /* HTML */ `
    <button class="${primary ? 'primary' : 'outlined'}" data-action="${action}" ${extra}>
      ${label}
    </button>
  `;
  const statistic = (value, label) => /* HTML */ `
    <div>
      <strong>${value}</strong>
      <small>${label}</small>
    </div>
  `;
  const informationRow = (label, value, extra = '') => /* HTML */ `
    <div class="info-row">
      <span>${label}</span>
      <strong ${extra}>${value}</strong>
    </div>
  `;
  const dataTable = (headers, rows) => /* HTML */ `
    <div class="table-scroll">
      <table class="labor-table">
        <thead>
          <tr>
            ${headers
              .map(
                (h) => /* HTML */ `
                  <th>${h}</th>
                `,
              )
              .join('')}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => /* HTML */ `
                <tr>
                  ${r
                    .map(
                      (v) => /* HTML */ `
                        <td>${v}</td>
                      `,
                    )
                    .join('')}
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
  const BUILDING_SUMMARIES = {
    restore: '32 winter berths · repairs',
    sailbudir: '16 summer berths · 1 sail',
    tentbudir: '12 summer berths · 1 tent',
    longhouse: '32 winter berths',
    turfhouse: '8 winter berths',
    workshop: 'Timber preparation +25%',
    charcoal: 'Charcoal production',
    smithy: 'Small-scale iron production',
    fishing: 'Fishing facilities +25%',
    smokehouse: 'Preserves the daily catch',
    byre: 'Shelter for the entire herd',
    haybarn: '16 tonnes of fodder capacity',
    storehouse: 'Dry food and material storage',
    woodshed: 'Protects heating fuel',
    well: 'Water collection +35%',
    carehut: '6 warm recovery berths',
    garden: 'Spring planting · autumn harvest',
    palisade: 'Enclosure and wind protection',
    boatyard: 'Fleet repairs',
    meeting: 'Sheltered household assembly',
  };
  // Each management page belongs to one group; direct links use the same tabs.
  const MANAGEMENT_GROUPS = [
    {
      name: 'Settlement',
      pages: [
        ['people', 'People', 'People & households'],
        ['stocks', 'Stores', 'Provisions & fuel'],
        ['council', 'Council', 'Council & stewardship'],
      ],
    },
    {
      name: 'Exploration',
      pages: [
        ['fleet', 'Fleet', 'Fleet & livestock'],
        ['coast', 'Coast', 'Coast & neighbours'],
      ],
    },
    {
      name: 'Activity',
      pages: [
        ['works', 'Construction', 'Construction orders'],
        ['reports', 'Reports', 'Reports & warnings'],
        ['journal', 'Journal', 'Journal'],
        ['chronicle', 'Chronicle', 'Expedition chronicle'],
      ],
    },
  ];

  class Interface {
    constructor(app) {
      this.app = app;
      this.page = '';
      this.selectedPerson = null;
    }

    get sim() {
      return this.app.sim;
    }

    open(title, body, wide = false, options = {}) {
      this.page = title;
      this.app.openModal(`<h2>${title}</h2>${body}`, wide, options);
    }

    managementNavigation() {
      const group = MANAGEMENT_GROUPS.find((entry) =>
        entry.pages.some(([, , title]) => title === this.page),
      );
      if (!group) return null;
      return {
        name: group.name,
        markup: group.pages
          .map(
            ([action, label, title]) => /* HTML */ `
              <button
                data-action="${action}"
                class="${title === this.page ? 'active' : ''}"
                ${title === this.page ? 'aria-current="page"' : ''}
              >
                ${label}
              </button>
            `,
          )
          .join(''),
      };
    }

    cost(type) {
      return Object.entries(Content.TYPES[type].cost)
        .map(
          ([key, v]) => /* HTML */ `
            <span class="${this.sim.state.resources[key] < v ? 'insufficient' : ''}">
              <b>${formatNumber(v)}</b>
              ${['timber', 'turf'].includes(key)
                ? 'm³ '
                : key === 'stone'
                  ? 't '
                  : key === 'iron'
                    ? 'kg '
                    : ''}${key}
            </span>
          `,
        )
        .join('');
    }

    summary(type) {
      return BUILDING_SUMMARIES[type] || '';
    }

    menu() {
      this.open(
        'Game menu',
        /* HTML */ `
          <nav class="game-menu" aria-label="Game actions">
            ${menuAction('Resume Game', 'close', 'resume')}
            ${menuAction('New Game', 'scenario', 'new')}
            ${menuAction('Load Game', 'load-game', 'load')}
            ${menuAction('Save Game', 'save', 'save')}
            ${menuAction('Settings', 'campaign', 'settings')}
            ${menuAction('Cheat Mode', 'cheats', 'cheats')} ${menuAction('Help', 'help', 'help')}
            ${menuAction('Quit', 'quit', 'quit')}
          </nav>
        `,
        false,
        { menuIcon: 'settings' },
      );
    }

    mainMenu() {
      return /* HTML */ `
        <div class="title-card">
          <h1>ARRIVAL IN VINLAND</h1>
          <nav class="game-menu" aria-label="Main menu actions">
            ${this.app.hasStartedCampaign
              ? menuAction('Continue Game', 'continue-game', 'resume')
              : ''}
            ${menuAction('New Game', 'scenario', 'new')}
            ${menuAction('Load Game', 'load-game', 'load')}
            ${menuAction('Settings', 'campaign', 'settings')} ${menuAction('Help', 'help', 'help')}
          </nav>
        </div>
      `;
    }

    loadGame() {
      const savedGames = [];
      try {
        for (const [slot, key] of Object.entries(SAVE_SLOTS)) {
          const simulation = root.VinlandModel.Simulation.load(localStorage.getItem(key) || '');
          if (simulation) {
            savedGames.push({ slot, simulation });
          }
        }
      } catch {}
      this.open(
        'Load Game',
        /* HTML */ `
          <section class="load-game-page" aria-label="Saved games">
            <div class="save-list">
              ${savedGames.length
                ? savedGames
                    .map(
                      ({ slot, simulation }) => /* HTML */ `
                        <article
                          class="save-card"
                          aria-label="${escapeHtml(simulation.state.config.name)}"
                        >
                          <img
                            class="save-card-icon"
                            src="assets/menu/${slot === 'autosave' ? 'resume' : 'save'}.svg"
                            alt=""
                          />
                          <div class="save-card-details">
                            <span class="save-kind ${slot === 'autosave' ? 'recovery-save' : ''}">
                              ${{
                                current: 'Saved game',
                                autosave: 'Autosave · recovery',
                                previous: 'Previous campaign',
                                legacy: 'Older saved game',
                              }[slot]}
                            </span>
                            <strong class="save-name">
                              ${escapeHtml(simulation.state.config.name)}
                            </strong>
                            <div class="save-details">
                              <span>
                                ${formatDate(simulation)} · ${formatCampaignTime(simulation)}
                              </span>
                              <span>${simulation.state.population} people</span>
                            </div>
                          </div>
                          ${actionButton('Load', 'load-slot', `data-slot="${slot}"`)}
                        </article>
                      `,
                    )
                    .join('')
                : /* HTML */ `
                    <div class="empty-saves">
                      <img src="assets/menu/load.svg" alt="" />
                      <strong>No saved games in this browser.</strong>
                      <p>Load a save file or start a new game.</p>
                    </div>
                  `}
            </div>
            <footer class="menu-page-footer">
              ${menuAction('Back', 'menu-back', 'back')}
              ${menuAction('Load from File…', 'import', 'load')}
            </footer>
          </section>
        `,
        false,
        { menuIcon: 'load' },
      );
    }

    works() {
      const simulation = this.sim;
      const distribution = simulation.crewDistribution();
      this.open(
        'Construction orders',
        /* HTML */ `
          <div class="modal-stat-row">
            ${statistic(simulation.state.queue.length, 'active orders')}${statistic(
              distribution.reduce((total, item) => total + item.assigned, 0),
              'builders assigned',
            )}
          </div>
          <div class="construction-activity" aria-label="Active construction">
            ${simulation.state.queue
              .map((order) => {
                const hands = distribution.find((entry) => entry.q.id === order.id)?.assigned || 0;
                const progress = Math.min(100, Math.max(0, (order.progress / order.hours) * 100));
                return /* HTML */ `
                  <article class="construction-project" data-project="${order.id}">
                    <div class="project-heading">
                      <button data-action="building" data-id="${order.id}">
                        ${order.kind ? 'Repair: ' : ''}${Content.TYPES[order.type].name}
                      </button>
                      <strong>${formatNumber(progress, 0)}%</strong>
                    </div>
                    <div
                      class="meter"
                      role="progressbar"
                      aria-label="Construction progress"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow="${progress}"
                    >
                      <i style="width:${progress}%"></i>
                    </div>
                    <div class="project-status">
                      <span>
                        ${formatNumber(Math.max(0, order.hours - order.progress), 0)} person-hours
                        left · ${hands} crew${hands ? '' : ' · Waiting for crew'}
                      </span>
                      <button data-action="cancel-project" data-id="${order.id}">Cancel</button>
                    </div>
                  </article>
                `;
              })
              .join('') || '<p>No construction orders.</p>'}
          </div>
          <div class="actions">
            ${actionButton('Select idle workers', 'select-workers')}${actionButton(
              'Back to settlement',
              'close',
              '',
              true,
            )}
          </div>
        `,
      );
    }

    build(type) {
      const buildingDefinition = Content.TYPES[type];
      const simulation = this.sim;
      const blocked = simulation.blockedReason(type);
      this.open(
        buildingDefinition.name,
        /* HTML */ `
          <p>${buildingDefinition.description}</p>
          <div class="modal-stat-row">
            ${statistic(
              formatNumber(buildingDefinition.hours, 0),
              'nominal person-hours',
            )}${statistic(buildingDefinition.crew, 'maximum crew')}${statistic(
              formatNumber(buildingDefinition.hours / buildingDefinition.crew / 10) + ' days',
              '8-hour, fair-weather estimate',
            )}
          </div>
          <div class="build-cost">${this.cost(type)}</div>
          ${dataTable(
            ['Work stage', 'Person-hours'],
            buildingDefinition.stages.map(([n, h]) => [n, formatNumber(h, 0)]),
          )}
          <p>
            Planning range:
            ${formatNumber(buildingDefinition.hours * 0.75, 0)}–${formatNumber(
              buildingDefinition.hours * 1.35,
              0,
            )}
            hours. Skills, fatigue, weather, site drainage and transport distance change actual
            progress.
          </p>
          ${blocked
            ? /* HTML */ `
                <p class="warning-text">${escapeHtml(blocked)}</p>
              `
            : ''}
          <div class="actions">
            ${actionButton(
              type === 'restore' ? 'Begin repairs' : 'Choose site',
              'build',
              `data-type="${type}" ${blocked ? 'disabled' : ''}`,
              true,
            )}${actionButton('Cancel', 'close')}
          </div>
        `,
      );
    }

    hall(room) {
      const simulation = this.sim;
      simulation.survey();
      const descriptions = {
        I: 'Private living chamber for the leader and close companions. A small hearth.',
        II:
          'Main shared sk\xE1li. Wall platforms provide seating and sleeping space around a ' +
          'central longfire.',
        III: 'South living and sleeping skáli with its own longfire.',
        IV: 'Kitchen. A double slate-box oven with heating stones stands in the southwest corner.',
        V: 'Large store. A pit may represent a burned wooden vat or cooking pit.',
        VI:
          'Boat-repair lean-to, open to the south. Post impressions identify a boat ' +
          'support frame.',
        VII:
          'Second store. Its original doorway was not identified; access in the game is ' +
          'an interpretation.',
      };
      this.roomDescriptions = descriptions;
      this.open(
        'Hall F',
        /* HTML */ `
          <p>
            Six enclosed rooms and an eastern boat-repair lean-to. North is at the top of the plan.
          </p>
          <div class="hall-plan">
            <button class="room" data-room="IV">
              <b>IV</b>
              Kitchen
            </button>
            <button class="room" data-room="I">
              <b>I</b>
              Private chamber
            </button>
            <div class="room empty"></div>
            <button class="room" data-room="V">
              <b>V</b>
              Large store
            </button>
            <button class="room" data-room="II">
              <b>II</b>
              Main skáli
            </button>
            <button class="room shed" data-room="VI">
              <b>VI</b>
              Boat repair
              <br />
              Open south ↓
            </button>
            <button class="room" data-room="VII">
              <b>VII</b>
              South store
            </button>
            <button class="room" data-room="III">
              <b>III</b>
              South skáli
            </button>
          </div>
          <p id="room-description">${room ? descriptions[room] : 'Select a room to inspect it.'}</p>
          <div class="modal-stat-row">
            ${statistic('≈160.5 m²', 'published interior area')}${statistic(
              '32',
              'estimated berths',
            )}${statistic(
              simulation.state.hallReady ? 'Open' : '640 h',
              simulation.state.hallReady ? 'hall restored' : 'scenario repair estimate',
            )}
          </div>
          <p>
            The plan follows the published F–G layout. Roof, occupancy and some door connections are
            reconstructions. A standing Hall F inherited by Karlsefni belongs to the original
            scenario.
          </p>
          <div class="actions">
            ${actionButton(
              this.app.world.cutaway ? 'Show roof' : 'Inspect cutaway',
              'cutaway',
              '',
              true,
            )}${!simulation.state.hallReady
              ? actionButton('Repair Hall F', 'details', 'data-type="restore"')
              : ''}
          </div>
        `,
      );
    }

    hub() {
      this.open(
        'Manage camp',
        /* HTML */ `
          <div class="hub-grid">
            ${[
              ['Settlement', 'settlement', 'People, stores and council'],
              ['Exploration', 'exploration', 'Fleet and coast'],
              ['Activity', 'activity', 'Construction, reports and expedition records'],
              ['Settings', 'campaign', 'Graphics, sound and text size'],
            ]
              .map(
                ([name, action, desc]) => /* HTML */ `
                  <button class="hub-card" data-action="${action}">
                    <strong>${name}</strong>
                    <span>${desc}</span>
                  </button>
                `,
              )
              .join('')}
          </div>
          <div class="actions">${actionButton('Back to camp', 'close', '', true)}</div>
        `,
      );
    }

    people() {
      const simulation = this.sim;
      this.open(
        'People & households',
        /* HTML */ `
          <div class="modal-stat-row">
            ${statistic(simulation.state.population, 'expedition members')}${statistic(
              simulation.workforce,
              'available adults',
            )}${statistic(formatNumber(simulation.meanTrust, 0) + '%', 'mean trust')}
          </div>
          <div class="people-list">
            ${simulation.state.households
              .map((household) => {
                const members = simulation.state.people.filter((p) =>
                  household.members.includes(p.id),
                );
                return /* HTML */ `
                  <details class="household">
                    <summary>
                      <strong>${escapeHtml(household.name)}</strong>
                      <span>
                        ${members.filter((person) => person.alive).length} people ·
                        ${formatNumber(household.health, 0)}% health
                      </span>
                    </summary>
                    <div class="household-facts">
                      ${informationRow(
                        'Diet',
                        formatNumber(household.diet * 100, 0) + '% of demand',
                      )}${informationRow(
                        'Warmth',
                        formatNumber(household.warmth * 100, 0) + '%',
                      )}${informationRow('Trust', formatNumber(household.trust, 0) + '%')}
                    </div>
                    ${members
                      .map(
                        (person) => /* HTML */ `
                          <button class="person-row" data-action="person" data-id="${person.id}">
                            <span>
                              ${escapeHtml(person.name)}
                              <small>
                                ${person.age} years ·
                                ${person.alive
                                  ? person.away
                                    ? 'Away'
                                    : Content.TASKS[person.job]?.name || 'Unassigned'
                                  : 'Deceased'}
                              </small>
                            </span>
                            <span>${formatNumber(person.health, 0)}% health</span>
                          </button>
                        `,
                      )
                      .join('')}
                  </details>
                `;
              })
              .join('')}
          </div>
          <div class="actions">
            ${actionButton('Select idle workers', 'select-workers')}${actionButton('Camp', 'hub')}
          </div>
        `,
      );
    }

    person(id) {
      const person = this.sim.state.people.find((p) => p.id === Number(id));
      if (!person) {
        return;
      }
      this.selectedPerson = person.id;
      this.open(
        escapeHtml(person.name),
        /* HTML */ `
          <div class="modal-stat-row">
            ${statistic(person.age, 'age')}${statistic(
              formatNumber(person.health, 0) + '%',
              'health',
            )}${statistic(formatNumber(person.fatigue, 0) + '%', 'fatigue')}${statistic(
              formatNumber(person.trust, 0) + '%',
              'trust',
            )}
          </div>
          ${informationRow(
            'Current role',
            person.away ? 'Travelling' : Content.TASKS[person.job]?.name || 'Unassigned',
          )}${informationRow(
            'Household',
            escapeHtml(this.sim.state.households[person.household]?.name),
          )}${informationRow('Institutional preference', person.preference)}${dataTable(
            ['Skill', 'Proficiency'],
            Object.entries(person.skills).map(([key, v]) => [
              Content.TASKS[key].name,
              formatNumber(v * 100, 0) + '%',
            ]),
          )}
          <h3>Report</h3>
          <p>
            ${person.health < 35
              ? 'I am too ill to work.'
              : person.fatigue > 65
                ? 'The working day leaves me exhausted.'
                : this.sim.foodDays < 7
                  ? 'Our food reserve is too small.'
                  : person.trust < 35
                    ? 'Promises and obligations need to be settled.'
                    : 'My household can meet its current obligations.'}
          </p>
          ${person.memory.length
            ? /* HTML */ `
                <p>${person.memory.map(escapeHtml).join(' · ')}</p>
              `
            : ''}
          <div class="actions">
            ${actionButton(
              'Appoint steward',
              'appoint',
              `data-id="${person.id}" ${person.away || !person.alive ? 'disabled' : ''}`,
            )}${actionButton(
              'Hear report in person',
              'visit',
              `data-id="${person.id}" ${this.app.world.nearby()?.id === person.id ? '' : 'disabled'}`,
            )}${actionButton('People', 'people')}
          </div>
        `,
      );
    }

    stocks() {
      const simulation = this.sim;
      const state = simulation.state;
      const last = state.ledger.at(-1);
      const rows = Object.entries(Content.FOOD).map(([key, f]) => [
        f.name,
        formatNumber(state.foods[key]) + ' kg',
        formatNumber(f.kcal, 0) + ' kcal/kg',
        formatNumber(last?.production[key] || 0) + ' kg',
        formatNumber(
          (last?.consumption[key] || 0) +
            (last?.losses[key] || 0) +
            (key === 'freshFish' ? last?.consumption.fishToDry || 0 : 0),
        ) + ' kg',
      ]);
      this.open(
        'Provisions & fuel',
        /* HTML */ `
          <div class="modal-stat-row">
            ${statistic(
              formatNumber(simulation.foodDays) + ' days',
              'full-ration reserve',
            )}${statistic(
              formatNumber(state.resources.firewood, 0) + ' kg',
              'split firewood',
            )}${statistic(formatNumber(state.resources.water, 0) + ' L', 'collected water')}
          </div>
          ${this.chart(
            state.ledger.map((d) => d.resources.food / Math.max(1, d.population)),
            'Full-ration days in store',
          )}
          <p>
            Food quantities are edible mass. Energy, diet demand, preservation and temperature
            determine available person-days; production and losses below show the last completed
            day. Fish sent for drying counts as used fresh fish.
          </p>
          ${dataTable(['Food', 'Stored', 'Energy', 'Produced', 'Used / spoiled'], rows)}
          <h3>Daily demands</h3>
          ${informationRow(
            'Crew food',
            formatNumber(simulation.campPopulation * 3000, 0) + ' modeled kcal/day',
          )}${informationRow(
            'Herd dry fodder',
            formatNumber(simulation.hayDemand) + ' kg/day in dormant pasture',
          )}${informationRow(
            'Hearths burning now',
            formatNumber(simulation.fuelDemand / 24) + ' kg/hour; refuelling is manual',
          )}${informationRow(
            'Household water',
            formatNumber(simulation.campPopulation * 3) + ' L/day + animal water',
          )}
          <h3>Physical stores</h3>
          <p>
            Totals below sum unreserved stock across stores. Meals, water, fodder and voyage loading
            use the camp supply point. Select workers → Work → Supply camp to bring stock back.
            Hearths burn their own fuel. Supply building lets you choose a store, workplace or
            hearth room in Hall F.
          </p>
          ${dataTable(
            ['Store', 'Used / capacity', 'Access', ''],
            Object.values(state.storage.stores).map((store) => [
              escapeHtml(
                store.id === 'camp'
                  ? 'Camp supply point'
                  : store.type === 'hearth'
                    ? 'Hall F · Room ' + store.id.split(':').at(-1) + ' hearth supplies'
                    : (Content.TYPES[store.type]?.name || 'Ground cache') + ' · ' + store.id,
              ),
              formatNumber(root.VinlandStorage.storeVolume(state, store)) +
                ' / ' +
                formatNumber(store.capacity) +
                ' m³',
              root.VinlandStorage.operational(state, store) ? 'Available' : 'Stranded',
              actionButton('Inventory', 'inventory', `data-store="${escapeHtml(store.id)}"`),
            ]),
          )}
          <h3>Settlement totals</h3>
          ${dataTable(
            ['Material', 'Stock'],
            Object.entries(state.resources)
              .filter(([key]) => key !== 'food')
              .map(([key, v]) => [
                escapeHtml(key),
                formatNumber(v) +
                  (key === 'timber' || key === 'turf'
                    ? ' m³'
                    : key === 'water'
                      ? ' L'
                      : key === 'stone'
                        ? ' t'
                        : ['iron', 'hay', 'firewood', 'charcoal', 'seeds', 'cloth'].includes(key)
                          ? ' kg'
                          : ''),
              ]),
          )}
          <div class="actions">
            ${actionButton('Select idle workers', 'select-workers')}${actionButton(
              'Reports',
              'reports',
            )}${actionButton('Camp', 'hub')}
          </div>
        `,
      );
    }

    chart(values, label) {
      const data = values.slice(-30);
      if (data.length < 2) {
        return '';
      }
      const max = Math.max(1, ...data);
      const min = Math.min(0, ...data);
      const points = data
        .map(
          (v, i) => `${24 + (i / (data.length - 1)) * 610},${94 - ((v - min) / (max - min)) * 76}`,
        )
        .join(' ');
      return /* HTML */ `
        <figure class="chart">
          <figcaption>${label} · last ${data.length} days</figcaption>
          <svg viewBox="0 0 660 118" role="img" aria-label="${label}">
            <path d="M24 18V94H634" fill="none" stroke="#83957b" />
            <polyline points="${points}" fill="none" stroke="#78b8f0" stroke-width="2.5" />
          </svg>
          <div class="chart-values">
            <span>Start ${formatNumber(data[0])}</span>
            <span>Now ${formatNumber(data.at(-1))}</span>
          </div>
        </figure>
      `;
    }

    council() {
      const simulation = this.sim;
      const state = simulation.state;
      const pol = state.politics;
      const steward = simulation.steward();
      this.open(
        'Council & stewardship',
        /* HTML */ `
          <div class="modal-stat-row">
            ${statistic(formatNumber(pol.legitimacy, 0) + '%', 'legitimacy')}${statistic(
              formatNumber(simulation.meanTrust, 0) + '%',
              'household trust',
            )}${statistic(steward ? escapeHtml(steward.name) : 'Unappointed', 'steward')}
          </div>
          <p>
            Rules require a household assembly. Support depends on trust, workload, food security
            and household preferences. A proposal is resolved after one game day.
          </p>
          ${Object.entries(Content.RULES)
            .map(
              ([key, r]) => /* HTML */ `
                <div class="policy-row">
                  <label>
                    ${r.name}
                    <select id="policy-${key}">
                      ${r.choices
                        .map(
                          (v, i) => /* HTML */ `
                            <option value="${v}" ${pol[key] === v ? 'selected' : ''}>
                              ${r.labels[i]}
                            </option>
                          `,
                        )
                        .join('')}
                    </select>
                  </label>
                  ${actionButton(
                    'Propose',
                    'propose',
                    `data-rule="${key}" ${pol.proposal ? 'disabled' : ''}`,
                  )}
                </div>
              `,
            )
            .join('')}${pol.proposal
            ? /* HTML */ `
                <p class="goal-banner">
                  Assembly pending: ${Content.RULES[pol.proposal.rule].name}.
                  ${pol.proposal.votes.filter((v) => v.yes).length} of ${pol.proposal.votes.length}
                  households currently support it.
                </p>
              `
            : ''}
          <div class="actions">
            ${actionButton('Choose a steward', 'people')}${actionButton('Camp', 'hub')}
          </div>
        `,
      );
    }

    fleet() {
      const simulation = this.sim;
      const state = simulation.state;
      this.open(
        'Fleet & livestock',
        /* HTML */ `
          <div class="modal-stat-row">
            ${statistic(
              state.ships.filter((b) => b.status === 'anchored').length +
                ' / ' +
                state.ships.length,
              'knarrs at anchor',
            )}${statistic(
              state.livestock.cattle + state.livestock.sheep + state.livestock.goats,
              'living animals',
            )}${statistic(formatNumber(state.herdHealth, 0) + '%', 'herd condition')}
          </div>
          <div class="fleet-list">
            ${state.ships
              .map(
                (ship) => /* HTML */ `
                  <div class="detail-tile">
                    <strong>${escapeHtml(ship.name)}</strong>
                    ${informationRow('Status', ship.status)}${informationRow(
                      'Hull condition',
                      ship.condition + '%',
                    )}${informationRow('Sail', ship.sail ? 'On ship' : 'Used for a búð')}
                    ${state.arrival
                      ? informationRow(
                          'People aboard',
                          state.people.filter((p) => p.arrivalShip === ship.id && !p.arrivalFerry)
                            .length,
                        ) +
                        informationRow(
                          'Role',
                          ship.role === 'livestock'
                            ? 'Livestock · ' +
                                state.arrival.animals.filter((a) => a.shipId === ship.id).length +
                                ' animals aboard'
                            : 'Passengers & supplies',
                        )
                      : ''}
                    <div class="actions">
                      ${state.arrival
                        ? actionButton(
                            'Cargo inventory',
                            'inventory',
                            `data-store="ship:${ship.id}"`,
                          )
                        : ''}
                      ${actionButton(
                        'Plan voyage',
                        'voyage',
                        `data-id="${ship.id}" ${ship.status === 'anchored' && ship.sail ? '' : 'disabled'}`,
                      )}${actionButton(
                        'Repair hull',
                        'repair-ship',
                        `data-id="${ship.id}" ${ship.condition >= 99 || ship.status !== 'anchored' ? 'disabled' : ''}`,
                      )}
                    </div>
                  </div>
                `,
              )
              .join('')}
          </div>
          <h3>Herd and fodder</h3>
          ${informationRow(
            'Animals',
            state.livestock.cattle +
              ' cattle · ' +
              state.livestock.sheep +
              ' sheep · ' +
              state.livestock.goats +
              ' goats',
          )}${informationRow(
            'Hay reserve',
            formatNumber(state.resources.hay, 0) +
              ' kg · ' +
              Math.floor(state.resources.hay / Math.max(1, simulation.hayDemand)) +
              ' dormant herd-days',
          )}
          <div class="policy-row">
            <label>
              Selective slaughter
              <select id="cull-species">
                <option value="cattle">1 cattle head</option>
                <option value="sheep">1 sheep</option>
                <option value="goats">1 goat</option>
              </select>
            </label>
            ${actionButton('Slaughter one', 'cull')}
          </div>
          <p>
            Slaughter creates perishable meat, reduces future feed demand and affects household
            confidence. The cattle yield is a modeled 140 kg edible meat per head; it is not an
            archaeological measurement.
          </p>
          <div class="actions">
            ${actionButton('View landing', 'focus-fleet')}${actionButton(
              'Atlantic',
              'atlantic',
            )}${actionButton('Camp', 'hub')}
          </div>
        `,
      );
    }

    voyage(id) {
      const simulation = this.sim;
      const ship = simulation.state.ships.find((v) => v.id === Number(id));
      if (!ship) {
        return;
      }
      this.open(
        'Plan voyage · ' + escapeHtml(ship.name),
        /* HTML */ `
          <p>
            Choose a harbour, crew and timber cargo. Provisions are reserved for the round trip.
            Weather, seamanship and hull condition affect delay and risk; absent crews cannot work
            at home.
          </p>
          <div class="form-grid">
            <label>
              Destination
              <select id="voyage-region">
                <option value="greenland">Greenland</option>
                <option value="iceland">Iceland</option>
              </select>
            </label>
            <label>
              Ship’s crew
              <input id="voyage-crew" type="number" min="6" max="16" value="8" />
            </label>
            <label>
              Trade timber · m³
              <input
                id="voyage-timber"
                type="number"
                min="0"
                step=".5"
                value="${Math.min(6, Math.floor(simulation.state.resources.timber))}"
              />
            </label>
          </div>
          <div id="voyage-quote"></div>
          <div class="actions">
            ${actionButton('Send voyage', 'launch', `data-id="${ship.id}"`, true)}${actionButton(
              'Fleet',
              'fleet',
            )}
          </div>
        `,
      );
      this.updateVoyageQuote(ship.id);
    }

    updateVoyageQuote(id) {
      const order = this.sim.voyageQuote(
        id,
        document.getElementById('voyage-region').value,
        Number(document.getElementById('voyage-crew').value),
        Number(document.getElementById('voyage-timber').value),
      );
      document.getElementById('voyage-quote').innerHTML = /* HTML */ `
        <div class="modal-stat-row">
          ${statistic(order.days + ' days', 'planned round trip')}${statistic(
            formatNumber(order.provisions) + ' kg',
            'dried provisions',
          )}${statistic(
            formatNumber(order.mass / 1000) + ' / ' + order.capacity / 1000 + ' t',
            'modeled payload',
          )}
        </div>
        ${order.reason
          ? '<p class="warning-text">' + escapeHtml(order.reason) + '</p>'
          : /* HTML */ `
              <p>
                Timber is exchanged for varying quantities of iron, cloth and grain. Market terms
                are scenario estimates, not a universal exchange rate.
              </p>
            `}
      `;
      document.querySelector('[data-action="launch"]').disabled = !!order.reason;
    }

    coast() {
      const simulation = this.sim;
      const state = simulation.state;
      const neighbours = state.neighbours;
      this.open(
        'Coast & neighbours',
        /* HTML */ `
          <p>
            Survey parties bring back dated observations. A promising coast is not automatically
            available for occupation.
          </p>
          <div class="region-list">
            ${state.regions
              .filter((r) => r.kind === 'survey')
              .map(
                (r) => /* HTML */ `
                  <div class="detail-tile">
                    <strong>${r.name}</strong>
                    ${informationRow(
                      'Knowledge',
                      r.known
                        ? 'Observed · ' + Math.round(r.confidence * 100) + '% confidence'
                        : 'Unsurveyed',
                    )}${informationRow('Travel', r.days + ' days · 4 people')}
                    <div class="actions">
                      ${actionButton(
                        r.known ? 'Survey again' : 'Send survey',
                        'scout',
                        `data-region="${r.id}" ${state.scouts.some((v) => v.region === r.id) ? 'disabled' : ''}`,
                      )}
                    </div>
                  </div>
                `,
              )
              .join('')}
          </div>
          <h3>Relationships</h3>
          ${neighbours.known
            ? /* HTML */ `
                ${informationRow(
                  'Reported community stance',
                  escapeHtml(neighbours.stance),
                )}${informationRow(
                  'Territorial access',
                  escapeHtml(neighbours.access),
                )}${informationRow('Trust estimate', formatNumber(neighbours.trust, 0) + '%')}
                <p>
                  This independently simulated coastal community is a fictional aggregate. The game
                  does not claim a specific people, village or contact at the archaeological site.
                </p>
                <div class="actions">
                  ${actionButton('Send envoys · 4 people', 'envoy')}${actionButton(
                    'Reciprocal exchange',
                    'exchange',
                    neighbours.agreement ? '' : 'disabled',
                  )}
                </div>
              `
            : /* HTML */ `
                <p>
                  No firsthand contact report has reached camp. This does not mean the coast is
                  uninhabited.
                </p>
              `}
          <h3>Resource condition</h3>
          ${informationRow(
            'Accessible woodland',
            formatNumber(state.ecology.wood, 0) + ' m³',
          )}${informationRow(
            'Fish availability index',
            formatNumber(state.ecology.fish * 100, 0) + '%',
          )}${informationRow(
            'Standing meadow estimate',
            formatNumber(state.ecology.pasture / 1000) + ' tonnes',
          )}
          <div class="actions">
            ${actionButton('Atlantic chart', 'atlantic')}${actionButton('Camp', 'hub')}
          </div>
        `,
      );
    }

    atlantic() {
      this.app.setView('atlantic');
    }

    reports() {
      const simulation = this.sim;
      const state = simulation.state;
      const last = state.ledger.at(-1);
      const dailyReport = last
        ? [
            informationRow('Observed weather', last.weather + ' · ' + last.temp + '°C'),
            informationRow('Construction labor', formatNumber(last.labor, 0) + ' person-hours'),
            informationRow('Warmth delivered', formatNumber(last.warmth * 100, 0) + '% of need'),
            informationRow(
              'Food spoilage',
              formatNumber(Object.values(last.losses).reduce((sum, loss) => sum + loss, 0)) + ' kg',
            ),
            this.chart(
              state.ledger.map((day) => day.health),
              'Camp health',
            ),
          ].join('')
        : /* HTML */ `
            <p>A full day has not yet been recorded.</p>
          `;
      this.open(
        'Reports & warnings',
        /* HTML */ `
          ${simulation.alerts
            .map(
              (a) => /* HTML */ `
                <div class="cause-card">
                  <strong>${escapeHtml(a.title)} · ${escapeHtml(a.value)}</strong>
                  <p>${a.cause}</p>
                </div>
              `,
            )
            .join('') ||
          /* HTML */ `
            <p>No critical shortages are reported.</p>
          `}
          <h3>Last completed day</h3>
          ${dailyReport}
          <h3>Winter preparation</h3>
          ${informationRow(
            'Insulated berths',
            simulation.winterShelter + ' / ' + simulation.campPopulation,
          )}${informationRow(
            'Fodder',
            Math.floor(state.resources.hay / Math.max(1, simulation.hayDemand)) +
              ' dormant herd-days',
          )}${informationRow('Food', formatNumber(simulation.foodDays) + ' full-ration days')}
          <p>
            Cold-season survival follows temperature, occupancy, fuel, food, water and fodder. The
            calendar does not directly deduct health.
          </p>
          <div class="actions">
            ${actionButton('Physical stocks', 'stocks')}${actionButton(
              'Chronicle',
              'chronicle',
            )}${actionButton('Journal', 'journal')}${actionButton('Camp', 'hub')}
          </div>
        `,
      );
    }

    journal() {
      this.open(
        'Journal',
        this.sim.state.journal
          .slice()
          .reverse()
          .map(
            (event) => /* HTML */ `
              <div class="journal-entry">
                <small>
                  ${formatDate(this.sim, event.time)} · ${escapeHtml(event.kind || 'report')}
                </small>
                ${escapeHtml(event.text)}
              </div>
            `,
          )
          .join(''),
      );
    }

    chronicle() {
      const c = this.sim.chronicle();
      this.open(
        'Expedition chronicle',
        /* HTML */ `
          <h3>${c.identity}</h3>
          <div class="modal-stat-row">
            ${statistic(c.days + ' days', 'elapsed')}${statistic(
              c.people,
              'surviving expedition',
            )}${statistic(c.health + '%', 'health')}${statistic(
              c.tradeReturns,
              'returned trading voyages',
            )}
          </div>
          <p>
            Continuity, autonomy, consent, relationships and ecological condition describe this
            society. Expansion is not the sole measure of success.
          </p>
          ${informationRow('Mean trust', c.trust + '%')}${informationRow(
            'Accessible woodland retained',
            c.ecology + '%',
          )}${c.records
            .map(
              (event) => /* HTML */ `
                <div class="journal-entry">
                  <small>${formatDate(this.sim, event.time)}</small>
                  ${escapeHtml(event.text)}
                </div>
              `,
            )
            .join('')}
          <div class="actions">
            ${actionButton('Continue', 'close', '', true)}${actionButton(
              'End this chapter',
              'end-campaign',
            )}${actionButton('Settings', 'campaign')}
          </div>
        `,
      );
    }

    inventory(storeId) {
      this.open('Store inventory', inventoryMarkup(this.sim, storeId));
    }

    building(id) {
      const simulation = this.sim;
      const building = [...simulation.state.buildings, ...simulation.state.queue].find(
        (v) => v.id === Number(id),
      );
      if (!building) {
        return;
      }
      const order = simulation.state.queue.includes(building);
      const buildingDefinition = Content.TYPES[building.type];
      this.open(
        buildingDefinition.name,
        /* HTML */ `
          <p>${buildingDefinition.description}</p>
          <div class="modal-stat-row">
            ${statistic(
              formatNumber((building.progress / building.hours) * 100, 0) + '%',
              'completed',
            )}${statistic(
              formatNumber(building.condition ?? 100, 0) + '%',
              'condition',
            )}${statistic(formatNumber(building.hours, 0) + ' h', 'nominal work')}
          </div>
          ${informationRow(
            'Site drainage',
            formatNumber((1 - (building.site?.wet || 0)) * 100, 0) + '%',
          )}${informationRow(
            'Exposure',
            formatNumber((building.site?.exposure || 0) * 100, 0) + '%',
          )}${informationRow(
            'Hauling distance',
            formatNumber(building.site?.travel || 0, 0) + ' m',
          )}${informationRow('Ownership', escapeHtml(building.owner || 'Expedition work'))}
          ${order
            ? informationRow(
                'Materials delivered',
                formatNumber(root.VinlandStorage.suppliedFraction(building) * 100, 1) + '%',
              )
            : inventoryMarkup(simulation, 'building:' + building.id)}
          ${['charcoal', 'smokehouse'].includes(building.type) && !order
            ? informationRow(
                'Batch',
                root.VinlandProductionProcesses.describe(
                  simulation.state,
                  'building:' + building.id,
                ) || 'Waiting for workers and local inputs',
              )
            : ''}
          <div class="actions">
            ${!order &&
            ['charcoal', 'smokehouse', 'smithy', 'workshop', 'byre', 'carehut'].includes(
              building.type,
            )
              ? actionButton(
                  'Work here with selected people',
                  'work-here',
                  'data-id="' + building.id + '"',
                )
              : ''}
            ${actionButton('View site', 'focus-building', `data-id="${building.id}"`, true)}${order
              ? actionButton(
                  'Assign selected workers',
                  'assign-workers',
                  `data-id="${building.id}"`,
                ) + actionButton('Cancel work', 'cancel', `data-id="${building.id}"`)
              : actionButton(
                  'Order repairs',
                  'repair-building',
                  `data-id="${building.id}" ${building.condition >= 99 ? 'disabled' : ''}`,
                )}${!order && ['sailbudir', 'tentbudir'].includes(building.type)
              ? actionButton('Dismantle & recover cloth', 'dismantle', `data-id="${building.id}"`)
              : ''}
          </div>
        `,
      );
    }

    campaign() {
      const app = this.app;
      this.open(
        'Settings',
        /* HTML */ `
          <h3>View & accessibility</h3>
          <div class="form-grid">
            <label>
              Text size
              <select id="text-scale" data-setting="textScale">
                ${[1, 1.15, 1.3]
                  .map(
                    (v) => /* HTML */ `
                      <option value="${v}" ${app.settings.textScale === v ? 'selected' : ''}>
                        ${Math.round(v * 100)}%
                      </option>
                    `,
                  )
                  .join('')}
              </select>
            </label>
            <label>
              Graphics
              <select data-setting="quality">
                <option value="high" ${app.settings.quality === 'high' ? 'selected' : ''}>
                  High
                </option>
                <option value="low" ${app.settings.quality === 'low' ? 'selected' : ''}>
                  Performance
                </option>
              </select>
            </label>
            <label class="check-row">
              <input type="checkbox" data-setting="sound" ${app.soundOn ? 'checked' : ''} />
              Ambient sound
            </label>
            <label>
              Volume
              <output id="sound-volume-output">
                ${Math.round(app.settings.soundVolume * 100)}%
              </output>
              <input
                type="range"
                min="0"
                max="100"
                value="${Math.round(app.settings.soundVolume * 100)}"
                data-setting="soundVolume"
                aria-label="Ambient sound volume"
              />
            </label>
          </div>
          <footer class="menu-page-footer">
            ${menuAction('Back', 'menu-back', 'back')}
            ${!app.atTitleScreen ? menuAction('Export current game', 'export', 'save') : ''}
          </footer>
        `,
        false,
        { menuIcon: 'settings' },
      );
    }

    scenario() {
      const selected = Content.PRESETS.karlsefni;
      this.open(
        'New campaign',
        /* HTML */ `
          ${this.app.hasStartedCampaign
            ? /* HTML */ `
                <p>
                  Your current expedition stays available until you start the new one. Export it
                  first if you want a portable copy.
                </p>
              `
            : ''}
          <div class="form-grid">
            <label>
              Starting scenario
              <select id="scenario-preset">
                ${Object.entries(Content.PRESETS)
                  .map(
                    ([key, p]) => /* HTML */ `
                      <option value="${key}">${p.name}</option>
                    `,
                  )
                  .join('')}
              </select>
            </label>
            <label>
              Seed
              <input id="scenario-seed" value="${selected.seed}" />
            </label>
            <label>
              People
              <input id="scenario-population" type="number" min="16" max="240" value="160" />
            </label>
            <label>
              Knarrs
              <input id="scenario-ships" type="number" min="1" max="6" value="4" />
            </label>
            <label>
              Tents
              <input id="scenario-tents" type="number" min="0" max="30" value="10" />
            </label>
            <label>
              Landfall
              <select id="scenario-site">
                <option value="meadows">L’Anse aux Meadows · inherited Hall F</option>
                <option value="bay">Timber-rich bay · no inherited hall</option>
                <option value="estuary">Sheltered estuary · no inherited hall</option>
              </select>
            </label>
            <label>
              Starting month
              <select id="scenario-month">
                ${Array.from(
                  {
                    length: 12,
                  },
                  (_, i) => /* HTML */ `
                    <option value="${i + 1}" ${i === 7 ? 'selected' : ''}>
                      ${new Date(2000, i, 1).toLocaleString('en', {
                        month: 'long',
                      })}
                    </option>
                  `,
                ).join('')}
              </select>
            </label>
            <label>
              Provision level
              <select id="scenario-supplies">
                <option value=".75">Limited</option>
                <option value="1" selected>Standard</option>
                <option value="1.1">Household provisions</option>
                <option value="1.3">Trading provisions</option>
                <option value="1.5">Well supplied</option>
              </select>
            </label>
            <label>
              Weather severity
              <select id="scenario-severity">
                <option value=".7">Milder</option>
                <option value="1" selected>Standard</option>
                <option value="1.3">Harsher</option>
              </select>
            </label>
            <label class="check-row">
              <input id="scenario-legacy" type="checkbox" />
              Continue with a successor
            </label>
          </div>
          <p>
            Passengers are capped at a modeled 60 per knarr. These are scenario limits, not attested
            voyage manifests. Alternative landfalls and societies are hypothetical.
          </p>
          <div class="actions">
            ${actionButton('Start campaign', 'start-campaign', '', true)}${this.app
              .hasStartedCampaign
              ? actionButton('Export current save', 'export')
              : ''}${actionButton(
              this.app.hasStartedCampaign ? 'Keep current campaign' : 'Cancel',
              'close',
            )}
          </div>
        `,
        false,
        { menuIcon: 'new' },
      );
    }

    help() {
      // Keep each map credit beside its licence, using the shared source list.
      const mapCredits = {
        'https://www.openstreetmap.org/copyright': {
          title: 'Coastline and freshwater geometry · © OpenStreetMap contributors',
          notice: 'Data licensed under ',
          licence: 'ODbL 1.0',
          url: 'https://opendatacommons.org/licenses/odbl/1-0/',
        },
        'https://datacube.services.geo.ca/stac/api/collections/mrdem-30': {
          title: 'Ground elevations · Natural Resources Canada (NRCan), MRDEM-30',
          notice: 'Contains information licensed under the ',
          licence: 'Open Government Licence – Canada',
          url: 'https://open.canada.ca/en/open-government-licence-canada',
        },
      };
      this.open(
        'Controls & historical notes',
        /* HTML */ `
          <ul class="help-list">
            <li>
              District: click people or left-drag a selection box. Shift adds workers.
              Middle/right-drag pans; WASD or arrows also pan. Scroll or + / − zoom. Hold Q / E to
              rotate the camera freely at 15° per second; hold Shift for 30°.
            </li>
            <li>
              Walk: WASD moves; arrow keys look around; hold Shift to sprint at 3× speed; mouse drag
              also looks; E speaks to nearby people. E also opens doors and boards or leaves boats.
              F opens a nearby hearth. G beside a supply pile picks up a load, up to 15 kg; G while
              carrying places it ahead or in nearby storage with room. Carried firewood can fuel
              hearths. Swimming and wading depend on water depth; Shift moves faster in water.
            </li>
            <li>
              Space pauses. 1× is real time; 3× and 8× speed up time, travel and work together. H
              toggles building roofs. C recenters the district.
            </li>
            <li>
              During a conversation: 1 logs, 2 turf, 3 firewood, 4 hay, 0 stop. E or Esc ends the
              conversation. Accepted orders also end it immediately. The speaker pauses, then
              resumes their previous order unless you give them a new one.
            </li>
            <li>
              Select workers, choose Build, then choose a building and click a clear site. Selected
              builders work from 08:00 to 18:00. They fetch reserved materials first; only time
              actually building counts toward the listed person-hours. Hold R / T to rotate the
              footprint in either direction; Shift doubles the speed. Placing a building releases
              the build cursor immediately. Right-click or Esc cancels a preview. Green sites are
              valid; red sites are blocked.
            </li>
            <li>
              Select people for Move, gathering, Work, Build, Shelter or Stop. Work offers fishing,
              foraging, camp care, crafting and hauling. Supply camp brings needed stock back;
              Supply building lets you click a store or workplace to stock. Each store has its own
              inventory. Choose Logs, Turf, Firewood or Hay under Gather; workers automatically find
              a reachable resource area and return to storage. Right-click ground to move;
              right-click unfinished construction to assign builders. Unordered people remain idle.
              Shelter sends selected people to available indoor places; ordered workers return to
              shelter off duty and resume their job the next day. Resources enter stores only after
              a load is carried back and unloaded. Trees leave stumps; turf cutting and mowing leave
              visible patches. Hay must dry before collection. Travel, cutting and unloading all use
              the same clock.
            </li>
            <li>
              Settlement groups People, Stores and Council. Exploration groups Fleet and Coast;
              Atlantic has its own screen. Activity groups Construction, Reports, Journal and
              Chronicle. Select a project to see its progress, or open Activity for all active
              projects. The contextual strip shows current targeting or nearby actions; general
              movement and camera controls are listed here. The cogwheel opens the game menu. Click
              a building to inspect it. Right-click a construction tool or press F1 while it is
              focused to open material costs and the work breakdown. Management windows pause time
              and can be dragged by their title bars.
            </li>
          </ul>
          <h3>Landing and camp setup</h3>
          <p>
            New campaigns begin aboard the knarrs. E · Go ashore takes Karlsefni and a companion in
            a crewed landing boat. Ashore, press E beside your companion or another adult to open
            landing orders: 1 brings the remaining people over, 2 assigns idle helpers to unload
            supplies and tents, 3 assigns two available livestock handlers, and 4 previews a tent
            site. Move and look to position the preview; E confirms and Esc cancels without
            assigning anyone. Press 5 to switch between landing and ordinary conversation orders.
            Existing jobs are preserved. Space unpauses the game. In district view, select people
            for Land selected people, Crew landing boat, Unload supplies, Pitch tent, or Land
            livestock. Choose landing area targets a clear beach before unloading starts. Packed
            tents provide no berths; each tent requires 2 person-hours to pitch. Livestock have
            their own knarr and need at least two handlers to lead them ashore. Orders and transfers
            use the 1×, 3× and 8× clock.
          </p>
          <h3>Evidence and interpretation</h3>
          <p>
            Hall F’s six rooms and repair lean-to follow its published archaeological plan. A
            standing hall, the exact 1005 arrival, 160-person manifest and livestock numbers belong
            to your original scenario. AD 1021 is securely attested Norse activity, not a proven
            first-arrival date.
          </p>
          <p>
            Individual ages, skills, climate and inclusive adult assembly voices are game
            assumptions, not recovered personal or legal records. Livestock buildings and kitchen
            gardens at this camp are plausible scenario additions, not identified site features.
            Timber and turf costs follow footprint and construction method. Individual labor hours,
            yields, temperatures, passage durations and carrying capacities are explicit estimates.
          </p>
          <p>
            Neighbouring communities have independent needs and territorial decisions. The simulated
            community is a fictional aggregate; no particular village, identity, language or
            ceremony is represented as historical fact. Expert and Indigenous consultation, voiced
            performance, cinematic character art, full tactical warfare and multigenerational
            content remain production work beyond this browser implementation.
          </p>
          <h3>Food and ships</h3>
          <p>
            Food stores use edible kilograms and approximate energy densities. A modeled adult
            ration is 3,000 kcal/day; child demand is smaller. Stockfish uses 3,270 kcal/kg from the
            Norwegian food table. The ship model takes inspiration from excavated Norse cargo craft,
            with a conservative 12-tonne payload and 6–16 working crew. Cargo, voyage provisions and
            missing crew are accounted separately from home stores.
          </p>
          <h3>Sources & licences</h3>
          <p>
            The L’Anse aux Meadows terrain uses modern OpenStreetMap coastline and freshwater
            geometry, with NRCan MRDEM-30 ground elevations at 30 m source resolution. Hall F is
            centred on its mapped original footprint, with local metres pointing east and south.
            This is a modern geographic reference, not a surveyed reconstruction of the 1005
            shoreline. Stream widths, underwater depths, vegetation, tents and footpaths are
            modeled; the terrain has no vertical exaggeration.
          </p>
          <ul class="help-list">
            ${Content.SOURCES.map(([title, url]) => {
              const credit = mapCredits[url];
              return /* HTML */ `
                <li>
                  <a href="${url}" target="_blank" rel="noopener">${credit?.title || title}</a>
                  ${credit
                    ? /* HTML */ `
                        <br />
                        ${credit.notice}
                        <a href="${credit.url}" target="_blank" rel="noopener">${credit.licence}</a>
                      `
                    : ''}
                </li>
              `;
            }).join('')}
          </ul>
          <div class="actions">
            ${actionButton('Settings', 'campaign')}${actionButton('Close', 'close', '', true)}
          </div>
        `,
        false,
        { menuIcon: 'help' },
      );
    }
  }
  root.VinlandInterface = {
    Interface,
    esc: escapeHtml,
    number: formatNumber,
    date: formatDate,
    informationRow,
    saveSlots: SAVE_SLOTS,
  };
})(window);
