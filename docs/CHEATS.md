# Cheat mode for testing

Open **Cogwheel → Cheat Mode**, or press **F10**. Turn on **Enable cheat mode**.
The panel does not pause the simulation; Space and the normal speed controls
still work. Esc or F10 closes the panel. A status-bar button shows when cheats
are enabled and reopens the panel.

## Construction and repairs

**Instant, free building & repairs** is selected by default when cheats are
enabled. Open the usual Build palette without selecting any people, or choose
a building in the cheat panel and press **Place building**. Click a valid site
normally. Completion is immediate, even while paused; no materials, fabric,
ship sails, person-hours or simulation time are spent. Existing geography,
rotation and overlap checks still apply. Completed buildings have their normal
interiors, inventories, collision and selection behavior.

Normal repair buttons also repair instantly for free. **Repair all + Hall F**
restores existing buildings, Hall F and anchored ships. **Finish all
construction** completes existing orders. It first returns uncollected
reservations and leaves carried/delivered supplies in physical caches through
the normal cancellation process, then creates the free finished structure.
Assigned builders are released. Free fabric shelters cannot return an unpaid
tent or ship sail when dismantled.

## Resources

Choose a resource, amount and destination, then **Create resources**. Units are
shown explicitly: m³ for timber/turf, tonnes for stone, litres for water and kg
for other resources. Firewood can be seasoned, fresh or very dry, for testing
ignition and useful heat.

- **Pile in front / map centre:** creates a visible physical stockpile ahead of
  Karlsefni in walk view, or at clear ground near the camera target in district
  view. It will not spawn through a wall or into an occupied position. If there
  is no clear point, move or turn before trying again.
- **Camp inventory:** adds resources directly to camp.
- **Nearby hearth inventory:** adds resources to the hearth beside Karlsefni.

Piles are ordinary local inventories: nearby firewood can be picked up with G,
and workers ordered to supply camp/buildings can haul their contents. They
remain in the saved world when cheat mode is disabled. Their small visible
bundles are markers, rather than a geometric representation of every kilogram.
Cheat stock destinations expand their capacity to hold the requested quantity.

## Weather

Choose **Weather** in the cheat panel: **Fair winds**, **Coastal rain**,
**Atlantic gale** or **Snow**. The selection takes effect immediately and remains
until changed. **Natural weather** returns to the normal seeded seasonal weather.
This changes the shared simulation weather, including precipitation, wind,
exposure, work conditions, visuals and sound. It does not advance time or change
the date, daylight or sun position. Rain uses temperatures above freezing; snow
uses freezing temperatures even when testing in summer.

The selection is saved with the campaign. Disabling cheat mode restores natural
weather; enabling it again reapplies the saved selection. Choose **Natural
weather** to clear the override while leaving other cheats enabled.

## Other shortcuts

- **Restore crew & herd** restores living people's health, fatigue and morale,
  and the existing herd's health. It does not revive the dead or recreate lost
  animals. **Keep crew healthy, rested & content** repeats this each hour.
- **Supply nearby hearth** adds firewood, water and soup ingredients to that
  room's inventory. Load and light the fire through the usual F controls.
- **Finish nearby soup** instantly cooks, cools and lifts an existing pot so
  bowls can be served immediately. This explicitly skips normal heating and
  fuel requirements; it does not claim to simulate that energy use.
- **Set noon / Set midnight** changes the time of day for lighting tests,
  retaining the date. This does not advance travel, work, fires or cooking.

Settings persist in campaign saves. Once an actual cheat command is used, the
campaign keeps its `used` marker. Turning cheats off restores normal costs and
survival rules; the status button changes to **CHEAT SAVE**. Created buildings,
resources and past changes remain. Older saves start with cheats off.

## Source and verification

`cheats.js` contains the commands and save validation. `cheat-controls.js` owns
the panel, spawn positioning and pile visuals; `style/cheats.css` owns its layout.
The simulation's order/repair entry points check the explicit enabled flags;
ordinary play retains the original paths. The mode is entirely local and adds
no runtime dependency or server requirement.

`npm test` includes `tests/cheats.cjs`. `npm run test:cheats` exercises the actual
offline menu, placement clicks, resource piles, repairs, save/load and smaller
screen layouts. The browser test writes `/tmp/vinland-cheat-mode.png`.
