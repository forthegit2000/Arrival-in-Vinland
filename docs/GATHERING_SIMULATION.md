# Gathering and the physical clock

At 1×, one real second advances one simulation second. The 3× and 8× controls
multiply the same clock for travel, work, construction, fires and drying. Pausing
stops it. A ten-hour shift takes 75 real minutes at 8×.

`Simulation.advanceRealtime(seconds, world)` runs `gathering.js` in 0.1-second
steps. `Simulation.advance(hours)` advances the calendar and passive processes;
it does not manufacture worker labor or move people. All work needs explicit
orders. Gatherers and builders work 08:00–18:00; support jobs use the approved
camp workday. Travel, loading, tool care and unloading consume shift time.

## Tree work

`work-timing.js` contains the editable hand-tool estimates and activity names.
Each tree goes through clearing, felling, branch removal and cross-cutting before
workers bundle timber or split firewood. Trunk diameter and species determine
felling effort; height determines branch work and the number of cross-cuts.

Nominal conifer felling takes `(30 + 0.6 × diameter_cm²)` seconds: **4.5 minutes
at 20 cm**, **16.5 minutes at 40 cm**. These are calibration estimates, not measured
AD 1005 cutting times. Birch gets a 1.25 hardness multiplier. Clearing adds 90
seconds; limbing adds approximately one minute per metre of tree height;
cross-cutting adds separate diameter-dependent work. Skill, condition and weather
adjust effective labor. See `treeBudget()` for the complete readable formulas.

Only one worker fells a standing tree. Two can process the fallen trunk. Workers
stand clear for three seconds after felling; winds of 40 km/h or more suspend
standing-tree cutting. Every fifteen minutes of axe work adds a 45-second pause
for tool care/rest. These safety thresholds are gameplay assumptions. The axe
animation runs only during actual axe work, never while off duty, travelling,
bundling, sharpening, waiting or speaking to Karlsefni.

Felling removes the crown and leaves a stump and finite wood on the ground.
Timber and firewood consume the **same** material. There is no extra fuel award
for felling. Tree size supplies an estimated 0.08–0.50 m³ of usable wood. A workshop
adds 25% to limbing, cross-cutting and splitting, not felling or transport.

## Other work and carrying

| Operation                 | Nominal on-site estimate            | Load                          |
| ------------------------- | ----------------------------------- | ----------------------------- |
| Bundle prepared timber    | 30 seconds per load                 | 0.030 m³, approximately 15 kg |
| Split and bundle firewood | 15 minutes plus 30 seconds per load | 15 kg                         |
| Cut and stack turf        | 3 minutes per load                  | 0.020 m³, approximately 15 kg |
| Mow rough meadow          | 180 m² per person-hour              | Cut grass remains on site     |
| Gather cured hay          | 30 kg per person-hour               | Up to 12 kg                   |
| Shore fishing             | 3 kg per person-hour                | 1 kg                          |
| Gather edible plants      | 2 kg per person-hour                | 1 kg                          |

Fishing/foraging productivity is unchanged; smaller loads permit earlier return
trips instead of waiting hours to fill a ten-kilogram load. These are averaged
catch/picking rates, not individual fish or species simulations. Weather, season,
fish pressure, skill and condition still affect them. A fishing shelter adds 25%
to catch work. Frozen turf cannot be cut.

Walking starts at 1.4 m/s, reduced to 75% when carrying, with terrain penalties.
Completed loads remain on people until they reach a suitable **individual store**
and spend 60 seconds unloading. Only then do stocks and the production ledger
increase. Storage space, paths and distance matter. Ground bundles take 30 seconds
to pick up. Stopping, retasking or losing a worker leaves recoverable cargo.
See [physical storage](STORAGE.md) and [building interiors](BUILDING_INTERIORS.md).

Hay yields an estimated 0.2 kg dry matter/m². A six-metre patch supplies 7.2 kg.
Cut grass needs sixteen fair daylight hours above 1°C before collection. Night
pauses drying; rain reverses curing progress and rewets uncollected dry hay.
Continued mowing restarts the combined windrow's curing period. This simplified
moisture model omits turning, detailed plant moisture and microbial losses.

Turf removal leaves bare ground; mowing and picking leave visible marks. Trees
and turf do not regenerate. Mown/picked patches can regrow after 21 days outside
winter. Habitat budgets and regeneration are scenario estimates.

## Batches and limits

Charcoal and stockfish now have separate preparation labor, elapsed burning or
drying, and unloading labor. They consume inputs from their own building's store.
Select workers, inspect the building and choose **Work here with selected people**.
[Work timing audit](WORK_TIMING_AUDIT.md) explains these processes and sources.

Saves retain partial stages, cargo, drying and batches. Old felling progress is
converted once; already-felled legacy trees retain their preparation credit.
Old carried ten-kilogram food loads remain valid.

Camp water/animal care and ironworking still use aggregate hourly outputs weighted
by actual on-site work time. They are not complete vessel, animal or smelting-cycle
simulations. Construction uses explicit person-hours and crew limits, but individual
building estimates are not archaeological measurements. Existing hearth fuel and
soup energy calculations are documented in [HEARTHS.md](HEARTHS.md).
