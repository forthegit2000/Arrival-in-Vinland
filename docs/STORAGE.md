# Physical storage

Stores own their stock. The top bar is a summary of unreserved inventories, not
a second pool from which every building can spend. Resource hovers also show
what is at camp. Starting provisions and older saves' unlocated stocks go to the
camp supply point once. Existing paid construction in older saves keeps its
materials at the site; migration does not charge for them again.

## Playing

- Harvesters deliver to a reachable camp, storehouse, woodshed or hay barn.
  Stock arrives after unloading. A full store redirects the next delivery;
  when no receiving store is reachable, the worker keeps the load.
- Select people, open **Work → Supply camp** to bring needed supplies back.
  **Work → Supply building**, followed by clicking a completed building, sends
  workers to stock that store or workplace. They choose suitable resources
  automatically, carry loads and wait if nothing suitable is reachable.
  These orders use the same 08:00–18:00 workday as direct gathering orders.
- **Stores → Inventory**, a building's details, or a visible ground bundle shows
  the individual inventory. Available goods and construction reservations are
  listed separately. Ruined buildings retain their stock but cannot supply it
  until repaired.
- Food, drinking water, fodder and departure cargo are drawn from
  **camp**. Stock in a distant warehouse is not automatically consumed there.
  Indoor crafting consumes its own workplace's inputs and leaves its outputs
  at that workplace. Supply its buffer with hauling orders. Garden planting
  similarly needs seed in the garden's buffer. Hearth fuel and soup ingredients
  come from the room's own inventory or physically carried wood. See [hearths](HEARTHS.md).

## Construction and conservation

Placing a site reserves material at specific stores, prioritising nearby stores.
The material still occupies those stores until collected. Assigned builders
fetch it, walk to their assigned site approach and unload it before doing work.
Travel/loading/unloading do not earn construction person-hours. Progress is
capped by the least supplied required material, so construction cannot complete
while any required material is missing.

Stopping, reassigning or losing a carrier leaves a recoverable cache at that
person's position. Construction loads remain reserved for their site. On
cancellation, uncollected reservations return to their original stores. Unused
delivered material stays at the site as salvage, and carried loads stay at the
carrier's position. Nothing is automatically returned to camp. Temporary
building dismantling likewise leaves salvaged material at the building.

Sails and tents retain their existing ship/fabric accounting. They are reserved
when a shelter is ordered; this change does not simulate carrying entire sails
or packed tents. Ship departure still loads from the camp supply point rather
than introducing a separate dockside loading sequence.

## Model and editable rules

`storage.js` owns inventories, capacities, reservations, transfers and save
validation. `state.resources` and `state.foods` expose derived totals using
enumerable getters. Game transactions name a store explicitly. Their absolute
setters remain available for scenario tools and existing test fixtures; they
edit actual inventories and are not used for gameplay transfers.

Capacities are gameplay estimates of stacking space: warehouses use 54% of floor
area in cubic metres and workplaces use a 4% floor-area buffer. The camp starts
with at least 100 m³ of space. Timber/turf use cubic metres, stone tonnes, water
litres and other goods kilograms. Volume conversions and the 15 kg carrying
limit are explicit in `storage.js`; they are calibrations, not archaeological
measurements. Reserved stock counts against capacity. Food spoilage is applied
per inventory, with a benefit only for food actually in an operational storehouse.
Overflow from production stays in a ground cache at the producing location.

`logistics.js` handles physical construction supply and assigned hauling. Loading
takes 30 simulation seconds, unloading 60. The existing shared simulation clock
and 1×/3×/8× speed controls apply. `world-interiors.js` supplies reachable indoor
pickup/drop-off points. Hauling does not assign idle people automatically.

Camp and animal consumption remain aggregate services. Hearth fuel, room heat
and soup bowls are simulated locally; served soup offsets the eater's next camp
rations and drinking water. Transfers between stores and building-site transport
are physical. Carts and permanent warehouse staff are not simulated.

`tests/storage.cjs` covers conservation, travel, construction supply, interruption,
cancellation, capacity, local shortages, crafting inputs and save migration.
