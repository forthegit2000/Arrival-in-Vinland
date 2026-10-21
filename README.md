# Arrival in Vinland

Open **`index.html` directly in your browser**. No server, build step, account or internet connection is needed. Keep the JavaScript files, `style/`, `assets/`, `media/`, and `vendor/` together. WebGL must be enabled.

This is a substantially expanded playable society-simulation prototype based on the thirty-page **Vinland — The Unwritten Shore** concept. It implements a connected seasonal game, rather than claiming to be a finished AAA production. The supplied document is design reference; its statements about variable openings do not override the original requested scenario. That arrival remains a selectable default.

## The campaign

The original preset starts on **1 August 1005 AD**, with **160 people, four knarrs, ten tents, four sails, eight cattle, twelve sheep and twelve goats**, and an inherited Hall F needing repairs. Three additional presets vary people, ships, provisions, children, season and landfall. **Cogwheel → New Game** exposes the scenario seed and starting parameters. New campaigns retain a previous-campaign backup in local storage.

There is no forced invasion, mandatory historical quest chain or expansion-only victory. Calendar seasons repeat, households and institutions persist, and a chronicle records the actual results. The player can close a chapter voluntarily. Optional Legacy mode chooses a surviving adult successor if the leader dies.

## Views and controls

- **District:** a fixed-angle orthographic camera centers the settlement. Left-click people or drag a selection box; Shift adds people. Drag with the middle or right mouse button to pan; WASD or arrows also pan. Scroll or **+ / −** zoom. Hold **Q / E** to rotate freely at 15° per second, or 30° with **Shift**. **C** recenters. Camera buttons and a minimap provide the same navigation. Touch supports dragging and pinch zoom.
- **Walk:** move Karlsefni with WASD; hold **Shift** to sprint at **3× walking speed** (4.2 m/s). Use arrow keys to look left/right/up/down, or drag the mouse. **E** speaks to a nearby person, or inspects a nearby building. During conversation: **1** logs, **2** turf, **3** firewood, **4** hay, **0** stop and idle, **E / Esc** leave. An accepted gathering or stop order ends the conversation immediately. The person pauses movement and work while speaking; their original order resumes on leaving unless you changed it. Conversation does not pause the rest of the camp. Mobile walking has direction buttons. Terrain and building collision limit movement. The walking view is unavailable while the leader is travelling.
- **Atlantic:** switches to a dedicated geographic screen with real coastlines, harbour selection, voyage planning, and journey estimates. Drag or use the arrow keys to pan; use the wheel, + / −, or touch pinch to zoom. Fit map restores the overview. District, Walk, or Escape returns to the settlement.
- **Space:** pause or resume. At 1×, one real second is one game second in every view. 3× and 8× accelerate the same clock, including walking, work and hauling. At 8×, a ten-hour shift takes 75 real minutes.
- **H:** Hall F roof cutaway. Click the hall or a room to inspect its plan.
- **Worker orders:** People start idle and never wander automatically. Select people, then choose Move, a Gather resource, or Build. Logs, turf, firewood and hay gathering automatically choose reachable resource areas; no ground click is needed. Right-click ground to move selected workers, or right-click unfinished work to assign them to that site. Stop cancels their orders.
- **Build:** choose a tool in the bottom palette, then click to place it. Each button shows the building name above a colored SVG illustration and its nominal work below as “person/hours”. Right-click a tool or press **F1** while it is focused to open the full work breakdown. On touch screens, the long-press context action opens those details. Hovering and focusing buttons do not open popups. Green footprints are valid; red footprints are blocked. Hold **R / T** to rotate the footprint clockwise/counterclockwise at the same speeds. Successful placement releases the build cursor immediately so another crew can be selected. Choose a building again to place another; right-click, **Esc**, or **Query** cancels an active preview. Building does not change the existing time speed or pause state. Reopen Hall F orders its fixed-site repairs directly.
- **Query:** **I** selects the query tool. Click a structure for its compact condition/work panel. Detailed room plans, work orders, people, stores, council, fleet, coast and reports are available from the console. Management windows pause time, leave the console accessible, and can be dragged by their title bars. **Esc** closes the window and restores the previous pause state.
- **Cogwheel:** Resume Game, New Game, Load Game, Save Game, Settings, Help, and Quit. Load Game offers the browser save, previous campaign backup, and file import. Settings includes export and accessibility options. Quit saves and pauses the campaign, then returns to the main menu. On phones, the command strip scrolls horizontally and includes Walk and Atlantic.

The top bar shows colored resource icons and quantities; hover or focus a resource for its name, units and amount. Tap a resource on touch screens. Arrival in Vinland stays centered in the compact bar.

The interface uses a docked blue-gray simulation console, a compact resource strip, building tools and a minimap; the terrain occupies a separate viewport above the console. Text-size settings also enlarge the console to keep its costs readable. The main interface keeps functional information visible; descriptions and historical notes are available on demand. Labels start at fourteen pixels, dialogs at sixteen. Settings provide 100%, 115% and 130% text sizes, a lower-cost graphics mode and optional CC0 environmental sound with a volume control.

## People and physical survival

Every expedition member has a persistent identity, age, household, skills, navigation experience, trust, fatigue, health and memories. Children do not enter the adult workforce until sixteen. People at sea, on survey or too ill to work are unavailable. Walking takes the leader out of the active work roster.

Crew quotas are filled by available people with relevant skills. Skilled people produce more effective work; fatigue, poor health and low trust reduce it. Longer working days consume more labor and accumulate fatigue. Departure reduces spare construction staffing before eliminating essential household work.

Food is stored as **fresh fish, dried fish, meat, plants, grain, dairy and fat**, in edible kilograms. The top bar translates its total energy into full-ration person-days. A modeled adult ration is 3,000 kcal/day and a child ration 1,800. These are game accounting assumptions, not individual nutritional prescriptions. Stockfish uses 3,270 kcal/kg from the Norwegian food table; other densities are approximate.

- Temperature affects spoilage; a dry storehouse slows losses.
- A drying house converts fresh fish into lower-mass preserved stockfish; the recorded input is distinct from human consumption.
- Household crews collect water, cook and care for animals. A spring collection point improves collection, rather than creating piped water.
- Occupied insulated rooms require firewood according to wind chill. A woodshed improves fuel use. Insulation quality and maintenance condition affect delivered warmth.
- Cattle, sheep and goats consume different amounts of dry fodder when pasture is dormant. Pasture and haymaking share a finite meadow estimate.
- Selective slaughter creates perishable meat and reduces future fodder and dairy demands.
- A care hut improves recovery only with food, water, warmth and caregivers.

Health is affected by shortages and exposure rather than an arbitrary November health deduction. The daily ledger records production, use, spoilage, work, stocks, climate, health and ecology. Reports expose the causes of current warnings.

## Construction and settlement

There are **twenty building options**, including the original shelters, longhouses, byre, hay store, bloomery and fishing facilities, plus a dry storehouse, fuel shelter, water collection point, care hut, garden, timber enclosure, repair shelter and assembly shelter.

The building catalogue stays closed until workers are selected and Build is chosen. Each directly ordered builder at the work site contributes one person-hour per working hour, up to ten per day (08:00–18:00), within the building’s crew cap. Other people stay idle, and completed or cancelled building orders release their crew. Completed buildings have actual entrances and usable rooms. Work and storage routes lead inside; **Shelter** sends selected people to available indoor places. Ongoing workers return to shelter off duty, then resume their job. **H / Cutaway** exposes the rooms. [Interior controls and layout rules](docs/BUILDING_INTERIORS.md) explain access, capacity and physical warmth. Fishing, foraging, camp care and crafting are explicit orders under **Work** after selecting people. Camp care includes water collection, cooking and animal care. Crafting needs a completed charcoal clamp. These jobs retain the assembly-approved camp workday; gathering and construction use 08:00–18:00.

Gathering credits resources only after workers carry real loads to a reachable camp drop-off or suitable storage building and finish unloading. Travel, cutting, carrying and handling consume work time. Trees are finite and leave stumps and timber; turf cutting and mowing leave visible patches. Hay must dry before collection. Fishing and foraging also require delivered loads. Retasking leaves recoverable bundles rather than teleporting their contents into stores. Hall D is not modeled; the established camp drop-off remains beside Hall F. [Gathering model and editable rates](docs/GATHERING_SIMULATION.md) documents the units, assumptions, storage routing and historical limits.

Tree work now separates clearing, diameter-dependent felling, limbing, cross-cutting and bundling or splitting. Tool care interrupts axe work; off-duty workers no longer keep chopping visually. Hay needs fair daylight to cure. Charcoal and stockfish use local inputs and timed batches rather than instant hourly conversion. Select people, inspect the pit or drying house, then choose **Work here with selected people**. [Work timing audit](docs/WORK_TIMING_AUDIT.md) lists the editable estimates, evidence and remaining simplifications.

Material costs are physical inventory reservations: cubic meters of timber/turf, tonnes of stone and kilograms of iron. Quoted work is **person-hours**, with a 75–135% planning range. Selected builders use the ten-hour accounting above. Crew caps prevent hundreds of people finishing a small hut in an hour. Gathering raw materials is separate from assembly, shaping and fitting work.

A sail shelter takes a sail from an actual anchored ship. That vessel cannot sail until the fabric is recovered. Tent conversion removes the original tent's berths during work. Cancellation returns fabric and the unused portion of other materials; dismantling a temporary shelter returns its fabric and half its structural stock.

Buildings deteriorate with time, wet sites and storm exposure. Repairs reserve supplies and require a work crew. Each construction or repair order needs its own selected workers. Assign them by right-clicking the site or using **Assign selected workers** in its work details. A new longhouse provides thirty-two estimated warm berths; that occupancy is a reconstruction assumption, not an attested count.

Gardens require spring seed and produce one autumn harvest per planted year. Their addition is hypothetical. Forest extraction and fish availability respond to pressure and recover at finite rates. Surveying inland woodland expands the known accessible harvesting district, not ownership by discovery.

## Council, coast and ocean

Work rules, food distribution, land/work arrangements and shore watches require an assembly. Households can support or reject proposals based on trust, burden, shortages and preferences. Changing land arrangements affects confidence and records the ownership form of subsequent buildings. A named steward can be appointed; work is always assigned to selected people, with no daily automatic reassignment.

Four-person survey parties carry provisions, leave the workforce and return dated knowledge. An independently simulated, fictional aggregate coastal community may be reported near the southern estuary. It has its own provisions, stance, territorial access and pressure. Envoys may be declined. An access agreement permits reciprocal exchanges that take a party, provisions and travel time.

A knarr voyage reserves an actual vessel, six to sixteen adult crew, timber cargo and dried food for the planned round trip. The conservative modeled payload is twelve tonnes, including crew/equipment and supplies. Home stores and labor cannot spend those resources again. Seamanship, hull condition and gales affect travel delay and condition. Returned cargo is credited once, upon return, and trade terms vary by market period. Voyages can run short of provisions; the current maritime model does not yet resolve foundering or tactical ship handling.

## Evidence and limits

Hall F follows the published relative arrangement: I is the private living chamber; II and III the shared skálar; IV the western kitchen with a double slate-box oven; V and VII the western stores; VI the eastern repair lean-to open to the south. Its published interior area is approximately 160.5 m². The original doorway to VII was not identified. The 3D walls, roofs, platforms, door connections and sleeping capacities are simplified reconstructions.

The 1005 arrival, inherited standing hall, detailed crew manifest, individual ages/skills and herd composition belong to the scenario. AD 1021 is securely attested Norse woodcutting at the site, not a known first-arrival date. Livestock facilities and gardens were not identified at L'Anse aux Meadows. The alternative bays, community and agreements are hypothetical, not claims of excavated villages or attested cultural behavior. The coast was used by Indigenous peoples long before the Norse.

L'Anse aux Meadows now uses mapped OpenStreetMap coastlines, streams and ponds, with NRCan MRDEM-30 elevations, in metres around the mapped original Hall F. The water shader, walking, building checks and minimap share this reference. Elevation detail is limited by the 30 m source; the shoreline distance field samples mapped geometry at 4 m. It is a modern geographic reference, not a surveyed reconstruction of the AD 1005 shoreline. Stream widths, underwater depths, vegetation and camp paths remain modeled. [Terrain sources, accuracy and rebuilding](assets/terrain/README.md) document the inputs and limits.

Climate is a seeded seasonal approximation, not recovered daily weather for AD 1005. Resource densities, births omitted from the current population model, care effects, labor rates, animal yields, market terms and route durations remain estimates. Art is generated locally; the character art is stylized rather than AAA photoreal performance. Environmental sound uses edited CC0 field recordings.

Sources:

- [F–G plan and room interpretations](https://canadianmysteries.ca/sites/vinland/archives/map/indexen.html).
- [Wallace, “The Norse in Newfoundland” (2003)](https://journals.lib.unb.ca/index.php/NFLDS/article/download/140/237). Whole-site turf and reconstruction labor supply rough benchmarks, not measured hours for individual game buildings.
- [Kuitems et al., Norse activity in AD 1021](https://www.nature.com/articles/s41586-021-03972-8).
- [Parks Canada, Indigenous occupation](https://parks.canada.ca/lhn-nhs/nl/meadows/culture/sites).
- [Viking Ship Museum, Skuldelev 1](https://www.vikingeskibsmuseet.dk/en/visit-the-museum/exhibitions/the-five-viking-ships/skuldelev-1/). Used as a cargo-craft reference, not an identification of Karlsefni's actual ships.
- [Norwegian Food Composition Table, stockfish](https://www.matvaretabellen.no/en/stockfish-dried-fish/).

[Concept implementation and remaining production scope](docs/CONCEPT_IMPLEMENTATION.md) maps the thirty-page vision to what is actually implemented. Specialist and Indigenous consultation, a complete ownership/contract market, multiple locally simulated harbors, tactical conflict, ship loss, reproduction/migration, authored character scenes, controller parity, remapping and cinematic art/audio remain further production work.

## Source and maintenance

The application source is kept readable and unminified. [CONTRIBUTING.md](CONTRIBUTING.md) maps the files and class hierarchy, explains the hourly/daily simulation flow and save contracts, and gives common editing and verification steps. Optional pinned npm tools provide formatting and browser tests; playing still requires only opening `index.html`.

## Saves and verification

The game always opens on the start screen. Choose **New Game** or **Load Game**; stored games never resume automatically. **Continue Game** appears only after quitting an already-open game back to the menu in the same session.

Load Game, New Game, Settings and Help use centered game dialogs with colored icons and no settlement tabs. Load Game shows separate save cards with the campaign date, time and population. Back and file-loading controls stay outside the scrolling save list. Menu styles are in `style/menus.css`; `npm run test:menus` verifies desktop/mobile layout and keyboard behavior.

Manual saves and thirty-second autosaves use separate browser storage slots. Autosaves, including recovery on closing the browser, appear explicitly under **Load Game → Autosave · recovery** and never overwrite **Save Game**. Starting or loading a campaign does not create a manual save. Export/import provides portable JSON saves. Older saves keep settlement progress and explicit worker orders. Removed crew quotas and steward delegation are discarded; workers without explicit orders become idle. Version-one saves migrate without deleting the original key. Import validation rejects negative stocks, duplicate people, duplicate reserved crews and malformed physical state. If a browser blocks local storage for file URLs, export instead.

```sh
npm test
```

The model tests cover arrival, reproducibility, labor and fabric conservation, work shifts, voyages, council decisions, survival, seasons, migrations and save validation. Gathering tests cover delayed inventory credit, finite sources, load limits, travel distance, blocked stores, interrupted loads, field drying, seasonal limits and identical results at 1×, 3× and 8×. Geography, audio and collision tests exercise the shared offline data and geometry. Longer seasonal tests use explicitly provisioned stock; they do not invent harvesting through calendar shortcuts.

`tests/browser.cjs` uses Playwright for direct-file, network-blocked checks: mouse/keyboard camera panning, zoom, continuous camera/building rotation, direct/repeated placement, invalid sites, right-click cancellation, touch pinch, movable management windows, Hall F rooms/cutaway, construction, placement, households/stores, council decisions, walking, Atlantic chart, save/reload, new scenarios, responsive layout and minimum label sizes. Set `PLAYWRIGHT_PATH` and `CHROMIUM_PATH` if using tools installed outside their usual locations. Browser-test tooling is not required to play.

`npm run test:weather` checks actual rain pixels, roof cover, graphics quality, snowfall and gradual drying in an offline browser. Rain uses wind-driven streaks, surface splashes, water ripples and drifting spray; terrain and roofs wet gradually, then dry after rain stops.

**Cheat mode:** Open Cogwheel → Cheat Mode or press **F10**, then enable it. Spawn resource piles in front of Karlsefni, build and repair instantly for free, finish existing construction, restore the crew, supply hearths, finish soup, switch between noon and midnight, and select weather (fair winds, rain, gale or snow). [Testing controls and save behavior](docs/CHEATS.md).

**Hearths and soup:** In walk view, press **G** beside a firewood store to carry wood and **F** beside a hearth to tend it. Hall F hearths work before repairs. Add fuel, light it and refill it as it burns into embers. Supply each room with water and ingredients, heat and simmer a pot, then lift it to cool and serve bowls. [Controls, physics assumptions and sources](docs/HEARTHS.md) explain the model.

**Ambient sound:** Enable Cogwheel → Settings → Ambient sound, then adjust Volume. Nine local CC0 loops cover rain, daylight birds, quiet night air, winter woodland, snowfall, surf, brook, hearth and storm wind. Layers fade with season, weather, time and the viewed location. Playback needs no server or network. [Recording sources, credits and licenses](media/SOURCES.md) document every file. `npm run test:audio` checks real local-file playback, weather transitions, mute and volume persistence.

**Sky and sun:** Walk view has a procedural daytime sky, clouds and twilight. The sun's direction and true angular size follow the campaign date, local mean solar time and Hall F's geographic coordinates. Shadows and water reflections share its direction. Arrow Up or upward camera dragging lets you see the high summer sun. District view retains black space beyond the map edge. [Clock convention, sources and tests](docs/SKY_AND_SUN.md).

**Doors:** Hall F and enclosed buildings start closed. Approach a door in walk mode and press **E** to open or close it. Workers handle doors along their ordered routes. Closed doors block passage and entrance daylight; door states are saved. [Door behavior and interiors](docs/BUILDING_INTERIORS.md).

Three.js 0.160.1 is locally bundled as a classic script. Its MIT license is in `vendor/THREE-LICENSE.txt`.

The Atlantic basemap uses Natural Earth 1:50m land, projected from geographic coordinates and bundled for offline play. It is a modern coastline reference; routes and positions are estimates. See [map sources and rebuilding](assets/maps/README.md).

`npm run test:workers` verifies actual worker selection, movement, stopping, log-hauling cycles and individual construction orders in the offline browser.

`npm run test:selection` clicks all nineteen constructed building types during construction, after completion, and after save/load, verifying mouse/touch selection and the correct building details.

`npm run test:collision` checks solid tents and construction sites, safe spawning,
people passing each other, paths around obstacles, sprinting into thin walls, and
unchanged physical walls in cutaway view. Collision geometry and its spatial index
are in `collision.js`; actor sizes, obstacle collection, and movement are in
`world-expansion.js`. People have a 0.34 m collision radius. Trees and rocks clear
when a construction site is reserved; people standing inside it move to clear ground.

`npm run test:conversation` checks walk-mode conversations through real keyboard input, temporary movement/work pauses, resuming unchanged orders, all four gathering commands, stopping, menu/view cleanup and mobile layout.
