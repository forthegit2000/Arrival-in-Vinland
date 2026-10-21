# Working on Vinland

The checked-in source is the editable source. There is no compilation, bundling, or
minification step. Open `index.html` directly in a browser to play after an edit.
Node and npm are optional development tools; the game does not use them at runtime.

## Find the right file

Human geometry, shared meshes and joint poses live in `character-models.js`.
`world-expansion.js` supplies actual travel distance, work/carry state and pause
state; the character module never changes simulation positions or saves. Keep
camera bob separate from the body rig. Near models have elbow/knee joints; distant
models use five meshes per person. Geometry is cached by outfit and age group.
The rig is stored in `object.characterRig`, because world registration replaces
root `userData` with selection metadata. Existing carried-resource and axe names
remain direct children for worker/hearth controls.

Run `npm run test:characters` for offline joint, planted-foot, tool-grip,
LOD, carrying and save checks; previews are written to
`/tmp/vinland-human-models.png` and `/tmp/vinland-human-movement.png`.
Also run `test:walking`, `test:workers`, `test:collision` and `test:timing`
when changing integration. Basic clothing follows the National Museum of Denmark's
[clothing overview](https://en.natmus.dk/historical-knowledge/denmark/prehistoric-period-until-1050-ad/the-viking-age/the-people/clothes-and-jewellery/):
tunics/trousers, dresses with undergarments, simple belts and restrained fittings.
These are visual reconstructions, not identified outfits from L'Anse aux Meadows.
Outfit assignment retains the old deterministic index pattern; no gender field
or modern breed/appearance claim is added to campaign data.

Livestock use `createLivestock()` / `poseLivestock()` in the same character module.
The transient `object.livestockRig` owns species, joints and visual phases. Each
species has four shared coat variants, articulated neck/head/legs, split hooves,
ear/tail motion and a seven-mesh distant version. Hoof and grazing poses sample
the walkable surface beneath their contact points. Movement in `world-expansion.js`
retains the existing collision radii and pasture/byre destinations, faces actual
travel, and alternates wandering with grazing poses. Pausing freezes land movement
and poses; deck animals continue to follow their ship. Species are reconciled when
aggregate herd counts change. Grazing is visual only and consumes no pasture or feed.

`npm run test:characters` also checks hoof contact, heading, pause, herd changes,
saving and grazing reach. It writes `/tmp/vinland-livestock-models.png` and
`/tmp/vinland-livestock-grazing.png`. Run `test:collision` after integration changes.
Dimensions, coat patterns and horn variation are visual estimates, not exact breeds,
sex assignments or evidence of these animals at L'Anse aux Meadows. The National
Museum of Denmark's [sheep/goat overview](https://natmus.dk/historisk-viden/danmark/oldtid-indtil-aar-1050/livet-i-oldtiden/husdyr-i-oldtiden/faar-og-geder-i-oldtiden/)
provides historical context; the models avoid oversized modern show-animal fleece.

`style/menus.css` styles the start screen and centered game dialogs; the generic
draggable settlement frame remains in `style/windows.css`. `Interface.open()`
accepts `{ menuIcon: 'load' }` as its fourth argument for a game menu dialog.
Only the five primary settlement panels show the settlement tabs. Save cards
live in `Interface.loadGame()`; footer actions are moved into `#window-footer`
so they remain outside the scrolling content. `npm run test:menus` checks layout,
focus, save details, import messages, export and loading at desktop/mobile sizes.

Startup and save routing live in `game.js`: the initial screen never loads a
campaign automatically. `hasStartedCampaign` distinguishes the paused preview
model from a chosen game. `interface.js` defines the menu and separate manual,
recovery, previous and legacy save slots. `npm run test:startup` covers explicit
loading, preservation of manual saves, recovery and mobile layout. Gameplay
browser tests enter through the shared `tests/browser-session.cjs` UI helper.

`doors.js` defines saved open/closed targets and shared doorway/leaf geometry.
`door-controls.js` handles door meshes, collision indexes, E interaction and
automatic passage for ordered workers. `world-interiors.js` connects them to
navigation; `interior-presentation.js` handles camera clearance and entrance light.
`npm run test:doors` exercises the real offline controls.

`solar.js` calculates the sun from the historical date, local mean solar time and
the mapped Hall F coordinates. `sky.js` renders the walking sky and solar disc;
`world-expansion.js` applies the shared direction to lighting and water. Read
[sky and sun](docs/SKY_AND_SUN.md) for clock conventions, editable presentation
and accuracy limits. `npm run test:sky` measures the actual rendered sun.

Hand-tool durations, tree-stage formulas and load sizes live in `work-timing.js`.
`production-processes.js` owns local charcoal/stockfish batches: preparation labor,
passive elapsed time and unloading labor. See [the work timing audit](docs/WORK_TIMING_AUDIT.md)
before changing these estimates. `tests/work-timing.cjs` verifies the model;
`npm run test:timing` checks workplace controls and animations in an offline browser.

| File                                                 | Responsibility                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `content.js`                                         | Building definitions, costs, nominal labor, tasks, food, scenarios, and historical references.                  |
| `conversation.js`                                    | Brief walk-mode dialogue, temporary per-person work pause, and keyboard gathering orders.                       |
| `worker-orders.js`                                   | Serializable named-worker commands, support jobs, validation, shifts and crew release.                          |
| `collision.js`                                       | Rotated rectangle/circle collision and a shared spatial index for nearby obstacles.                             |
| `worker-controls.js`                                 | Pointer and box selection, worker rings, contextual actions and specific-site assignment.                       |
| `style/workers.css`                                  | Worker action panel and selection marquee.                                                                      |
| `tests/building-selection-browser.cjs`               | Mouse and touch selection for all constructed building types, before/after completion and save/load.            |
| `tests/workers.cjs`, `tests/workers-browser.cjs`     | Exact labor, explicit-only work, saved commands, pointer selection and visible hauling.                         |
| `cheats.js`, `cheat-controls.js`, `style/cheats.css` | Explicit opt-in test commands, free construction/repairs, physical resource piles, and the F10 panel.           |
| `hearths.js`                                         | Saved local fuel, combustion, room heat, wood moisture, pot energy, soup and meal credits.                      |
| `hearth-controls.js`, `style/hearth.css`             | Walk-mode fire tending and cooking panel.                                                                       |
| `docs/HEARTHS.md`                                    | Hearth controls, physical constants, model assumptions and sources.                                             |
| `building-spaces.js`                                 | Shared local-space walls, entrances, furniture and shelter places.                                              |
| `world-interiors.js`                                 | `InteriorWorld extends HarvestWorld`: indoor routes, floor heights, work, storage, shelter and cutaways.        |
| `gathering.js`                                       | Fixed-step physical work, finite source material, cargo, delivery and drying.                                   |
| `world-harvesting.js`                                | `HarvestWorld extends SettlementWorld`: real source selection, storage routes and harvest marks.                |
| `docs/GATHERING_SIMULATION.md`                       | Editable rates, units, assumptions and gathering evidence.                                                      |
| `simulation.js`                                      | Authoritative people, stocks, construction, survival, politics, travel, and saves. Works in Node without a DOM. |
| `world.js`                                           | `BaseWorld`: renderer setup, terrain, geometry, buildings, and shared mesh helpers.                             |
| `weather.js`                                         | GPU precipitation, roof cover, impacts, ground spray, wet materials, and weather transitions.                   |
| `tests/weather-browser.cjs`                          | Rendered rain pixels, roof heights, weather transitions, graphics quality, and offline shader checks.           |
| `world-expansion.js`                                 | `SettlementWorld extends BaseWorld`: detailed art, collision, local movement, and animation.                    |
| `controls.js`                                        | `World extends InteriorWorld`: district camera, pointer gestures, selection, and construction ghosts.           |
| `assets/buildings/*.svg`                             | Individual colored building illustrations, editable as ordinary SVG files.                                      |
| `assets/menu/*.svg`                                  | Colored cogwheel and game-menu action icons.                                                                    |
| `assets/resources/*.svg`                             | Colored resource illustrations used by the top bar.                                                             |
| `hud.js`                                             | Persistent resource counters and their pointer, focus, and touch tooltip.                                       |
| `interface.js`                                       | Management-window HTML and display helpers.                                                                     |
| `audio.js`                                           | Local ambient playback, day/night and weather mixes, spatial water/hearth layers and volume fading.             |
| `media/`                                             | CC0 MP3 loops, per-recording sources and license text.                                                          |
| `tools/build-ambience.cjs`                           | Developer-only ffmpeg processing of verified source previews into quiet cyclic loops.                           |
| `tests/audio.cjs`, `tests/audio-browser.cjs`         | Seasonal mix rules, CC0 file hashes and actual offline browser playback.                                        |
| `game.js`                                            | Startup, command routing, HUD sections, event bindings, and the animation loop.                                 |
| `index.html`                                         | HUD structure and ordered local script tags.                                                                    |
| `style/base.css`                                     | Shared theme, readable text sizes, buttons, forms, and meters.                                                  |
| `style/hud.css`                                      | Resource bar, simulation console, minimap, calendar, and work queue.                                            |
| `style/construction.css`                             | Build categories, illustrated buttons, icon sizing, and costs.                                                  |
| `style/viewport.css`                                 | World canvas, labels, camera tools, inspector, and notifications.                                               |
| `style/windows.css`                                  | Management window frame, title bar, tabs, and scrolling.                                                        |
| `style/management.css`                               | Settlement page layouts, tables, charts and households.                                                         |
| `style/menus.css`                                    | Start screen, centered game dialogs, save cards and menu footers.                                               |
| `style/walking.css`                                  | Walking console, hints, touch controls, and view-specific overrides.                                            |
| `tests/simulation.cjs`                               | Model rules, conservation, saves, and seasonal regressions.                                                     |
| `tests/browser.cjs`                                  | Actual browser controls, layout, offline loading, and campaign smoke tests.                                     |
| `assets/maps/`                                       | Offline Natural Earth coastline map and data provenance.                                                        |
| `atlantic-geography.js`                              | Latitude/longitude references, projection, sea corridors, and nautical distances.                               |
| `atlantic.js`                                        | Dedicated Atlantic screen, map input, harbours, voyage planner, and journey estimates.                          |
| `style/atlantic.css`                                 | Dedicated Atlantic screen, chart, sidebar, and responsive layout.                                               |
| `tests/atlantic.cjs`                                 | Projection, distances, route endpoints, and offline basemap checks.                                             |
| `meadows-geography.js`                               | Shared real-site coordinates, height sampling, signed shore distance, and freshwater geometry.                  |
| `assets/terrain/`                                    | Bundled settlement reference geometry, elevation window, generated grids, licensing, and accuracy notes.        |
| `tools/build-meadows-terrain.cjs`                    | Optional JavaScript builder using GeoTIFF/projection development tools; never runs in the game.                 |
| `tests/terrain.cjs`                                  | Source geometry, physical metre coordinates, heights, water constraints, and arrival anchorage checks.          |

Scripts use classic browser globals so `file://` loading works without a server.
Keep their order in `index.html`: content, terrain data and geography, collision geometry, gathering, worker orders, model, base world, weather renderer, settlement world, harvest world, interior world,
interactive world, management interface, resource HUD, Atlantic geography and screen, ambience, worker controls, conversation panel, then application startup. The bundled Three.js script loads first. `game.js` instantiates the final
`VinlandWorld.World`.

## Follow a change through the game

`game.js` ends by calling `initializeGame()`. Its named `bind*` functions attach
controls once. `handleAction()` routes management commands through an explicit
switch. `renderInterface()` calls one function for each HUD section.

The animation loop passes speed-scaled seconds to
`Simulation.advanceRealtime(seconds, world)`. `gathering.js` steps physical movement,
work and deliveries in 0.1-second increments, then advances the calendar.
`Simulation.advance(hours)` is a low-level calendar operation; it produces no
physical harvesting or construction on its own. The model accumulates fractional time and invokes
`onHour()` at whole-hour boundaries. Midnight also invokes `onDay()`. Those methods
list their operations in execution order; each operation has its own named method.
Production, consumption, health, travel, votes, and ledger recording have deliberate
ordering. Preserve it when changing a rule.

Work assignments come only from named-person orders: move, gather, build, or work
(fishing, foraging, camp care, crafting). The roster is derived from those orders;
never recruit people to fill a numeric quota or automatically move a completed
crew onto another job. Older saves discard quota fields while retaining direct
orders. Construction and gathering use ten hours; support jobs follow the camp's
approved workday. Commands live in `worker-orders.js`, contextual actions in
`worker-controls.js`, and support destinations in `world-expansion.js`.

Walk rendering interpolates the previous and current fixed-step leader poses using
the clock remainder. The camera position and its aim ease together; updating the
aim instantly while easing only the camera creates a visible pitch pulse. These
displayed poses must never be written back to collision positions or saves.
`npm run test:walking` reproduces movement at controlled render intervals and
checks smooth walking/sprinting at 1×, 3× and 8×.

[Usable building interiors](docs/BUILDING_INTERIORS.md) documents the entrance and room system, shelter orders and physical warmth rules.

The world renders campaign state. Mesh positions, animation routes, selection
outlines, and build ghosts are presentation data. Clicking a ghost requests a model
order; `Simulation.order()` checks the actual site, reserves materials and fabric,
and creates a work order. Never debit stock or grant shelter in a renderer or an
HTML template. Local walking updates the leader's persisted position, while travel
outcomes and the economic clock remain model responsibilities.

Building selection belongs to the root returned by `buildGeneric()`. Initialize its
`userData.select` before any specialized branch can return. A component reused as
decoration must lose its independent selection tag: the converted tent fabric
belongs to its building, rather than to a landing-tent entity. `sync()` attaches
the saved building ID. Both district worker controls and touch queries use this
shared ownership metadata.

The base-world constructor calls overridable `buildScene()` and `bindControls()`.
Those methods run on the final derived object before its constructor finishes.
Initialize the fields they use inside those methods or in the base constructor.
Use ordinary class overrides and `super`, rather than patching prototypes at load time.

## Common edits

- **Change a building:** edit its entry in `content.js`. Costs, stage hours, crew caps,
  dimensions, and shelter effects belong there. Stage hours must sum to nominal
  hours. Update `interface.js`'s building summary if its visible effect changes, and
  the appropriate world geometry if its shape changes.
- **Change harvesting:** edit `gathering.js` for physical rates, cargo and source budgets, or `world-harvesting.js` for habitat selection, routes and visual marks. Keep stock credits in the model and update the rate documentation.
- **Change a production or survival rule:** edit the relevant hourly or daily helper
  in `simulation.js`. Add a model test that checks the resulting stock, health, or
  labor outcome.
- **Change a control:** pointer gestures live in `World.bindControls()` in
  `controls.js`; application keyboard shortcuts live in `bindKeyboardShortcuts()`
  in `game.js`. Both camera modes read WASD and arrow keys through
  `SettlementWorld.readMovementInput()` in `world-expansion.js`. Update the controls
  help and browser regression where relevant.
- **Change a management page:** edit its method in `interface.js`. Buttons use
  `data-action`; dispatch belongs in `game.js`. Escape player-provided text with
  `escapeHtml()` before inserting it into markup.
- **Change the HUD:** edit the matching `render*` function in `game.js`, the static
  structure in `index.html`, and the relevant stylesheet in `style/`. Each component's
  responsive rules stay in the same file. See [the style guide](style/README.md).
- **Change the Atlantic screen:** edit `atlantic.js`, its section in `index.html`,
  and `style/atlantic.css`. Coordinates and projection belong in `atlantic-geography.js`.
  Rebuild the basemap if the projection changes; see [map provenance](assets/maps/README.md).
  Never place geographic markers with hand-picked SVG pixels or saved legacy `x`/`y` values.
- **Change the real settlement terrain:** read [terrain provenance](assets/terrain/README.md).
  `meadows-geography.js` is the shared reference for the renderer, model placement,
  walking, and minimap. Mesh density must not be described as source-data accuracy.
  The generated grids can be rebuilt offline from the checked-in geographic extract
  and elevation window; `geotiff` and `proj4` are developer tools only.
- **Resize build-button icons:** find `.build-panel` in `style/construction.css`. Change
  `--build-icon-width` (94px) and `--build-icon-height` (76px) to adjust their size
  limits. `--build-icon-gap` (4px) controls both gaps between the illustration and
  its labels. Icons shrink to fit the available button height. Keep the same gap
  for both labels by leaving the shared `.build-card` grid spacing in place.

Coordinates and dimensions are metres; `y` is vertical. Model time is hours since
the scenario date; animation deltas are real seconds. Labor is nominal person-hours.
Timber and turf use cubic metres, stone tonnes, iron and most supplies kilograms,
and water litres. `resources.food` is an energy-derived ration count; `foods` holds
actual edible kilograms. The top bar converts the energy reserve to days of demand.

Save version 3 includes identifiers, stock, crew reservations, rules, and mission
state. Renaming a serialized field requires a migration and validation changes.
Keep compatibility aliases in the model exports unless all consumers are migrated.

CSS colors belong only in `style/color-palette.css`; use named palette variables
in component styles, including gradients, shadows and color fallbacks. See
[editing styles](style/README.md). `npm run check:colors` enforces this rule and
checks variable references and stylesheet order; it also runs in `npm run check`.

## Code style

Write for the next person who needs to change a rule or diagnose a broken control.

- Use descriptive domain names such as `state`, `weather`, `person`, and `order`.
  `x`, `y`, `z`, geometry dimensions, and short loop indices are reasonable for geometry and arithmetic.
- Use two spaces, explicit braces, and one variable declaration per statement.
- Give functions one coherent responsibility. Keep orchestration methods short
  enough to see the sequence without reading each implementation.
- Comment units, assumptions, ordering, ownership, and surprising constraints.
  Avoid comments that merely restate the next statement.
- Keep HTML in readable multiline templates marked `/* HTML */` so it is formatted
  along with JavaScript. Prose can use joined strings to preserve its exact value.
- Use the 100-column formatter setting. URLs and SVG path data can exceed that
  width when splitting them would make the asset harder to inspect.
- Keep third-party minified code in `vendor/`. Do not minify the application source.
- Preserve direct-file, offline loading. Do not introduce CDN imports, runtime
  package loading, or a mandatory development server.

## Format and verify

Install the pinned development tools once:

```sh
npm ci
```

Then use:

```sh
npm run format        # Format application source, tests, and documentation.
npm run check         # Check CSS colors, formatting and model tests.
```

The model tests also run without installing anything:

```sh
node --test tests/simulation.cjs tests/atlantic.cjs tests/terrain.cjs
```

For browser checks, install the test browser once and run:

```sh
npx playwright install chromium
npm run test:browser
npm run test:audio
npm run test:workers
npm run test:selection
npm run test:collision
npm run test:conversation
```

The browser suite opens `index.html` as a file, blocks HTTP requests, and exercises
actual controls. It does not start a server. If using an existing Playwright or
Chromium installation, set `PLAYWRIGHT_PATH` and `CHROMIUM_PATH`; both are supported
by `tests/browser.cjs`. Test screenshots are written under `/tmp`.

Review the behavior as well as the test result: open the game, check the relevant
view, and keep material/labor information readable at each supported text size.

Camera and building rotation input is integrated in `controls.js`, using real elapsed
seconds and the `ROTATION_SPEED` / `FAST_ROTATION_SPEED` constants at the top.
`bindRotationButton()` in `game.js` connects held pointer and keyboard buttons to
that same input. Interactive rotations accept arbitrary radians; quarter turns used
to orient static mesh geometry are unrelated.

Weather rendering is separate from the simulation in `weather.js`. Particle counts
and shader constants are near the top; `update()` controls wind, fades and drying.
`world.js` tags gabled roofs and tents with their width, depth, eaves and rise so
rain uses the same roof profiles as the building geometry. The renderer keeps up
to 48 nearby profiles active, including when Hall F is shown in cutaway. Rain and
impacts are visual approximations, not a fluid simulation. All weather meshes clip
to the finite terrain tile, and low graphics quality reduces particle counts.

Conversation pause state belongs to `ConversationSession`, outside the serialized
campaign. Do not replace or snapshot a worker's order just to pause them: closing
the conversation must preserve any new command. The roster and hourly accounting
exclude the speaker; the renderer also freezes their route/hauling phase. Resource
commands use `WorkerControls.assignGathering()` so walk and district orders share
resource, access, and return-path checks.
